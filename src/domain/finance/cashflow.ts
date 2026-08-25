/**
 * Monthly cashflow aggregation for the dashboard chart.
 * Pure fold over rent periods — expected is the invoiced total, collected is
 * the allocated total, both in integer cents. No month is ever synthesised:
 * the caller decides the window, the engine only sums what exists.
 */

export interface CashflowPeriodLike {
  period: string; // YYYY-MM
  totalCents: number;
  allocatedCents: number;
}

export interface CashflowMonth {
  month: string; // YYYY-MM
  expectedCents: number;
  collectedCents: number;
}

export function monthlyCashflow(periods: CashflowPeriodLike[], months: string[]): CashflowMonth[] {
  return months.map((month) => {
    let expectedCents = 0;
    let collectedCents = 0;
    for (const p of periods) {
      if (p.period !== month) continue;
      expectedCents += p.totalCents;
      collectedCents += p.allocatedCents;
    }
    return { month, expectedCents, collectedCents };
  });
}
