import { NextRequest, NextResponse } from "next/server";
import { withOrgAndClient, dbError } from "@/lib/gestion/api";
import { generateDocument } from "@/lib/documents/generate";
import { isDocumentKind } from "@/lib/documents/kinds";
import type { Locale } from "@/lib/i18n/config";

/**
 * A document of the workspace, produced from its rows: the kind, the
 * record it is about, optionally the language (the settings' by default)
 * and whether a new version is wanted when one exists already. Answers
 * the document's register id and fingerprint, or why not.
 */
export const runtime = "nodejs";

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function POST(req: NextRequest) {
  const ctx = await withOrgAndClient();
  if (ctx instanceof NextResponse) return ctx;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const kind = str(body.kind, 40);
  const sourceId = str(body.sourceId, 64);
  if (!isDocumentKind(kind) || !sourceId) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const lang = str(body.lang, 2) as Locale | "";
  const result = await generateDocument(ctx, ctx.client, { kind, sourceId, lang: lang || undefined, force: body.force === true });
  if ("error" in result) {
    if (result.error === "not_found") return NextResponse.json(result, { status: 404 });
    if (result.error === "storage_failed") return dbError(result.context, result.detail);
    if (result.error === "template_error") return NextResponse.json(result, { status: 500 });
    return NextResponse.json(result, { status: 409 });
  }
  return NextResponse.json(result, { status: result.existing ? 200 : 201 });
}
