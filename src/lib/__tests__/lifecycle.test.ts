import { beforeEach, describe, expect, it } from "vitest";
import { fr } from "@/lib/i18n/fr";
import type { OrgContext } from "@/lib/gestion/api";
import { createRental, parseRentalInput, payerTenantIndex } from "@/lib/gestion/rental";
import { activateLease, closeLease, discardDraft, openLedger } from "@/lib/gestion/lease";
import { dueDateFor, ledgerMonths, nextDueOn as nextDueByRule } from "@/lib/gestion/ledger";
import { buildRealDataFrom } from "@/lib/demo/data-real";
import { orgFromWorkspace } from "@/lib/demo/data-empty";
import { buildPortfolio, findCard, nextDueOn, occupancyOf } from "@/lib/gestion/portfolio";
import { addDays, addMonths } from "@/domain/dates";
import { FakeDb } from "./helpers/fake-postgrest";

/**
 * The lifecycle of a rental, end to end, on one database.
 *
 * Every step below runs the real write functions the routes call, then
 * hydrates the dataset exactly as a signed-in account does and reads it
 * through the portfolio projection the property sheet renders. What the
 * property, the contacts, the ledger and the history show is therefore
 * asserted against the same rows, which is the whole point: there is one
 * canonical record of a tenancy, and every screen reads it.
 */

const ORG = "0f0f0f0f-0000-4000-8000-00000000c0de";
const today = new Date().toISOString().slice(0, 10);
const thisMonth = `${today.slice(0, 7)}-01`;
const nextMonth = addMonths(thisMonth, 1);
const lastDayOfMonth = addDays(nextMonth, -1);

function ctxFor(db: FakeDb): OrgContext {
  return { g: db.client(), org: { id: ORG, name: "Cabinet Test", kind: "owner", role: "owner" }, userId: "user-1" };
}

async function hydrate(db: FakeDb) {
  return buildRealDataFrom(db.client(), orgFromWorkspace({ id: ORG, name: "Cabinet Test", kind: "owner" }), async () => new Map());
}

/** Create property: a house with one lettable lot, as the property wizard writes it. */
function seedProperty(db: FakeDb): { propertyId: string; unitId: string } {
  const property = db.insertRow("properties", {
    org_id: ORG,
    name: "Maison Weber",
    type: "house",
    address: { street: "Rue de la Gare", number: "12", postal_code: "8001", city: "Strassen" },
    commune: "Strassen",
  });
  const unit = db.insertRow("units", {
    org_id: ORG,
    property_id: property.id,
    label: "Maison",
    kind: "dwelling",
    area_sqm: 120,
    rooms: 5,
  });
  return { propertyId: String(property.id), unitId: String(unit.id) };
}

const couple = (unitId: string) =>
  parseRentalInput(
    {
      unitId,
      tenants: [
        { firstName: "Anna", lastName: "Weber", email: "anna.weber@example.lu", phone: "+352 621 000 001" },
        { firstName: "Luc", lastName: "Weber" },
        { firstName: "", lastName: "" },
      ],
      colocation: false,
      type: "residential",
      startDate: thisMonth,
      rent: "1 250",
      charges: "150",
      paymentDay: "5",
      depositMonths: 2,
      depositForm: "bank_guarantee",
      payerName: "Anna Weber",
      payerIban: "LU28 0019 4006 4475 0000",
    },
    today,
    "fr",
  )!;

describe("the lifecycle of a rental", () => {
  let db: FakeDb;
  let ctx: OrgContext;
  let propertyId: string;
  let unitId: string;

  beforeEach(() => {
    db = new FakeDb(today);
    ctx = ctxFor(db);
    ({ propertyId, unitId } = seedProperty(db));
  });

  it("walks from a vacant property to a new tenancy without mixing two rentals", async () => {
    // ── Vacant ──
    let demo = await hydrate(db);
    let card = findCard(buildPortfolio(demo), propertyId)!;
    expect(occupancyOf(card)).toBe("vacant");
    expect(card.single!.tenantNames).toEqual([]);
    expect(card.monthlyCents).toBe(0);

    // ── Add tenants, create lease, set rent, complete rental ──
    const created = await createRental(ctx, fr, couple(unitId));
    if ("error" in created) throw new Error(created.error);
    expect(created.status).toBe("active");
    expect(created.contactIds).toHaveLength(2);
    expect(created.propertyId).toBe(propertyId);
    // The written lease lacks the capital investi declaration: that is a
    // compliance item for the dossier, and it changes nothing above.
    expect(created.issues.map((i) => i.code)).toContain("MENTIONS_INCOMPLETE");
    // This month and next are open the moment the lease is written.
    expect(created.periodsOpened).toBe(2);

    // ── Property becomes occupied, tenants and rent appear ──
    demo = await hydrate(db);
    card = findCard(buildPortfolio(demo), propertyId)!;
    expect(occupancyOf(card)).toBe("occupied");
    expect(card.single!.lease!.id).toBe(created.leaseId);
    expect(card.single!.lease!.status).toBe("active");
    expect(card.single!.tenantNames).toEqual(["Anna Weber", "Luc Weber"]);
    expect(card.single!.monthlyCents).toBe(140000);
    expect(card.single!.lease!.rentCents).toBe(125000);
    expect(card.single!.lease!.chargesCents).toBe(15000);
    expect(card.single!.lease!.paymentDay).toBe(5);
    expect(card.single!.lease!.colocation).toBe(false);
    expect(card.nextDue).toBe(nextDueOn(today, 5));

    // ── Monthly obligation exists, and paid-ness is derived, not stored ──
    const periods = demo.RENT_PERIODS.filter((rp) => rp.leaseId === created.leaseId);
    expect(periods.map((rp) => rp.period).sort()).toEqual([thisMonth.slice(0, 7), nextMonth.slice(0, 7)]);
    expect(periods.every((rp) => rp.totalCents === 140000 && rp.allocatedCents === 0)).toBe(true);
    expect(card.single!.period).not.toBeNull();
    expect(["pending", "late", "upcoming"]).toContain(card.single!.status);
    expect(demo.openInvoicesForMatching().some((inv) => inv.leaseId === created.leaseId)).toBe(true);

    // ── Contacts read the same lease ──
    for (const id of created.contactIds) {
      const contact = demo.CONTACTS.find((c) => c.id === id)!;
      expect(contact.roles).toContain("tenant");
      expect(demo.LEASES.filter((l) => l.tenantContactIds.includes(id)).map((l) => l.id)).toEqual([created.leaseId]);
    }
    expect(demo.leaseUnitLabel(card.single!.lease!)).toBe("Maison · Maison Weber");

    // ── Payer account, guarantee ──
    expect(demo.IBAN_BINDINGS).toContainEqual({ payerIban: "LU280019400644750000", leaseId: created.leaseId });
    expect(demo.CONTACTS.find((c) => c.id === created.contactIds[0])!.iban).toBe("LU280019400644750000");
    expect(demo.CONTACTS.find((c) => c.id === created.contactIds[1])!.iban).toBeUndefined();
    const deposit = demo.DEPOSITS.find((x) => x.leaseId === created.leaseId)!;
    expect(deposit.amountCents).toBe(250000);
    expect(deposit.form).toBe("bank_guarantee");

    // ── A second rental on a let lot is refused ──
    expect(await createRental(ctx, fr, couple(unitId))).toEqual({ error: "already_let" });

    // ── End rental ──
    const closed = await closeLease(
      ctx,
      created.leaseId,
      { endDate: lastDayOfMonth, depositOutcome: "released", releasedCents: 250000, keysReturned: true, decompteIssuedOn: null },
      today,
    );
    if ("error" in closed) throw new Error(closed.error);
    expect(closed.unitId).toBe(unitId);
    // Next month was owed by nobody and paid by nobody: it goes. This month happened.
    expect(closed.droppedPeriods).toBe(1);

    // ── Property becomes vacant, history remains whole ──
    demo = await hydrate(db);
    card = findCard(buildPortfolio(demo), propertyId)!;
    expect(occupancyOf(card)).toBe("vacant");
    expect(card.single!.tenantNames).toEqual([]);
    expect(card.monthlyCents).toBe(0);
    const ended = demo.LEASES.find((l) => l.id === created.leaseId)!;
    expect(ended.status).toBe("ended");
    expect(ended.endDate).toBe(lastDayOfMonth);
    expect(demo.leaseTenantNames(ended)).toEqual(["Anna Weber", "Luc Weber"]);
    expect(demo.RENT_PERIODS.filter((rp) => rp.leaseId === created.leaseId).map((rp) => rp.period)).toEqual([
      thisMonth.slice(0, 7),
    ]);
    expect(demo.ENDED_LEASES.map((l) => l.id)).toContain(created.leaseId);
    expect(demo.DEPOSITS.find((x) => x.leaseId === created.leaseId)!.status).toBe("released");
    // Former tenants keep their lease on their contact sheet.
    expect(demo.LEASES.filter((l) => l.tenantContactIds.includes(created.contactIds[1])).map((l) => l.id)).toEqual([
      created.leaseId,
    ]);

    // ── Add a new tenant: a new rental becomes active on its own ledger ──
    const next = await createRental(
      ctx,
      fr,
      parseRentalInput({ unitId, firstName: "Nora", lastName: "Adam", rent: "1 300", startDate: today, paymentDay: "1" }, today, "fr")!,
    );
    if ("error" in next) throw new Error(next.error);
    expect(next.status).toBe("active");
    expect(next.leaseId).not.toBe(created.leaseId);

    demo = await hydrate(db);
    card = findCard(buildPortfolio(demo), propertyId)!;
    expect(occupancyOf(card)).toBe("occupied");
    expect(card.single!.lease!.id).toBe(next.leaseId);
    expect(card.single!.tenantNames).toEqual(["Nora Adam"]);
    expect(card.single!.monthlyCents).toBe(130000);
    expect(card.single!.lease!.seq).toBeGreaterThan(ended.seq);

    // Nothing of the first tenancy moved: same tenants, same rent, same one period.
    const first = demo.LEASES.find((l) => l.id === created.leaseId)!;
    expect(first.status).toBe("ended");
    expect(first.rentCents).toBe(125000);
    expect(demo.leaseTenantNames(first)).toEqual(["Anna Weber", "Luc Weber"]);
    expect(demo.RENT_PERIODS.filter((rp) => rp.leaseId === created.leaseId)).toHaveLength(1);
    expect(demo.RENT_PERIODS.filter((rp) => rp.leaseId === next.leaseId).every((rp) => rp.totalCents === 130000)).toBe(true);
    expect(demo.LEASES).toHaveLength(2);
    // The property's history holds both, numbered by the order they began.
    const history = demo.LEASES.filter((l) => l.unitId === unitId && l.status !== "draft").sort((a, b) => a.seq - b.seq);
    expect(history.map((l) => l.status)).toEqual(["ended", "active"]);
  });

  it("records a colocation only when the owner says so, and never for one person", async () => {
    const input = parseRentalInput(
      {
        unitId,
        tenants: [
          { firstName: "Ana", lastName: "Santos" },
          { firstName: "Tom", lastName: "Kremer" },
          { firstName: "Lea", lastName: "Faber" },
        ],
        colocation: true,
        rent: "2 100",
        charges: "300",
      },
      today,
      "fr",
    )!;
    const created = await createRental(ctx, fr, input);
    if ("error" in created) throw new Error(created.error);
    const demo = await hydrate(db);
    const lease = demo.LEASES.find((l) => l.id === created.leaseId)!;
    expect(lease.colocation).toBe(true);
    expect(lease.tenantContactIds).toHaveLength(3);
    expect(demo.leaseTenantNames(lease)).toEqual(["Ana Santos", "Tom Kremer", "Lea Faber"]);
    expect(findCard(buildPortfolio(demo), propertyId)!.single!.tenantNames).toHaveLength(3);
    // The pacte de colocation is a compliance item on the dossier, not a gate.
    expect(created.issues.map((i) => i.code)).toContain("PACTE_COLOCATION_MISSING");
    expect(created.status).toBe("active");

    const solo = parseRentalInput({ unitId: "x", firstName: "Solo", rent: "1", colocation: true }, today, "fr")!;
    expect(solo.colocation).toBe(false);
  });

  it("keeps the unit's property from being trusted in the request", async () => {
    const result = await createRental(ctx, fr, parseRentalInput({ unitId: "not-a-unit", firstName: "X", rent: "1" }, today, "fr")!);
    expect(result).toEqual({ error: "not_found" });
  });
});

describe("a draft written before lifecycle and compliance were told apart", () => {
  let db: FakeDb;
  let ctx: OrgContext;
  let propertyId: string;
  let unitId: string;

  const seedDraft = (rent = 90000) => {
    const contact = db.insertRow("contacts", { org_id: ORG, first_name: "Guillaume", last_name: "M" });
    db.insertRow("contact_roles", { org_id: ORG, contact_id: contact.id, role: "tenant" });
    const lease = db.insertRow("leases", {
      org_id: ORG,
      unit_id: unitId,
      status: "draft",
      start_date: today,
      rent_cents: rent,
      charges_cents: 600,
      payment_day: 1,
    });
    db.insertRow("lease_parties", { org_id: ORG, lease_id: lease.id, contact_id: contact.id, role: "tenant" });
    db.insertRow("deposits", { org_id: ORG, lease_id: lease.id, form: "cash", amount_cents: rent * 2, status: "pending" });
    return String(lease.id);
  };

  beforeEach(() => {
    db = new FakeDb(today);
    ctx = ctxFor(db);
    ({ propertyId, unitId } = seedProperty(db));
  });

  it("is shown on its lot as a dossier in preparation, and never occupies it", async () => {
    const draftId = seedDraft();
    const demo = await hydrate(db);
    const card = findCard(buildPortfolio(demo), propertyId)!;
    expect(occupancyOf(card)).toBe("vacant");
    expect(card.single!.vacant).toBe(true);
    expect(card.single!.tenantNames).toEqual([]);
    expect(card.single!.drafts.map((l) => l.id)).toEqual([draftId]);
    expect(demo.leaseTenantNames(card.single!.drafts[0])).toEqual(["Guillaume M"]);
    // Contacts already knew the tenant: the property now knows the draft.
    expect(demo.LEASES.filter((l) => l.tenantContactIds.length > 0)).toHaveLength(1);
  });

  it("becomes the tenancy in force when activated, with its ledger opened", async () => {
    const draftId = seedDraft();
    const result = await activateLease(ctx, draftId, today);
    expect(result).toEqual({ ok: true, periodsOpened: 2 });

    const demo = await hydrate(db);
    const card = findCard(buildPortfolio(demo), propertyId)!;
    expect(occupancyOf(card)).toBe("occupied");
    expect(card.single!.lease!.id).toBe(draftId);
    expect(card.single!.tenantNames).toEqual(["Guillaume M"]);
    expect(card.single!.monthlyCents).toBe(90600);
    expect(card.single!.drafts).toEqual([]);
    expect(demo.RENT_PERIODS.filter((rp) => rp.leaseId === draftId)).toHaveLength(2);

    // Activating twice does nothing twice.
    expect(await activateLease(ctx, draftId, today)).toEqual({ error: "not_draft" });
  });

  it("cannot be activated onto a lot another tenancy already occupies", async () => {
    const draftId = seedDraft();
    const running = await createRental(ctx, fr, parseRentalInput({ unitId, firstName: "Nora", lastName: "Adam", rent: "1 300" }, today, "fr")!);
    if ("error" in running) throw new Error(running.error);
    expect(await activateLease(ctx, draftId, today)).toEqual({ error: "already_let" });
  });

  it("can be discarded while it carries nothing, and the people stay", async () => {
    const draftId = seedDraft();
    const keep = seedDraft(100);
    expect(await discardDraft(ctx, draftId)).toEqual({ ok: true });

    const demo = await hydrate(db);
    expect(demo.LEASES.map((l) => l.id)).toEqual([keep]);
    expect(demo.DEPOSITS.map((x) => x.leaseId)).toEqual([keep]);
    expect(demo.CONTACTS).toHaveLength(2);
    expect(findCard(buildPortfolio(demo), propertyId)!.single!.drafts.map((l) => l.id)).toEqual([keep]);
  });

  it("refuses to discard anything that already happened", async () => {
    const draftId = seedDraft();
    db.insertRow("rent_periods", { org_id: ORG, lease_id: draftId, period: thisMonth, due_date: thisMonth, rent_cents: 90000 });
    expect(await discardDraft(ctx, draftId)).toEqual({ error: "not_empty" });

    const running = await createRental(ctx, fr, parseRentalInput({ unitId, firstName: "Nora", rent: "1 300" }, today, "fr")!);
    if ("error" in running) throw new Error(running.error);
    expect(await discardDraft(ctx, running.leaseId)).toEqual({ error: "not_draft" });
    expect(await discardDraft(ctx, "nope")).toEqual({ error: "not_found" });
  });
});

describe("the ledger", () => {
  it("never makes the first month due before the tenancy starts", () => {
    // Signed on the 17th, rent due on the 5th: September is owed on the 17th,
    // October on the 5th. Before this rule a brand-new tenancy read as late.
    expect(dueDateFor("2026-09-01", 5, "2026-09-17")).toBe("2026-09-17");
    expect(dueDateFor("2026-10-01", 5, "2026-09-17")).toBe("2026-10-05");
    expect(dueDateFor("2026-09-01", 20, "2026-09-17")).toBe("2026-09-20");
    expect(nextDueByRule("2026-09-17", 5, "2026-09-17", null)).toBe("2026-09-17");
    expect(nextDueByRule("2026-09-18", 5, "2026-09-17", null)).toBe("2026-10-05");
    // A tenancy that ends before its next payment day owes nothing more.
    expect(nextDueByRule("2026-09-18", 5, "2026-09-17", "2026-09-23")).toBeNull();
    expect(nextDueByRule("2026-09-01", 5, "2026-09-17", null)).toBe("2026-09-17");
  });

  it("writes the first period due on the start date when the payment day has passed", async () => {
    const db = new FakeDb("2026-09-17");
    const ctx = ctxFor(db);
    const { unitId } = seedProperty(db);
    const created = await createRental(
      ctx,
      fr,
      parseRentalInput({ unitId, firstName: "Paul", lastName: "Wurrh", rent: "20", charges: "5", paymentDay: "5", startDate: "2026-09-17" }, "2026-09-17", "fr")!,
    );
    if ("error" in created) throw new Error(created.error);
    const periods = db.table("rent_periods").map((rp) => ({ period: rp.period, due: rp.due_date })).sort((a, b) => String(a.period).localeCompare(String(b.period)));
    expect(periods).toEqual([
      { period: "2026-09-01", due: "2026-09-17" },
      { period: "2026-10-01", due: "2026-10-05" },
    ]);
    // On the day it is created, the tenancy is pending, not late.
    expect(db.periodStatus().map((r) => r.status)).toEqual(["pending", "upcoming"]);
  });

  it("opens this month and next for a lease starting now", () => {
    expect(ledgerMonths(thisMonth, null, today)).toEqual([thisMonth, nextMonth]);
  });

  it("looks a year back at most, and never past the lease's end", () => {
    expect(ledgerMonths(addMonths(thisMonth, -30), null, today)).toHaveLength(13);
    expect(ledgerMonths(addMonths(thisMonth, -30), null, today)[0]).toBe(addMonths(thisMonth, -11));
    expect(ledgerMonths(thisMonth, lastDayOfMonth, today)).toEqual([thisMonth]);
    expect(ledgerMonths(nextMonth, null, today)).toEqual([nextMonth]);
    expect(ledgerMonths(addMonths(thisMonth, 3), null, today)).toEqual([]);
  });

  it("never rewrites a month that already exists", async () => {
    const db = new FakeDb(today);
    const ctx = ctxFor(db);
    const { unitId } = seedProperty(db);
    const lease = db.insertRow("leases", { org_id: ORG, unit_id: unitId, status: "active", start_date: thisMonth, rent_cents: 100000 });
    const l = { id: String(lease.id), startDate: thisMonth, endDate: null, rentCents: 100000, chargesCents: 0, paymentDay: 1 };
    expect(await openLedger(ctx, l, today)).toBe(2);
    db.table("rent_periods")[0].rent_cents = 99999;
    expect(await openLedger(ctx, { ...l, rentCents: 111111 }, today)).toBe(0);
    expect(db.table("rent_periods").map((rp) => rp.rent_cents).sort()).toEqual([100000, 99999]);
  });
});

describe("reading the request", () => {
  it("reads one person sent as flat fields, and several sent as a list", () => {
    const flat = parseRentalInput({ unitId: "u", firstName: "Jean", lastName: "Muller", rent: "1 000" }, today, "fr")!;
    expect(flat.tenants).toEqual([{ firstName: "Jean", lastName: "Muller", email: null, phone: null, language: "fr" }]);
    expect(flat.colocation).toBe(false);
    expect(flat.rentCents).toBe(100000);
    expect(flat.chargesCents).toBe(0);
    expect(flat.startDate).toBe(today);

    const list = parseRentalInput(
      { unitId: "u", tenants: [{ firstName: "A", language: "de" }, { lastName: "B", language: "xx" }, {}], rent: "1", colocation: true },
      today,
      "en",
    )!;
    expect(list.tenants.map((t) => t.language)).toEqual(["de", "en"]);
    expect(list.colocation).toBe(true);
  });

  it("refuses what cannot be a rental", () => {
    expect(parseRentalInput({ unitId: "u", rent: "1 000" }, today, "fr")).toBeNull();
    expect(parseRentalInput({ unitId: "u", firstName: "A", rent: "abc" }, today, "fr")).toBeNull();
    expect(parseRentalInput({ unitId: "", firstName: "A", rent: "1" }, today, "fr")).toBeNull();
    expect(parseRentalInput({ unitId: "u", firstName: "A", rent: "1", depositMonths: 13 }, today, "fr")).toBeNull();
    expect(parseRentalInput({ unitId: "u", firstName: "A", rent: "1", charges: "x" }, today, "fr")).toBeNull();
  });

  it("knows which tenant holds the payer account, if any", () => {
    const anna = { firstName: "Anna", lastName: "Weber", email: null, phone: null, language: "fr" };
    const luc = { firstName: "Luc", lastName: "Weber", email: null, phone: null, language: "fr" };
    expect(payerTenantIndex([anna], null)).toBe(0);
    expect(payerTenantIndex([anna], "Anna Weber")).toBe(0);
    expect(payerTenantIndex([anna], "Maman Weber")).toBe(-1);
    expect(payerTenantIndex([anna, luc], null)).toBe(-1);
    expect(payerTenantIndex([anna, luc], "WEBER Luc")).toBe(1);
    expect(payerTenantIndex([anna, luc], "Société Payeuse")).toBe(-1);
  });
});
