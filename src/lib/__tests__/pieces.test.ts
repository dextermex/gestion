import { beforeEach, describe, expect, it } from "vitest";
import type { OrgContext } from "@/lib/gestion/api";
import { attachTenantFiles, createTenantRequest, parseRequestInput } from "@/lib/portal/requests";
import { PIECE_MAX_BYTES, isPdfName, pieceClass, pieceLine, pieceRefusal, preparePieces, type PieceLabels } from "@/lib/portal/pieces";
import { attachmentFolder } from "@/lib/portal/types";
import { fr } from "@/lib/i18n/fr";
import { tenantPieceLabels } from "@/lib/portal/labels";
import { reclassDocument, registerUploaded, removeDocument, retentionUntil, shareDocument, signedUploadTarget } from "@/lib/gestion/documents";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MAX_DOCUMENT_BYTES } from "@/lib/gestion/documents-rules";
import { DOCUMENT_KINDS, sharedOnceProduced } from "@/lib/documents/kinds";
import { FakeDb } from "./helpers/fake-postgrest";
import { ORG, ctxFor, hydrate, letTo, linkAccount, seedProperty, space } from "./helpers/tenancy";

/**
 * The files a tenant attaches to a request: photographs, and a PDF where a
 * document is what is asked for. What is refused is refused by name, with
 * its reason; what is accepted is filed under its class in the lease's own
 * folder, and reaches both sides.
 */
const ANNA = { firstName: "Anna", lastName: "Weber", email: "anna.weber@example.lu" };
const anna = { id: "user-anna", email: "anna.weber@example.lu" };
const today = new Date().toISOString().slice(0, 10);
const labels: PieceLabels = tenantPieceLabels(fr);

describe("what a tenant may attach", () => {
  it("takes photographs and a PDF, up to the size one request may carry", () => {
    expect(pieceRefusal({ type: "image/jpeg", size: 800_000 })).toBeNull();
    expect(pieceRefusal({ type: "application/pdf", size: 1_200_000 })).toBeNull();
    expect(pieceRefusal({ type: "application/pdf", size: PIECE_MAX_BYTES })).toBeNull();
    expect(pieceRefusal({ type: "application/pdf", size: PIECE_MAX_BYTES + 1 })).toBe("size");
    expect(pieceRefusal({ type: "image/heic", size: 800_000 })).toBe("type");
    expect(pieceRefusal({ type: "application/zip", size: 10 })).toBe("type");
    expect(pieceRefusal({ type: "image/png", size: 0 })).toBe("size");
    // Under the host's limit on a request body (about 4.5 MB), with room for the form around the file.
    expect(PIECE_MAX_BYTES).toBeLessThanOrEqual(4 * 1024 * 1024);
  });

  it("files a piece under what it is: a photograph, the insurance certificate, another paper", () => {
    expect(pieceClass("image/jpeg", null)).toBe("photo");
    expect(pieceClass("application/pdf", null)).toBe("other");
    expect(pieceClass("application/pdf", "insurance")).toBe("insurance");
    expect(pieceClass("image/png", "insurance")).toBe("insurance");
    expect([isPdfName("attestation.PDF"), isPdfName("evier.png"), isPdfName("pdf")]).toEqual([true, false, false]);
  });

  it("says by name what will not go, and why, instead of dropping it", async () => {
    const file = (name: string, type: string, size: number) => new File([new Uint8Array(size)], name, { type });
    const chosen = [file("evier.png", "image/png", 2000), file("attestation.pdf", "application/pdf", 3000), file("archive.zip", "application/zip", 10), file("scan.pdf", "application/pdf", PIECE_MAX_BYTES + 5)];
    const { ready, refused } = await preparePieces(chosen);
    expect(ready.map((f) => f.name)).toEqual(["evier.png", "attestation.pdf"]);
    expect(refused).toEqual([
      { name: "archive.zip", ok: false, reason: "type" },
      { name: "scan.pdf", ok: false, reason: "size" },
    ]);
    expect(refused.map((o) => pieceLine(o, labels))).toEqual([
      "archive.zip : format non accepté (JPEG, PNG, WebP ou PDF).",
      "scan.pdf : fichier trop volumineux (4 Mo au plus).",
    ]);
    // More than a handful at once: the ones beyond are named too.
    const many = await preparePieces(Array.from({ length: 7 }, (_, i) => file(`p${i}.png`, "image/png", 100)));
    expect([many.ready.length, many.refused.map((o) => [o.name, o.reason])]).toEqual([5, [["p5.png", "too_many"], ["p6.png", "too_many"]]]);
    expect(pieceLine({ name: "x.png", ok: false, reason: "failed" }, labels)).toContain("l'envoi n'a pas abouti");
  });
});

describe("a tenant's files on their request", () => {
  let db: FakeDb;
  let ctx: OrgContext;
  let leaseId: string;
  let ticketId: string;
  const folder = () => attachmentFolder(ORG, leaseId);

  beforeEach(async () => {
    db = new FakeDb(today);
    ctx = ctxFor(db);
    db.insertRow("agencies", { id: ORG, name: "Cabinet Test" });
    db.insertRow("crm_members", { agency_id: ORG, user_id: "user-owner", role: "owner", status: "active", email: "owner@cabinet-test.lu" });
    const { propertyId, unitId } = seedProperty(db);
    const rental = await letTo(ctx, unitId, [ANNA]);
    leaseId = rental.leaseId;
    await linkAccount(db, ctx, rental, anna);
    const request = await createTenantRequest(db.tenantClient(anna), anna, { id: leaseId, orgId: ORG, unitId, propertyId, subject: "Maison · Maison Weber" }, parseRequestInput({ kind: "other", title: "Attestation d'assurance habitation" })!);
    if ("error" in request) throw new Error(request.error);
    ticketId = request.id;
  });

  it("records a PDF certificate and a photograph under their classes, and both sides list them", async () => {
    const attached = await attachTenantFiles(db.tenantClient(anna), anna, { id: leaseId, orgId: ORG }, ticketId, [
      { path: `${folder()}a.pdf`, name: "attestation.pdf", mime: "application/pdf", sizeBytes: 120_000, klass: "insurance" },
      { path: `${folder()}b.jpg`, name: "compteur.jpg", mime: "image/jpeg", sizeBytes: 300_000, klass: "photo" },
      // A class a tenant may not file is brought back to a photograph; a path outside the lease's folder is not recorded.
      { path: `${folder()}c.png`, name: "plan.png", mime: "image/png", sizeBytes: 10, klass: "id_document" },
      { path: `${ORG}/documents/x.pdf`, name: "ailleurs.pdf", mime: "application/pdf", sizeBytes: 10, klass: "other" },
    ]);
    expect(attached).toEqual({ attached: 3 });
    const rows = db.table("documents").filter((d) => d.related_id === ticketId);
    expect(rows.map((d) => [d.name, d.class, d.retention_class]).sort()).toEqual([
      ["attestation.pdf", "insurance", "accounting_10y"],
      ["compteur.jpg", "photo", "gdpr_minimised"],
      ["plan.png", "photo", "gdpr_minimised"],
    ]);
    const mine = await space(db, anna);
    expect(mine.requests[0].attachments.map((a) => a.name).sort()).toEqual(["attestation.pdf", "compteur.jpg", "plan.png"]);
    const demo = await hydrate(db, ORG, {});
    expect(demo.TICKETS.find((t) => t.id === ticketId)!.attachments.map((a) => a.name).sort()).toEqual(["attestation.pdf", "compteur.jpg", "plan.png"]);
  });

  it("still delivers the certificate on a base that takes photographs only: filed as a photograph rather than refused", async () => {
    db.photosOnly = true;
    const attached = await attachTenantFiles(db.tenantClient(anna), anna, { id: leaseId, orgId: ORG }, ticketId, [
      { path: `${folder()}a.pdf`, name: "attestation.pdf", mime: "application/pdf", sizeBytes: 120_000, klass: "insurance" },
    ]);
    expect(attached).toEqual({ attached: 1 });
    expect(db.table("documents").filter((d) => d.related_id === ticketId).map((d) => [d.name, d.class])).toEqual([["attestation.pdf", "photo"]]);
  });
});

describe("what the tenant reads of the desk's side", () => {
  let db: FakeDb;
  let ctx: OrgContext;
  let leaseId: string;
  let unitId: string;

  beforeEach(async () => {
    db = new FakeDb(today);
    ctx = ctxFor(db);
    db.insertRow("agencies", { id: ORG, name: "Cabinet Test" });
    db.insertRow("crm_members", { agency_id: ORG, user_id: "user-owner", role: "owner", status: "active", email: "owner@cabinet-test.lu" });
    const seeded = seedProperty(db);
    unitId = seeded.unitId;
    const rental = await letTo(ctx, unitId, [ANNA]);
    leaseId = rental.leaseId;
    await linkAccount(db, ctx, rental, anna);
  });

  it("lists the requests the tenant raised, not an intervention the desk opened on the lot", async () => {
    db.insertRow("tickets", { id: "t-desk", org_id: ORG, lease_id: leaseId, unit_id: unitId, source: "manager", status: "triaged", title: "Devis toiture (note interne)", created_at: `${today}T08:00:00Z` });
    db.insertRow("tickets", { id: "t-mine", org_id: ORG, lease_id: leaseId, unit_id: unitId, source: "tenant", status: "new", title: "Fuite sous l'évier", created_at: `${today}T09:00:00Z` });
    const mine = await space(db, anna);
    expect(mine.requests.map((r) => r.id)).toEqual(["t-mine"]);
    // Nor its pieces: a quote filed on the desk's intervention stays at the desk.
    db.insertRow("documents", { id: "d-quote", org_id: ORG, class: "invoice", name: "devis.pdf", storage_path: `${ORG}/documents/q.pdf`, related_type: "ticket", related_id: "t-desk" });
    const again = await space(db, anna);
    expect(again.requests.flatMap((r) => r.attachments.map((a) => a.name))).toEqual([]);
  });

  it("shows a piece of the lease only once the desk shares it, and the desk can take it back", async () => {
    db.insertRow("documents", { id: "d-scan", org_id: ORG, class: "lease", name: "bail-signe.pdf", storage_path: `${ORG}/documents/s.pdf`, related_type: "lease", related_id: leaseId, shared_with_tenant: false });
    const docsOf = async () => (await space(db, anna)).current?.documents.map((d) => d.name) ?? [];
    expect(await docsOf()).toEqual([]);
    expect(await shareDocument(ctx, "d-scan", true)).toEqual({ shared: true });
    expect(await docsOf()).toEqual(["bail-signe.pdf"]);
    expect(await shareDocument(ctx, "d-scan", false)).toEqual({ shared: false });
    expect(await docsOf()).toEqual([]);
    // Only a piece of a tenancy has tenants to be shared with; another workspace's piece is not found.
    db.insertRow("documents", { id: "d-prop", org_id: ORG, class: "deed", name: "acte.pdf", storage_path: `${ORG}/documents/a.pdf`, related_type: "property", related_id: "p-1" });
    expect(await shareDocument(ctx, "d-prop", true)).toEqual({ error: "not_found" });
    expect(await shareDocument(ctxFor(db, "0f0f0f0f-0000-4000-8000-00000000beef"), "d-scan", true)).toEqual({ error: "not_found" });
  });

  it("produces for the tenant what is written for them; a formal reminder waits until it is sent", () => {
    const withheld = DOCUMENT_KINDS.filter((k) => !sharedOnceProduced(k));
    expect(withheld.sort()).toEqual(["arrears_formal", "arrears_mise_en_demeure"]);
    expect(sharedOnceProduced("rent_receipt")).toBe(true);
    expect(sharedOnceProduced("lease_contract")).toBe(true);
  });
});

describe("the retention clock of an upload", () => {
  it("runs ten years from filing for the accounting classes, three months for an applicant's papers, and stays open otherwise", () => {
    expect(retentionUntil("accounting_10y", "2026-11-20")).toBe("2036-11-20");
    expect(retentionUntil("applicant_3m", "2026-11-30")).toBe("2027-03-02");
    expect(retentionUntil("accounting_10y", "2028-02-29")).toBe("2038-03-01");
    expect(retentionUntil("permanent", "2026-11-20")).toBeNull();
    expect(retentionUntil("aml_5y_from_end", "2026-11-20")).toBeNull();
    expect(retentionUntil("gdpr_minimised", "2026-11-20")).toBeNull();
    expect(retentionUntil("accounting_10y", "nonsense")).toBeNull();
  });
});

/** The bucket as far as a large upload needs it: signed upload tokens, the stored objects, removal. */
function fakeBucket() {
  const objects = new Map<string, Uint8Array>();
  const signed: string[] = [];
  const removed: string[] = [];
  const bucket = {
    createSignedUploadUrl: async (path: string) => {
      signed.push(path);
      return { data: { token: `tok-${signed.length}`, path, signedUrl: "" }, error: null };
    },
    download: async (path: string) => {
      const bytes = objects.get(path);
      return bytes ? { data: new Blob([bytes as BlobPart]), error: null } : { data: null, error: { message: "not found" } };
    },
    remove: async (paths: string[]) => {
      for (const p of paths) {
        removed.push(p);
        objects.delete(p);
      }
      return { data: [], error: null };
    },
  };
  const client = { storage: { from: () => bucket } } as unknown as SupabaseClient;
  return { client, objects, signed, removed };
}

describe("a large piece the browser puts in the bucket itself", () => {
  let db: FakeDb;
  let ctx: OrgContext;
  beforeEach(() => {
    db = new FakeDb(today);
    ctx = ctxFor(db);
    db.insertRow("agencies", { id: ORG, name: "Cabinet Test" });
    db.insertRow("crm_members", { agency_id: ORG, user_id: "user-owner", role: "owner", status: "active", email: "owner@cabinet-test.lu" });
  });

  it("hands out a path in the workspace's own folder, for a type and a size the register takes", async () => {
    const { client, signed } = fakeBucket();
    const target = await signedUploadTarget(ctx, client, { type: "application/pdf", size: 9 * 1024 * 1024 });
    expect("path" in target && target.path).toMatch(new RegExp(`^${ORG}/documents/[0-9a-f-]{36}\\.pdf$`));
    expect(signed).toHaveLength(1);
    expect(await signedUploadTarget(ctx, client, { type: "application/x-msdownload", size: 10 })).toEqual({ error: "unsupported_type" });
    expect(await signedUploadTarget(ctx, client, { type: "application/pdf", size: MAX_DOCUMENT_BYTES + 1 })).toEqual({ error: "too_large" });
  });

  it("registers the stored file with its own size and fingerprint, once, and only from the workspace's folder", async () => {
    const { client, objects } = fakeBucket();
    const target = await signedUploadTarget(ctx, client, { type: "application/pdf", size: 6_000_000 });
    if (!("path" in target)) throw new Error("no target");
    objects.set(target.path, new Uint8Array(6_000_000).fill(7));
    const stored = await registerUploaded(ctx, client, { path: target.path, klass: "decompte", name: "Décompte syndic 2025", relatedType: null, relatedId: null });
    expect("id" in stored && stored.sizeBytes).toBe(6_000_000);
    const row = db.table("documents").find((d) => d.storage_path === target.path)!;
    expect([row.mime, row.size_bytes, row.class, row.name, String(row.sha256).length]).toEqual(["application/pdf", 6_000_000, "decompte", "Décompte syndic 2025", 64]);
    // The same path again, a path elsewhere, a name the application never hands out: refused.
    expect(await registerUploaded(ctx, client, { path: target.path, klass: "other", name: "x" })).toEqual({ error: "invalid" });
    expect(await registerUploaded(ctx, client, { path: `${ORG}/tickets/x/11111111-2222-4333-8444-555555555555.pdf`, klass: "other", name: "x" })).toEqual({ error: "invalid" });
    expect(await registerUploaded(ctx, client, { path: `${ORG}/documents/../../etc.pdf`, klass: "other", name: "x" })).toEqual({ error: "invalid" });
  });

  it("registers nothing for a file that is not there, and removes one over the limit", async () => {
    const { client, objects, removed } = fakeBucket();
    const missing = `${ORG}/documents/11111111-2222-4333-8444-555555555555.pdf`;
    expect(await registerUploaded(ctx, client, { path: missing, klass: "other", name: "x" })).toEqual({ error: "upload_failed" });
    const big = `${ORG}/documents/11111111-2222-4333-8444-666666666666.pdf`;
    objects.set(big, new Uint8Array(MAX_DOCUMENT_BYTES + 1));
    expect(await registerUploaded(ctx, client, { path: big, klass: "other", name: "x" })).toEqual({ error: "too_large" });
    expect(removed).toEqual([big]);
    expect(db.table("documents")).toHaveLength(0);
  });
});

describe("the register's housekeeping", () => {
  let db: FakeDb;
  let ctx: OrgContext;
  beforeEach(() => {
    db = new FakeDb(today);
    ctx = ctxFor(db);
    db.insertRow("agencies", { id: ORG, name: "Cabinet Test" });
    db.insertRow("crm_members", { agency_id: ORG, user_id: "user-owner", role: "owner", status: "active", email: "owner@cabinet-test.lu" });
    const piece = (id: string, extra: Record<string, unknown> = {}) =>
      db.insertRow("documents", { id, org_id: ORG, class: "other", retention_class: "accounting_10y", name: `${id}.pdf`, storage_path: `${ORG}/documents/${id}.pdf`, sealed: false, created_at: "2026-11-02T10:00:00Z", ...extra });
    piece("d-loose");
    piece("d-sealed", { sealed: true, class: "lease" });
    piece("d-produced", { sealed: false });
    db.insertRow("generated_documents", { document_id: "d-produced", org_id: ORG, kind: "rent_notice", source_id: "rp-1" });
    piece("d-invoice", { class: "invoice" });
    db.insertRow("work_orders", { id: "wo-1", org_id: ORG, ticket_id: "t-1", status: "invoiced", invoice_document_id: "d-invoice" });
  });

  it("takes out a piece filed by mistake, with its file", async () => {
    const { client, removed } = fakeBucket();
    expect(await removeDocument(ctx, client, "d-loose")).toEqual({ removed: true });
    expect(db.table("documents").some((d) => d.id === "d-loose")).toBe(false);
    expect(removed).toEqual([`${ORG}/documents/d-loose.pdf`]);
  });

  it("keeps what is sealed, produced, or named by a work order, and finds nothing of another workspace", async () => {
    const { client, removed } = fakeBucket();
    expect(await removeDocument(ctx, client, "d-sealed")).toEqual({ error: "sealed" });
    expect(await removeDocument(ctx, client, "d-produced")).toEqual({ error: "produced" });
    expect(await removeDocument(ctx, client, "d-invoice")).toEqual({ error: "in_use" });
    expect(await removeDocument(ctxFor(db, "0f0f0f0f-0000-4000-8000-00000000beef"), client, "d-loose")).toEqual({ error: "not_found" });
    expect(removed).toEqual([]);
    expect(db.table("documents")).toHaveLength(4);
  });

  it("puts a piece on another shelf with the clock of its class; a sealed piece keeps its class but can be renamed", async () => {
    expect(await reclassDocument(ctx, "d-loose", { klass: "id_document" })).toEqual({ id: "d-loose", name: null, klass: "id_document" });
    const row = db.table("documents").find((d) => d.id === "d-loose")!;
    expect([row.class, row.retention_class, row.retention_until]).toEqual(["id_document", "aml_5y_from_end", null]);
    await reclassDocument(ctx, "d-loose", { klass: "invoice" });
    expect(db.table("documents").find((d) => d.id === "d-loose")!.retention_until).toBe("2036-11-02");
    expect(await reclassDocument(ctx, "d-sealed", { klass: "other" })).toEqual({ error: "sealed" });
    expect(await reclassDocument(ctx, "d-sealed", { name: "  Bail signé  " })).toEqual({ id: "d-sealed", name: "Bail signé", klass: null });
    expect(await reclassDocument(ctx, "d-loose", { name: "   " })).toEqual({ error: "invalid" });
    expect(await reclassDocument(ctx, "d-loose", {})).toEqual({ error: "invalid" });
  });
});
