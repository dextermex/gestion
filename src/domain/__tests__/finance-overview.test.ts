import { describe, expect, it } from "vitest";
import { expensesByCategory, monthlyFlows, periodResult, unpaidBills, yearResult, type FlowBill } from "@/domain/finance/overview";

const bill = (over: Partial<FlowBill>): FlowBill => ({ direction: "expense", amountCents: 0, category: "other_frais", cashflow: true, docDate: null, dueOn: null, paidOn: null, createdAt: "2026-08-01", ...over });
const periods = [
  { period: "2026-07", allocatedCents: 150_000 },
  { period: "2026-08", allocatedCents: 100_000 },
  { period: "2026-08", allocatedCents: 66_000 },
];
const bills = [
  bill({ amountCents: 48_000, category: "maintenance_repairs", docDate: "2026-06-25", dueOn: "2026-07-25", paidOn: "2026-07-10" }),
  bill({ amountCents: 124_000, category: "maintenance_repairs", docDate: "2026-08-08", dueOn: "2026-09-07" }),
  bill({ amountCents: 186_000, category: "insurance", docDate: "2026-01-15", paidOn: "2026-01-20" }),
  bill({ direction: "income", amountCents: 20_000, docDate: "2026-08-02", paidOn: "2026-08-03" }),
  bill({ amountCents: 9_900, cashflow: false, docDate: "2026-08-20", paidOn: "2026-08-20" }),
  bill({ amountCents: 5_000, docDate: "2026-07-01", dueOn: "2026-07-15" }),
];

describe("the finance overview", () => {
  it("sums what came in and what went out per month, and never invents a month", () => {
    expect(monthlyFlows(periods, bills, ["2026-07", "2026-08", "2026-09"])).toEqual([
      { month: "2026-07", inCents: 150_000, outCents: 48_000, netCents: 102_000 },
      { month: "2026-08", inCents: 186_000, outCents: 0, netCents: 186_000 },
      { month: "2026-09", inCents: 0, outCents: 0, netCents: 0 },
    ]);
  });
  it("keeps a bill outside the cash flow out of a month's flow", () => {
    expect(monthlyFlows([], bills, ["2026-08"])[0].outCents).toBe(0);
  });
  it("lists what is still to pay, the overdue first", () => {
    expect(unpaidBills(bills, "2026-08-23").map((b) => b.amountCents)).toEqual([5_000, 124_000]);
  });
  it("splits a year's expenses by category, the largest first", () => {
    const rows = expensesByCategory(bills, "2026");
    expect(rows.map((r) => [r.category, r.cents])).toEqual([["insurance", 186_000], ["maintenance_repairs", 172_000], ["other_frais", 14_900]]);
    expect(rows.reduce((a, r) => a + r.share, 0)).toBeCloseTo(1);
    expect(expensesByCategory(bills, "2025")).toEqual([]);
  });
  it("sums a quarter and a year so far the same way, by the months named", () => {
    expect(periodResult(periods, bills, "2026-07", "2026-09")).toEqual({ incomeCents: 336_000, expenseCents: 138_900, netCents: 197_100 });
    expect(periodResult(periods, bills, "2026-01", "2026-06")).toEqual({ incomeCents: 0, expenseCents: 234_000, netCents: -234_000 });
    expect(periodResult(periods, bills, "2025-01", "2025-12")).toEqual({ incomeCents: 0, expenseCents: 0, netCents: 0 });
  });
  it("gives the year so far: rents up to the month, other receipts, expenses and the result", () => {
    expect(yearResult(periods, bills, "2026", "2026-07")).toEqual({ rentCents: 150_000, otherIncomeCents: 20_000, expenseCents: 372_900, resultCents: -202_900 });
    expect(yearResult(periods, bills, "2026", "2026-08").rentCents).toBe(316_000);
  });
});
