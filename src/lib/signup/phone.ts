import { getCountries, getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/min";
import type { Locale } from "@/lib/i18n/config";

export const PRIORITY_COUNTRIES: CountryCode[] = ["LU", "BE", "FR", "DE", "NL"];
export function countryFlag(code: string) {
  return String.fromCodePoint(...[...code].map((letter) => 127397 + letter.charCodeAt(0)));
}
export function countriesFor(locale: Locale) {
  const names = new Intl.DisplayNames([locale === "lu" ? "lb" : locale, "en"], { type: "region" });
  const rest = getCountries().filter((code) => !PRIORITY_COUNTRIES.includes(code));
  rest.sort((a, b) => (names.of(a) ?? a).localeCompare(names.of(b) ?? b, locale === "lu" ? "lb" : locale));
  return [...PRIORITY_COUNTRIES, ...rest].map((code) => ({ code, name: names.of(code) ?? code, dial: `+${getCountryCallingCode(code)}`, flag: countryFlag(code) }));
}
export function normalizePhone(raw: string, country: CountryCode): string | null {
  // Reject extensions, letters and pasted prose. Accept national trunk prefixes,
  // spaces, parentheses and international + / 00 numbers.
  const value = raw.trim().replace(/^00/, "+");
  if (!/^[+\d\s().-]+$/.test(value) || value.length > 40) return null;
  const phone = parsePhoneNumberFromString(value, country);
  return phone?.isValid() && !phone.ext ? phone.number : null;
}
