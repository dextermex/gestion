import { describe, expect, it } from "vitest";
import { monthlyCashflow } from "../finance/cashflow";

const p = (period: string, total: number, allocated: number) => ({
  period,
  totalCents: total,
  allocatedCents: allocated,
});

describe("monthlyCashflow", () => {
  it("sums expected and collected per month, in the caller's order", () => {
    const rows = [
      p("2026-07", 100_00, 100_00),
      p("2026-07", 50_00, 25_00),
      p("2026-08", 80_00, 0),
    ];
    expect(monthlyCashflow(rows, ["2026-07", "2026-08"])).toEqual([
      { month: "2026-07", expectedCents: 150_00, collectedCents: 125_00 },
      { month: "2026-08", expectedCents: 80_00, collectedCents: 0 },
    ]);
  });

  it("returns zeros for months with no periods rather than dropping them", () => {
    expect(monthlyCashflow([], ["2026-06"])).toEqual([
      { month: "2026-06", expectedCents: 0, collectedCents: 0 },
    ]);
  });

  it("ignores periods outside the requested window", () => {
    const rows = [p("2026-05", 10_00, 10_00), p("2026-09", 20_00, 0)];
    expect(monthlyCashflow(rows, ["2026-09"])).toEqual([
      { month: "2026-09", expectedCents: 20_00, collectedCents: 0 },
    ]);
  });
});
