import { describe, expect, it } from "vitest";
import { fr } from "@/lib/i18n/fr";
import { activateLease, createLease, ledgerPinFor, openLedger, trackingMonth, trimLedgerBefore } from "@/lib/gestion/lease";
import { saveRentalDraft } from "@/lib/gestion/rental";
import { addMonths } from "@/domain/dates";
import { FakeDb } from "./helpers/fake-postgrest";
import { ORG, ctxFor, dossier, isoToday, seedProperty } from "./helpers/tenancy";

/**
 * A tenancy that already runs when the owner records it is followed from the
 * month the owner chooses, by default this one: the months before are not
 * opened as unpaid rent, on either side. A start date corrected later never
 * opens months behind the ones already followed, and a start moved later
 * takes away the months that were never owed.
 */

const today = isoToday();
const thisMonth = `${today.slice(0, 7)}-01`;
const nextMonth = addMonths(thisMonth, 1);
const fiveBack = addMonths(thisMonth, -5);
const ANNA = { firstName: "Anna", lastName: "Weber", email: "anna.weber@example.lu" };

const months = (db: FakeDb, leaseId: string): string[] =>
  db
    .table("rent_periods")
    .filter((rp) => rp.lease_id === leaseId)
    .map((rp) => String(rp.period))
    .sort();

async function draftFrom(db: FakeDb, startDate: string): Promise<string> {
  const ctx = ctxFor(db);
  const { unitId } = seedProperty(db);
  const saved = await saveRentalDraft(ctx, fr, dossier({ unitId, step: "rent", tenants: [ANNA], rent: "1 250", charges: "150", startDate, paymentDay: "1" }));
  if ("error" in saved) throw new Error(saved.error);
  return saved.leaseId;
}

describe("the month rent is tracked from", () => {
  it("is this month for a tenancy that already ran, unless the owner says otherwise", () => {
    expect(trackingMonth(fiveBack, today)).toBe(thisMonth);
    expect(trackingMonth(fiveBack, today, null)).toBe(thisMonth);
    expect(trackingMonth(fiveBack, today, "start")).toBe(fiveBack);
    expect(trackingMonth(fiveBack, today, addMonths(thisMonth, -2).slice(0, 7))).toBe(addMonths(thisMonth, -2));
    // Never before the tenancy began, never after this month.
    expect(trackingMonth(fiveBack, today, addMonths(thisMonth, -9).slice(0, 7))).toBe(fiveBack);
    expect(trackingMonth(fiveBack, today, addMonths(thisMonth, 3).slice(0, 7))).toBe(thisMonth);
    // A tenancy starting now or later is followed from its own first month.
    expect(trackingMonth(today, today)).toBe(thisMonth);
    expect(trackingMonth(nextMonth, today, "start")).toBe(nextMonth);
  });

  it("opens no past month when an existing tenancy is activated", async () => {
    const db = new FakeDb(today);
    const ctx = ctxFor(db);
    const leaseId = await draftFrom(db, fiveBack);
    expect(await activateLease(ctx, leaseId, today)).toEqual({ ok: true, periodsOpened: 2 });
    expect(months(db, leaseId)).toEqual([thisMonth, nextMonth]);
    expect(db.table("leases").find((l) => l.id === leaseId)?.ledger_from).toBe(thisMonth);
    // No month before the one followed reads as owed.
    expect(db.periodStatus().filter((r) => r.lease_id === leaseId && String(r.period) < thisMonth)).toEqual([]);
  });

  it("opens the past months the owner asked for, and those only", async () => {
    const db = new FakeDb(today);
    const ctx = ctxFor(db);
    const leaseId = await draftFrom(db, fiveBack);
    expect(await activateLease(ctx, leaseId, today, "start")).toEqual({ ok: true, periodsOpened: 7 });
    expect(months(db, leaseId)[0]).toBe(fiveBack);

    const db2 = new FakeDb(today);
    const second = await draftFrom(db2, fiveBack);
    await activateLease(ctxFor(db2), second, today, addMonths(thisMonth, -2).slice(0, 7));
    expect(months(db2, second)).toEqual([addMonths(thisMonth, -2), addMonths(thisMonth, -1), thisMonth, nextMonth]);
  });

  it("keeps the choice when the ledger is opened again", async () => {
    const db = new FakeDb(today);
    const ctx = ctxFor(db);
    const leaseId = await draftFrom(db, fiveBack);
    await activateLease(ctx, leaseId, today);
    const lease = db.table("leases").find((l) => l.id === leaseId)!;
    await openLedger(ctx, { id: leaseId, startDate: fiveBack, endDate: null, rentCents: 125000, chargesCents: 15000, paymentDay: 1, ledgerFrom: String(lease.ledger_from) }, today);
    expect(months(db, leaseId)).toEqual([thisMonth, nextMonth]);
  });

  it("follows the quick lease from this month, and names a lot already let", async () => {
    const db = new FakeDb(today);
    const ctx = ctxFor(db);
    const { unitId } = seedProperty(db);
    const contact = db.insertRow("contacts", { org_id: ORG, kind: "natural", first_name: "Anna", last_name: "Weber" });
    const input = {
      unitId,
      tenantContactIds: [String(contact.id)],
      colocation: false,
      type: "residential" as const,
      startDate: fiveBack,
      endDate: null,
      rentCents: 125000,
      chargesCents: 15000,
      paymentDay: 1,
      depositMonths: 2,
      depositForm: "cash" as const,
      furnished: false,
    };
    const lease = await createLease(ctx, fr, input);
    if ("error" in lease) throw new Error(lease.error);
    expect(lease.pending).toEqual([]);
    expect(months(db, lease.id)).toEqual([thisMonth, nextMonth]);
    expect(await createLease(ctx, fr, input)).toEqual({ error: "already_let" });
  });
});

describe("a start date corrected on a running tenancy", () => {
  it("pins the first month followed before an earlier date is written", async () => {
    const db = new FakeDb(today);
    const ctx = ctxFor(db);
    const leaseId = await draftFrom(db, thisMonth);
    await activateLease(ctx, leaseId, today);
    const lease = db.table("leases").find((l) => l.id === leaseId)!;
    // A row written before the column existed carries no first month: it is pinned to the ledger's.
    lease.ledger_from = null;
    expect(await ledgerPinFor(ctx, { id: leaseId, status: "active", ledgerFrom: null })).toBe(thisMonth);
    // Pinned once; a dossier in preparation has no ledger to pin.
    expect(await ledgerPinFor(ctx, { id: leaseId, status: "active", ledgerFrom: thisMonth })).toBeNull();
    expect(await ledgerPinFor(ctx, { id: leaseId, status: "draft", ledgerFrom: null })).toBeNull();
    // With the month pinned, opening the ledger from an earlier start opens nothing behind it.
    await openLedger(ctx, { id: leaseId, startDate: fiveBack, endDate: null, rentCents: 125000, chargesCents: 15000, paymentDay: 1, ledgerFrom: thisMonth }, today);
    expect(months(db, leaseId)).toEqual([thisMonth, nextMonth]);
  });

  it("takes away the months before a later start, keeping any that carry money", async () => {
    const db = new FakeDb(today);
    const ctx = ctxFor(db);
    const leaseId = await draftFrom(db, fiveBack);
    await activateLease(ctx, leaseId, today, "start");
    const periods = db.table("rent_periods").filter((rp) => rp.lease_id === leaseId);
    const paid = periods.find((rp) => rp.period === fiveBack)!;
    const reversed = periods.find((rp) => rp.period === addMonths(thisMonth, -4))!;
    db.insertRow("payments", { id: "pay-1", org_id: ORG, lease_id: leaseId, received_on: today, amount_cents: 140000, method: "transfer" });
    db.insertRow("payment_allocations", { org_id: ORG, payment_id: "pay-1", rent_period_id: paid.id, amount_cents: 140000 });
    db.insertRow("payment_allocations", { org_id: ORG, payment_id: "pay-1", rent_period_id: reversed.id, amount_cents: 100, reversed_at: `${today}T10:00:00Z` });

    const newStart = `${addMonths(thisMonth, -2).slice(0, 7)}-17`;
    const trimmed = await trimLedgerBefore(ctx, leaseId, newStart, 1);
    // The month nobody paid is gone, the one with a reversed payment is written off.
    expect(trimmed).toBe(2);
    expect(months(db, leaseId)).toEqual([fiveBack, addMonths(thisMonth, -4), addMonths(thisMonth, -2), addMonths(thisMonth, -1), thisMonth, nextMonth]);
    expect(db.table("rent_periods").find((rp) => rp.id === reversed.id)?.written_off).toBe(true);
    expect(db.table("rent_periods").find((rp) => rp.id === paid.id)?.written_off).toBe(false);
    // The new first month is owed from the day the tenancy starts.
    expect(db.table("rent_periods").find((rp) => rp.lease_id === leaseId && rp.period === addMonths(thisMonth, -2))?.due_date).toBe(newStart);
  });
});
