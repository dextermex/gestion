import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fr } from "@/lib/i18n/fr";
import type { OrgContext } from "@/lib/gestion/api";
import { parseDossierInput, saveRentalDraft, type DossierInput } from "@/lib/gestion/rental";
import { activateLease } from "@/lib/gestion/lease";
import { recordPaymentFifo } from "@/lib/banking/allocate";
import { assemble, type Assembled } from "@/lib/documents/assemble";
import { composeDocument } from "@/lib/documents/compose";
import { generateDocument, renderLabels, templateValidated, type Generated } from "@/lib/documents/generate";
import { DOCUMENT_KINDS } from "@/lib/documents/kinds";
import { sealManifest } from "@/lib/documents/manifest";
import type { DocumentModel } from "@/lib/documents/model";
import { previewInput } from "@/lib/documents/preview";
import { renderPdf } from "@/lib/documents/render";
import { templateVersion } from "@/lib/documents/wording";
import { FakeDb, type Row } from "@/lib/__tests__/helpers/fake-postgrest";

/**
 * A document, start to finish, on one database: refused until the
 * workspace validated the template and filled its identity, then produced
 * from the tenancy's rows as a sealed PDF in the register, related to the
 * lease, with the record of what it was made from. The same rows give the
 * same document back; a new version is asked for explicitly.
 */
const ORG = "0f0f0f0f-0000-4000-8000-0000000000aa";
const today = new Date().toISOString().slice(0, 10);
const ANNA = { firstName: "Anna", lastName: "Weber", email: "anna.weber@example.lu" };
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

/** The bucket the register writes to, kept in memory: what was uploaded where. */
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

function seedProperty(db: FakeDb): { propertyId: string; unitId: string } {
  const property = db.insertRow("properties", {
    org_id: ORG,
    name: "Maison Weber",
    type: "house",
    address: { street: "Rue de la Gare", number: "12", postal_code: "8001", city: "Strassen" },
    commune: "Strassen",
  });
  const unit = db.insertRow("units", { org_id: ORG, property_id: property.id, label: "Maison", kind: "dwelling", area_sqm: 120, rooms: 5 });
  return { propertyId: String(property.id), unitId: String(unit.id) };
}

const dossier = (body: Record<string, unknown>): DossierInput => {
  const input = parseDossierInput(body, "fr");
  if (!input) throw new Error("unreadable dossier");
  return input;
};

async function letTo(ctx: OrgContext, unitId: string): Promise<string> {
  const saved = await saveRentalDraft(ctx, fr, dossier({ unitId, step: "rent", tenants: [ANNA], rent: "1250", startDate: today, paymentDay: "1" }));
  if ("error" in saved) throw new Error(saved.error);
  const active = await activateLease(ctx, saved.leaseId, today);
  if ("error" in active) throw new Error(active.error);
  return saved.leaseId;
}

/** The workspace validates every template in its current version. */
function validateAll(db: FakeDb): void {
  for (const kind of DOCUMENT_KINDS) db.insertRow("template_validations", { org_id: ORG, kind, lang: "fr", version: templateVersion(kind, "fr"), validated_by: "user-1" });
}

const generated = (out: Generated | { error: string }): Generated => {
  if ("error" in out) throw new Error(`generation failed: ${JSON.stringify(out)}`);
  return out;
};
const assembled = (out: Assembled | { error: string }): Assembled => {
  if ("error" in out) throw new Error(`assembly failed: ${JSON.stringify(out)}`);
  return out;
};

describe("documents produced from the rows", () => {
  let db: FakeDb;
  let ctx: OrgContext;
  let storage: ReturnType<typeof fakeStorage>;
  let leaseId: string;
  let periodId: string;
  let period: Row;

  beforeEach(async () => {
    db = new FakeDb(today);
    ctx = ctxFor(db);
    storage = fakeStorage();
    const { unitId } = seedProperty(db);
    leaseId = await letTo(ctx, unitId);
    const periods = db
      .table("rent_periods")
      .filter((r) => r.lease_id === leaseId)
      .sort((a, b) => String(a.period).localeCompare(String(b.period)));
    period = periods[0];
    periodId = String(period.id);
  });

  it("refuses to produce anything before the workspace validated the template in this language and version", async () => {
    expect(await generateDocument(ctx, storage.client, { kind: "rent_notice", sourceId: periodId, today })).toEqual({
      error: "template_not_validated",
      lang: "fr",
      version: templateVersion("rent_notice", "fr"),
    });
    expect(db.table("documents")).toHaveLength(0);
    expect(storage.files.size).toBe(0);
    // A validation of an earlier version does not count.
    db.insertRow("template_validations", { org_id: ORG, kind: "rent_notice", lang: "fr", version: "2000-01-01.1" });
    expect(await templateValidated(ctx, "rent_notice", "fr")).toEqual({ ok: false, version: templateVersion("rent_notice", "fr") });
    // A language without a template is refused, not translated.
    expect(await generateDocument(ctx, storage.client, { kind: "rent_notice", sourceId: periodId, today, lang: "en" })).toEqual({ error: "no_template", lang: "en" });
  });

  it("refuses while the lessor's identity or payment account is missing, naming the fields", async () => {
    validateAll(db);
    expect(await generateDocument(ctx, storage.client, { kind: "rent_notice", sourceId: periodId, today })).toEqual({ error: "settings_incomplete", missing: ["legalName", "address", "payment"] });
    db.insertRow("workspace_settings", { ...SETTINGS, iban: "", holder_name: "" });
    expect(await generateDocument(ctx, storage.client, { kind: "rent_notice", sourceId: periodId, today })).toEqual({ error: "settings_incomplete", missing: ["payment"] });
    // A certificate prints no payment instructions: the identity is enough.
    expect("error" in (await generateDocument(ctx, storage.client, { kind: "housing_certificate", sourceId: leaseId, today }))).toBe(false);
  });

  it("produces the rent notice as a sealed PDF in the register, related to the tenancy, with the record of what it was made from", async () => {
    validateAll(db);
    db.insertRow("workspace_settings", SETTINGS);
    const g = generated(await generateDocument(ctx, storage.client, { kind: "rent_notice", sourceId: periodId, today }));
    expect(g.existing).toBe(false);
    expect(g.name).toBe(`Avis d'échéance · Maison · ${String(period.period).slice(0, 7)}.pdf`);
    const doc = db.table("documents").find((d) => d.id === g.documentId)!;
    expect(doc).toMatchObject({ org_id: ORG, class: "other", sealed: true, related_type: "lease", related_id: leaseId, mime: "application/pdf", sha256: g.sha256, uploaded_by: "user-1" });
    const bytes = storage.files.get(String(doc.storage_path))!;
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(g.sha256);
    expect(g.sizeBytes).toBe(bytes.length);
    const rec = db.table("generated_documents").find((r) => r.document_id === g.documentId)!;
    expect(rec).toMatchObject({ org_id: ORG, kind: "rent_notice", lang: "fr", template_version: templateVersion("rent_notice", "fr"), source_type: "rent_period", source_id: periodId, generated_by: "user-1" });
    expect(String(rec.payload_sha256)).toMatch(/^[0-9a-f]{64}$/);
    // The model carries the lessor and the tenant, the rows' figures and the payment code.
    const a = assembled(await assemble(ctx, "rent_notice", periodId, today));
    expect(a.input.lessor).toMatchObject({ legalName: "Cabinet Test s.à r.l.", addressLine: "24, Rue de Bonnevoie, L-1260 Luxembourg", iban: "LU280019400644750000" });
    expect(a.input.tenants).toEqual(["Anna Weber"]);
    expect(a.input.data).toMatchObject({ rentCents: 125000, totalCents: Number(period.total_cents), allocatedCents: 0 });
    // Asked again: the same document. Asked for a new version: another one, the first kept.
    expect(await generateDocument(ctx, storage.client, { kind: "rent_notice", sourceId: periodId, today })).toMatchObject({ documentId: g.documentId, existing: true });
    const forced = generated(await generateDocument(ctx, storage.client, { kind: "rent_notice", sourceId: periodId, today, force: true }));
    expect(forced.documentId).not.toBe(g.documentId);
    expect(db.table("documents")).toHaveLength(2);
    expect(db.table("generated_documents")).toHaveLength(2);
  });

  it("issues a receipt only for a period the allocations say is paid, listing what arrived and when", async () => {
    validateAll(db);
    db.insertRow("workspace_settings", SETTINGS);
    expect(await generateDocument(ctx, storage.client, { kind: "rent_receipt", sourceId: periodId, today })).toEqual({ error: "not_ready", reason: "unpaid" });
    const paid = await recordPaymentFifo(ctx.g, ORG, { leaseId, receivedOn: today, amountCents: Number(period.total_cents), auto: false, allocatedBy: "user-1" });
    expect("error" in paid).toBe(false);
    const g = generated(await generateDocument(ctx, storage.client, { kind: "rent_receipt", sourceId: periodId, today }));
    expect(db.table("documents").find((d) => d.id === g.documentId)).toMatchObject({ class: "receipt", sealed: true, related_id: leaseId });
    const a = assembled(await assemble(ctx, "rent_receipt", periodId, today));
    expect(a.input.data).toMatchObject({ totalCents: Number(period.total_cents), allocations: [{ on: today, cents: Number(period.total_cents) }] });
  });

  it("produces the contract and the housing certificate from the lease's own rows, and nothing from another workspace's id", async () => {
    validateAll(db);
    db.insertRow("workspace_settings", SETTINGS);
    const contract = generated(await generateDocument(ctx, storage.client, { kind: "lease_contract", sourceId: leaseId, today }));
    expect(db.table("documents").find((d) => d.id === contract.documentId)).toMatchObject({ class: "lease", sealed: true, related_type: "lease", related_id: leaseId });
    expect(contract.name).toContain("Maison");
    const a = assembled(await assemble(ctx, "lease_contract", leaseId, today));
    expect(a.input.data).toMatchObject({ leaseType: "residential", startDate: today, rentCents: 125000, paymentDay: 1, tenants: [{ name: "Anna Weber", email: "anna.weber@example.lu" }], unit: { label: "Maison", areaSqm: 120, rooms: 5 } });
    const cert = generated(await generateDocument(ctx, storage.client, { kind: "housing_certificate", sourceId: leaseId, today }));
    expect(cert.existing).toBe(false);
    const c = assembled(await assemble(ctx, "housing_certificate", leaseId, today));
    expect(c.input.tenants).toEqual(["Anna Weber"]);
    expect(c.input.data).toMatchObject({ startDate: today, endDate: null });
    expect(await generateDocument(ctx, storage.client, { kind: "lease_contract", sourceId: "not-a-lease", today })).toEqual({ error: "not_found" });
    expect(await generateDocument(ctx, storage.client, { kind: "rent_notice", sourceId: "not-a-period", today })).toEqual({ error: "not_found" });
  });

  it("reports an inventory only once it is sealed, from its items and photos", async () => {
    validateAll(db);
    db.insertRow("workspace_settings", SETTINGS);
    const at = `${today}T12:00:00.000Z`;
    const session = db.insertRow("edl_sessions", { org_id: ORG, lease_id: leaseId, kind: "entry", status: "signed", scheduled_at: at, completed_at: at, key_handover_at: at, hash_manifest_sha256: null });
    const item = db.insertRow("edl_items", { org_id: ORG, session_id: session.id, room: "Séjour", category: "paint", condition: "good", notes: "Trace au-dessus de la porte" });
    expect(await generateDocument(ctx, storage.client, { kind: "edl_report", sourceId: String(session.id), today })).toEqual({ error: "not_ready", reason: "unsealed" });
    const photo = db.insertRow("edl_media", { org_id: ORG, item_id: item.id, storage_path: `${ORG}/edl/${session.id}/p.jpg`, sha256: "ab".repeat(32), captured_at: `${today}T12:05:00.000Z` });
    const { sha256 } = sealManifest(
      { id: String(session.id), kind: "entry", completedAt: today, keyHandoverAt: today },
      [{ id: String(item.id), room: "Séjour", category: "paint", condition: "good", notes: "Trace au-dessus de la porte" }],
      [{ id: String(photo.id), itemId: String(item.id), sha256: "ab".repeat(32), capturedAt: `${today}T12:05:00.000Z` }],
    );
    await ctx.g.from("edl_sessions").update({ hash_manifest_sha256: sha256, status: "sealed" }).eq("org_id", ORG).eq("id", session.id);
    const g = generated(await generateDocument(ctx, storage.client, { kind: "edl_report", sourceId: String(session.id), today }));
    expect(db.table("documents").find((d) => d.id === g.documentId)).toMatchObject({ class: "edl", sealed: true, related_id: leaseId });
    const a = assembled(await assemble(ctx, "edl_report", String(session.id), today));
    expect(a.input.data).toMatchObject({
      manifestSha256: sha256,
      signed: true,
      keyHandoverAt: today,
      rooms: [{ room: "Séjour", items: [{ category: "paint", condition: "good", photos: 1 }] }],
      photos: [{ room: "Séjour", category: "paint", sha256: "ab".repeat(32) }],
    });
  });

  it("renders the preview of a template as a watermarked PDF and stores nothing", async () => {
    const model = composeDocument(previewInput("lease_contract", "fr")) as DocumentModel;
    const bytes = await renderPdf(model, renderLabels("fr"));
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(2000);
    expect(db.table("documents")).toHaveLength(0);
    expect(storage.files.size).toBe(0);
  });
});
