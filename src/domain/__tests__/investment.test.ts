import { describe, expect, it } from "vitest";
import { amortize, investmentCashflow, InvestmentInputError, nextPurchase, repaidProgress } from "../investment";

describe("mortgage amortization estimates", () => {
  it("accounts for every cent over a normal mortgage and settles the last payment", () => {
    const result = amortize({ balanceCents: 40_000_000, annualRatePct: 3.5, remainingMonths: 300 });
    expect(result.monthlyPaymentCents).toBe(200_249);
    expect(result.schedule).toHaveLength(300);
    expect(result.schedule.at(-1)?.balanceCents).toBe(0);
    expect(result.schedule.reduce((sum, row) => sum + row.principalCents, 0)).toBe(40_000_000);
    expect(result.totalPaymentCents).toBe(40_000_000 + result.totalInterestCents);
    for (const [index, row] of result.schedule.entries()) {
      expect(row.month).toBe(index + 1);
      expect(row.paymentCents).toBe(row.interestCents + row.principalCents);
      expect(row.balanceCents).toBe(row.openingCents - row.principalCents);
      expect(row.balanceCents).toBeGreaterThanOrEqual(0);
      expect(row.principalCents).toBeGreaterThanOrEqual(0);
      expect(Object.values(row).every(Number.isSafeInteger)).toBe(true);
      if (index > 0) expect(row.openingCents).toBe(result.schedule[index - 1].balanceCents);
    }
    expect(result.schedule[0].interestCents).toBe(116_667);
    expect(result.schedule[299].paymentCents).not.toBe(result.monthlyPaymentCents);
  });

  it("handles zero rate without division by zero and clears a rounding remainder", () => {
    const result = amortize({ balanceCents: 100, annualRatePct: 0, remainingMonths: 3 });
    expect(result.monthlyPaymentCents).toBe(33);
    expect(result.schedule.map((row) => row.paymentCents)).toEqual([33, 33, 34]);
    expect(result.totalInterestCents).toBe(0);
    expect(result.totalPaymentCents).toBe(100);
  });

  it("settles a one-payment mortgage including its interest", () => {
    const result = amortize({ balanceCents: 100_000, annualRatePct: 12, remainingMonths: 1 });
    expect(result.schedule).toEqual([{ month: 1, openingCents: 100_000, interestCents: 1_000, principalCents: 100_000, paymentCents: 101_000, balanceCents: 0 }]);
  });

  it("returns no future payments for zero capital and accepts a zero remaining term", () => {
    expect(amortize({ balanceCents: 0, annualRatePct: 3.5, remainingMonths: 0 })).toEqual({ schedule: [], monthlyPaymentCents: 0, totalInterestCents: 0, totalPaymentCents: 0 });
    expect(amortize({ balanceCents: 0, annualRatePct: 0, remainingMonths: 12 }).schedule).toEqual([]);
  });

  it("retains precision for near-zero interest instead of exploding the payment", () => {
    const result = amortize({ balanceCents: 12_000, annualRatePct: 1e-12, remainingMonths: 12 });
    expect(result.monthlyPaymentCents).toBe(1_000);
    expect(result.totalPaymentCents).toBe(12_000);
  });

  it("never overpays tiny balances and does not manufacture zero-balance rows", () => {
    const result = amortize({ balanceCents: 2, annualRatePct: 0, remainingMonths: 3 });
    expect(result.schedule.map((row) => row.paymentCents)).toEqual([1, 1]);
    expect(result.totalPaymentCents).toBe(2);
    const subCentPayment = amortize({ balanceCents: 1, annualRatePct: 0, remainingMonths: 12 });
    expect(subCentPayment.schedule.at(-1)?.paymentCents).toBe(1);
    expect(subCentPayment.totalPaymentCents).toBe(1);
  });

  it.each([
    { balanceCents: -1 }, { balanceCents: 1.5 }, { balanceCents: NaN }, { balanceCents: Number.MAX_SAFE_INTEGER + 1 },
    { annualRatePct: Infinity }, { annualRatePct: NaN }, { annualRatePct: -1 }, { annualRatePct: 101 },
    { remainingMonths: 0 }, { remainingMonths: -1 }, { remainingMonths: 1.5 }, { remainingMonths: NaN }, { remainingMonths: 1_201 },
  ])("rejects invalid mortgage inputs: %o", (override) => {
    expect(() => amortize({ balanceCents: 100_000, annualRatePct: 4, remainingMonths: 12, ...override })).toThrow(InvestmentInputError);
  });

  it("rejects aggregate results outside safe integer cents", () => {
    expect(() => amortize({ balanceCents: Number.MAX_SAFE_INTEGER, annualRatePct: 100, remainingMonths: 1 })).toThrow(expect.objectContaining({ code: "amount_overflow" }));
  });
});

describe("capital repayment progress", () => {
  it("distinguishes paid capital from equity and does not infer progress without an original amount", () => {
    expect(repaidProgress(1_000_000, 750_000)).toEqual({ repaidCents: 250_000, repaidPct: 25, balanceIncreased: false });
    expect(repaidProgress(1_000_000, 0).repaidPct).toBe(100);
    expect(repaidProgress(0, 0).repaidPct).toBeNull();
  });
  it("flags capital increases instead of displaying negative repayment progress", () => {
    expect(repaidProgress(1_000, 1_500)).toEqual({ repaidCents: 0, repaidPct: 0, balanceIncreased: true });
    expect(repaidProgress(0, 1_000)).toEqual({ repaidCents: 0, repaidPct: null, balanceIncreased: true });
  });
  it("rejects invalid capital figures", () => {
    expect(() => repaidProgress(10, -1)).toThrow(InvestmentInputError);
    expect(() => repaidProgress(1.5, 1)).toThrow(InvestmentInputError);
  });
});

describe("investment cash flow", () => {
  const base = { monthlyRentCents: 200_000, occupancyPct: 90, monthlyOwnerCostsCents: 30_000, monthlyDebtCents: 120_000, monthlyInsuranceCents: 5_000, totalAcquisitionCents: 50_000_000 };

  it("keeps operating yield separate from cash flow after principal, interest and insurance", () => {
    expect(investmentCashflow(base)).toEqual({ effectiveRentCents: 180_000, operatingSurplusCents: 150_000, cashflowCents: 25_000, netYieldPct: 3.6 });
    expect(investmentCashflow({ ...base, monthlyDebtCents: 200_000 })).toEqual({ effectiveRentCents: 180_000, operatingSurplusCents: 150_000, cashflowCents: -55_000, netYieldPct: 3.6 });
  });
  it("represents vacancy and losses without clamping them to zero", () => {
    expect(investmentCashflow({ ...base, occupancyPct: 0 })).toEqual({ effectiveRentCents: 0, operatingSurplusCents: -30_000, cashflowCents: -155_000, netYieldPct: -0.72 });
  });
  it("does not claim a yield without a positive cost denominator", () => {
    expect(investmentCashflow({ ...base, totalAcquisitionCents: undefined }).netYieldPct).toBeNull();
    expect(investmentCashflow({ ...base, totalAcquisitionCents: 0 }).netYieldPct).toBeNull();
  });
  it("rounds estimated rent to integer cents", () => {
    expect(investmentCashflow({ ...base, monthlyRentCents: 101, occupancyPct: 50 }).effectiveRentCents).toBe(51);
  });
  it.each([{ occupancyPct: -1 }, { occupancyPct: 101 }, { occupancyPct: NaN }, { monthlyRentCents: -1 }, { monthlyDebtCents: 0.5 }, { monthlyInsuranceCents: Infinity }, { monthlyOwnerCostsCents: -1 }, { totalAcquisitionCents: -1 }])("rejects invalid cash-flow inputs: %o", (override) => {
    expect(() => investmentCashflow({ ...base, ...override })).toThrow(InvestmentInputError);
  });
  it("rejects a combined outflow beyond safe integer cents", () => {
    expect(() => investmentCashflow({ ...base, monthlyOwnerCostsCents: Number.MAX_SAFE_INTEGER, monthlyDebtCents: Number.MAX_SAFE_INTEGER })).toThrow(expect.objectContaining({ code: "amount_overflow" }));
  });
});

describe("next-purchase cash target", () => {
  const base = { priceCents: 50_000_000, loanCents: 40_000_000, feesCents: 4_000_000, worksCents: 2_000_000, reserveCents: 1_000_000, availableCashCents: 15_000_000, monthlySavingCents: 300_000 };

  it("includes fees, works and retained reserves and rounds up to complete months", () => {
    expect(nextPurchase(base)).toEqual({ targetCents: 17_000_000, gapCents: 2_000_000, months: 7 });
  });
  it.each([0, -300_000])("cannot reach an unfunded target with a monthly saving of %i", (monthlySavingCents) => {
    expect(nextPurchase({ ...base, monthlySavingCents }).months).toBeNull();
  });
  it("shows an already funded target immediately even if saving is negative", () => {
    expect(nextPurchase({ ...base, availableCashCents: 18_000_000, monthlySavingCents: -100_000 })).toEqual({ targetCents: 17_000_000, gapCents: 0, months: 0 });
  });
  it("allows financing works and fees but retains the separately budgeted reserve", () => {
    expect(nextPurchase({ ...base, loanCents: 56_000_000, availableCashCents: 0 })).toEqual({ targetCents: 1_000_000, gapCents: 1_000_000, months: 4 });
  });
  it.each([{ loanCents: 56_000_001 }, { priceCents: -1 }, { feesCents: 0.5 }, { worksCents: NaN }, { reserveCents: -1 }, { availableCashCents: -1 }, { monthlySavingCents: Infinity }])("rejects invalid target inputs: %o", (override) => {
    expect(() => nextPurchase({ ...base, ...override })).toThrow(InvestmentInputError);
  });
  it("reports stable input codes and refuses overflowing targets", () => {
    expect(() => nextPurchase({ ...base, monthlySavingCents: 0.5 })).toThrow(expect.objectContaining({ code: "invalid_money", field: "monthlySavingCents" }));
    expect(() => nextPurchase({ ...base, priceCents: Number.MAX_SAFE_INTEGER })).toThrow(expect.objectContaining({ code: "amount_overflow" }));
  });
});
