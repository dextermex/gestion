import { NextRequest, NextResponse } from "next/server";
import { withOrg, dbError } from "@/lib/gestion/api";
import { composeDocument, unfilledPlaceholders } from "@/lib/documents/compose";
import { renderLabels } from "@/lib/documents/generate";
import { isDocumentKind } from "@/lib/documents/kinds";
import type { DocumentModel } from "@/lib/documents/model";
import { previewInput } from "@/lib/documents/preview";
import { renderPdf } from "@/lib/documents/render";
import { templateFor } from "@/lib/documents/wording";
import type { Locale } from "@/lib/i18n/config";

/**
 * A template as the person validating it reads it: the preview, with
 * fictitious values that say so, never stored; and the validation itself,
 * recorded for the template's current version (a later version asks
 * again), or withdrawn.
 */
export const runtime = "nodejs";

type Params = { params: Promise<{ kind: string }> };
const LANGS = ["fr", "en", "de", "lu"] as const;
const langOf = (v: unknown): Locale | null => (typeof v === "string" && (LANGS as readonly string[]).includes(v) ? (v as Locale) : null);

export async function GET(req: NextRequest, { params }: Params) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const { kind } = await params;
  const lang = langOf(req.nextUrl.searchParams.get("lang")) ?? "fr";
  if (!isDocumentKind(kind)) return NextResponse.json({ error: "invalid" }, { status: 400 });
  if (!templateFor(kind, lang)) return NextResponse.json({ error: "no_template", lang }, { status: 404 });
  const model = composeDocument(previewInput(kind, lang));
  if ("error" in model) return NextResponse.json({ error: "no_template", lang }, { status: 404 });
  const placeholders = unfilledPlaceholders(model as DocumentModel);
  if (placeholders.length > 0) return NextResponse.json({ error: "template_error", placeholders }, { status: 500 });
  const bytes = await renderPdf(model as DocumentModel, renderLabels(lang));
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="modele-${kind}-${lang}.pdf"`, "Cache-Control": "private, no-store" },
  });
}

export async function POST(req: NextRequest, { params }: Params) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const { g, org, userId } = ctx;
  const { kind } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const lang = langOf(body.lang) ?? "fr";
  if (!isDocumentKind(kind)) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const template = templateFor(kind, lang);
  if (!template) return NextResponse.json({ error: "no_template", lang }, { status: 404 });
  const { data: existing, error: readErr } = await g.from("template_validations").select("version").eq("org_id", org.id).eq("kind", kind).eq("lang", lang).maybeSingle();
  if (readErr) return dbError("template validation read", readErr);
  const validatedAt = new Date().toISOString();
  if (existing) {
    const { error } = await g.from("template_validations").update({ version: template.version, validated_by: userId, validated_at: validatedAt }).eq("org_id", org.id).eq("kind", kind).eq("lang", lang);
    if (error) return dbError("template validation update", error);
  } else {
    const { error } = await g.from("template_validations").insert({ org_id: org.id, kind, lang, version: template.version, validated_by: userId, validated_at: validatedAt });
    if (error) return dbError("template validation insert", error);
  }
  return NextResponse.json({ kind, lang, version: template.version, validatedAt });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const { g, org } = ctx;
  const { kind } = await params;
  const lang = langOf(req.nextUrl.searchParams.get("lang")) ?? "fr";
  if (!isDocumentKind(kind)) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const { error } = await g.from("template_validations").delete().eq("org_id", org.id).eq("kind", kind).eq("lang", lang);
  if (error) return dbError("template validation delete", error);
  return NextResponse.json({ ok: true });
}
