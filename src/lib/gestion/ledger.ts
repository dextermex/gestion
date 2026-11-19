import { addMonths } from "@/domain/dates";

/**
 * The calendar of a tenancy's ledger, as pure rules shared by the write path
 * (`openLedger`), the nightly `gestion.roll_rent_periods()` mirror in SQL, and
 * the portfolio projection every screen reads. One place decides which months
 * exist and when each one is owed, so a card, a sheet and the database never
 * disagree about a due date.
 */

/**
 * The months a live lease's ledger must hold, as YYYY-MM-01: from the start
 * month (capped a year back) through next month, never past the lease's end.
 * `trackFrom` is the month the owner chose to track rent from: a tenancy that
 * already ran when it was recorded opens no month before it, so nothing the
 * owner never asked Morada to follow reads as unpaid.
 */
export function ledgerMonths(startDate: string, endDate: string | null, today: string, trackFrom: string | null = null): string[] {
  const liveMonth = `${today.slice(0, 7)}-01`;
  const floor = addMonths(liveMonth, -11);
  const startMonth = `${startDate.slice(0, 7)}-01`;
  let m = startMonth < floor ? floor : startMonth;
  if (trackFrom && /^\d{4}-\d{2}/.test(trackFrom)) {
    const from = `${trackFrom.slice(0, 7)}-01`;
    if (from > m) m = from;
  }
  let end = addMonths(liveMonth, 1);
  if (endDate) {
    const endMonth = `${endDate.slice(0, 7)}-01`;
    if (endMonth < end) end = endMonth;
  }
  const out: string[] = [];
  while (m <= end) {
    out.push(m);
    m = addMonths(m, 1);
  }
  return out;
}

/**
 * When a month's rent falls due: the lease's payment day, except that the
 * first month can never be due before the tenancy starts. A lease signed on
 * the 17th with rent due on the 5th owes its first month on the 17th, not
 * twelve days before it began (which read as "late" on day one).
 */
export function dueDateFor(month: string, paymentDay: number, startDate: string): string {
  const day = String(Math.min(Math.max(Math.round(paymentDay) || 1, 1), 28)).padStart(2, "0");
  const due = `${month.slice(0, 7)}-${day}`;
  return due < startDate ? startDate : due;
}

/**
 * The next date a rent falls due on or after `today`, by the same rule, and
 * never after the tenancy's end: a lease that ends before its next payment
 * day owes nothing more.
 */
export function nextDueOn(today: string, paymentDay: number, startDate?: string, endDate?: string | null): string | null {
  const month = `${today.slice(0, 7)}-01`;
  for (const m of [month, addMonths(month, 1), addMonths(month, 2)]) {
    const due = dueDateFor(m, paymentDay, startDate ?? "");
    if (due >= today) return endDate && due > endDate ? null : due;
  }
  return null;
}

/**
 * Whether a tenancy is still in force today. A lease that carries an end date
 * (a departure recorded ahead, a term that was not renewed) stays in force
 * until that day and is over from it on: the nightly
 * `gestion.end_due_leases()` writes `ended` on the row, and until it has run
 * the date itself decides, so no screen waits for the job.
 */
export function effectiveLeaseStatus<S extends string>(status: S, endDate: string | null, today: string): S | "ended" {
  return (status === "active" || status === "notice") && endDate !== null && endDate !== "" && endDate <= today ? "ended" : status;
}
