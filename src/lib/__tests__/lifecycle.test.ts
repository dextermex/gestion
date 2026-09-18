import { beforeEach, describe, expect, it } from "vitest";
import { fr } from "@/lib/i18n/fr";
import type { OrgContext } from "@/lib/gestion/api";
import { parseDossierInput, payerTenantIndex, saveRentalDraft, type DossierInput } from "@/lib/gestion/rental";
import { activateLease, closeLease, discardDraft, openLedger } from "@/lib/gestion/lease";
import { dueDateFor, ledgerMonths, nextDueOn as nextDueByRule } from "@/lib/gestion/ledger";
import { dossierOf } from "@/lib/gestion/dossier";
import { buildRealDataFrom } from "@/lib/demo/data-real";
import { orgFromWorkspace } from "@/lib/demo/data-empty";
import { buildPortfolio, findCard, nextDueOn, occupancyOf } from "@/lib/gestion/portfolio";
import { addDays, addMonths } from "@/domain/dates";
import { FakeDb } from "./helpers/fake-postgrest";

/**
 * The lifecycle of a rental, end to end, on one database.
 *
 * Every step below runs the real write functions the routes call (the
 * dossier saved from a step, the activation, the departure), then hydrates
 * the dataset exactly as a signed-in account does and reads it through the
 * portfolio projection the property sheet renders. What the property, the
 * contacts, the ledger and the history show is therefore asserted against
 * the same rows, which is the whole point: there is one canonical record of
 * a tenancy, and every screen reads it.
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

/** The request as the wizard sends it from a step, read the way the route reads it. */
const dossier = (body: Record<string, unknown>): DossierInput => {
  const input = parseDossierInput(body, "fr");
  if (!input) throw new Error("unreadable dossier");
  return input;
};

const ANNA = { firstName: "Anna", lastName: "Weber", email: "anna.weber@example.lu", phone: "+352 621 000 001" };
const LUC = { firstName: "Luc", lastName: "Weber" };

/** A tenancy recorded in one go and activated: the shortest path to a let lot. */
async function letTo(ctx: OrgContext, unitId: string, tenant: { firstName: string; lastName?: string }, rent: string, on = today) {
  const saved = await saveRentalDraft(ctx, fr, dossier({ unitId, step: "rent", tenants: [tenant], rent, startDate: on, paymentDay: "1" }));
  if ("error" in saved) throw new Error(saved.error);
  const active = await activateLease(ctx, saved.leaseId, on);
  if ("error" in active) throw new Error(active.error);
  return { ...saved, periodsOpened: active.periodsOpened };
}

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

  it("walks from a vacant property to a new tenancy one saved step at a time, without mixing two rentals", async () => {
    // ── Vacant ──
    let demo = await hydrate(db);
    let card = findCard(buildPortfolio(demo), propertyId)!;
    expect(occupancyOf(card)).toBe("vacant");
    expect(card.single!.tenantNames).toEqual([]);
    expect(card.monthlyCents).toBe(0);

    // ── Step 1, then "save and continue later": the dossier exists, the lot stays free ──
    const first = await saveRentalDraft(ctx, fr, dossier({ unitId, step: "tenant", tenants: [ANNA, LUC, { firstName: "", lastName: "" }] }));
    if ("error" in first) throw new Error(first.error);
    expect(first.status).toBe("draft");
    expect(first.contactIds).toHaveLength(2);
    expect(first.propertyId).toBe(propertyId);
    expect(first.completed).toEqual(["tenant"]);
    expect(first.resumeStep).toBe("lease");

    demo = await hydrate(db);
    card = findCard(buildPortfolio(demo), propertyId)!;
    expect(occupancyOf(card)).toBe("vacant");
    expect(card.single!.tenantNames).toEqual([]);
    expect(card.single!.drafts.map((l) => l.id)).toEqual([first.leaseId]);
    // What the property says: "Dossier en préparation · 1/9 étapes", resumed at the lease step.
    expect(dossierOf(demo, card.single!.drafts[0])).toEqual({ completed: ["tenant"], done: 1, total: 9, resumeStep: "lease", ready: false });
    expect(demo.leaseTenantNames(card.single!.drafts[0])).toEqual(["Anna Weber", "Luc Weber"]);
    expect(demo.RENT_PERIODS).toEqual([]);
    for (const id of first.contactIds) {
      expect(demo.CONTACTS.find((c) => c.id === id)!.roles).toContain("tenant");
      expect(demo.LEASES.filter((l) => l.tenantContactIds.includes(id)).map((l) => l.id)).toEqual([first.leaseId]);
    }
    // Nothing can be activated without a rent.
    expect(await activateLease(ctx, first.leaseId, today)).toEqual({ error: "incomplete" });

    // ── Resumed at the rent step: the same people, now with a rent ──
    const people = [
      { ...ANNA, contactId: first.contactIds[0] },
      { ...LUC, contactId: first.contactIds[1] },
    ];
    const withRent = await saveRentalDraft(
      ctx,
      fr,
      dossier({ leaseId: first.leaseId, unitId, step: "rent", tenants: people, type: "residential", startDate: thisMonth, rent: "1 250", charges: "150", paymentDay: "5" }),
    );
    if ("error" in withRent) throw new Error(withRent.error);
    expect(withRent.leaseId).toBe(first.leaseId);
    expect(withRent.contactIds).toEqual(first.contactIds);
    expect(withRent.completed).toEqual(["tenant", "lease", "rent"]);
    expect(withRent.resumeStep).toBe("payment");

    demo = await hydrate(db);
    card = findCard(buildPortfolio(demo), propertyId)!;
    expect(demo.CONTACTS).toHaveLength(2);
    expect(demo.LEASES).toHaveLength(1);
    expect(occupancyOf(card)).toBe("vacant");
    expect(card.monthlyCents).toBe(0);
    expect(card.single!.drafts[0].rentCents).toBe(125000);
    expect(dossierOf(demo, card.single!.drafts[0])).toMatchObject({ done: 3, resumeStep: "payment", ready: true });

    // ── Resumed at the guarantee step: payer account and deposit ──
    const withGuarantee = await saveRentalDraft(
      ctx,
      fr,
      dossier({
        leaseId: first.leaseId,
        unitId,
        step: "guarantee",
        tenants: people,
        startDate: thisMonth,
        rent: "1 250",
        charges: "150",
        paymentDay: "5",
        payerName: "Anna Weber",
        payerIban: "LU28 0019 4006 4475 0000",
        depositMonths: 2,
        depositForm: "bank_guarantee",
      }),
    );
    if ("error" in withGuarantee) throw new Error(withGuarantee.error);
    expect(withGuarantee.completed).toEqual(["tenant", "lease", "rent", "payment", "guarantee"]);
    expect(withGuarantee.resumeStep).toBe("inspection");
    // The written lease lacks the capital investi declaration: a compliance
    // item for the dossier, and it changes nothing about the lifecycle.
    expect(withGuarantee.issues.map((i) => i.code)).toContain("MENTIONS_INCOMPLETE");

    demo = await hydrate(db);
    expect(demo.IBAN_BINDINGS).toContainEqual({ payerIban: "LU280019400644750000", leaseId: first.leaseId });
    expect(demo.CONTACTS.find((c) => c.id === first.contactIds[0])!.iban).toBe("LU280019400644750000");
    expect(demo.CONTACTS.find((c) => c.id === first.contactIds[1])!.iban).toBeUndefined();
    const deposit = demo.DEPOSITS.find((x) => x.leaseId === first.leaseId)!;
    expect(deposit.amountCents).toBe(250000);
    expect(deposit.form).toBe("bank_guarantee");
    card = findCard(buildPortfolio(demo), propertyId)!;
    expect(occupancyOf(card)).toBe("vacant");
    expect(dossierOf(demo, card.single!.drafts[0])).toMatchObject({ done: 5, resumeStep: "inspection" });

    // ── Activation: the one move that occupies the lot and opens the ledger ──
    const activated = await activateLease(ctx, first.leaseId, today);
    expect(activated).toEqual({ ok: true, periodsOpened: 2 });
    expect(db.table("lease_parties").map((p) => p.moved_in_on)).toEqual([thisMonth, thisMonth]);

    demo = await hydrate(db);
    card = findCard(buildPortfolio(demo), propertyId)!;
    expect(occupancyOf(card)).toBe("occupied");
    expect(card.single!.drafts).toEqual([]);
    expect(card.single!.lease!.id).toBe(first.leaseId);
    expect(card.single!.lease!.status).toBe("active");
    expect(card.single!.tenantNames).toEqual(["Anna Weber", "Luc Weber"]);
    expect(card.single!.monthlyCents).toBe(140000);
    expect(card.single!.lease!.rentCents).toBe(125000);
    expect(card.single!.lease!.chargesCents).toBe(15000);
    expect(card.single!.lease!.paymentDay).toBe(5);
    expect(card.single!.lease!.colocation).toBe(false);
    expect(card.nextDue).toBe(nextDueOn(today, 5));

    // ── Monthly obligation exists, and paid-ness is derived, not stored ──
    const periods = demo.RENT_PERIODS.filter((rp) => rp.leaseId === first.leaseId);
    expect(periods.map((rp) => rp.period).sort()).toEqual([thisMonth.slice(0, 7), nextMonth.slice(0, 7)]);
    expect(periods.every((rp) => rp.totalCents === 140000 && rp.allocatedCents === 0)).toBe(true);
    expect(card.single!.period).not.toBeNull();
    expect(["pending", "late", "upcoming"]).toContain(card.single!.status);
    expect(demo.openInvoicesForMatching().some((inv) => inv.leaseId === first.leaseId)).toBe(true);
    expect(demo.leaseUnitLabel(card.single!.lease!)).toBe("Maison · Maison Weber");

    // ── A second dossier on a let lot is refused, and the tenancy cannot be resumed as a dossier ──
    expect(await saveRentalDraft(ctx, fr, dossier({ unitId, step: "tenant", tenants: [{ firstName: "Nora" }] }))).toEqual({ error: "already_let" });
    expect(await saveRentalDraft(ctx, fr, dossier({ leaseId: first.leaseId, unitId, step: "rent", tenants: people, rent: "1" }))).toEqual({
      error: "not_draft",
    });
    expect(await activateLease(ctx, first.leaseId, today)).toEqual({ error: "not_draft" });

    // ── End rental ──
    const closed = await closeLease(
      ctx,
      first.leaseId,
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
    const ended = demo.LEASES.find((l) => l.id === first.leaseId)!;
    expect(ended.status).toBe("ended");
    expect(ended.endDate).toBe(lastDayOfMonth);
    expect(demo.leaseTenantNames(ended)).toEqual(["Anna Weber", "Luc Weber"]);
    expect(demo.RENT_PERIODS.filter((rp) => rp.leaseId === first.leaseId).map((rp) => rp.period)).toEqual([thisMonth.slice(0, 7)]);
    expect(demo.ENDED_LEASES.map((l) => l.id)).toContain(first.leaseId);
    expect(demo.DEPOSITS.find((x) => x.leaseId === first.leaseId)!.status).toBe("released");
    // Former tenants keep their lease on their contact sheet.
    expect(demo.LEASES.filter((l) => l.tenantContactIds.includes(first.contactIds[1])).map((l) => l.id)).toEqual([first.leaseId]);

    // ── Add a new tenant: a new rental becomes active on its own ledger ──
    const next = await letTo(ctx, unitId, { firstName: "Nora", lastName: "Adam" }, "1 300");
    expect(next.leaseId).not.toBe(first.leaseId);

    demo = await hydrate(db);
    card = findCard(buildPortfolio(demo), propertyId)!;
    expect(occupancyOf(card)).toBe("occupied");
    expect(card.single!.lease!.id).toBe(next.leaseId);
    expect(card.single!.tenantNames).toEqual(["Nora Adam"]);
    expect(card.single!.monthlyCents).toBe(130000);
    expect(card.single!.lease!.seq).toBeGreaterThan(ended.seq);

    // Nothing of the first tenancy moved: same tenants, same rent, same one period.
    const firstLease = demo.LEASES.find((l) => l.id === first.leaseId)!;
    expect(firstLease.status).toBe("ended");
    expect(firstLease.rentCents).toBe(125000);
    expect(demo.leaseTenantNames(firstLease)).toEqual(["Anna Weber", "Luc Weber"]);
    expect(demo.RENT_PERIODS.filter((rp) => rp.leaseId === first.leaseId)).toHaveLength(1);
    expect(demo.RENT_PERIODS.filter((rp) => rp.leaseId === next.leaseId).every((rp) => rp.totalCents === 130000)).toBe(true);
    expect(demo.LEASES).toHaveLength(2);
    // The property's history holds both, numbered by the order they began.
    const history = demo.LEASES.filter((l) => l.unitId === unitId && l.status !== "draft").sort((a, b) => a.seq - b.seq);
    expect(history.map((l) => l.status)).toEqual(["ended", "active"]);
  });

  it("continues the dossier already in preparation on a lot instead of doubling it", async () => {
    // "Ajouter un locataire" clicked twice, or a save whose answer never
    // reached the browser: the lot has one dossier, not two.
    const a = await saveRentalDraft(ctx, fr, dossier({ unitId, step: "tenant", tenants: [ANNA] }));
    if ("error" in a) throw new Error(a.error);
    const b = await saveRentalDraft(ctx, fr, dossier({ unitId, step: "tenant", tenants: [{ ...ANNA, contactId: a.contactIds[0] }, LUC] }));
    if ("error" in b) throw new Error(b.error);
    expect(b.leaseId).toBe(a.leaseId);
    expect(b.contactIds[0]).toBe(a.contactIds[0]);
    const demo = await hydrate(db);
    expect(demo.LEASES).toHaveLength(1);
    expect(demo.CONTACTS).toHaveLength(2);
    expect(demo.leaseTenantNames(demo.LEASES[0])).toEqual(["Anna Weber", "Luc Weber"]);
  });

  it("keeps a dossier as it was saved, from every step, with the memory of what is done", async () => {
    const first = await saveRentalDraft(ctx, fr, dossier({ unitId, step: "tenant", tenants: [ANNA] }));
    if ("error" in first) throw new Error(first.error);
    const anna = { ...ANNA, contactId: first.contactIds[0] };
    const at = async (step: string, extra: Record<string, unknown>) => {
      const r = await saveRentalDraft(ctx, fr, dossier({ leaseId: first.leaseId, unitId, step, tenants: [anna], ...extra }));
      if ("error" in r) throw new Error(r.error);
      return r;
    };
    // Left from the lease step with a rent not yet entered: two done, resume at the rent.
    expect((await at("lease", { type: "commercial", startDate: thisMonth })).resumeStep).toBe("rent");
    let demo = await hydrate(db);
    expect(demo.LEASES[0].type).toBe("commercial");
    expect(dossierOf(demo, demo.LEASES[0])).toMatchObject({ done: 2, resumeStep: "rent", ready: false });

    // Every later step, saved in turn, moves the resume point by one.
    expect((await at("rent", { rent: "900", startDate: thisMonth })).resumeStep).toBe("payment");
    expect((await at("payment", { rent: "900", startDate: thisMonth, payerIban: "LU28 0019 4006 4475 0000" })).resumeStep).toBe("guarantee");
    expect((await at("guarantee", { rent: "900", startDate: thisMonth, payerIban: "LU28 0019 4006 4475 0000", depositMonths: 0 })).resumeStep).toBe(
      "inspection",
    );
    expect((await at("inspection", { rent: "900", startDate: thisMonth, payerIban: "LU28 0019 4006 4475 0000" })).resumeStep).toBe("insurance");
    expect((await at("insurance", { rent: "900", startDate: thisMonth, payerIban: "LU28 0019 4006 4475 0000" })).resumeStep).toBe("documents");
    const last = await at("documents", { rent: "900", startDate: thisMonth, payerIban: "LU28 0019 4006 4475 0000" });
    expect(last.completed).toEqual(["tenant", "lease", "rent", "payment", "guarantee", "inspection", "insurance", "documents"]);
    expect(last.resumeStep).toBe("activation");

    demo = await hydrate(db);
    const lease = demo.LEASES[0];
    expect(lease.status).toBe("draft");
    expect(lease.dossier).toEqual({ completed: last.completed, step: "documents", payerName: null });
    // "No guarantee" answered on its step is kept as no deposit, and the step counts.
    expect(demo.DEPOSITS).toEqual([]);
    expect(dossierOf(demo, lease)).toMatchObject({ done: 8, total: 9, resumeStep: "activation", ready: true });
    expect(occupancyOf(findCard(buildPortfolio(demo), propertyId)!)).toBe("vacant");

    // Clearing the rent from an earlier step reopens the rent step for the next resume.
    const cleared = await at("lease", { rent: "", startDate: thisMonth });
    expect(cleared.completed).not.toContain("rent");
    expect(cleared.resumeStep).toBe("rent");
    demo = await hydrate(db);
    expect(dossierOf(demo, demo.LEASES[0])).toMatchObject({ done: 7, resumeStep: "rent", ready: false });
  });

  it("lets someone leave the dossier and stay a contact", async () => {
    const first = await saveRentalDraft(ctx, fr, dossier({ unitId, step: "tenant", tenants: [ANNA, LUC] }));
    if ("error" in first) throw new Error(first.error);
    const only = await saveRentalDraft(
      ctx,
      fr,
      dossier({ leaseId: first.leaseId, unitId, step: "tenant", tenants: [{ ...LUC, contactId: first.contactIds[1], email: "luc@example.lu" }] }),
    );
    if ("error" in only) throw new Error(only.error);
    expect(only.contactIds).toEqual([first.contactIds[1]]);
    const demo = await hydrate(db);
    expect(demo.CONTACTS).toHaveLength(2);
    expect(demo.leaseTenantNames(demo.LEASES[0])).toEqual(["Luc Weber"]);
    expect(demo.CONTACTS.find((c) => c.id === first.contactIds[1])!.email).toBe("luc@example.lu");
    expect(demo.LEASES.filter((l) => l.tenantContactIds.includes(first.contactIds[0]))).toEqual([]);
  });

  it("records a colocation only when the owner says so, and never for one person", async () => {
    const input = dossier({
      unitId,
      step: "rent",
      tenants: [
        { firstName: "Ana", lastName: "Santos" },
        { firstName: "Tom", lastName: "Kremer" },
        { firstName: "Lea", lastName: "Faber" },
      ],
      colocation: true,
      rent: "2 100",
      charges: "300",
    });
    const saved = await saveRentalDraft(ctx, fr, input);
    if ("error" in saved) throw new Error(saved.error);
    const demo = await hydrate(db);
    const lease = demo.LEASES.find((l) => l.id === saved.leaseId)!;
    expect(lease.colocation).toBe(true);
    expect(lease.tenantContactIds).toHaveLength(3);
    expect(demo.leaseTenantNames(lease)).toEqual(["Ana Santos", "Tom Kremer", "Lea Faber"]);
    // The pacte de colocation is a compliance item on the dossier, not a gate.
    expect(saved.issues.map((i) => i.code)).toContain("PACTE_COLOCATION_MISSING");
    expect(await activateLease(ctx, saved.leaseId, today)).toEqual({ ok: true, periodsOpened: 2 });
    expect(findCard(buildPortfolio(await hydrate(db)), propertyId)!.single!.tenantNames).toHaveLength(3);

    const solo = dossier({ unitId: "x", firstName: "Solo", rent: "1", colocation: true });
    expect(solo.colocation).toBe(false);
  });

  it("keeps the unit's property from being trusted in the request", async () => {
    expect(await saveRentalDraft(ctx, fr, dossier({ unitId: "not-a-unit", step: "tenant", firstName: "X" }))).toEqual({ error: "not_found" });
    expect(await saveRentalDraft(ctx, fr, dossier({ leaseId: "not-a-lease", unitId, step: "rent", rent: "1" }))).toEqual({ error: "not_found" });
  });
});

describe("each property sees only the dossiers on its own lots", () => {
  let db: FakeDb;
  let ctx: OrgContext;

  /** A property with the given lots, as the property wizard writes it. */
  const seed = (name: string, labels: string[]) => {
    const property = db.insertRow("properties", { org_id: ORG, name, type: labels.length > 1 ? "building" : "house", address: {}, commune: "Luxembourg" });
    const units = labels.map((label) => String(db.insertRow("units", { org_id: ORG, property_id: property.id, label, kind: "dwelling", area_sqm: 50, rooms: 2 }).id));
    return { id: String(property.id), units };
  };
  /** A dossier saved from the first step on a lot, as the wizard sends it. */
  const start = async (unitId: string, firstName: string) => {
    const r = await saveRentalDraft(ctx, fr, dossier({ unitId, step: "tenant", tenants: [{ firstName, lastName: "Test" }] }));
    if ("error" in r) throw new Error(r.error);
    return r;
  };
  const draftsOf = (cards: ReturnType<typeof buildPortfolio>, propertyId: string) =>
    findCard(cards, propertyId)!.lots.map((line) => ({ unit: line.unit.id, drafts: line.drafts.map((l) => l.id) }));

  beforeEach(() => {
    db = new FakeDb(today);
    ctx = ctxFor(db);
  });

  it("writes every dossier on the lot it was started from, and each property reads only its own, before and after a refresh", async () => {
    const a = seed("Maison A", ["Maison"]);
    const b = seed("Maison B", ["Maison"]);
    const c = seed("Résidence C", ["Apt 1", "Apt 2"]);

    const dA = await start(a.units[0], "Anna");
    const dB = await start(b.units[0], "Bruno");
    const dC = await start(c.units[1], "Chloé");

    // ── Written: lease → unit → property is the canonical chain, and it is what was asked for ──
    const unitOf = (leaseId: string) => String(db.table("leases").find((l) => l.id === leaseId)!.unit_id);
    const propertyOf = (unitId: string) => String(db.table("units").find((u) => u.id === unitId)!.property_id);
    expect(unitOf(dA.leaseId)).toBe(a.units[0]);
    expect(unitOf(dB.leaseId)).toBe(b.units[0]);
    expect(unitOf(dC.leaseId)).toBe(c.units[1]);
    expect([dA.propertyId, dB.propertyId, dC.propertyId]).toEqual([a.id, b.id, c.id]);
    expect([propertyOf(unitOf(dA.leaseId)), propertyOf(unitOf(dB.leaseId)), propertyOf(unitOf(dC.leaseId))]).toEqual([a.id, b.id, c.id]);

    // ── Read, exactly as the property sheet and the Biens card read it ──
    const expectScoped = (demo: Awaited<ReturnType<typeof hydrate>>) => {
      const cards = buildPortfolio(demo);
      expect(draftsOf(cards, a.id)).toEqual([{ unit: a.units[0], drafts: [dA.leaseId] }]);
      expect(draftsOf(cards, b.id)).toEqual([{ unit: b.units[0], drafts: [dB.leaseId] }]);
      // A building shows a dossier under the lot it is on, and nowhere else.
      expect(draftsOf(cards, c.id)).toEqual([
        { unit: c.units[0], drafts: [] },
        { unit: c.units[1], drafts: [dC.leaseId] },
      ]);
      // What each sheet names: its own tenant, never another property's.
      const names = (propertyId: string) => findCard(cards, propertyId)!.lots.flatMap((line) => line.drafts.flatMap((l) => demo.leaseTenantNames(l)));
      expect(names(a.id)).toEqual(["Anna Test"]);
      expect(names(b.id)).toEqual(["Bruno Test"]);
      expect(names(c.id)).toEqual(["Chloé Test"]);
      // Every property remains vacant: a dossier occupies nothing.
      for (const id of [a.id, b.id, c.id]) expect(occupancyOf(findCard(cards, id)!)).toBe("vacant");
    };
    expectScoped(await hydrate(db));
    // A refresh is a new request: the dataset is rebuilt from the rows, and says the same.
    expectScoped(await hydrate(db));

    // ── Resuming from a lot picks that lot's dossier, never a neighbour's ──
    const againA = await start(a.units[0], "Anna");
    expect(againA.leaseId).toBe(dA.leaseId);
    const firstC1 = await start(c.units[0], "Dan");
    expect(firstC1.leaseId).not.toBe(dC.leaseId);
    const demo = await hydrate(db);
    expect(draftsOf(buildPortfolio(demo), c.id)).toEqual([
      { unit: c.units[0], drafts: [firstC1.leaseId] },
      { unit: c.units[1], drafts: [dC.leaseId] },
    ]);
    expect(draftsOf(buildPortfolio(demo), a.id)).toEqual([{ unit: a.units[0], drafts: [dA.leaseId] }]);
    expect(demo.LEASES).toHaveLength(4);
  });

  it("refuses to save a dossier onto a lot it does not belong to, and moves nothing", async () => {
    const a = seed("Maison A", ["Maison"]);
    const b = seed("Maison B", ["Maison"]);
    const dA = await start(a.units[0], "Anna");
    const dB = await start(b.units[0], "Bruno");

    // A stale tab, or a request naming another lot: refused, not rewritten.
    const crossed = await saveRentalDraft(ctx, fr, dossier({ leaseId: dA.leaseId, unitId: b.units[0], step: "rent", tenants: [{ firstName: "Anna", lastName: "Test", contactId: dA.contactIds[0] }], rent: "900" }));
    expect(crossed).toEqual({ error: "wrong_lot" });

    const cards = buildPortfolio(await hydrate(db));
    expect(draftsOf(cards, a.id)).toEqual([{ unit: a.units[0], drafts: [dA.leaseId] }]);
    expect(draftsOf(cards, b.id)).toEqual([{ unit: b.units[0], drafts: [dB.leaseId] }]);
    expect(db.table("leases").find((l) => l.id === dA.leaseId)!.rent_cents).toBe(0);
  });
});

describe("a draft written before the flow kept its own memory", () => {
  let db: FakeDb;
  let ctx: OrgContext;
  let propertyId: string;
  let unitId: string;

  const seedDraft = (rent = 90000, withTenant = true) => {
    const lease = db.insertRow("leases", {
      org_id: ORG,
      unit_id: unitId,
      status: "draft",
      start_date: today,
      rent_cents: rent,
      charges_cents: 600,
      payment_day: 1,
    });
    if (withTenant) {
      const contact = db.insertRow("contacts", { org_id: ORG, first_name: "Guillaume", last_name: "M" });
      db.insertRow("contact_roles", { org_id: ORG, contact_id: contact.id, role: "tenant" });
      db.insertRow("lease_parties", { org_id: ORG, lease_id: lease.id, contact_id: contact.id, role: "tenant" });
    }
    db.insertRow("deposits", { org_id: ORG, lease_id: lease.id, form: "cash", amount_cents: rent * 2, status: "pending" });
    return String(lease.id);
  };

  beforeEach(() => {
    db = new FakeDb(today);
    ctx = ctxFor(db);
    ({ propertyId, unitId } = seedProperty(db));
  });

  it("is shown on its lot as a dossier in preparation, read from its rows, and never occupies it", async () => {
    const draftId = seedDraft();
    const demo = await hydrate(db);
    const card = findCard(buildPortfolio(demo), propertyId)!;
    expect(occupancyOf(card)).toBe("vacant");
    expect(card.single!.vacant).toBe(true);
    expect(card.single!.tenantNames).toEqual([]);
    expect(card.single!.drafts.map((l) => l.id)).toEqual([draftId]);
    expect(demo.leaseTenantNames(card.single!.drafts[0])).toEqual(["Guillaume M"]);
    // No memory on the row: the tenant, the lease, the rent and the deposit are what it holds.
    expect(dossierOf(demo, card.single!.drafts[0])).toEqual({
      completed: ["tenant", "lease", "rent", "guarantee"],
      done: 4,
      total: 9,
      resumeStep: "payment",
      ready: true,
    });
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

  it("cannot be activated while nobody is on it or no rent is set", async () => {
    expect(await activateLease(ctx, seedDraft(90000, false), today)).toEqual({ error: "incomplete" });
    expect(await activateLease(ctx, seedDraft(0), today)).toEqual({ error: "incomplete" });
    expect(occupancyOf(findCard(buildPortfolio(await hydrate(db)), propertyId)!)).toBe("vacant");
  });

  it("cannot be activated onto a lot another tenancy already occupies", async () => {
    // The tenancy first, the stale draft after: a save on the lot would
    // otherwise continue the draft rather than start a second dossier.
    await letTo(ctx, unitId, { firstName: "Nora", lastName: "Adam" }, "1 300");
    const draftId = seedDraft();
    expect(await activateLease(ctx, draftId, today)).toEqual({ error: "already_let" });
    expect(await saveRentalDraft(ctx, fr, dossier({ unitId, step: "tenant", firstName: "Late" }))).toEqual({ error: "already_let" });
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

    const running = await letTo(ctx, unitId, { firstName: "Nora" }, "1 300");
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
    const saved = await saveRentalDraft(
      ctx,
      fr,
      dossier({ unitId, step: "rent", firstName: "Paul", lastName: "Wurrh", rent: "20", charges: "5", paymentDay: "5", startDate: "2026-09-17" }),
    );
    if ("error" in saved) throw new Error(saved.error);
    // A dossier owes nothing; the tenancy owes from the day it is activated.
    expect(db.table("rent_periods")).toEqual([]);
    expect(await activateLease(ctx, saved.leaseId, "2026-09-17")).toEqual({ ok: true, periodsOpened: 2 });
    const periods = db
      .table("rent_periods")
      .map((rp) => ({ period: rp.period, due: rp.due_date }))
      .sort((a, b) => String(a.period).localeCompare(String(b.period)));
    expect(periods).toEqual([
      { period: "2026-09-01", due: "2026-09-17" },
      { period: "2026-10-01", due: "2026-10-05" },
    ]);
    // On the day it is activated, the tenancy is pending, not late.
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
    const flat = parseDossierInput({ unitId: "u", firstName: "Jean", lastName: "Muller", rent: "1 000" }, "fr")!;
    expect(flat.tenants).toEqual([{ contactId: null, firstName: "Jean", lastName: "Muller", email: null, phone: null, language: "fr" }]);
    expect(flat.leaseId).toBeNull();
    expect(flat.step).toBe("tenant");
    expect(flat.colocation).toBe(false);
    expect(flat.rentCents).toBe(100000);
    expect(flat.chargesCents).toBe(0);
    expect(flat.startDate).toBeNull();

    const list = parseDossierInput(
      { unitId: "u", leaseId: "l", step: "guarantee", tenants: [{ firstName: "A", language: "de", contactId: "c-1" }, { lastName: "B", language: "xx" }, {}], rent: "1", colocation: true },
      "en",
    )!;
    expect(list.tenants.map((t) => [t.contactId, t.language])).toEqual([
      ["c-1", "de"],
      [null, "en"],
    ]);
    expect(list.leaseId).toBe("l");
    expect(list.step).toBe("guarantee");
    expect(list.colocation).toBe(true);
  });

  it("reads a dossier with nothing filled in yet, as long as it names someone or exists", () => {
    // The rent step not reached: 0 for now, never a refusal.
    expect(parseDossierInput({ unitId: "u", firstName: "A" }, "fr")).toMatchObject({ rentCents: 0, chargesCents: 0, depositMonths: 0 });
    // A dossier being resumed may be saved with everyone removed.
    expect(parseDossierInput({ unitId: "u", leaseId: "l", step: "lease" }, "fr")).toMatchObject({ leaseId: "l", tenants: [], step: "lease" });
    // A step name from outside that is not one lands on the first step.
    expect(parseDossierInput({ unitId: "u", firstName: "A", step: "bogus" }, "fr")!.step).toBe("tenant");
  });

  it("refuses what cannot be a dossier", () => {
    expect(parseDossierInput({ unitId: "u", rent: "1 000" }, "fr")).toBeNull();
    expect(parseDossierInput({ unitId: "u", firstName: "A", rent: "abc" }, "fr")).toBeNull();
    expect(parseDossierInput({ unitId: "", firstName: "A", rent: "1" }, "fr")).toBeNull();
    expect(parseDossierInput({ unitId: "u", firstName: "A", rent: "1", depositMonths: 13 }, "fr")).toBeNull();
    expect(parseDossierInput({ unitId: "u", firstName: "A", rent: "1", charges: "x" }, "fr")).toBeNull();
  });

  it("knows which tenant holds the payer account, if any", () => {
    const anna = { firstName: "Anna", lastName: "Weber" };
    const luc = { firstName: "Luc", lastName: "Weber" };
    expect(payerTenantIndex([anna], null)).toBe(0);
    expect(payerTenantIndex([anna], "Anna Weber")).toBe(0);
    expect(payerTenantIndex([anna], "Maman Weber")).toBe(-1);
    expect(payerTenantIndex([anna, luc], null)).toBe(-1);
    expect(payerTenantIndex([anna, luc], "WEBER Luc")).toBe(1);
    expect(payerTenantIndex([anna, luc], "Société Payeuse")).toBe(-1);
  });
});
