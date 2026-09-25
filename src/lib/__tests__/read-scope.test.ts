import { beforeEach, describe, expect, it } from "vitest";
import type { OrgContext } from "@/lib/gestion/api";
import { addManagerMessage } from "@/lib/gestion/requests";
import { billState } from "@/lib/gestion/bills";
import { windowStart } from "@/lib/demo/scope";
import { FakeDb } from "./helpers/fake-postgrest";
import { ORG, ctxFor, hydrate, letTo, seedProperty } from "./helpers/tenancy";

/**
 * What the real loader reads for each question a screen asks: the shell's
 * light read, the bounded default, a tenancy's sheet, a property's, one
 * conversation in full, a page of the register. The rows are seeded on the
 * in-memory database and read back through the same phases production
 * runs, so a table read whole where a filter was meant fails here.
 */

const ANNA = { firstName: "Anna", lastName: "Weber", email: "anna.weber@example.lu" };
const LUC = { firstName: "Luc", lastName: "Weber", email: "luc.weber@example.lu" };
const today = new Date().toISOString().slice(0, 10);
const at = (hour: number): string => `${today}T${String(hour).padStart(2, "0")}:00:00.000Z`;
/** The first day of the month n months back. */
const monthsBack = (n: number): string => windowStart(today, n);
const RENT = 125000;
const UNKNOWN = "00000000-0000-4000-8000-000000000000";

describe("the real loader reads what the screen asks for", () => {
  let db: FakeDb;
  let ctx: OrgContext;
  let propertyA: string;
  let unitA: string;
  let propertyB: string;
  let unitB: string;
  let leaseA: string;
  let leaseB: string;
  let convA: string;
  let convB: string;
  let artisan: string;

  beforeEach(async () => {
    db = new FakeDb(today);
    ctx = ctxFor(db);
    db.insertRow("agencies", { id: ORG, name: "Cabinet Test" });
    db.insertRow("crm_members", { agency_id: ORG, user_id: "user-owner", role: "owner", status: "active", email: "owner@cabinet-test.lu" });
    ({ propertyId: propertyA, unitId: unitA } = seedProperty(db));
    ({ propertyId: propertyB, unitId: unitB } = seedProperty(db, ORG, "Résidence Beaulieu"));
    // A's tenancy began 30 months ago and its ledger has rolled every month
    // since (activation opens the first two; the nightly roll, stood in for
    // here, the rest): the four oldest months are paid, two old ones still owe.
    leaseA = (await letTo(ctx, unitA, [ANNA], "1 250", monthsBack(30))).leaseId;
    leaseB = (await letTo(ctx, unitB, [LUC], "980")).leaseId;
    for (let k = 28; k >= 0; k--) {
      db.insertRow("rent_periods", { org_id: ORG, lease_id: leaseA, period: monthsBack(k), due_date: monthsBack(k), rent_cents: RENT, charges_cents: 15000 });
    }
    const periods = db.table("rent_periods").filter((rp) => rp.lease_id === leaseA).sort((a, b) => (String(a.period) < String(b.period) ? -1 : 1));
    expect(periods).toHaveLength(31);
    for (const rp of periods.slice(0, 4)) {
      db.insertRow("payment_allocations", { org_id: ORG, payment_id: UNKNOWN, rent_period_id: rp.id, amount_cents: rp.total_cents });
    }
    // Two conversations: the desk wrote to both, Anna answered on hers (unread), Luc's is the newest.
    const a = await addManagerMessage(ctx, { leaseId: leaseA }, "Bonjour Anna");
    if ("error" in a) throw new Error(a.error);
    convA = a.conversationId;
    db.table("messages").find((m) => m.id === a.id)!.sent_at = at(8);
    db.insertRow("messages", { org_id: ORG, conversation_id: convA, sender_kind: "tenant", sender_user_id: "user-anna", body: "Une question sur les charges", sent_at: at(9) });
    db.insertRow("messages", { org_id: ORG, conversation_id: convA, sender_kind: "manager", sender_user_id: "user-owner", body: "Je regarde", sent_at: at(10), read_at: at(10) });
    const b = await addManagerMessage(ctx, { leaseId: leaseB }, "Bonjour Luc");
    if ("error" in b) throw new Error(b.error);
    convB = b.conversationId;
    db.table("messages").find((m) => m.id === b.id)!.sent_at = at(10);
    db.insertRow("messages", { org_id: ORG, conversation_id: convB, sender_kind: "manager", sender_user_id: "user-owner", body: "Les clés sont prêtes", sent_at: at(11), read_at: at(11) });
    db.table("conversations").find((c) => c.id === convA)!.last_message_at = at(10);
    db.table("conversations").find((c) => c.id === convB)!.last_message_at = at(11);
    // The register: three loose pieces, one on B's property, one on A's tenancy.
    const piece = (name: string, hour: number, related: { type: string; id: string } | null) =>
      db.insertRow("documents", {
        org_id: ORG, name, class: "other", retention_class: "accounting_10y", retention_until: null, sealed: false,
        related_type: related?.type ?? null, related_id: related?.id ?? null, size_bytes: 1024, storage_path: `${ORG}/documents/${name}`, created_at: at(hour),
      });
    piece("un.pdf", 1, null);
    piece("deux.pdf", 2, null);
    piece("trois.pdf", 3, null);
    piece("reglement-beaulieu.pdf", 4, { type: "property", id: propertyB });
    piece("bail-anna.pdf", 5, { type: "lease", id: leaseA });
    // The books: a boiler repair on A (open), an old paid insurance on B, a fee with no date.
    artisan = String(db.insertRow("contacts", { org_id: ORG, kind: "legal", legal_name: "Krier Chauffage" }).id);
    db.insertRow("contact_roles", { org_id: ORG, contact_id: artisan, role: "artisan" });
    db.insertRow("bills", { org_id: ORG, supplier_contact_id: artisan, property_id: propertyA, unit_id: unitA, category: "maintenance_repairs", subject: "Chaudière", doc_no: "F-2026-1", doc_date: today, due_on: today, amount_cents: 124000, vat_cents: 18017 });
    db.insertRow("bills", { org_id: ORG, property_id: propertyB, category: "insurance", subject: "PNO 2023", doc_date: monthsBack(36), paid_on: monthsBack(36), amount_cents: 186000, vat_rate_pct: 0 });
    db.insertRow("bills", { org_id: ORG, category: "management_fees", subject: "Honoraires", paid_on: today, amount_cents: 30000, vat_cents: 4359 });
    // Two requests, one per property; two bank operations, one waiting in the review queue.
    db.insertRow("tickets", { org_id: ORG, unit_id: unitA, property_id: propertyA, lease_id: leaseA, source: "tenant", category: "plumbing", severity: "priority", status: "new", title: "Fuite", created_at: at(6), updated_at: at(6) });
    db.insertRow("tickets", { org_id: ORG, unit_id: unitB, property_id: propertyB, lease_id: leaseB, source: "manager", category: "other", severity: "routine", status: "new", title: "Boîte aux lettres", created_at: at(7), updated_at: at(7) });
    db.insertRow("bank_transactions", { org_id: ORG, booked_on: today, amount_cents: 125000, counterparty_name: "Anna Weber", match_status: "review" });
    db.insertRow("bank_transactions", { org_id: ORG, booked_on: today, amount_cents: 98000, counterparty_name: "Luc Weber", match_status: "auto" });
  });

  it("reads the bounded default: the portfolio whole, the ledger's last two years plus what still owes, the queue, the first page of the register", async () => {
    const demo = await hydrate(db);
    expect(demo.PROPERTIES.map((p) => p.name).sort()).toEqual(["Maison Weber", "Résidence Beaulieu"]);
    expect(demo.LEASES.map((l) => l.id).sort()).toEqual([leaseA, leaseB].sort());
    // 31 months opened on A: the four oldest are paid and lie outside the window, the two next still owe and come along.
    const from = windowStart(today).slice(0, 7);
    const ofA = demo.RENT_PERIODS.filter((rp) => rp.leaseId === leaseA);
    expect(ofA.filter((rp) => rp.period < from).map((rp) => rp.status)).toEqual(["late", "late"]);
    expect(ofA.filter((rp) => rp.period >= from)).toHaveLength(25);
    expect(ofA.some((rp) => rp.allocatedCents > 0)).toBe(false);
    expect(demo.TICKETS.map((t) => t.title).sort()).toEqual(["Boîte aux lettres", "Fuite"]);
    expect(demo.BANK_TXS.map((t) => t.status).sort()).toEqual(["auto", "review"]);
    // The register, newest first, one page, its count.
    expect(demo.DOCUMENTS.map((doc) => doc.name)).toEqual(["bail-anna.pdf", "reglement-beaulieu.pdf", "trois.pdf", "deux.pdf", "un.pdf"]);
    expect(demo.PAGING.documents).toEqual({ page: 1, size: 50, total: 5, pages: 1 });
    // The books: the old paid insurance is out of the window; the open bill and the undated fee are in.
    expect(demo.BILLS.map((bill) => [bill.subject, bill.supplierName, bill.hasDocument, billState(bill, today)]).sort()).toEqual([
      ["Chaudière", "Krier Chauffage", false, "due"],
      ["Honoraires", "", false, "paid"],
    ]);
    expect(demo.BILLS.find((bill) => bill.subject === "Chaudière")!.unitLabel).toContain("Maison");
    // No conversation was asked for: each carries its last word and its unread count.
    expect(demo.CONVERSATIONS.map((c) => [c.participantName, c.loaded, c.messages.map((m) => m.body), c.unread]).sort()).toEqual([
      ["Anna Weber", false, ["Je regarde"], 1],
      ["Luc Weber", false, ["Les clés sont prêtes"], 0],
    ]);
  });

  it("pages the register as the address asks, bounded", async () => {
    const second = await hydrate(db, ORG, { documents: { page: 2, size: 2 } });
    expect(second.DOCUMENTS.map((doc) => doc.name)).toEqual(["trois.pdf", "deux.pdf"]);
    expect(second.PAGING.documents).toEqual({ page: 2, size: 2, total: 5, pages: 3 });
    const last = await hydrate(db, ORG, { documents: { page: 3, size: 2 } });
    expect(last.DOCUMENTS.map((doc) => doc.name)).toEqual(["un.pdf"]);
    const beyond = await hydrate(db, ORG, { documents: { page: 9, size: 2 } });
    expect([beyond.DOCUMENTS, beyond.PAGING.documents.total]).toEqual([[], 5]);
  });

  it("opens one conversation in full: the one named, the most recent, or the tenancy's own on its sheet", async () => {
    const latest = await hydrate(db, ORG, { conversationId: "latest" });
    expect(latest.CONVERSATIONS.map((c) => [c.id, c.loaded, c.messages.length]).sort()).toEqual([[convA, false, 1], [convB, true, 2]].sort());
    const named = await hydrate(db, ORG, { conversationId: convA });
    const anna = named.CONVERSATIONS.find((c) => c.id === convA)!;
    expect([anna.loaded, anna.unread]).toEqual([true, 1]);
    expect(anna.messages.map((m) => [m.kind, m.body])).toEqual([["manager", "Bonjour Anna"], ["tenant", "Une question sur les charges"], ["manager", "Je regarde"]]);
    expect(named.CONVERSATIONS.find((c) => c.id === convB)!.loaded).toBe(false);
    // An id the policies answer nothing for falls back to the most recent: the screen never opens on nothing.
    const foreign = await hydrate(db, ORG, { conversationId: UNKNOWN });
    expect(foreign.CONVERSATIONS.find((c) => c.loaded)?.id).toBe(convB);
    const sheet = await hydrate(db, ORG, { leaseId: leaseA });
    expect(sheet.CONVERSATIONS.map((c) => [c.id, c.loaded]).sort()).toEqual([[convA, true], [convB, false]].sort());
  });

  it("reads a tenancy's sheet: its whole past, its own pieces, no books", async () => {
    const demo = await hydrate(db, ORG, { leaseId: leaseA });
    expect(demo.LEASES.map((l) => l.id)).toEqual([leaseA]);
    expect(demo.RENT_PERIODS).toHaveLength(31);
    expect(demo.RENT_PERIODS.filter((rp) => rp.allocatedCents > 0)).toHaveLength(4);
    expect(demo.TICKETS.map((t) => t.title)).toEqual(["Fuite"]);
    expect(demo.DOCUMENTS.map((doc) => doc.name)).toEqual(["bail-anna.pdf"]);
    expect(demo.BILLS).toEqual([]);
    expect(demo.BANK_TXS).toEqual([]);
    // The lot and its property are there for the sheet's labels, the other property's tenancy is not.
    expect(demo.unitById(unitA).label).toBe("Maison");
    expect(demo.propertyById(propertyA).name).toBe("Maison Weber");
  });

  it("reads a property's sheet: its lots, their tenancies, requests, pieces and bills, nothing of the next building", async () => {
    const demo = await hydrate(db, ORG, { propertyId: propertyB });
    expect(demo.PROPERTIES.map((p) => p.id)).toEqual([propertyB]);
    expect(demo.UNITS.map((u) => u.id)).toEqual([unitB]);
    expect(demo.LEASES.map((l) => l.id)).toEqual([leaseB]);
    expect(demo.TICKETS.map((t) => t.title)).toEqual(["Boîte aux lettres"]);
    expect(demo.DOCUMENTS.map((doc) => doc.name)).toEqual(["reglement-beaulieu.pdf"]);
    // A property's books are read whole: the old paid insurance is on its sheet.
    expect(demo.BILLS.map((bill) => bill.subject)).toEqual(["PNO 2023"]);
    expect(demo.RENT_PERIODS.every((rp) => rp.leaseId === leaseB)).toBe(true);
    const other = await hydrate(db, ORG, { propertyId: propertyA });
    expect(other.BILLS.map((bill) => bill.subject)).toEqual(["Chaudière"]);
    expect(other.DOCUMENTS.map((doc) => doc.name)).toEqual(["bail-anna.pdf"]);
  });

  it("reads the shell alone: the portfolio, the people, the badges, whether a rent was ever received, and no history", async () => {
    const demo = await hydrate(db, ORG, { shell: true });
    expect(demo.PROPERTIES).toHaveLength(2);
    expect(demo.UNITS).toHaveLength(2);
    expect(demo.LEASES.map((l) => l.status)).toEqual(["active", "active"]);
    expect(demo.leaseTenantNames(demo.LEASES.find((l) => l.id === leaseA)!)).toEqual(["Anna Weber"]);
    expect(demo.CONTACTS.map((c) => c.name).sort()).toEqual(["Anna Weber", "Krier Chauffage", "Luc Weber"]);
    expect(demo.CONVERSATIONS.reduce((sum, c) => sum + c.unread, 0)).toBe(1);
    expect(demo.BANK_TXS.map((t) => t.status)).toEqual(["review"]);
    // One period with money on it is enough to tick "a first rent received".
    expect(demo.RENT_PERIODS).toHaveLength(1);
    expect(demo.RENT_PERIODS[0].allocatedCents).toBeGreaterThan(0);
    expect([demo.TICKETS, demo.DOCUMENTS, demo.BILLS, demo.EDLS, demo.DEPOSITS, demo.ARREARS_ACTIONS, demo.CHARGE_PERIODS]).toEqual([[], [], [], [], [], [], []]);
    expect(demo.PAGING.documents.total).toBe(0);
  });
});
