import { NextRequest, NextResponse } from "next/server";
import { withOrgAndClient } from "@/lib/gestion/api";
import { relatedExists, storeDocument } from "@/lib/gestion/documents";
import { DOCUMENT_CLASSES, documentName, type DocumentClass } from "@/lib/gestion/documents-rules";

/**
 * A piece added to the workspace's register: the file, its class, a name,
 * and the record it hangs off when there is one. The bucket's policy and
 * the table's decide under the caller's own token.
 */
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function POST(req: NextRequest) {
  const ctx = await withOrgAndClient();
  if (ctx instanceof NextResponse) return ctx;
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const klass = str(form?.get("class"), 40) as DocumentClass;
  if (!(file instanceof File) || file.size === 0 || !DOCUMENT_CLASSES.includes(klass)) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const relatedType = str(form?.get("relatedType"), 40);
  const relatedId = str(form?.get("relatedId"), 64);
  if ((relatedType && !relatedId) || (!relatedType && relatedId)) return NextResponse.json({ error: "invalid" }, { status: 400 });
  if (relatedType) {
    const exists = await relatedExists(ctx, relatedType, relatedId);
    if (exists === null) return NextResponse.json({ error: "invalid" }, { status: 400 });
    if (!exists) return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const stored = await storeDocument(ctx, ctx.client, {
    file,
    klass,
    name: documentName(str(form?.get("name"), 160), file.name),
    relatedType: relatedType || null,
    relatedId: relatedId || null,
  });
  if ("error" in stored) {
    const status = stored.error === "unsupported_type" ? 415 : stored.error === "too_large" ? 413 : 502;
    return NextResponse.json({ error: stored.error }, { status });
  }
  return NextResponse.json({ id: stored.id, name: stored.name, sizeBytes: stored.sizeBytes, sha256: stored.sha256 }, { status: 201 });
}
