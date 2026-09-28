import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { amortize } from "@/domain/investment";
import { calendarDay, loanSchema, moneyInput, type LoanDraft } from "../loans";

const draft: LoanDraft = {
  propertyId: "property-1", unitId: null, name: "Tranche fixe", bankName: "Banque",
  originalCents: 40_000_000, balanceCents: 35_000_000, balanceDate: "2026-09-01",
  annualRatePct: 3.5, rateType: "fixed", remainingMonths: 240, insuranceCents: 5_000,
  nextPaymentDate: "2026-10-01", fixedUntil: "2031-09-01", notes: "",
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-27T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("loan input schema", () => {
  it("accepts an individual tranche whose amounts can be safely amortised", () => {
    const record = loanSchema.parse(draft);
    const estimate = amortize(record);
    expect(estimate.schedule.at(-1)?.balanceCents).toBe(0);
    expect(estimate.totalPaymentCents).toBe(record.balanceCents + estimate.totalInterestCents);
  });

  it("permits increased capital and zero-rate borrowing without inventing repayments", () => {
    expect(loanSchema.safeParse({ ...draft, balanceCents: 45_000_000 }).success).toBe(true);
    expect(loanSchema.safeParse({ ...draft, annualRatePct: 0 }).success).toBe(true);
    expect(loanSchema.safeParse({ ...draft, rateType: "variable", fixedUntil: null }).success).toBe(true);
  });

  it("requires a zero term for zero balance and a positive term for outstanding capital", () => {
    expect(loanSchema.safeParse({ ...draft, balanceCents: 0, remainingMonths: 0 }).success).toBe(true);
    for (const override of [{ balanceCents: 0 }, { remainingMonths: 0 }]) {
      const result = loanSchema.safeParse({ ...draft, ...override });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues).toContainEqual(expect.objectContaining({ path: ["remainingMonths"], message: "balance_term" }));
    }
  });

  it("does not allow a combined mixed loan to masquerade as one amortising tranche", () => {
    expect(loanSchema.safeParse({ ...draft, rateType: "mixed" }).success).toBe(false);
  });

  it("accepts optional unit scope only as a non-empty identifier or null", () => {
    expect(loanSchema.parse({ ...draft, unitId: "unit-1" }).unitId).toBe("unit-1");
    expect(loanSchema.parse(draft).unitId).toBeNull();
    expect(loanSchema.safeParse({ ...draft, unitId: "" }).success).toBe(false);
    expect(loanSchema.safeParse({ ...draft, unitId: "   " }).success).toBe(false);
    expect(loanSchema.safeParse({ ...draft, propertyId: "   " }).success).toBe(false);
  });

  it("rejects blank names and trims human-entered names", () => {
    expect(loanSchema.parse({ ...draft, name: "  Tranche  ", bankName: " Banque ", notes: " Note " })).toMatchObject({ name: "Tranche", bankName: "Banque", notes: "Note" });
    expect(loanSchema.safeParse({ ...draft, name: "  " }).success).toBe(false);
    expect(loanSchema.safeParse({ ...draft, bankName: "  " }).success).toBe(false);
  });

  it("checks a statement date at validation time and accepts today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-27T12:00:00Z"));
    expect(loanSchema.safeParse({ ...draft, balanceDate: "2026-09-27" }).success).toBe(true);
    const result = loanSchema.safeParse({ ...draft, balanceDate: "2026-09-28" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toContainEqual(expect.objectContaining({ path: ["balanceDate"], message: "future_balance" }));
  });

  it.each([
    { originalCents: 0 }, { originalCents: -1 }, { balanceCents: 1.5 },
    { balanceCents: NaN }, { balanceCents: Infinity }, { balanceCents: 100_000_000_001 },
    { insuranceCents: -1 }, { annualRatePct: -1 }, { annualRatePct: NaN }, { annualRatePct: Infinity }, { annualRatePct: 31 },
    { remainingMonths: -1 }, { remainingMonths: 0.5 }, { remainingMonths: 601 },
    { balanceDate: "2026-02-30" }, { nextPaymentDate: "2026-13-01" }, { fixedUntil: "invalid" },
  ])("rejects invalid financial/date input: %o", (override) => {
    expect(loanSchema.safeParse({ ...draft, ...override }).success).toBe(false);
  });

  it("accepts nullable dates and rejects unknown payload fields", () => {
    expect(loanSchema.safeParse({ ...draft, nextPaymentDate: null, fixedUntil: null }).success).toBe(true);
    expect(loanSchema.safeParse({ ...draft, paid: true }).success).toBe(false);
  });
});

describe("calendar day validation", () => {
  it.each(["2024-02-29", "2026-09-27", "2030-12-31"])("accepts a real date: %s", (value) => {
    expect(calendarDay.safeParse(value).success).toBe(true);
  });
  it.each(["", "2025-02-29", "2026-04-31", "2026-00-10", "2026-01-00", "2026-9-1", "2026-09-27T12:00:00Z", "0000-01-01"])("rejects an invalid date: %s", (value) => {
    expect(calendarDay.safeParse(value).success).toBe(false);
  });
});

describe("euro input parsing", () => {
  it.each([
    ["0", 0], ["0,01", 1], ["0.1", 10], ["10.09", 1_009],
    ["  1250,50  ", 125_050], ["1 250,50 €", 125_050], ["€ 1\u202f250,50", 125_050],
    ["1\u00a0250.50", 125_050], ["999999999.99", 99_999_999_999], ["1000000000", 100_000_000_000],
  ])("parses %s into exact integer cents", (raw, expected) => {
    expect(moneyInput(String(raw))).toBe(expected);
  });

  it.each(["", " ", "-1", "+1", "1e3", "Infinity", "NaN", "1.001", "1,000", "1,234.56", "1.234,56", "12 34", "1  000", "10€00", "€100€", "1\t000", "1000000000.01", "9007199254740991", "9".repeat(100)])("rejects malformed, ambiguous or excessive amounts: %s", (raw) => {
    expect(moneyInput(raw)).toBeNull();
  });
});
