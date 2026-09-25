import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrgContext } from "@/lib/gestion/api";
import { storeBytes, discardDocument } from "@/lib/gestion/documents";
import type { Locale } from "@/lib/i18n/config";
import { assemble, lessorOf, readSettings, type AssembleFailure } from "./assemble";
import { composeDocument, unfilledPlaceholders } from "./compose";
import { KIND_CLASS, type DocumentKind } from "./kinds";
import type { DocumentModel } from "./model";
import { renderPdf, type RenderLabels } from "./render";
import { missingForDocuments } from "./settings-rules";
import { templateFor, wordingFor } from "./wording";

/**
 * One document, start to finish: the template the workspace validated in
 * this language and version, the rows it is about, the model, the PDF,
 * the sealed row in the register and the record of what it was made from.
 * A kind already produced for the same source comes back as it is unless
 * a new version is asked for; every refusal names its reason.
 */
export interface Generated {
  documentId: string;
  name: string;
  sha256: string;
  sizeBytes: number;
  existing: boolean;
}

export type GenerateFailure =
  | { error: "not_found" }
  | { error: "no_template"; lang: Locale }
  | { error: "template_not_validated"; lang: Locale; version: string }
  | { error: "settings_incomplete"; missing: string[] }
  | { error: "not_ready"; reason: string }
  | { error: "template_error"; placeholders: string[] }
  | { error: "storage_failed"; context: string; detail: { code?: string; message?: string } | null };

const LANGS: Locale[] = ["fr", "en", "de", "lu"];

export function renderLabels(lang: Locale): RenderLabels {
  const w = wordingFor(lang) ?? wordingFor("fr")!;
  return { sender: w.common.senderLabel, recipient: w.common.recipientLabel, reference: w.common.referenceLabel, subject: w.common.subjectLabel, page: w.common.pageLabel };
}

/** Whether the workspace validated this template in its current version. */
export async function templateValidated(ctx: OrgContext, kind: DocumentKind, lang: Locale): Promise<{ ok: true; version: string } | { ok: false; version: string | null }> {
  const t = templateFor(kind, lang);
  if (!t) return { ok: false, version: null };
  const { data, error } = await ctx.g.from("template_validations").select("version").eq("org_id", ctx.org.id).eq("kind", kind).eq("lang", lang).maybeSingle();
  if (error) {
    console.error("template validation read failed:", error.code, error.message);
    return { ok: false, version: t.version };
  }
  return data && String(data.version) === t.version ? { ok: true, version: t.version } : { ok: false, version: t.version };
}

/** The latest document of this kind for this source, if one was produced. */
export async function existingDocument(ctx: OrgContext, kind: DocumentKind, sourceId: string): Promise<Generated | null> {
  const { data, error } = await ctx.g
    .from("generated_documents")
    .select("document_id")
    .eq("org_id", ctx.org.id)
    .eq("kind", kind)
    .eq("source_id", sourceId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const { data: doc } = await ctx.g.from("documents").select("id,name,sha256,size_bytes").eq("org_id", ctx.org.id).eq("id", String(data.document_id)).maybeSingle();
  if (!doc) return null;
  return { documentId: String(doc.id), name: String(doc.name), sha256: String(doc.sha256 ?? ""), sizeBytes: Number(doc.size_bytes) || 0, existing: true };
}

export async function generateDocument(
  ctx: OrgContext,
  client: SupabaseClient,
  req: { kind: DocumentKind; sourceId: string; lang?: Locale; force?: boolean; today?: string },
): Promise<Generated | GenerateFailure> {
  const today = req.today ?? new Date().toISOString().slice(0, 10);
  const settingsRow = await readSettings(ctx);
  const { settings } = lessorOf(settingsRow, ctx.org.name);
  const lang: Locale = req.lang && LANGS.includes(req.lang) ? req.lang : settings.documentLang;
  const template = templateFor(req.kind, lang);
  if (!template) return { error: "no_template", lang };
  const validated = await templateValidated(ctx, req.kind, lang);
  if (!validated.ok) return { error: "template_not_validated", lang, version: template.version };

  if (!req.force) {
    const existing = await existingDocument(ctx, req.kind, req.sourceId);
    if (existing) return existing;
  }

  const assembled = await assemble(ctx, req.kind, req.sourceId, today);
  if ("error" in assembled) return assembled as AssembleFailure;
  const missing = missingForDocuments(settings, assembled.needsPayment);
  if (missing.length > 0) return { error: "settings_incomplete", missing };

  const payloadSha256 = createHash("sha256").update(JSON.stringify(assembled.payload)).digest("hex");
  const model = composeDocument({ ...assembled.input, lang, reference: `${req.kind.replace(/_/g, "-")}-${req.sourceId.slice(0, 8)}` } as Parameters<typeof composeDocument>[0]);
  if ("error" in model) return { error: "no_template", lang };
  const placeholders = unfilledPlaceholders(model as DocumentModel);
  if (placeholders.length > 0) return { error: "template_error", placeholders };

  const bytes = await renderPdf(model as DocumentModel, renderLabels(lang));
  const unitShort = assembled.input.place.unitLabel.split(" · ")[0];
  const name = `${(model as DocumentModel).title} · ${unitShort} · ${assembled.nameSuffix}.pdf`;
  const stored = await storeBytes(ctx, client, {
    bytes,
    mime: "application/pdf",
    klass: KIND_CLASS[req.kind],
    name,
    relatedType: "lease",
    relatedId: assembled.leaseId,
    sealed: true,
  });
  if ("error" in stored) return { error: "storage_failed", context: `document ${stored.error}`, detail: null };

  const { error: genErr } = await ctx.g.from("generated_documents").insert({
    document_id: stored.id,
    org_id: ctx.org.id,
    kind: req.kind,
    lang,
    template_version: template.version,
    source_type: assembled.source.type,
    source_id: assembled.source.id,
    payload_sha256: payloadSha256,
    generated_by: ctx.userId,
  });
  if (genErr) {
    await discardDocument(ctx, client, { id: stored.id, path: stored.path });
    return { error: "storage_failed", context: "generated document insert", detail: genErr };
  }
  return { documentId: stored.id, name: stored.name, sha256: stored.sha256, sizeBytes: stored.sizeBytes, existing: false };
}
