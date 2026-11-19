import { beforeEach, describe, expect, it } from "vitest";
import type { OrgContext } from "@/lib/gestion/api";
import { isCalendarDay, isPaymentError, recordPaymentFifo } from "@/lib/banking/allocate";
import { cancelPayment } from "@/lib/banking/cancel";
import { reconcileUnmatched } from "@/lib/banking/reconcile";
import { openLedger } from "@/lib/gestion/lease";
import { addDays, addMonths } from "@/domain/dates";
import { FakeDb, type Row } from "./helpers/fake-postgrest";
import { ORG, ctxFor, hydrate, isoToday, letTo, seedProperty } from "./helpers/tenancy";

/**
 * Money in, once. A payment and its allocations are one write; a bank
 * operation becomes at most one payment; a payment typed by hand and the
 * bank's own line for it are the same money; a mistake can be cancelled,
 * with its trace; and what is received above what is due is a credit the
 * owner reads and the next periods take.
 */

const today = isoToday();
const thisMonth = `${today.slice(0, 7)}-01`;
const started = addMonths(thisMonth, -2);
const MONTH = 140000; // 1 250 rent + 150 charges
const ANNA = { firstName: "Anna", lastName: "Weber", email: "anna.weber@example.lu" };

describe("payments on a tenancy", () => {
  let db: FakeDb;
  let ctx: OrgContext;
  let leaseId: string;
  let unitId: string;

  const allocatedByPeriod = (): Array<[string, number]> =>
    (db.rowsOf("rent_period_status").filter((r) => r.lease_id === leaseId) as Row[])
      .sort((a, b) => (String(a.period) < String(b.period) ? -1 : 1))
      .map((r) => [String(r.period).slice(0, 7), Number(r.allocated_cents)]);
  const pay = (amountCents: number, extra: Partial<Parameters<typeof recordPaymentFifo>[2]> = {}) =>
    recordPaymentFifo(ctx.g, ORG, { leaseId, amountCents, receivedOn: today, auto: false, ...extra });
  const bankLine = (amountCents: number, extra: Row = {}): Row =>
    db.insertRow("bank_transactions", { org_id: ORG, bank_account_id: "acc-1", booked_on: today, amount_cents: amountCents, counterparty_name: "ANNA WEBER", ...extra });

  beforeEach(async () => {
    db = new FakeDb(today);
    ctx = ctxFor(db);
    ({ unitId } = seedProperty(db));
    const rental = await letTo(ctx, unitId, [ANNA], "1 250", started);
    leaseId = rental.leaseId;
    // The ledger as it stands today: the two months behind, this one and the next.
    await openLedger(ctx, { id: leaseId, startDate: started, endDate: null, rentCents: 125000, chargesCents: 15000, paymentDay: 1 }, today);
  });

  it("allocates to the oldest open months first and leaves the rest open", async () => {
    const outcome = await pay(MONTH + 50000);
    expect(outcome).toMatchObject({ allocated: MONTH + 50000, credit: 0, linked: false, replayed: false });
    expect(allocatedByPeriod().map(([, c]) => c)).toEqual([MONTH, 50000, 0, 0]);
    expect(db.table("payments")).toHaveLength(1);
  });

  it("writes once for a request sent twice", async () => {
    const first = await pay(MONTH, { requestKey: "dialog-0001" });
    const again = await pay(MONTH, { requestKey: "dialog-0001" });
    expect(isPaymentError(first)).toBe(false);
    expect(again).toMatchObject({ replayed: true, allocated: MONTH, credit: 0 });
    expect(db.table("payments")).toHaveLength(1);
    expect(allocatedByPeriod().map(([, c]) => c)).toEqual([MONTH, 0, 0, 0]);
    // Another request is another payment.
    await pay(MONTH, { requestKey: "dialog-0002" });
    expect(db.table("payments")).toHaveLength(2);
  });

  it("refuses an amount of nothing, an unknown tenancy, and a day that does not exist", async () => {
    expect(await pay(0)).toMatchObject({ step: "invalid" });
    expect(await recordPaymentFifo(ctx.g, ORG, { leaseId: "nope", amountCents: 100, receivedOn: today, auto: false })).toMatchObject({ step: "lease" });
    expect(db.table("payments")).toHaveLength(0);
    expect(isCalendarDay("2026-02-28")).toBe(true);
    expect(isCalendarDay("2026-02-31")).toBe(false);
    expect(isCalendarDay("28/02/2026")).toBe(false);
  });

  it("turns a bank operation into one payment, however many times it is matched", async () => {
    const tx = bankLine(MONTH);
    const first = await pay(MONTH, { bankTransactionId: String(tx.id), match: { tier: "manual", explain: "Maison" } });
    expect(first).toMatchObject({ allocated: MONTH });
    expect(db.table("bank_transactions")[0]).toMatchObject({ match_status: "manual", match_tier: "manual", match_explain: "Maison" });
    // The second "Rapprocher" (another tab, another member) finds the operation taken.
    expect(await pay(MONTH, { bankTransactionId: String(tx.id) })).toMatchObject({ step: "claimed" });
    expect(db.table("payments")).toHaveLength(1);
    expect(allocatedByPeriod().map(([, c]) => c)).toEqual([MONTH, 0, 0, 0]);
    // The base itself would refuse a second live payment for the operation.
    expect(() => db.insertRow("payments", { org_id: ORG, lease_id: leaseId, bank_transaction_id: tx.id, received_on: today, amount_cents: MONTH })).toThrow(/payments_bank_transaction_live_key/);
  });

  it("recognises the bank's line for a payment already typed by hand, instead of counting it twice", async () => {
    await pay(MONTH, { receivedOn: addDays(today, -2) });
    const tx = bankLine(MONTH);
    const matched = await pay(MONTH, { bankTransactionId: String(tx.id), auto: true, match: { tier: "rf", confidence: 1, explain: "RF" }, twinDays: 10 });
    expect(matched).toMatchObject({ linked: true, allocated: MONTH, credit: 0 });
    expect(db.table("payments")).toHaveLength(1);
    expect(db.table("payments")[0].bank_transaction_id).toBe(tx.id);
    expect(db.table("bank_transactions")[0].match_status).toBe("auto");
    expect(allocatedByPeriod().map(([, c]) => c)).toEqual([MONTH, 0, 0, 0]);

    // A second transfer of the same amount is new money: the hand-typed payment is already taken.
    const second = bankLine(MONTH, { booked_on: addDays(today, -1) });
    expect(await pay(MONTH, { receivedOn: addDays(today, -1), bankTransactionId: String(second.id), auto: true, twinDays: 10 })).toMatchObject({ linked: false });
    expect(db.table("payments")).toHaveLength(2);
    expect(allocatedByPeriod().map(([, c]) => c)).toEqual([MONTH, MONTH, 0, 0]);
  });

  it("does not take a payment of another amount, another tenancy or another season for the same money", async () => {
    await pay(MONTH, { receivedOn: addDays(today, -40) });
    await pay(MONTH - 100, { receivedOn: today });
    const tx = bankLine(MONTH);
    expect(await pay(MONTH, { bankTransactionId: String(tx.id), auto: true, twinDays: 10 })).toMatchObject({ linked: false });
    expect(db.table("payments")).toHaveLength(3);
  });

  it("keeps money above what is due as a credit the owner reads, and gives it to the next month when it opens", async () => {
    const outcome = await pay(4 * MONTH + 30000);
    expect(outcome).toMatchObject({ allocated: 4 * MONTH, credit: 30000 });
    let demo = await hydrate(db);
    expect(demo.LEASE_CREDITS).toEqual({ [leaseId]: 30000 });

    // A month later the ledger opens the following month: the credit goes to it.
    const later = addMonths(thisMonth, 1);
    db.today = later;
    const opened = await openLedger(ctx, { id: leaseId, startDate: started, endDate: null, rentCents: 125000, chargesCents: 15000, paymentDay: 1 }, later);
    expect(opened).toBe(1);
    expect(allocatedByPeriod().at(-1)).toEqual([addMonths(thisMonth, 2).slice(0, 7), 30000]);
    db.today = today;
    demo = await hydrate(db);
    expect(demo.LEASE_CREDITS).toEqual({});
  });

  it("lists the payments of a tenancy on its sheet, with what of each sits on periods", async () => {
    await pay(MONTH, { receivedOn: addDays(today, -1) });
    const big = await pay(5 * MONTH);
    if (isPaymentError(big)) throw new Error(big.step);
    const demo = await hydrate(db, ORG, { leaseId });
    expect(demo.PAYMENTS.map((p) => [p.receivedOn, p.amountCents, p.allocatedCents, p.cancelledOn])).toEqual([
      [today, 5 * MONTH, 3 * MONTH, null],
      [addDays(today, -1), MONTH, MONTH, null],
    ]);
    expect(demo.LEASE_CREDITS[leaseId]).toBe(2 * MONTH);
    // The workspace's own read carries the credit, not every payment.
    expect((await hydrate(db)).PAYMENTS).toEqual([]);
  });

  it("cancels a payment with its allocations, keeps the trace, and sends its bank operation back to review", async () => {
    const tx = bankLine(2 * MONTH);
    const paid = await pay(2 * MONTH, { bankTransactionId: String(tx.id), match: { tier: "manual" } });
    if (isPaymentError(paid)) throw new Error(paid.step);
    expect(allocatedByPeriod().map(([, c]) => c)).toEqual([MONTH, MONTH, 0, 0]);

    expect(await cancelPayment(ctx.g, paid.paymentId, "Mauvais bail")).toEqual({ ok: true, already: false, leaseId, bankTransactionId: tx.id });
    expect(allocatedByPeriod().map(([, c]) => c)).toEqual([0, 0, 0, 0]);
    const row = db.table("payments")[0];
    expect(row.cancelled_at).not.toBeNull();
    expect(row.cancel_reason).toBe("Mauvais bail");
    // Never deleted: the allocations stay, reversed.
    expect(db.table("payment_allocations").every((a) => a.reversed_at != null)).toBe(true);
    expect(db.table("bank_transactions")[0]).toMatchObject({ match_status: "review", match_explain: "payment_cancelled" });

    // Twice is once; an unknown payment is not found.
    expect(await cancelPayment(ctx.g, paid.paymentId, null)).toMatchObject({ ok: true, already: true });
    expect(await cancelPayment(ctx.g, "nope", null)).toEqual({ error: "not_found" });

    // The operation can be matched again, properly this time.
    expect(await pay(2 * MONTH, { bankTransactionId: String(tx.id), match: { tier: "manual" } })).toMatchObject({ allocated: 2 * MONTH });
    const demo = await hydrate(db, ORG, { leaseId });
    expect(demo.PAYMENTS.map((p) => [p.amountCents, p.allocatedCents, p.cancelledOn !== null]).sort()).toEqual([[2 * MONTH, 0, true], [2 * MONTH, 2 * MONTH, false]].sort());
  });

  it("gives the months a cancellation frees to the credit that was waiting", async () => {
    const first = await pay(4 * MONTH);
    const duplicate = await pay(MONTH);
    if (isPaymentError(first) || isPaymentError(duplicate)) throw new Error("payment failed");
    expect((await hydrate(db)).LEASE_CREDITS).toEqual({ [leaseId]: MONTH });
    // The four months were paid twice over by mistake: cancel the first, the other one still covers a month.
    await cancelPayment(ctx.g, first.paymentId, "Doublon");
    expect(allocatedByPeriod().map(([, c]) => c)).toEqual([MONTH, 0, 0, 0]);
    expect((await hydrate(db)).LEASE_CREDITS).toEqual({});
  });

  it("refuses to cancel a payment a quittance attests", async () => {
    const paid = await pay(MONTH);
    if (isPaymentError(paid)) throw new Error(paid.step);
    const period = db.table("rent_periods").filter((rp) => rp.lease_id === leaseId).sort((a, b) => (String(a.period) < String(b.period) ? -1 : 1))[0];
    db.insertRow("generated_documents", { org_id: ORG, document_id: "doc-1", kind: "rent_receipt", lang: "fr", template_version: "1", source_type: "rent_period", source_id: period.id, payload_sha256: "x" });
    expect(await cancelPayment(ctx.g, paid.paymentId, null)).toEqual({ error: "receipt_issued" });
    expect(db.table("payments")[0].cancelled_at).toBeNull();
    expect(allocatedByPeriod()[0][1]).toBe(MONTH);
  });

  it("says the base is behind when it does not carry the function yet, and writes nothing", async () => {
    db.absentRpc.add("record_payment");
    expect(await pay(MONTH)).toMatchObject({ step: "outdated" });
    db.absentRpc.add("cancel_payment");
    expect(await cancelPayment(ctx.g, "any", null)).toEqual({ error: "schema_outdated" });
    expect(db.table("payments")).toHaveLength(0);
  });
});

describe("the matching run", () => {
  let db: FakeDb;
  let ctx: OrgContext;
  let leaseId: string;
  let rf: string;

  beforeEach(async () => {
    db = new FakeDb(today);
    ctx = ctxFor(db);
    const { unitId } = seedProperty(db);
    const rental = await letTo(ctx, unitId, [ANNA], "1 250", started);
    leaseId = rental.leaseId;
    await openLedger(ctx, { id: leaseId, startDate: started, endDate: null, rentCents: 125000, chargesCents: 15000, paymentDay: 1 }, today);
    rf = String(db.table("leases").find((l) => l.id === leaseId)!.rf_reference);
  });

  const line = (amountCents: number, extra: Row = {}): Row =>
    db.insertRow("bank_transactions", { org_id: ORG, bank_account_id: "acc-1", booked_on: today, amount_cents: amountCents, counterparty_name: "ANNA WEBER", remittance_info: `${rf} loyer`, ...extra });
  const run = () => reconcileUnmatched(ctx.g as unknown as Parameters<typeof reconcileUnmatched>[0], ORG);

  it("posts an RF line once, whatever the number of runs", async () => {
    const tx = line(MONTH);
    expect(await run()).toEqual({ auto: 1, review: 0, ignored: 0 });
    expect(await run()).toEqual({ auto: 0, review: 0, ignored: 0 });
    expect(db.table("payments")).toHaveLength(1);
    expect(db.table("payments")[0]).toMatchObject({ bank_transaction_id: tx.id, amount_cents: MONTH, lease_id: leaseId });
    expect(db.table("bank_transactions")[0]).toMatchObject({ match_status: "auto", match_tier: "rf" });
    expect(db.table("payment_allocations").map((a) => [a.amount_cents, a.auto])).toEqual([[MONTH, true]]);
  });

  it("keeps the open ledger true between two lines of one run", async () => {
    line(MONTH, { booked_on: addDays(today, -1) });
    line(MONTH);
    expect(await run()).toMatchObject({ auto: 2 });
    const allocated = (db.rowsOf("rent_period_status") as Row[]).sort((a, b) => (String(a.period) < String(b.period) ? -1 : 1)).map((r) => Number(r.allocated_cents));
    expect(allocated).toEqual([MONTH, MONTH, 0, 0]);
  });

  it("attaches the line to a payment the owner already typed, and does not post it again", async () => {
    await recordPaymentFifo(ctx.g, ORG, { leaseId, amountCents: MONTH, receivedOn: addDays(today, -3), auto: false });
    const tx = line(MONTH);
    expect(await run()).toMatchObject({ auto: 1 });
    expect(db.table("payments")).toHaveLength(1);
    expect(db.table("payments")[0].bank_transaction_id).toBe(tx.id);
    const allocated = (db.rowsOf("rent_period_status") as Row[]).reduce((a, r) => a + Number(r.allocated_cents), 0);
    expect(allocated).toBe(MONTH);
  });

  it("leaves a line somebody matched by hand in the meantime alone", async () => {
    const tx = line(MONTH, { remittance_info: "loyer" });
    // The run reads the line as unmatched; a person matches it before the run decides.
    tx.match_status = "manual";
    expect(await run()).toEqual({ auto: 0, review: 0, ignored: 0 });
    expect(tx.match_status).toBe("manual");
  });

  it("sets a debit aside and holds a foreign-currency line for a person", async () => {
    line(-8990, { counterparty_name: "CREOS", remittance_info: "Facture" });
    line(MONTH, { currency: "CHF" });
    expect(await run()).toEqual({ auto: 0, review: 1, ignored: 1 });
    expect(db.table("payments")).toHaveLength(0);
    expect(db.table("bank_transactions").map((t) => t.match_status).sort()).toEqual(["ignored", "review"]);
  });

  it("matches against the whole open ledger of a large workspace, not its first page", async () => {
    // 1 100 other tenancies, each with an open month: the tenancy under test is read last.
    for (let i = 0; i < 1100; i++) {
      const unit = db.insertRow("units", { org_id: ORG, property_id: "p-bulk", label: `Lot ${i}` });
      const lease = db.insertRow("leases", { id: `bulk-${String(i).padStart(5, "0")}`, org_id: ORG, unit_id: unit.id, status: "active", start_date: started, rent_cents: 90000 });
      db.insertRow("rent_periods", { id: `bulk-rp-${String(i).padStart(5, "0")}`, org_id: ORG, lease_id: lease.id, period: thisMonth, due_date: thisMonth, rent_cents: 90000 });
    }
    const late = db.insertRow("leases", { id: "zz-late", org_id: ORG, unit_id: db.insertRow("units", { org_id: ORG, property_id: "p-bulk", label: "Dernier" }).id, status: "active", start_date: started, rent_cents: 77700, rf_reference: "RF18539007547034" });
    db.insertRow("rent_periods", { id: "zz-rp", org_id: ORG, lease_id: late.id, period: thisMonth, due_date: thisMonth, rent_cents: 77700 });
    const tx = db.insertRow("bank_transactions", { org_id: ORG, bank_account_id: "acc-1", booked_on: today, amount_cents: 77700, counterparty_name: "X", remittance_info: "RF18539007547034" });
    expect(await run()).toMatchObject({ auto: 1 });
    expect(db.table("payments").find((p) => p.bank_transaction_id === tx.id)).toMatchObject({ lease_id: "zz-late" });
  });
});
