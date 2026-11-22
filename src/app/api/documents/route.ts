import { NextRequest, NextResponse } from "next/server";
import { withOrgAndClient } from "@/lib/gestion/api";
import { registerUploaded, relatedExists, storeDocument } from "@/lib/gestion/documents";
import { DOCUMENT_CLASSES, documentName, type DocumentClass } from "@/lib/gestion/documents-rules";

/**
 * A piece added to the workspace's register: the file, its class, a name,
 * and the record it hangs off when there is one. The bucket's policy and
 * the table's decide under the caller's own token.
 *
 * Two shapes. A file of a few megabytes travels in the request itself (a
 * form). A larger one was put in the bucket by the browser, with the token
 * `POST /api/documents/televersement` handed out, and this route is then
 * told its path (JSON): the file is read back from the bucket and
 * registered exactly as the other is.
 *
 * A piece of a tenancy may be shared with its tenants (`shared`): only
 * then do they read it in their space.
 */
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function POST(req: NextRequest) {
  const ctx = await withOrgAndClient("write");
  if (ctx instanceof NextResponse) return ctx;
  const json = (req.headers.get("content-type") ?? "").includes("application/json");
  const form = json ? null : await req.formData().catch(() => null);
  const body = json ? ((await req.json().catch(() => ({}))) as Record<string, unknown>) : null;
  const field = (name: string): unknown => (body ? body[name] : form?.get(name));

  const file = form?.get("file");
  const uploadedPath = body ? str(body.uploadedPath, 300) : "";
  const klass = str(field("class"), 40) as DocumentClass;
  const hasFile = file instanceof File && file.size > 0;
  if ((!hasFile && !uploadedPath) || !DOCUMENT_CLASSES.includes(klass)) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const relatedType = str(field("relatedType"), 40);
  const relatedId = str(field("relatedId"), 64);
  if ((relatedType && !relatedId) || (!relatedType && relatedId)) return NextResponse.json({ error: "invalid" }, { status: 400 });
  if (relatedType) {
    const exists = await relatedExists(ctx, relatedType, relatedId);
    if (exists === null) return NextResponse.json({ error: "invalid" }, { status: 400 });
    if (!exists) return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const shared = field("shared") === true || field("shared") === "true";

  const stored = hasFile
    ? await storeDocument(ctx, ctx.client, {
        file: file as File,
        klass,
        name: documentName(str(field("name"), 160), (file as File).name),
        relatedType: relatedType || null,
        relatedId: relatedId || null,
        shared,
      })
    : await registerUploaded(ctx, ctx.client, { path: uploadedPath, klass, name: str(field("name"), 160), relatedType: relatedType || null, relatedId: relatedId || null, shared });
  if ("error" in stored) {
    const status = stored.error === "invalid" ? 400 : stored.error === "unsupported_type" ? 415 : stored.error === "too_large" ? 413 : 502;
    return NextResponse.json({ error: stored.error }, { status });
  }
  return NextResponse.json({ id: stored.id, name: stored.name, sizeBytes: stored.sizeBytes, sha256: stored.sha256 }, { status: 201 });
}
