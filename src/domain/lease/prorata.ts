import { daysInMonth, diffDays, parseISO, toISO, type ISODate } from "@/domain/dates";

/**
 * A month the tenancy covers only in part: it began during it, or it ends
 * during it. The month's amount is cut to the days the tenancy covers, over
 * the days of that month (calendar days), rounded once to the cent. Rent and
 * charges are cut the same way, separately, so each line stays an integer.
 */
export interface MonthShare {
  /** First day the tenancy covers in the month. */
  from: ISODate;
  /** Last day the tenancy covers in the month. */
  to: ISODate;
  days: number;
  daysInMonth: number;
}

/** The days of `month` (YYYY-MM or YYYY-MM-01) a tenancy from `start` to `end` covers; null when it covers the whole month or none of it. */
export function monthShare(month: string, start: ISODate, end: ISODate | null): MonthShare | null {
  const { y, m } = parseISO(`${month.slice(0, 7)}-01`);
  const total = daysInMonth(y, m);
  const first = toISO(y, m, 1);
  const last = toISO(y, m, total);
  const from = start > first ? start : first;
  const to = end && end < last ? end : last;
  if (to < from) return null;
  const days = diffDays(from, to) + 1;
  if (days >= total) return null;
  return { from, to, days, daysInMonth: total };
}

/** An amount cut to a share of the month, rounded once. */
export function prorate(amountCents: number, share: Pick<MonthShare, "days" | "daysInMonth">): number {
  return Math.round((amountCents * share.days) / share.daysInMonth);
}
