import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrgContext } from "@/lib/gestion/api";
import { storeBytes } from "@/lib/gestion/documents";
import { generateDocument, type GenerateFailure } from "@/lib/documents/generate";
import {
  EXPIRY_DAYS,
  authModeFor,
  normalizePhone,
  orderSigners,
  signerIssues,
  usageForSending,
  type EnvelopeStatus,
  type SignatureLevel,
  type SignerInput,
  type SignerIssue,
  type SignerLocale,
  type SignerStatus,
} from "./envelope";
import type { ProviderEnv, SignatureStatus } from "./provider";
import { anchorFor, isProviderError, type ProviderErrorCode, type SignatureClient } from "./youtrust";

/**
 * A lease's contract, sent to be signed and brought back sealed. Every
 * write runs under the caller's own session, so the policies decide; the
 * provider is reached with the deployment's key from the server alone.
 *
 * Sending: the lease must be a dossier (a draft), with no sending still out;
 * the signers are exactly the tenants the contract names, then the lessor;
 * the contract is produced afresh from the validated template with an
 * anchor per signer, recorded, sent, and its usage put on the ledger.
 *
 * Reading back: an open sending is read from the provider at most once a
 * minute; signatures as they come, and once every signer has signed, the
 * signed PDF and the merged audit trail sealed in the register beside the lease.
 */

type Row = Record<string, unknown>;
const s = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const MISSING_TABLE = new Set(["PGRST205", "42P01"]);
const isMissing = (e: { code?: string } | null): boolean => Boolean(e && MISSING_TABLE.has(s(e.code)));

export interface SignerForm {
  contactId?: string | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  locale?: SignerLocale;
}

export interface SendInput {
  leaseId: string;
  level: SignatureLevel;
  tenants: SignerForm[];
  lessor: SignerForm;
}

export type SendFailure =
  | { error: "not_configured" }
  | { error: "level_unavailable" }
  | { error: "not_found" }
  | { error: "not_draft" }
  | { error: "already_sent" }
  | { error: "parties_changed" }
  | { error: "signers_invalid"; issues: Array<{ position: number; issues: SignerIssue[] }> }
  | { error: "provider"; reason: ProviderErrorCode }
  | { error: "schema_outdated" }
  | { error: "storage_failed"; context: string; detail: { code?: string; message?: string } | null }
  | GenerateFailure;

export interface Provider {
  status: SignatureStatus;
  client: SignatureClient;
}

/** How long a sending may sit as a draft before it is taken for an interrupted one. */
export const STALE_DRAFT_MS = 10 * 60_000;

const addDays = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** The tenants a lease's contract names: tenants still living there. */
async function currentTenantIds(ctx: OrgContext, leaseId: string): Promise<string[] | { error: { code?: string; message?: string } }> {
  const { data, error } = await ctx.g.from("lease_parties").select("contact_id,role,moved_out_on").eq("org_id", ctx.org.id).eq("lease_id", leaseId);
  if (error) return { error };
  return ((data ?? []) as Row[]).filter((p) => s(p.role) === "tenant" && !p.moved_out_on).map((p) => s(p.contact_id));
}

export async function sendLeaseForSignature(ctx: OrgContext, storage: SupabaseClient, provider: Provider | null, input: SendInput, today: string): Promise<{ envelopeId: string; status: EnvelopeStatus } | SendFailure> {
  if (!provider || !provider.status.configured || !provider.status.provider) return { error: "not_configured" };
  if (!provider.status.levels.includes(input.level)) return { error: "level_unavailable" };
  const { g, org } = ctx;

  const { data: lease, error: leaseErr } = await g.from("leases").select("id,status").eq("org_id", org.id).eq("id", input.leaseId).maybeSingle();
  if (leaseErr) return { error: "storage_failed", context: "lease lookup", detail: leaseErr };
  if (!lease) return { error: "not_found" };
  if (s(lease.status) !== "draft") return { error: "not_draft" };

  // A sending left a draft by an interrupted request (older than ten minutes) no longer holds the lease.
  const stale = new Date(Date.now() - STALE_DRAFT_MS).toISOString();
  await g.from("signature_envelopes").update({ status: "failed", failure: "stale_draft" }).eq("org_id", org.id).eq("lease_id", input.leaseId).eq("status", "draft").lte("created_at", stale);
  const { data: live, error: liveErr } = await g.from("signature_envelopes").select("id").eq("org_id", org.id).eq("lease_id", input.leaseId).in("status", ["draft", "ongoing"]).limit(1);
  if (liveErr) return isMissing(liveErr) ? { error: "schema_outdated" } : { error: "storage_failed", context: "live sending lookup", detail: liveErr };
  if ((live ?? []).length > 0) return { error: "already_sent" };

  const tenantIds = await currentTenantIds(ctx, input.leaseId);
  if (!Array.isArray(tenantIds)) return { error: "storage_failed", context: "parties lookup", detail: tenantIds.error };
  const asked = new Set(input.tenants.map((t) => s(t.contactId)));
  if (tenantIds.length === 0 || asked.size !== tenantIds.length || tenantIds.some((id) => !asked.has(id))) return { error: "parties_changed" };

  // Each signer as the provider will receive them, checked before anything is produced or sent.
  const asSigner = (f: SignerForm, role: SignerInput["role"], level: SignatureLevel): SignerInput => ({
    role,
    contactId: role === "lessor" ? null : s(f.contactId) || null,
    firstName: f.firstName.trim(),
    lastName: f.lastName.trim(),
    email: f.email.trim().toLowerCase(),
    phone: f.phone && f.phone.trim() ? f.phone.trim() : null,
    locale: f.locale ?? "fr",
    level,
  });
  const tenants = input.tenants.map((t) => asSigner(t, "tenant", input.level));
  const lessor = asSigner(input.lessor, "lessor", "electronic_signature");
  const checked = [...tenants, lessor].map((sg, i) => ({ position: i + 1, issues: signerIssues(sg) })).filter((c) => c.issues.length > 0);
  if (checked.length > 0) return { error: "signers_invalid", issues: checked };

  // The contract, afresh from the validated template, with an anchor per signer.
  const produced = await generateDocument(ctx, storage, { kind: "lease_contract", sourceId: input.leaseId, force: true, today, signing: { anchorFor } });
  if ("error" in produced) return produced;
  if (!produced.bytes || !produced.parties) return { error: "storage_failed", context: "contract production", detail: null };
  const ordered = orderSigners(produced.parties.map((p) => p.id), tenants, lessor);
  if (!ordered) return { error: "parties_changed" };
  const signers = ordered.map((sg) => ({ ...sg, phone: sg.phone ? normalizePhone(sg.phone) : null }));

  const env: ProviderEnv = provider.status.env;
  const { data: envelope, error: envErr } = await g
    .from("signature_envelopes")
    .insert({
      org_id: org.id,
      lease_id: input.leaseId,
      document_id: produced.documentId,
      provider: provider.status.provider,
      provider_env: env,
      status: "draft",
      level: input.level,
      expires_on: addDays(today, EXPIRY_DAYS),
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (envErr || !envelope) {
    if (envErr && s(envErr.code) === "23505") return { error: "already_sent" };
    if (envErr && isMissing(envErr)) return { error: "schema_outdated" };
    return { error: "storage_failed", context: "sending insert", detail: envErr };
  }
  const envelopeId = s(envelope.id);
  const signerRows = signers.map((sg, i) => ({
    org_id: org.id,
    envelope_id: envelopeId,
    position: i + 1,
    role: sg.role,
    contact_id: sg.contactId,
    first_name: sg.firstName,
    last_name: sg.lastName,
    email: sg.email,
    phone: sg.phone,
    locale: sg.locale,
    level: sg.level,
    auth_mode: authModeFor(sg.level, sg.phone) ?? "otp_email",
  }));
  const { data: insertedSigners, error: signerErr } = await g.from("signature_signers").insert(signerRows).select("id,position");
  if (signerErr || !insertedSigners) {
    await g.from("signature_envelopes").update({ status: "failed", failure: "signers_insert" }).eq("org_id", org.id).eq("id", envelopeId);
    return { error: "storage_failed", context: "signers insert", detail: signerErr };
  }

  const sent = await provider.client.send({
    name: produced.name.replace(/\.pdf$/i, ""),
    externalId: envelopeId,
    fileName: produced.name,
    pdf: produced.bytes,
    expiresOn: addDays(today, EXPIRY_DAYS),
    signers: signerRows.map((r) => ({ firstName: r.first_name, lastName: r.last_name, email: r.email, phone: r.phone, locale: r.locale as SignerLocale, level: r.level as SignatureLevel, authMode: r.auth_mode })),
  });
  if (isProviderError(sent)) {
    await g.from("signature_envelopes").update({ status: "failed", failure: sent.error }).eq("org_id", org.id).eq("id", envelopeId);
    return { error: "provider", reason: sent.error };
  }

  const sentAt = new Date().toISOString();
  const { error: upErr } = await g.from("signature_envelopes").update({ status: "ongoing", provider_request_id: sent.requestId, sent_at: sentAt, last_synced_at: sentAt }).eq("org_id", org.id).eq("id", envelopeId);
  if (upErr) return { error: "storage_failed", context: "sending update", detail: upErr };
  const byPosition = new Map(((insertedSigners ?? []) as Row[]).map((r) => [Number(r.position), s(r.id)]));
  for (let i = 0; i < sent.signerIds.length; i++) {
    const id = byPosition.get(i + 1);
    if (id) await g.from("signature_signers").update({ provider_signer_id: sent.signerIds[i], status: i === 0 ? "notified" : "pending" }).eq("org_id", org.id).eq("id", id);
  }
  const usage = usageForSending(signers).map((l) => ({
    org_id: org.id,
    kind: l.kind,
    quantity: l.quantity,
    unit_price_cents: l.unitPriceCents,
    unit_cost_cents: l.unitCostCents,
    lease_id: input.leaseId,
    envelope_id: envelopeId,
    provider: provider.status.provider,
    provider_env: env,
    created_by: ctx.userId,
  }));
  const { error: usageErr } = await g.from("usage_charges").insert(usage);
  if (usageErr) console.error("usage ledger insert failed:", usageErr.code, usageErr.message);
  return { envelopeId, status: "ongoing" };
}

/** The suffix a signed piece and its audit trail carry in the register, in the contract's language. */
const SIGNED_NAME: Record<string, { signed: string; trail: string }> = {
  fr: { signed: "signé", trail: "Journal de preuve" },
  en: { signed: "signed", trail: "Audit trail" },
  de: { signed: "unterschrieben", trail: "Prüfprotokoll" },
  lu: { signed: "ënnerschriwwen", trail: "Beweisjournal" },
};

export interface SyncResult {
  checked: number;
  changed: number;
}

/** How often one sending may be read back from the provider. */
export const SYNC_INTERVAL_MS = 60_000;

/**
 * Reads the open sendings back from the provider: the oldest first when no
 * ids are given, at most SYNC_BATCH in a pass, each at most once a minute
 * unless forced, and the pass stops as soon as the provider asks to slow down.
 */
export async function syncSendings(ctx: OrgContext, storage: SupabaseClient, provider: Provider | null, opts: { envelopeIds?: string[]; force?: boolean; now?: Date } = {}): Promise<SyncResult | { error: "not_configured" } | { error: "schema_outdated" }> {
  if (!provider || !provider.status.configured) return { error: "not_configured" };
  const { g, org } = ctx;
  const now = opts.now ?? new Date();
  let q = g.from("signature_envelopes").select("id,lease_id,document_id,provider_request_id,status,last_synced_at").eq("org_id", org.id).eq("status", "ongoing");
  if (opts.envelopeIds && opts.envelopeIds.length > 0) q = q.in("id", opts.envelopeIds.slice(0, 20));
  const { data: envelopes, error } = await q.order("sent_at", { ascending: true }).limit(SYNC_BATCH);
  if (error) return isMissing(error) ? { error: "schema_outdated" } : { checked: 0, changed: 0 };
  let checked = 0;
  let changed = 0;
  for (const e of (envelopes ?? []) as Row[]) {
    const last = e.last_synced_at ? Date.parse(s(e.last_synced_at)) : 0;
    if (!opts.force && last && now.getTime() - last < SYNC_INTERVAL_MS) continue;
    const requestId = s(e.provider_request_id);
    if (!requestId) continue;
    checked++;
    const outcome = await syncOne(ctx, storage, provider.client, e, requestId, now);
    if (outcome === "rate_limited") break;
    if (outcome === "changed") changed++;
  }
  return { checked, changed };
}

/** At most this many sendings are read back in one pass (the sandbox allows 30 calls a minute). */
export const SYNC_BATCH = 10;

type SyncOutcome = "changed" | "unchanged" | "rate_limited";

async function syncOne(ctx: OrgContext, storage: SupabaseClient, client: SignatureClient, envelope: Row, requestId: string, now: Date): Promise<SyncOutcome> {
  const { g, org } = ctx;
  const envelopeId = s(envelope.id);
  const nowIso = now.toISOString();
  const state = await client.read(requestId);
  if (isProviderError(state)) {
    // The provider asks to slow down: stop this pass, nothing is marked read.
    if (state.error === "rate_limited") return "rate_limited";
    // A sending the provider no longer knows is closed; anything else is read again next time.
    if (state.error === "not_found") {
      await g.from("signature_envelopes").update({ status: "canceled", failure: "not_found_at_provider", last_synced_at: nowIso }).eq("org_id", org.id).eq("id", envelopeId);
      return "changed";
    }
    await g.from("signature_envelopes").update({ last_synced_at: nowIso }).eq("org_id", org.id).eq("id", envelopeId);
    return "unchanged";
  }

  let changed = false;
  const { data: signerRows } = await g.from("signature_signers").select("id,position,first_name,last_name,provider_signer_id,status,signed_at,audit_document_id").eq("org_id", org.id).eq("envelope_id", envelopeId).order("position");
  const rows = (signerRows ?? []) as Row[];
  const byProvider = new Map(rows.map((r) => [s(r.provider_signer_id), r]));
  for (const ps of state.signers) {
    const row = byProvider.get(ps.id);
    if (!row || s(row.status) === ps.status) continue;
    const patch: Row = { status: ps.status as SignerStatus };
    if (ps.status === "signed" && !row.signed_at) {
      // When they signed, as the provider recorded it; the moment it was read here otherwise.
      const at = await client.signedAt(requestId, ps.id);
      patch.signed_at = typeof at === "string" ? at : nowIso;
    }
    await g.from("signature_signers").update(patch).eq("org_id", org.id).eq("id", s(row.id));
    row.status = ps.status;
    if (patch.signed_at) row.signed_at = patch.signed_at;
    changed = true;
  }

  if (state.status === "done") {
    const sealed = await sealSigned(ctx, storage, client, envelope, requestId, rows);
    if (!sealed) {
      // The provider is done but a file did not come back: read again next time, nothing half-written.
      await g.from("signature_envelopes").update({ last_synced_at: nowIso, failure: "download_pending" }).eq("org_id", org.id).eq("id", envelopeId);
      return changed ? "changed" : "unchanged";
    }
    const completedAt = state.completedAt ?? nowIso;
    await g.from("signature_envelopes").update({ status: "done", completed_at: completedAt, signed_document_id: sealed, last_synced_at: nowIso, failure: null }).eq("org_id", org.id).eq("id", envelopeId);
    await g.from("leases").update({ signed_at: completedAt }).eq("org_id", org.id).eq("id", s(envelope.lease_id)).is("signed_at", null);
    return "changed";
  }
  if (state.status === "declined" || state.status === "expired" || state.status === "canceled") {
    await g.from("signature_envelopes").update({ status: state.status, last_synced_at: nowIso }).eq("org_id", org.id).eq("id", envelopeId);
    return "changed";
  }
  await g.from("signature_envelopes").update({ last_synced_at: nowIso }).eq("org_id", org.id).eq("id", envelopeId);
  return changed ? "changed" : "unchanged";
}

/**
 * The signed contract and the signers' merged audit trail, sealed beside the
 * lease; the signed piece's id, or null when a file did not come back.
 */
async function sealSigned(ctx: OrgContext, storage: SupabaseClient, client: SignatureClient, envelope: Row, requestId: string, signers: Row[]): Promise<string | null> {
  const { g, org } = ctx;
  const leaseId = s(envelope.lease_id);
  const [{ data: sent }, { data: gen }] = await Promise.all([
    g.from("documents").select("id,name").eq("org_id", org.id).eq("id", s(envelope.document_id)).maybeSingle(),
    g.from("generated_documents").select("lang").eq("org_id", org.id).eq("document_id", s(envelope.document_id)).maybeSingle(),
  ]);
  const words = SIGNED_NAME[s(gen?.lang)] ?? SIGNED_NAME.fr;
  const baseName = s(sent?.name).replace(/\.pdf$/i, "") || "Contrat";

  const pdf = await client.signedDocument(requestId);
  if (isProviderError(pdf)) return null;
  const trail = await client.auditTrails(requestId);
  if (isProviderError(trail)) return null;

  const stored = await storeBytes(ctx, storage, { bytes: pdf, mime: "application/pdf", klass: "lease", name: `${baseName} · ${words.signed}.pdf`, relatedType: "lease", relatedId: leaseId, sealed: true });
  if ("error" in stored) return null;
  const storedTrail = await storeBytes(ctx, storage, { bytes: trail, mime: "application/pdf", klass: "lease", name: `${words.trail} · ${baseName}.pdf`, relatedType: "lease", relatedId: leaseId, sealed: true });
  if (!("error" in storedTrail)) {
    for (const r of signers) await g.from("signature_signers").update({ audit_document_id: storedTrail.id }).eq("org_id", org.id).eq("id", s(r.id));
  }
  return stored.id;
}

export type CancelFailure = { error: "not_configured" } | { error: "not_found" } | { error: "not_live" } | { error: "provider"; reason: ProviderErrorCode } | { error: "schema_outdated" };

/** A sending still out, cancelled at the provider and here. */
export async function cancelSending(ctx: OrgContext, provider: Provider | null, envelopeId: string): Promise<{ ok: true } | CancelFailure> {
  if (!provider || !provider.status.configured) return { error: "not_configured" };
  const { g, org } = ctx;
  const { data: envelope, error } = await g.from("signature_envelopes").select("id,status,provider_request_id").eq("org_id", org.id).eq("id", envelopeId).maybeSingle();
  if (error) return isMissing(error) ? { error: "schema_outdated" } : { error: "not_found" };
  if (!envelope) return { error: "not_found" };
  if (s(envelope.status) !== "ongoing" || !envelope.provider_request_id) return { error: "not_live" };
  const res = await provider.client.cancel(s(envelope.provider_request_id));
  if (isProviderError(res) && res.error !== "not_found") return { error: "provider", reason: res.error };
  await g.from("signature_envelopes").update({ status: "canceled", last_synced_at: new Date().toISOString() }).eq("org_id", org.id).eq("id", envelopeId).eq("status", "ongoing");
  return { ok: true };
}
