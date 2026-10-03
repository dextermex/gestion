/**
 * Display helpers for the subscription, safe on the server and in the
 * browser. Stripe counts in unix seconds; the screens speak in the calendar
 * days of Luxembourg, so a trial that ends late at night is not shown a day
 * early.
 */
import { INTL_LOCALE, fmt, plural, type Locale } from "@/lib/i18n/config";
import type { Dict } from "@/lib/i18n/fr";
import { RENT_BANDS, type Rhythm } from "@/domain/billing/pricing";

const LUXEMBOURG_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Luxembourg", year: "numeric", month: "2-digit", day: "2-digit" });

/** The calendar day a unix time falls on in Luxembourg, as "YYYY-MM-DD". */
export function dayOf(unix: number): string {
  return LUXEMBOURG_DAY.format(new Date(unix * 1000));
}

/** A price as the plans show it: whole euros when it is round ("5 €"), cents otherwise ("3,20 €"). */
export function price(cents: number, locale: Locale): string {
  const whole = cents % 100 === 0;
  return (cents / 100).toLocaleString(INTL_LOCALE[locale], { style: "currency", currency: "EUR", minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
}

type BillingCopy = Dict["billing"];

export const periodName = (b: BillingCopy, rhythm: Rhythm) => (rhythm === "quarter" ? b.periodQuarter : b.periodYear);

/** "12 lots", "1 lot". */
export const lotsLabel = (b: BillingCopy, locale: Locale, n: number) => plural(locale, n, b.lotsOne, b.lotsMany);
/** "12 lots loués", "1 lot loué". */
export const lotsLetLabel = (b: BillingCopy, locale: Locale, n: number) => plural(locale, n, b.lotsLetOne, b.lotsLetMany);
export const leasesLabel = (b: BillingCopy, locale: Locale, n: number) => plural(locale, n, b.leasesOne, b.leasesMany);
/** "5 days", for "ends in 5 days". */
export const daysLabel = (b: BillingCopy, locale: Locale, n: number) => plural(locale, n, b.daysOne, b.daysMany);
/** "5 days left". */
export const daysLeftLabel = (b: BillingCopy, locale: Locale, n: number) => plural(locale, n, b.daysLeftOne, b.daysLeftMany);

/** A reduction as the price lines print it: "−10 %", with the locale's own spacing and a true minus sign. */
export function pctOff(pct: number, locale: Locale): string {
  return new Intl.NumberFormat(INTL_LOCALE[locale], { style: "percent" }).format(-pct / 100).replace("-", "\u2212");
}

/** A rent band as a price line reads it ("de 1 000 € à 1 499 €"), from the bands themselves. */
export function bandLabel(b: BillingCopy, locale: Locale, band: number): string {
  const current = RENT_BANDS[band];
  const previous = band > 0 ? RENT_BANDS[band - 1] : null;
  if (!previous || previous.below === null) return fmt(b.bandFirst, { max: price(current.below ?? 0, locale) });
  if (current.below === null) return fmt(b.bandLast, { min: price(previous.below, locale) });
  return fmt(b.bandMiddle, { min: price(previous.below, locale), max: price(current.below - 100, locale) });
}
