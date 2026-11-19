/**
 * What came in and what went out, month by month, for the Finance screen.
 * Pure folds over rent periods and bills, in integer cents. Money in is the
 * rent allocated to a month's periods plus the receipts paid in it; money
 * out is the bills paid in it. A bill the desk marked as outside the cash
 * flow counts in the year's result and never in a month's flow. Nothing is
 * synthesised: the caller names the months.
 */

export interface FlowPeriod {
  period: string; // YYYY-MM
  allocatedCents: number;
}

export interface FlowBill {
  direction: "expense" | "income";
  amountCents: number;
  category: string;
  cashflow: boolean;
  docDate: string | null;
  dueOn: string | null;
  paidOn: string | null;
  createdAt: string;
}

export interface MonthFlow {
  month: string;
  inCents: number;
  outCents: number;
  netCents: number;
}

export function monthlyFlows(periods: FlowPeriod[], bills: FlowBill[], months: string[]): MonthFlow[] {
  return months.map((month) => {
    let inCents = 0;
    let outCents = 0;
    for (const p of periods) if (p.period === month) inCents += p.allocatedCents;
    for (const b of bills) {
      if (!b.cashflow || !b.paidOn || b.paidOn.slice(0, 7) !== month) continue;
      if (b.direction === "income") inCents += b.amountCents;
      else outCents += b.amountCents;
    }
    return { month, inCents, outCents, netCents: inCents - outCents };
  });
}

/** Bills still to pay, the ones past their due date first, then by due date (undated last). */
export function unpaidBills<T extends FlowBill>(bills: T[], today: string): T[] {
  const late = (b: T) => (b.dueOn !== null && b.dueOn < today ? 0 : 1);
  return bills
    .filter((b) => b.direction === "expense" && b.paidOn === null)
    .sort((a, b) => late(a) - late(b) || (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999"));
}

/** The day a bill belongs to in the books: its document's date, else the day it was entered. */
export const billDay = (b: Pick<FlowBill, "docDate" | "createdAt">): string => (b.docDate ?? b.createdAt).slice(0, 10);

/** Expenses of a year by category, the largest first, with the share of each in the total. */
export function expensesByCategory(bills: FlowBill[], year: string): Array<{ category: string; cents: number; share: number }> {
  const sums = new Map<string, number>();
  for (const b of bills) {
    if (b.direction !== "expense" || billDay(b).slice(0, 4) !== year) continue;
    sums.set(b.category, (sums.get(b.category) ?? 0) + b.amountCents);
  }
  const total = [...sums.values()].reduce((a, c) => a + c, 0);
  return [...sums.entries()]
    .map(([category, cents]) => ({ category, cents, share: total === 0 ? 0 : cents / total }))
    .sort((a, b) => b.cents - a.cents);
}

/** A year so far: the rent allocated to its months up to `uptoMonth`, the other receipts, the expenses, and what is left. */
export function yearResult(periods: FlowPeriod[], bills: FlowBill[], year: string, uptoMonth: string): { rentCents: number; otherIncomeCents: number; expenseCents: number; resultCents: number } {
  let rentCents = 0;
  let otherIncomeCents = 0;
  let expenseCents = 0;
  for (const p of periods) if (p.period.slice(0, 4) === year && p.period <= uptoMonth) rentCents += p.allocatedCents;
  for (const b of bills) {
    if (billDay(b).slice(0, 4) !== year) continue;
    if (b.direction === "income") otherIncomeCents += b.amountCents;
    else expenseCents += b.amountCents;
  }
  return { rentCents, otherIncomeCents, expenseCents, resultCents: rentCents + otherIncomeCents - expenseCents };
}
