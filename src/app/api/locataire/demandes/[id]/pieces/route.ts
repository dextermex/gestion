import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { authedClient } from "@/lib/supabase/server";
import { MEDIA_BUCKET } from "@/lib/gestion/media";
import { withTenant } from "@/lib/portal/session";
import { attachTenantFiles, type UploadedFile } from "@/lib/portal/requests";
import { attachmentFolder } from "@/lib/portal/types";

/**
 * Photos for one of the tenant's own requests. Each file goes into the
 * lease's folder of the private media bucket under the tenant's token, so
 * the storage policy decides (their lease, in force); then the documents
 * are recorded on the intervention, where the owner's screens list them.
 */
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif" };
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 5;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withTenant();
  if (ctx instanceof NextResponse) return ctx;
  const { g, session } = ctx;
  const { id } = await params;

  const { data: ticket, error } = await g.from("tickets").select("id,org_id,lease_id").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: "storage_failed" }, { status: 502 });
  if (!ticket || !ticket.lease_id) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const lease = { id: String(ticket.lease_id), orgId: String(ticket.org_id) };

  const form = await req.formData().catch(() => null);
  const files = (form?.getAll("files") ?? []).filter((f): f is File => f instanceof File).slice(0, MAX_FILES);
  if (files.length === 0) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const storage = authedClient(session.accessToken).storage.from(MEDIA_BUCKET);
  const folder = attachmentFolder(lease.orgId, lease.id);
  const uploaded: UploadedFile[] = [];
  let refused = 0;
  for (const file of files) {
    const ext = TYPES[file.type];
    if (!ext || file.size > MAX_BYTES || file.size === 0) {
      refused += 1;
      continue;
    }
    const path = `${folder}${randomUUID()}.${ext}`;
    const { error: upErr } = await storage.upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) {
      console.error("request photo upload failed:", upErr.message);
      refused += 1;
      continue;
    }
    uploaded.push({ path, name: file.name, mime: file.type, sizeBytes: file.size });
  }
  if (uploaded.length === 0) return NextResponse.json({ error: "upload_failed", refused }, { status: 502 });

  const result = await attachTenantFiles(g, { id: session.userId }, lease, String(ticket.id), uploaded);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.error === "forbidden" ? 403 : 502 });
  return NextResponse.json({ ok: true, attached: result.attached, refused });
}
