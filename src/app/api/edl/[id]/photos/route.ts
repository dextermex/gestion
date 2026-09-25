import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { withOrgAndClient, dbError } from "@/lib/gestion/api";
import { MEDIA_BUCKET } from "@/lib/gestion/media";

/**
 * A photo of an inventory item: stored in the workspace's folder for the
 * session, fingerprinted, chained to the photo before it (each row keeps
 * the previous fingerprint), so the manifest the seal hashes covers every
 * picture in order. Images only, under the bucket's own limit.
 */
export const runtime = "nodejs";

const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif" };
const MAX_BYTES = 25 * 1024 * 1024;
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withOrgAndClient();
  if (ctx instanceof NextResponse) return ctx;
  const { g, org, client } = ctx;
  const { id } = await params;
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const itemId = str(form?.get("itemId"), 64);
  if (!(file instanceof File) || file.size === 0 || !itemId) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const ext = IMAGE_TYPES[file.type];
  if (!ext) return NextResponse.json({ error: "unsupported_type" }, { status: 415 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "too_large" }, { status: 413 });

  const [{ data: session, error: sErr }, { data: item, error: iErr }] = await Promise.all([
    g.from("edl_sessions").select("id,status,hash_manifest_sha256").eq("org_id", org.id).eq("id", id).maybeSingle(),
    g.from("edl_items").select("id,session_id").eq("org_id", org.id).eq("id", itemId).maybeSingle(),
  ]);
  if (sErr) return dbError("inventory lookup", sErr);
  if (iErr) return dbError("inventory item lookup", iErr);
  if (!session || !item || String(item.session_id) !== id) return NextResponse.json({ error: "not_found" }, { status: 404 });
  // A sealed inventory takes no more pictures: its manifest is fixed.
  if (String(session.hash_manifest_sha256 ?? "")) return NextResponse.json({ error: "sealed" }, { status: 409 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const path = `${org.id}/edl/${id}/${randomUUID()}.${ext}`;
  const { error: upErr } = await client.storage.from(MEDIA_BUCKET).upload(path, bytes, { contentType: file.type, upsert: false });
  if (upErr) {
    console.error("inventory photo upload failed:", upErr.message);
    return NextResponse.json({ error: "upload_failed" }, { status: 502 });
  }
  // The chain: the previous photo of the session, by capture order.
  const { data: items } = await g.from("edl_items").select("id").eq("org_id", org.id).eq("session_id", id);
  const itemIds = ((items ?? []) as Array<{ id: string }>).map((x) => x.id);
  const { data: previous } = itemIds.length > 0
    ? await g.from("edl_media").select("sha256").eq("org_id", org.id).in("item_id", itemIds).order("captured_at", { ascending: false }).limit(1).maybeSingle()
    : { data: null };
  const capturedAt = new Date().toISOString();
  const { data, error } = await g
    .from("edl_media")
    .insert({ org_id: org.id, item_id: itemId, storage_path: path, sha256, captured_at: capturedAt, prev_sha256: previous?.sha256 ? String(previous.sha256) : null })
    .select("id")
    .single();
  if (error || !data) {
    await client.storage.from(MEDIA_BUCKET).remove([path]).catch(() => null);
    return dbError("inventory photo insert", error);
  }
  return NextResponse.json({ id: data.id, sha256, capturedAt }, { status: 201 });
}
