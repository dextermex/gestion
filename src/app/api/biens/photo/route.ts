import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { authedClient, getSession } from "@/lib/supabase/server";
import { getIdentity } from "@/lib/workspace";
import { MEDIA_BUCKET } from "@/lib/gestion/media";

/**
 * Uploads a property photograph into the private `gestion-media` bucket and
 * records it on the property.
 *
 * Both halves run under the caller's own JWT, so the bucket's RLS decides:
 * the object path starts with the workspace id, and a member of another
 * cabinet is refused by the storage policy, not by this code. Nothing is
 * stored until the upload has actually succeeded.
 */

const TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};
const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const identity = await getIdentity();
  const org = identity?.active;
  if (!org) return NextResponse.json({ error: "no_workspace" }, { status: 403 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const propertyId = String(form?.get("propertyId") ?? "");
  // A lot's own photograph lives in its property's folder, under the same policies.
  const unitId = String(form?.get("unitId") ?? "");
  if (!(file instanceof File) || !propertyId) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const ext = TYPES[file.type];
  if (!ext) return NextResponse.json({ error: "unsupported_type" }, { status: 415 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "too_large" }, { status: 413 });

  const client = authedClient(session.accessToken);

  // The property must be one this account can edit. RLS would refuse the
  // update anyway; reading first turns that into an honest 404.
  const { data: property, error: findErr } = await client
    .schema("gestion")
    .from("properties")
    .select("id")
    .eq("org_id", org.id)
    .eq("id", propertyId)
    .maybeSingle();
  if (findErr || !property) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (unitId) {
    const { data: unit, error: unitErr } = await client
      .schema("gestion")
      .from("units")
      .select("id")
      .eq("org_id", org.id)
      .eq("property_id", propertyId)
      .eq("id", unitId)
      .maybeSingle();
    if (unitErr || !unit) return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const path = `${org.id}/${propertyId}/${randomUUID()}.${ext}`;
  const { error: upErr } = await client.storage
    .from(MEDIA_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) {
    console.error("photo upload failed:", upErr.message);
    return NextResponse.json({ error: "upload_failed" }, { status: 502 });
  }

  const { error: setErr } = unitId
    ? await client.schema("gestion").from("units").update({ photo_url: path }).eq("org_id", org.id).eq("id", unitId)
    : await client.schema("gestion").from("properties").update({ photo_url: path }).eq("org_id", org.id).eq("id", propertyId);
  if (setErr) {
    // The object is orphaned rather than silently half-applied; say so.
    console.error("photo_url update failed:", setErr.code, setErr.message);
    return NextResponse.json({ error: "storage_failed" }, { status: 502 });
  }

  return NextResponse.json({ path });
}
