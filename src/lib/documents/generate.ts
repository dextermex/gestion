import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrgContext } from "@/lib/gestion/api";
import { storeBytes, discardDocument } from "@/lib/gestion/documents";
import type { Locale } from "@/lib/i18n/config";
import { assemble, lessorOf, readSettings, type AssembleFailure } from "./assemble";
import type { MissingItem } from "./contract-parties";
import { composeDocument, unfilledPlaceholders } from "./compose";
import { KIND_CLASS, sharedOnceProduced, type DocumentKind } from "./kinds";
import type { DocumentModel } from "./model";
import { renderPdf, type RenderLabels } from "./render";
import { missingForDocuments } from "./settings-rules";
import { templateFor, wordingFor } from "./wording";
import { todayISO } from "@/lib/clock";

/**
 * One document, start to finish: the template the workspace validated in
 * this language and version, the rows it is about, the model, the PDF,
 * the sealed row in the register and the record of what it was made from.
 * A kind already produced for the same source comes back as it is unless
 * a new version is asked for, or unless what it would say changed since
 * (another language, another version of the template, other data: a
 * corrected name, an amount, the lessor's details); every refusal names
 * its reason.
 */
export interface Generated {
  documentId: string;
  name: string;
  sha256: string;
  sizeBytes: number;
  existing: boolean;
  /** Freshly produced: the PDF itself, for a caller that sends it on (a signature). */
  bytes?: Buffer;
  /** Freshly produced: the tenants it names, in its order. */
  parties?: Array<{ id: string; name: string; email: string | null }>;
}

export type GenerateFailure =
  | { error: "not_found" }
  | { error: "no_template"; lang: Locale }
  | { error: "template_not_validated"; lang: Locale; version: string }
  | { error: "settings_incomplete"; missing: string[] }
  | { error: "not_ready"; reason: string }
  | { error: "contract_incomplete"; missing: MissingItem[] }
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

/** What a produced document was made from: its language, its template's version, the fingerprint of its data. */
export interface MadeFrom {
  lang: string;
  version: string;
  payloadSha256: string;
}

/** Whether a document made from `was` says what one made from `now` would. */
export function sameMaking(was: MadeFrom | undefined, now: MadeFrom): boolean {
  return !!was && was.lang === now.lang && was.version === now.version && was.payloadSha256 === now.payloadSha256;
}

/** The latest document of this kind for this source, if one was produced, with what it was made from. */
export async function existingDocument(ctx: OrgContext, kind: DocumentKind, sourceId: string): Promise<(Generated & { madeFrom: MadeFrom }) | null> {
  const { data, error } = await ctx.g
    .from("generated_documents")
    .select("document_id,lang,template_version,payload_sha256")
    .eq("org_id", ctx.org.id)
    .eq("kind", kind)
    .eq("source_id", sourceId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const { data: doc } = await ctx.g.from("documents").select("id,name,sha256,size_bytes").eq("org_id", ctx.org.id).eq("id", String(data.document_id)).maybeSingle();
  if (!doc) return null;
  return {
    documentId: String(doc.id),
    name: String(doc.name),
    sha256: String(doc.sha256 ?? ""),
    sizeBytes: Number(doc.size_bytes) || 0,
    existing: true,
    madeFrom: { lang: String(data.lang ?? ""), version: String(data.template_version ?? ""), payloadSha256: String(data.payload_sha256 ?? "") },
  };
}

export async function generateDocument(
  ctx: OrgContext,
  client: SupabaseClient,
  req: {
    kind: DocumentKind;
    sourceId: string;
    lang?: Locale;
    force?: boolean;
    today?: string;
    /** A contract produced to be signed electronically: the provider's anchor for the signer at a position (1 = first). */
    signing?: { anchorFor: (position: number) => string };
  },
): Promise<Generated | GenerateFailure> {
  const today = req.today ?? todayISO();
  const settingsRow = await readSettings(ctx);
  const { settings } = lessorOf(settingsRow, ctx.org.name);
  const lang: Locale = req.lang && LANGS.includes(req.lang) ? req.lang : settings.documentLang;
  const template = templateFor(req.kind, lang);
  if (!template) return { error: "no_template", lang };
  const validated = await templateValidated(ctx, req.kind, lang);
  if (!validated.ok) return { error: "template_not_validated", lang, version: template.version };

  const existing = req.force ? null : await existingDocument(ctx, req.kind, req.sourceId);
  const strip = (doc: NonNullable<typeof existing>): Generated => {
    const { madeFrom: _made, ...generated } = doc;
    void _made;
    return generated;
  };

  const assembled = await assemble(ctx, req.kind, req.sourceId, today);
  // What can no longer be produced keeps the document that was.
  if ("error" in assembled) return existing ? strip(existing) : (assembled as AssembleFailure);
  const missing = missingForDocuments(settings, assembled.needsPayment);
  if (missing.length > 0) return existing ? strip(existing) : { error: "settings_incomplete", missing };

  const payloadSha256 = createHash("sha256").update(JSON.stringify(assembled.payload)).digest("hex");
  // The same document back only when it says what this one would: same language, template and data.
  if (existing && sameMaking(existing.madeFrom, { lang, version: template.version, payloadSha256 })) return strip(existing);
  const signing = req.signing && req.kind === "lease_contract" ? { anchors: Array.from({ length: assembled.parties.length + 1 }, (_, i) => req.signing!.anchorFor(i + 1)) } : undefined;
  const model = composeDocument({ ...assembled.input, lang, reference: `${req.kind.replace(/_/g, "-")}-${req.sourceId.slice(0, 8)}`, signing } as Parameters<typeof composeDocument>[0]);
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
    // What is written for the tenant is theirs to read at once; a formal reminder is theirs once it is sent.
    shared: sharedOnceProduced(req.kind),
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
  if (!req.force) {
    // Two requests for the same document at the same moment both got this far: the first one written
    // stands, and this one is taken back, so a double request leaves one piece.
    const { data: twins } = await ctx.g
      .from("generated_documents")
      .select("document_id")
      .eq("org_id", ctx.org.id)
      .eq("kind", req.kind)
      .eq("source_id", req.sourceId)
      .eq("lang", lang)
      .eq("template_version", template.version)
      .eq("payload_sha256", payloadSha256)
      // Only a request of the same moment: an older identical piece is another story (a version since replaced).
      .gte("generated_at", new Date(Date.now() - 2 * 60_000).toISOString())
      .order("generated_at", { ascending: true })
      .limit(1);
    const first = ((twins as Array<{ document_id: unknown }> | null) ?? [])[0];
    if (first && String(first.document_id) !== stored.id) {
      const { data: doc } = await ctx.g.from("documents").select("id,name,sha256,size_bytes").eq("org_id", ctx.org.id).eq("id", String(first.document_id)).maybeSingle();
      if (doc) {
        await ctx.g.from("generated_documents").delete().eq("org_id", ctx.org.id).eq("document_id", stored.id);
        await discardDocument(ctx, client, { id: stored.id, path: stored.path });
        return { documentId: String(doc.id), name: String(doc.name), sha256: String(doc.sha256 ?? ""), sizeBytes: Number(doc.size_bytes) || 0, existing: true };
      }
    }
  }
  return { documentId: stored.id, name: stored.name, sha256: stored.sha256, sizeBytes: stored.sizeBytes, existing: false, bytes, parties: assembled.parties };
}
