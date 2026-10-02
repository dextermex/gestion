import { beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fr } from "@/lib/i18n/fr";
import type { OrgContext } from "@/lib/gestion/api";
import { parseDossierInput, saveRentalDraft } from "@/lib/gestion/rental";
import { activateLease } from "@/lib/gestion/lease";
import { DOCUMENT_KINDS } from "@/lib/documents/kinds";
import { templateVersion } from "@/lib/documents/wording";
import { ADDON_PRICE_CENTS } from "@/lib/billing/prices";
import { cancelSending, sendLeaseForSignature, syncSendings, type Provider, type SendInput } from "@/lib/signature/service";
import type { ProviderError, ProviderState, SendRequest, SignatureClient } from "@/lib/signature/youtrust";
import { FakeDb } from "@/lib/__tests__/helpers/fake-postgrest";
import { completeContractFacts, LESSOR_PERSON } from "@/lib/__tests__/helpers/contract-identity";

/**
 * A dossier's contract sent to be signed and brought back sealed, on one
 * database and a scripted provider: refused when it should be, produced
 * afresh with an anchor per signer, recorded and sent tenants first, read
 * back as signatures come in, sealed once done, and cancellable.
 */
const ORG = "0f0f0f0f-0000-4000-8000-0000000000aa";
const today = new Date().toISOString().slice(0, 10);
const SETTINGS = {
  org_id: ORG,
  legal_name: "Cabinet Test s.à r.l.",
  signatory_name: "Alex Test",
  address_street: "Rue de Bonnevoie",
  address_number: "24",
  postal_code: "1260",
  city: "Luxembourg",
  country: "LU",
  email: "cabinet@example.lu",
  phone: "",
  iban: "LU280019400644750000",
  bic: "BCEELULL",
  holder_name: "Cabinet Test s.à r.l.",
  document_lang: "fr",
};

function ctxFor(db: FakeDb): OrgContext {
  return { g: db.client(), org: { id: ORG, name: "Cabinet Test", kind: "owner", role: "owner" }, userId: "user-1" };
}

function fakeStorage(): { client: SupabaseClient; files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>();
  const client = {
    storage: {
      from: () => ({
        upload: async (path: string, bytes: Buffer) => {
          files.set(path, bytes);
          return { data: { path }, error: null };
        },
        remove: async (paths: string[]) => {
          for (const p of paths) files.delete(p);
          return { data: [], error: null };
        },
      }),
    },
  } as unknown as SupabaseClient;
  return { client, files };
}

interface Script {
  send?: (req: SendRequest) => { requestId: string; signerIds: string[] } | ProviderError;
  read?: (requestId: string) => ProviderState | ProviderError;
  signedDocument?: () => Buffer | ProviderError;
}

function scripted(script: Script, levels: Provider["status"]["levels"] = ["electronic_signature", "advanced_electronic_signature"]) {
  const calls: Array<[string, unknown]> = [];
  let n = 0;
  const client: SignatureClient = {
    async send(req) {
      calls.push(["send", req]);
      n++;
      return script.send?.(req) ?? { requestId: `req-${n}`, signerIds: req.signers.map((_, i) => `ps-${n}-${i + 1}`) };
    },
    async read(id) {
      calls.push(["read", id]);
      return script.read?.(id) ?? { status: "ongoing", completedAt: null, signers: [] };
    },
    async signedAt(id, signerId) {
      calls.push(["signedAt", signerId]);
      return "2026-10-02T08:00:00.000Z";
    },
    async signedDocument(id) {
      calls.push(["signedDocument", id]);
      return script.signedDocument?.() ?? Buffer.from("%PDF-1.7 signed");
    },
    async auditTrails(id) {
      calls.push(["auditTrails", id]);
      return Buffer.from("%PDF-1.7 trail");
    },
    async cancel(id) {
      calls.push(["cancel", id]);
      return true;
    },
  };
  const provider: Provider = { status: { configured: true, provider: "yousign", env: "sandbox", levels }, client };
  return { calls, provider, script };
}

async function draftLease(db: FakeDb, ctx: OrgContext, label: string, email: string): Promise<{ leaseId: string; tenantId: string }> {
  const property = db.insertRow("properties", { org_id: ORG, name: `Maison ${label}`, type: "house", address: { street: "Rue de la Gare", number: "12", postal_code: "8001", city: "Strassen" }, commune: "Strassen" });
  const unit = db.insertRow("units", { org_id: ORG, property_id: property.id, label, kind: "dwelling", area_sqm: 120, rooms: 5 });
  const input = parseDossierInput({ unitId: unit.id, step: "rent", tenants: [{ firstName: "Anna", lastName: "Weber", email }], rent: "1250", startDate: today, paymentDay: "1" }, "fr");
  if (!input) throw new Error("unreadable dossier");
  const saved = await saveRentalDraft(ctx, fr, input);
  if ("error" in saved) throw new Error(saved.error);
  const party = db.table("lease_parties").find((p) => p.lease_id === saved.leaseId && p.role === "tenant");
  // Every party and the dwelling named in full: the contract can be produced.
  completeContractFacts(db, saved.leaseId);
  return { leaseId: saved.leaseId, tenantId: String(party?.contact_id) };
}

const sending = (leaseId: string, tenantId: string, over: Partial<SendInput> = {}): SendInput => ({
  leaseId,
  level: "electronic_signature",
  tenants: [{ contactId: tenantId, firstName: "Anna", lastName: "Weber", email: "anna.weber@example.lu", phone: "+352 621 123 456", locale: "fr" }],
  lessor: { firstName: "Alex", lastName: "Test", email: "cabinet@example.lu", phone: null },
  ...over,
});

describe("a lease's contract, sent to be signed", () => {
  let db: FakeDb;
  let ctx: OrgContext;
  let storage: ReturnType<typeof fakeStorage>;
  let lease: { leaseId: string; tenantId: string };

  beforeEach(async () => {
    db = new FakeDb(today);
    ctx = ctxFor(db);
    storage = fakeStorage();
    db.insertRow("workspace_settings", { ...SETTINGS, ...LESSOR_PERSON });
    for (const kind of DOCUMENT_KINDS) db.insertRow("template_validations", { org_id: ORG, kind, lang: "fr", version: templateVersion(kind, "fr"), validated_by: "user-1" });
    lease = await draftLease(db, ctx, "Maison", "anna.weber@example.lu");
  });

  it("refuses without a provider, at a level the account lacks, for a running lease, or for signers the lease does not name", async () => {
    expect(await sendLeaseForSignature(ctx, storage.client, null, sending(lease.leaseId, lease.tenantId), today)).toEqual({ error: "not_configured" });
    const { provider } = scripted({}, ["electronic_signature"]);
    expect(await sendLeaseForSignature(ctx, storage.client, provider, sending(lease.leaseId, lease.tenantId, { level: "qualified_electronic_signature" }), today)).toEqual({ error: "level_unavailable" });
    expect(await sendLeaseForSignature(ctx, storage.client, provider, sending(lease.leaseId, "0f0f0f0f-0000-4000-8000-00000000dead"), today)).toEqual({ error: "parties_changed" });
    expect(await sendLeaseForSignature(ctx, storage.client, provider, sending("0f0f0f0f-0000-4000-8000-00000000beef", lease.tenantId), today)).toEqual({ error: "not_found" });
    const active = await activateLease(ctx, lease.leaseId, today);
    expect("error" in active).toBe(false);
    expect(await sendLeaseForSignature(ctx, storage.client, provider, sending(lease.leaseId, lease.tenantId), today)).toEqual({ error: "not_draft" });
    expect(db.table("signature_envelopes")).toHaveLength(0);
    expect(db.table("generated_documents")).toHaveLength(0);
  });

  it("names the signer who cannot be sent at the level asked, before producing anything", async () => {
    const { provider, calls } = scripted({});
    const out = await sendLeaseForSignature(ctx, storage.client, provider, sending(lease.leaseId, lease.tenantId, { level: "advanced_electronic_signature", tenants: [{ contactId: lease.tenantId, firstName: "Anna", lastName: "Weber", email: "anna.weber@example.lu", phone: null }] }), today);
    expect(out).toEqual({ error: "signers_invalid", issues: [{ position: 1, issues: ["phone"] }] });
    expect(calls).toHaveLength(0);
    expect(db.table("generated_documents")).toHaveLength(0);
  });

  it("produces the contract afresh, records the sending, sends the tenants then the lessor, and puts the usage on the ledger", async () => {
    const { provider, calls } = scripted({});
    const out = await sendLeaseForSignature(ctx, storage.client, provider, sending(lease.leaseId, lease.tenantId), today);
    expect(out).toMatchObject({ status: "ongoing" });
    const envelopeId = (out as { envelopeId: string }).envelopeId;

    const [gen] = db.table("generated_documents");
    expect(gen).toMatchObject({ kind: "lease_contract", source_id: lease.leaseId });
    const envelope = db.table("signature_envelopes")[0];
    expect(envelope).toMatchObject({ id: envelopeId, org_id: ORG, lease_id: lease.leaseId, document_id: gen.document_id, provider: "yousign", provider_env: "sandbox", status: "ongoing", provider_request_id: "req-1", level: "electronic_signature" });
    expect(String(envelope.expires_on) > today).toBe(true);

    const signers = db.table("signature_signers").sort((a, b) => Number(a.position) - Number(b.position));
    expect(signers.map((s) => [s.position, s.role, s.contact_id, s.phone, s.auth_mode, s.provider_signer_id, s.status])).toEqual([
      [1, "tenant", lease.tenantId, "+352621123456", "otp_sms", "ps-1-1", "notified"],
      [2, "lessor", null, null, "otp_email", "ps-1-2", "pending"],
    ]);

    const [, req] = calls.find(([k]) => k === "send") as [string, SendRequest];
    expect(req.externalId).toBe(envelopeId);
    expect(req.signers.map((s) => s.lastName)).toEqual(["Weber", "Test"]);
    expect(req.pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(req.fileName.endsWith(".pdf")).toBe(true);
    expect(req.name.endsWith(".pdf")).toBe(false);

    expect(db.table("usage_charges").map((u) => [u.kind, u.quantity, u.unit_price_cents, u.provider_env, u.envelope_id])).toEqual([["signature_sending", 1, ADDON_PRICE_CENTS.signature_sending, "sandbox", envelopeId]]);

    // While it is out, nothing else is sent for the same lease.
    expect(await sendLeaseForSignature(ctx, storage.client, provider, sending(lease.leaseId, lease.tenantId), today)).toEqual({ error: "already_sent" });
  });

  it("counts every advanced signature on the ledger", async () => {
    const { provider } = scripted({});
    await sendLeaseForSignature(ctx, storage.client, provider, sending(lease.leaseId, lease.tenantId, { level: "advanced_electronic_signature" }), today);
    expect(db.table("usage_charges").map((u) => [u.kind, u.quantity])).toEqual([
      ["signature_sending", 1],
      ["signature_advanced", 1],
    ]);
  });

  it("marks a sending the provider refused as failed, bills nothing, and lets a new one go out", async () => {
    const refusing = scripted({ send: () => ({ error: "invalid", status: 400, detail: "phone_number" }) });
    expect(await sendLeaseForSignature(ctx, storage.client, refusing.provider, sending(lease.leaseId, lease.tenantId), today)).toEqual({ error: "provider", reason: "invalid" });
    expect(db.table("signature_envelopes")[0]).toMatchObject({ status: "failed", failure: "invalid" });
    expect(db.table("usage_charges")).toHaveLength(0);
    const { provider } = scripted({});
    expect(await sendLeaseForSignature(ctx, storage.client, provider, sending(lease.leaseId, lease.tenantId), today)).toMatchObject({ status: "ongoing" });
  });

  it("reads signatures back as they come, at most once a minute, then seals the signed contract and the audit trail and dates the lease's signature", async () => {
    const run = scripted({});
    const out = await sendLeaseForSignature(ctx, storage.client, run.provider, sending(lease.leaseId, lease.tenantId), today);
    const envelopeId = (out as { envelopeId: string }).envelopeId;

    // Just sent: read again only after a minute.
    expect(await syncSendings(ctx, storage.client, run.provider)).toEqual({ checked: 0, changed: 0 });

    run.script.read = () => ({ status: "ongoing", completedAt: null, signers: [{ id: "ps-1-1", status: "signed" }, { id: "ps-1-2", status: "notified" }] });
    expect(await syncSendings(ctx, storage.client, run.provider, { force: true })).toEqual({ checked: 1, changed: 1 });
    const tenant = db.table("signature_signers").find((s) => s.position === 1);
    expect(tenant).toMatchObject({ status: "signed", signed_at: "2026-10-02T08:00:00.000Z" });
    expect(db.table("signature_envelopes")[0].status).toBe("ongoing");

    // Done at the provider, but the signed file does not come back: nothing half-written.
    run.script.read = () => ({ status: "done", completedAt: "2026-10-02T09:30:00.000Z", signers: [{ id: "ps-1-1", status: "signed" }, { id: "ps-1-2", status: "signed" }] });
    run.script.signedDocument = () => ({ error: "unavailable" });
    const before = db.table("documents").length;
    await syncSendings(ctx, storage.client, run.provider, { force: true });
    expect(db.table("signature_envelopes")[0]).toMatchObject({ status: "ongoing", failure: "download_pending" });
    expect(db.table("documents")).toHaveLength(before);

    run.script.signedDocument = undefined;
    expect(await syncSendings(ctx, storage.client, run.provider, { force: true })).toEqual({ checked: 1, changed: 1 });
    const envelope = db.table("signature_envelopes")[0];
    expect(envelope).toMatchObject({ id: envelopeId, status: "done", completed_at: "2026-10-02T09:30:00.000Z", failure: null });
    const signed = db.table("documents").find((d) => d.id === envelope.signed_document_id);
    expect(signed).toMatchObject({ class: "lease", sealed: true, related_type: "lease", related_id: lease.leaseId, mime: "application/pdf" });
    expect(String(signed?.name)).toMatch(/· signé\.pdf$/);
    const trail = db.table("documents").find((d) => String(d.name).startsWith("Journal de preuve · "));
    expect(trail).toMatchObject({ sealed: true, related_id: lease.leaseId });
    expect(db.table("signature_signers").every((s) => s.audit_document_id === trail?.id)).toBe(true);
    expect(db.table("leases").find((l) => l.id === lease.leaseId)?.signed_at).toBe("2026-10-02T09:30:00.000Z");

    // A done sending is no longer read.
    expect(await syncSendings(ctx, storage.client, run.provider, { force: true })).toEqual({ checked: 0, changed: 0 });
  });

  it("stops a pass as soon as the provider asks to slow down, and closes a sending that was declined", async () => {
    const run = scripted({});
    await sendLeaseForSignature(ctx, storage.client, run.provider, sending(lease.leaseId, lease.tenantId), today);
    const second = await draftLease(db, ctx, "Studio", "ben@example.lu");
    await sendLeaseForSignature(ctx, storage.client, run.provider, { ...sending(second.leaseId, second.tenantId), tenants: [{ contactId: second.tenantId, firstName: "Anna", lastName: "Weber", email: "ben@example.lu", phone: null }] }, today);

    run.script.read = () => ({ error: "rate_limited", status: 429 });
    expect(await syncSendings(ctx, storage.client, run.provider, { force: true })).toEqual({ checked: 1, changed: 0 });
    expect(run.calls.filter(([k]) => k === "read")).toHaveLength(1);

    run.script.read = () => ({ status: "declined", completedAt: null, signers: [{ id: "ps-1-1", status: "declined" }] });
    expect(await syncSendings(ctx, storage.client, run.provider, { force: true })).toEqual({ checked: 2, changed: 2 });
    expect(db.table("signature_envelopes").map((e) => e.status)).toEqual(["declined", "declined"]);
  });

  it("cancels a sending still out, at the provider and here, and only once", async () => {
    const run = scripted({});
    const out = await sendLeaseForSignature(ctx, storage.client, run.provider, sending(lease.leaseId, lease.tenantId), today);
    const envelopeId = (out as { envelopeId: string }).envelopeId;
    expect(await cancelSending(ctx, run.provider, envelopeId)).toEqual({ ok: true });
    expect(run.calls.filter(([k]) => k === "cancel")).toEqual([["cancel", "req-1"]]);
    expect(db.table("signature_envelopes")[0].status).toBe("canceled");
    expect(await cancelSending(ctx, run.provider, envelopeId)).toEqual({ error: "not_live" });
    expect(await cancelSending(ctx, run.provider, "0f0f0f0f-0000-4000-8000-00000000beef")).toEqual({ error: "not_found" });
    // Cancelled, the lease may be sent again.
    expect(await sendLeaseForSignature(ctx, storage.client, run.provider, sending(lease.leaseId, lease.tenantId), today)).toMatchObject({ status: "ongoing" });
  });
});
