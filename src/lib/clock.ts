/**
 * The calendar day and the clock that a landlord and a tenant in Luxembourg
 * read. The server runs in UTC: asked there, "today" turns a day late between
 * midnight and one or two in the morning, and a time prints one or two hours
 * early. Every "today" of the application and every printed time goes
 * through here, so that both spaces and the database agree on the day.
 */
export const LUX_TIME_ZONE = "Europe/Luxembourg";

const DAY = new Intl.DateTimeFormat("en-CA", { timeZone: LUX_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** The Luxembourg calendar day of an instant, "YYYY-MM-DD". */
export function dayOf(instant: Date | string | number): string {
  const d = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(d.getTime())) return "";
  return DAY.format(d);
}

/** Today in Luxembourg, "YYYY-MM-DD". */
export function todayISO(now: Date = new Date()): string {
  return dayOf(now);
}

/** The month of today in Luxembourg, "YYYY-MM". */
export function thisMonth(now: Date = new Date()): string {
  return todayISO(now).slice(0, 7);
}
