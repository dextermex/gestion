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

/** Intl locale per UI language — the Morada marketplace map. */
export const INTL_LOCALE: Record<Locale, string> = {
  fr: "fr-LU",
  en: "en-GB",
  de: "de-LU",
  lu: "lb-LU",
};

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
