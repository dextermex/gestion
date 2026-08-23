import { cookies, headers } from "next/headers";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "./config";
import { fr } from "./fr";
import { en } from "./en";
import { de } from "./de";
import { lu } from "./lu";
import type { Dict } from "./fr";

const DICTS: Record<Locale, Dict> = { fr, en, de, lu };

export function getDict(locale: Locale): Dict {
  return DICTS[locale] ?? DICTS[DEFAULT_LOCALE];
}

/**
 * Resolve the request locale server-side: `morada_locale` cookie (same name
 * as the Morada ecosystem, so one choice follows the user across spaces),
 * else Accept-Language, else French.
 */
export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const fromCookie = store.get("morada_locale")?.value;
  if (fromCookie && (LOCALES as readonly string[]).includes(fromCookie)) {
    return fromCookie as Locale;
  }
  const accept = (await headers()).get("accept-language") ?? "";
  for (const part of accept.split(",")) {
    const code = part.trim().slice(0, 2).toLowerCase();
    const mapped = code === "lb" ? "lu" : code;
    if ((LOCALES as readonly string[]).includes(mapped)) return mapped as Locale;
  }
  return DEFAULT_LOCALE;
}

export async function getI18n(): Promise<{ locale: Locale; d: Dict }> {
  const locale = await getLocale();
  return { locale, d: getDict(locale) };
}

export type { Dict };
