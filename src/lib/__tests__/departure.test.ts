import { beforeEach, describe, expect, it } from "vitest";
import type { OrgContext } from "@/lib/gestion/api";
import { closeLease, openLedger } from "@/lib/gestion/lease";
import { departureDate, effectiveLeaseStatus, nextDueOn } from "@/lib/gestion/ledger";
import { buildPortfolio, findCard, occupancyOf } from "@/lib/gestion/portfolio";
import { rentDue } from "@/lib/portal/view";
import { createTenantRequest, parseRequestInput } from "@/lib/portal/requests";
import { addDays, addMonths } from "@/domain/dates";
import { FakeDb } from "./helpers/fake-postgrest";
import { ORG, ctxFor, departOn, hydrate, isoToday, letTo, linkAccount, seedProperty, space } from "./helpers/tenancy";

/**
 * A departure is dated. Recorded for a day ahead it is a notice: the tenancy
 * stays in force until that day (the lot occupied, the rent due, the tenant
 * able to ask), and ends on it. Recorded for today or before, it ends now.
 * A lease whose end date has come never reads as running, whether or not the
 * nightly job has written `ended` on it yet.
 */

const today = isoToday();
const thisMonth = `${today.slice(0, 7)}-01`;
const started = addMonths(thisMonth, -3);
const ANNA = { firstName: "Anna", lastName: "Weber", email: "anna.weber@example.lu" };
const anna = { id: "user-anna", email: "anna.weber@example.lu" };
const ROBINET = parseRequestInput({ kind: "technical", category: "plumbing", title: "Robinet qui fuit", description: "Dans la cuisine." })!;
const closure = (endDate: string) => ({ endDate, depositOutcome: "release_pending" as const, keysReturned: true, decompteIssuedOn: null });

describe("a departure and its date", () => {
  let db: FakeDb;
  let ctx: OrgContext;
  let propertyId: string;
  let unitId: string;

  beforeEach(() => {
    db = new FakeDb(today);
    ctx = ctxFor(db);
    ({ propertyId, unitId } = seedProperty(db));
  });

  it("gives notice when the date is ahead: the tenancy stays in force until that day", async () => {
    const rental = await letTo(ctx, unitId, [ANNA], "1 250", started);
    await linkAccount(db, ctx, rental, anna);
    const ahead = addDays(today, 45);

    const noticed = await closeLease(ctx, rental.leaseId, closure(ahead), today);
    expect(noticed).toMatchObject({ ok: true, status: "notice", endDate: ahead, depositStatus: null, pending: [] });

    // The row: on notice, its end date stored, nobody moved out.
    const row = db.table("leases").find((l) => l.id === rental.leaseId)!;
    expect([row.status, row.end_date]).toEqual(["notice", ahead]);
    expect(db.table("lease_parties").filter((p) => p.lease_id === rental.leaseId).map((p) => p.moved_out_on)).toEqual([null]);

    // The owner's screens: the lot is still let, to the same person.
    const demo = await hydrate(db);
    const card = findCard(buildPortfolio(demo), propertyId)!;
    expect(occupancyOf(card)).toBe("occupied");
    expect(card.single!.lease).toMatchObject({ id: rental.leaseId, status: "notice", endDate: ahead });
    // The rent keeps falling due: this month and the next are in the ledger, none dropped.
    const months = demo.RENT_PERIODS.filter((rp) => rp.leaseId === rental.leaseId).map((rp) => rp.period);
    expect(months).toContain(today.slice(0, 7));
    expect(months).toContain(addMonths(thisMonth, 1).slice(0, 7));

    // The tenant keeps their rights: the tenancy is their current one, and a request goes through.
    const mine = await space(db, anna);
    expect(mine.current).toMatchObject({ id: rental.leaseId, status: "notice", endDate: ahead });
    const lease = { id: rental.leaseId, orgId: ORG, unitId, propertyId, subject: "Maison · Maison Weber" };
    const asked = await createTenantRequest(db.tenantClient(anna), anna, lease, ROBINET);
    expect(asked).toHaveProperty("id");
  });

  it("drops only the months after the departure month, and opens them again when the date moves later", async () => {
    // Let today: the ledger holds this month and the next.
    const rental = await letTo(ctx, unitId, [ANNA], "1 250");
    const endOfThisMonth = addDays(addMonths(thisMonth, 1), -1);
    if (endOfThisMonth === today) return; // the last day of a month: a date ahead in this month does not exist
    const first = await closeLease(ctx, rental.leaseId, closure(endOfThisMonth), today);
    expect(first).toMatchObject({ status: "notice", droppedPeriods: 1 });
    const periodsOf = () => db.table("rent_periods").filter((rp) => rp.lease_id === rental.leaseId).map((rp) => String(rp.period)).sort();
    expect(periodsOf().at(-1)).toBe(thisMonth);

    const later = await closeLease(ctx, rental.leaseId, closure(addDays(addMonths(thisMonth, 2), -1)), today);
    expect(later).toMatchObject({ status: "notice", droppedPeriods: 0 });
    expect(periodsOf().at(-1)).toBe(addMonths(thisMonth, 1));
  });

  it("ends the tenancy when the date is today, and the former tenant can no longer ask", async () => {
    const rental = await letTo(ctx, unitId, [ANNA], "1 250", started);
    await linkAccount(db, ctx, rental, anna);
    const ended = await closeLease(ctx, rental.leaseId, closure(today), today);
    expect(ended).toMatchObject({ ok: true, status: "ended", endDate: today });

    const demo = await hydrate(db);
    expect(occupancyOf(findCard(buildPortfolio(demo), propertyId)!)).toBe("vacant");
    expect(demo.LEASES.find((l) => l.id === rental.leaseId)).toMatchObject({ status: "ended", endDate: today });
    expect(db.table("lease_parties").filter((p) => p.lease_id === rental.leaseId).map((p) => p.moved_out_on)).toEqual([today]);

    const mine = await space(db, anna);
    expect(mine.current).toBeNull();
    const lease = { id: rental.leaseId, orgId: ORG, unitId, propertyId, subject: "Maison · Maison Weber" };
    expect(await createTenantRequest(db.tenantClient(anna), anna, lease, ROBINET)).toEqual({ error: "forbidden" });
  });

  it("reads a lease whose end date has come as ended, before the nightly job has written it", async () => {
    const rental = await letTo(ctx, unitId, [ANNA], "1 250", started);
    await linkAccount(db, ctx, rental, anna);
    // What the base holds on the morning the job has not run: still on notice, the date reached.
    Object.assign(db.table("leases").find((l) => l.id === rental.leaseId)!, { status: "notice", end_date: today });

    const demo = await hydrate(db);
    expect(demo.LEASES.find((l) => l.id === rental.leaseId)!.status).toBe("ended");
    expect(occupancyOf(findCard(buildPortfolio(demo), propertyId)!)).toBe("vacant");
    expect(demo.ENDED_LEASES.map((l) => l.id)).toEqual([rental.leaseId]);
    const mine = await space(db, anna);
    expect(mine.current).toBeNull();
    expect(mine.past.map((l) => [l.id, l.status])).toEqual([[rental.leaseId, "ended"]]);

    // A lease whose term has passed with nobody leaving is not over: it carries on, prolonged by law.
    Object.assign(db.table("leases").find((l) => l.id === rental.leaseId)!, { status: "active", end_date: addDays(today, -10) });
    const carried = await hydrate(db);
    expect(carried.LEASES.find((l) => l.id === rental.leaseId)!.status).toBe("active");
    expect(occupancyOf(findCard(buildPortfolio(carried), propertyId)!)).not.toBe("vacant");
    expect((await space(db, anna)).current?.id).toBe(rental.leaseId);
  });

  it("keeps a lease's rent falling due after its term when nobody left", async () => {
    const rental = await letTo(ctx, unitId, [ANNA], "1 250", started);
    // Signed for a term that ended last month; the tenant is still there.
    const lease = db.table("leases").find((l) => l.id === rental.leaseId)!;
    lease.end_date = addDays(thisMonth, -1);
    await openLedger(ctx, { id: rental.leaseId, startDate: started, endDate: null, rentCents: 125000, chargesCents: 15000, paymentDay: 1 }, today);
    const months = db.table("rent_periods").filter((rp) => rp.lease_id === rental.leaseId).map((rp) => String(rp.period));
    expect(months).toContain(thisMonth);
    expect(months).toContain(addMonths(thisMonth, 1));
    expect(nextDueOn(today, 1, started, departureDate({ status: "active", endDate: String(lease.end_date) }))).not.toBeNull();
  });

  it("decides by the date alone", () => {
    expect(effectiveLeaseStatus("notice", addDays(today, 1), today)).toBe("notice");
    expect(effectiveLeaseStatus("notice", today, today)).toBe("ended");
    // The term signed for is not a departure.
    expect(effectiveLeaseStatus("active", addDays(today, -1), today)).toBe("active");
    expect(effectiveLeaseStatus("active", null, today)).toBe("active");
    expect(effectiveLeaseStatus("draft", addDays(today, -1), today)).toBe("draft");
  });

  it("only tells the guarantee that the keys are back: no amount leaves it at the departure", async () => {
    const rental = await letTo(ctx, unitId, [ANNA], "1 250", started);
    const deposit = db.insertRow("deposits", { org_id: ORG, lease_id: rental.leaseId, form: "cash", amount_cents: 250000, status: "held" });
    // An outcome the departure may not write, and an amount with it, as an older client would send them.
    const forged = { endDate: today, depositOutcome: "released", releasedCents: 999900, keysReturned: true, keysReturnedOn: addDays(today, 3), decompteIssuedOn: null } as unknown as Parameters<typeof closeLease>[2];
    const closed = await closeLease(ctx, rental.leaseId, forged, today);
    expect(closed).toMatchObject({ status: "ended", depositStatus: "held", pending: [] });
    expect(db.table("deposits").find((x) => x.id === deposit.id)).toMatchObject({ status: "held", key_handover_on: today, released_balance_cents: null, released_first_tranche_cents: null });
  });

  it("opens the restitution of a guarantee that was received, and leaves one never received as it is", async () => {
    const rental = await letTo(ctx, unitId, [ANNA], "1 250", started);
    const held = db.insertRow("deposits", { org_id: ORG, lease_id: rental.leaseId, form: "cash", amount_cents: 250000, status: "held" });
    const closed = await departOn(db, ctx, rental.leaseId, today);
    expect(closed).toMatchObject({ status: "ended", depositStatus: "release_pending" });
    expect(db.table("deposits").find((x) => x.id === held.id)).toMatchObject({ status: "release_pending", key_handover_on: today });

    const other = seedProperty(db, ORG, "Studio Gare");
    const second = await letTo(ctx, other.unitId, [{ firstName: "Luc", lastName: "Adam" }], "900", started);
    const pending = db.insertRow("deposits", { org_id: ORG, lease_id: second.leaseId, form: "cash", amount_cents: 180000, status: "pending" });
    expect(await departOn(db, ctx, second.leaseId, today)).toMatchObject({ status: "ended", depositStatus: "pending" });
    expect(db.table("deposits").find((x) => x.id === pending.id)).toMatchObject({ status: "pending", key_handover_on: today });
  });

  it("refuses to close twice, a draft, an unknown lease, and an end before the start", async () => {
    const rental = await letTo(ctx, unitId, [ANNA], "1 250", started);
    expect(await closeLease(ctx, rental.leaseId, closure(started), today)).toEqual({ error: "end_before_start" });
    expect(await closeLease(ctx, "nope", closure(today), today)).toEqual({ error: "not_found" });
    expect(await closeLease(ctx, rental.leaseId, closure(today), today)).toMatchObject({ status: "ended" });
    expect(await closeLease(ctx, rental.leaseId, closure(today), today)).toEqual({ error: "already_ended" });
    const other = seedProperty(db, ORG, "Studio Gare");
    const draft = db.insertRow("leases", { org_id: ORG, unit_id: other.unitId, status: "draft", start_date: started, rent_cents: 90000 });
    expect(await closeLease(ctx, String(draft.id), closure(today), today)).toEqual({ error: "not_live" });
  });
});

describe("what a tenant reads of their tenancies", () => {
  let db: FakeDb;
  let ctx: OrgContext;

  beforeEach(() => {
    db = new FakeDb(today);
    ctx = ctxFor(db);
  });

  it("never shows a dossier in preparation, even to a person whose account is already linked", async () => {
    const first = seedProperty(db, ORG, "Maison Weber");
    const rental = await letTo(ctx, first.unitId, [ANNA], "1 250", started);
    await linkAccount(db, ctx, rental, anna);
    // The owner starts a dossier for the same person on another lot.
    const second = seedProperty(db, ORG, "Studio Gare");
    const draft = db.insertRow("leases", { org_id: ORG, unit_id: second.unitId, status: "draft", start_date: addMonths(thisMonth, 2), rent_cents: 90000 });
    db.insertRow("lease_parties", { org_id: ORG, lease_id: draft.id, contact_id: rental.contactIds[0], role: "tenant" });

    let mine = await space(db, anna);
    expect(mine.current!.id).toBe(rental.leaseId);
    expect([...mine.others, ...mine.past].map((l) => l.id)).toEqual([]);

    // With no tenancy in force, the draft still is not theirs to see.
    await departOn(db, ctx, rental.leaseId, today);
    mine = await space(db, anna);
    expect(mine.current).toBeNull();
    expect(mine.past.map((l) => l.id)).toEqual([rental.leaseId]);
  });

  it("keeps the balance of a former tenant on screen: the same arrears the owner reads", async () => {
    const { unitId } = seedProperty(db, ORG, "Maison Weber");
    const rental = await letTo(ctx, unitId, [ANNA], "1 250", started);
    await linkAccount(db, ctx, rental, anna);
    await departOn(db, ctx, rental.leaseId, today);

    const demo = await hydrate(db);
    const ownerSide = demo.RENT_PERIODS.filter((rp) => rp.leaseId === rental.leaseId && rp.dueDate < today).reduce((a, rp) => a + (rp.totalCents - rp.allocatedCents), 0);
    expect(ownerSide).toBeGreaterThan(0);

    const mine = await space(db, anna);
    expect(mine.current).toBeNull();
    expect(mine.payments).not.toBeNull();
    expect(mine.payments!.outstandingCents).toBe(ownerSide);
    expect(rentDue(mine.past[0], today).lateCents).toBe(ownerSide);
  });

  it("carries the ledger of every tenancy in force, each with its own reference", async () => {
    const flat = seedProperty(db, ORG, "Appartement");
    const parking = seedProperty(db, ORG, "Parking");
    const a = await letTo(ctx, flat.unitId, [ANNA], "1 250", started);
    const b = await letTo(ctx, parking.unitId, [ANNA], "120", addMonths(started, -1));
    await linkAccount(db, ctx, a, anna);

    const mine = await space(db, anna);
    expect(mine.current!.id).toBe(a.leaseId);
    expect(mine.others.map((l) => l.id)).toEqual([b.leaseId]);
    const other = mine.others[0];
    expect(other.periods.length).toBeGreaterThan(0);
    expect(rentDue(other, today).lateCents).toBeGreaterThan(0);
    expect(other.rfReference).not.toBe(mine.current!.rfReference);
  });
});
