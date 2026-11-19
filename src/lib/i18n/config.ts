/** Shared locale config — importable from client and server code alike. */

export const LOCALES = ["fr", "en", "de", "lu"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "fr";

export const LOCALE_LABELS: Record<Locale, string> = {
  fr: "Français",
  en: "English",
  de: "Deutsch",
  lu: "Lëtzebuergesch",
};

/** `lu` maps to the ISO code `lb` in html lang / hreflang (Morada convention). */
export function htmlLang(locale: Locale): string {
  return locale === "lu" ? "lb" : locale;
}

/** Intl locale per UI language (the Morada marketplace map). For what a client component prints, see `NUMBER_LOCALE` and `dateInWords`. */
export const INTL_LOCALE: Record<Locale, string> = {
  fr: "fr-LU",
  en: "en-GB",
  de: "de-LU",
  lu: "lb-LU",
};

/**
 * The locale figures and amounts are written in. Luxembourgish borrows
 * German's rules for Luxembourg, which write a number, an amount and a
 * percentage exactly as `lb-LU` does. Not every browser carries
 * Luxembourgish data (Chrome does not), and a browser asked for a locale it
 * lacks answers in its own: a client component would print "1.850,00 €" on
 * the server and "€1,850.00" after hydration. Everything a client component
 * formats goes through this map and `dateInWords`, never through `lb-LU`.
 */
export const NUMBER_LOCALE: Record<Locale, string> = { ...INTL_LOCALE, lu: "de-LU" };

/** Luxembourgish month names as the language's own locale data writes them: in full, short inside a date, short on their own. */
const LU_MONTHS = {
  long: ["Januar", "Februar", "Mäerz", "Abrëll", "Mee", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"],
  short: ["Jan.", "Feb.", "Mäe.", "Abr.", "Mee", "Juni", "Juli", "Aug.", "Sep.", "Okt.", "Nov.", "Dez."],
  alone: ["Jan", "Feb", "Mäe", "Abr", "Mee", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"],
} as const;

/**
 * A day or a month in words, written the same on the server and in every
 * browser. For Luxembourgish the date is laid out by German's rules for
 * Luxembourg (the same order and punctuation as `lb-LU`) and the month's
 * name comes from the table above, so no browser needs Luxembourgish data
 * to print "15. Mäe. 2026". `options.timeZone` may be "UTC"; without it the
 * date is read in the runtime's own zone, as `toLocaleDateString` does.
 */
export function dateInWords(d: Date, locale: Locale, options: Intl.DateTimeFormatOptions): string {
  if (locale !== "lu") return d.toLocaleDateString(INTL_LOCALE[locale], options);
  const names = options.month === "long" ? LU_MONTHS.long : options.day ? LU_MONTHS.short : LU_MONTHS.alone;
  const month = options.timeZone === "UTC" ? d.getUTCMonth() : d.getMonth();
  return new Intl.DateTimeFormat(NUMBER_LOCALE.lu, options)
    .formatToParts(d)
    .map((part) => (part.type === "month" && (options.month === "long" || options.month === "short") ? names[month] : part.value))
    .join("");
}

/** Tiny template interpolation: fmt("il reste {n} jours", {n: 3}). */
export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

/**
 * Picks the singular or plural form for a count.
 *
 * French treats zero as singular ("0 libre"), the other three do not
 * ("0 vacant units"). Every count rendered next to a noun goes through here
 * rather than guessing, which is what produced "0 libres" before.
 */
export function plural(locale: Locale, n: number, one: string, many: string): string {
  const singular = locale === "fr" ? Math.abs(n) <= 1 : Math.abs(n) === 1;
  return fmt(singular ? one : many, { n });
}

/**
 * The day of the month as it is written in each language: French wants
 * "1er" for the first and a bare number afterwards, the others always take
 * the bare number (German adds the point the dictionary already carries).
 */
export function ordinalDay(locale: Locale, n: number): string {
  return locale === "fr" && n === 1 ? "1er" : String(n);
}
