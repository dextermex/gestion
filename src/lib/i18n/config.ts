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
