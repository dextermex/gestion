import { INTL_LOCALE, type Locale } from "@/lib/i18n/config";
import { formatDate } from "@/lib/types";

/**
 * A planned visit's day and hour as the tenant reads them: on Luxembourg's
 * clock, whatever clock the server keeps. A timestamp that names no zone
 * (the sample cabinets') is already wall-clock time and is read as written.
 */
export function visitWhen(iso: string, locale: Locale): { date: string; time: string } {
  const zoned = /(Z|[+-]\d{2}:?\d{2})$/.test(iso);
  const moment = new Date(zoned ? iso : `${iso.slice(0, 19)}Z`);
  if (Number.isNaN(moment.getTime())) return { date: formatDate(iso.slice(0, 10), locale), time: "" };
  const timeZone = zoned ? "Europe/Luxembourg" : "UTC";
  return {
    date: moment.toLocaleDateString(INTL_LOCALE[locale], { weekday: "short", day: "numeric", month: "short", timeZone }),
    time: moment.toLocaleTimeString(INTL_LOCALE[locale], { hour: "2-digit", minute: "2-digit", timeZone }),
  };
}

/**
 * A month as a sentence takes it. French joins it with "de" and elides
 * before a vowel ("d'août 2026", "de mai 2026"); the other languages take
 * the month as it is.
 */
export function monthPhrase(label: string, locale: Locale): string {
  if (locale !== "fr") return label;
  const lower = label.charAt(0).toLowerCase() + label.slice(1);
  return (/^[aeiouyhéèêàâîôû]/i.test(lower) ? "d'" : "de ") + lower;
}

/** The month's name alone, for a line whose date already says the year. */
export function monthName(isoDate: string, locale: Locale): string {
  const moment = new Date(`${isoDate.slice(0, 7)}-01T00:00:00Z`);
  if (Number.isNaN(moment.getTime())) return "";
  return moment.toLocaleDateString(INTL_LOCALE[locale], { month: "long", timeZone: "UTC" });
}
