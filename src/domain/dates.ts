/**
 * Date arithmetic for legal clocks. All dates are ISO "YYYY-MM-DD" strings in
 * civil (Luxembourg) time — legal deadlines are calendar concepts, so we never
 * let timezones or DST shift a due date.
 */

export type ISODate = string;

export function parseISO(d: ISODate): { y: number; m: number; day: number } {
  const [y, m, day] = d.split("-").map(Number);
  return { y, m, day };
}

export function toISO(y: number, m: number, day: number): ISODate {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Add calendar months, clamping to the last day of the target month
 * (31 Jan + 1 month = 28/29 Feb) — the convention used for legal delays.
 */
export function addMonths(d: ISODate, months: number): ISODate {
  const { y, m, day } = parseISO(d);
  const zero = y * 12 + (m - 1) + months;
  const ny = Math.floor(zero / 12);
  const nm = (zero % 12) + 1;
  return toISO(ny, nm, Math.min(day, daysInMonth(ny, nm)));
}

export function addDays(d: ISODate, days: number): ISODate {
  const { y, m, day } = parseISO(d);
  const dt = new Date(Date.UTC(y, m - 1, day + days));
  return toISO(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addYears(d: ISODate, years: number): ISODate {
  return addMonths(d, years * 12);
}

/** Whole days from a to b (positive when b is after a). */
export function diffDays(a: ISODate, b: ISODate): number {
  const pa = parseISO(a);
  const pb = parseISO(b);
  const ta = Date.UTC(pa.y, pa.m - 1, pa.day);
  const tb = Date.UTC(pb.y, pb.m - 1, pb.day);
  return Math.round((tb - ta) / 86_400_000);
}

/** Full calendar months elapsed from a to b (floor; negative if b < a). */
export function fullMonthsBetween(a: ISODate, b: ISODate): number {
  if (b < a) return -fullMonthsBetween(b, a);
  const pa = parseISO(a);
  const pb = parseISO(b);
  let months = (pb.y - pa.y) * 12 + (pb.m - pa.m);
  if (pb.day < pa.day) months -= 1;
  return months;
}

/**
 * Commenced calendar months from a (exclusive) to b — the deposit-penalty
 * clock: "+10% per commenced month of delay". One day late = 1 commenced
 * month; a month and a day = 2.
 */
export function commencedMonthsBetween(a: ISODate, b: ISODate): number {
  if (b <= a) return 0;
  return fullMonthsBetween(a, b) + (addMonths(a, fullMonthsBetween(a, b)) < b ? 1 : 0);
}

export function fullYearsBetween(a: ISODate, b: ISODate): number {
  return Math.floor(fullMonthsBetween(a, b) / 12);
}

/** Last day of the month containing d. */
export function endOfMonth(d: ISODate): ISODate {
  const { y, m } = parseISO(d);
  return toISO(y, m, daysInMonth(y, m));
}

export function startOfMonth(d: ISODate): ISODate {
  const { y, m } = parseISO(d);
  return toISO(y, m, 1);
}

export function isBefore(a: ISODate, b: ISODate): boolean {
  return a < b;
}

export function maxDate(...dates: ISODate[]): ISODate {
  return dates.reduce((a, b) => (a > b ? a : b));
}

export function minDate(...dates: ISODate[]): ISODate {
  return dates.reduce((a, b) => (a < b ? a : b));
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export function formatDate(d: ISODate): string {
  const { y, m, day } = parseISO(d);
  return DATE_FORMAT.format(new Date(Date.UTC(y, m - 1, day)));
}
