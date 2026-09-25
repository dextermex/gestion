import { LOCALES, type Locale } from "@/lib/i18n/config";

/**
 * The lessor's identity and payment instructions as the settings screen
 * saves them, checked once, the same way for the route and its tests. An
 * IBAN is kept as typed without spaces and must pass the ISO 7064 check;
 * the holder's name is kept verbatim, since the payer's bank compares it.
 */
export interface LessorSettings {
  legalName: string;
  signatoryName: string;
  addressStreet: string;
  addressNumber: string;
  postalCode: string;
  city: string;
  country: string;
  email: string;
  phone: string;
  iban: string;
  bic: string;
  holderName: string;
  documentLang: Locale;
  /** The desk's words to a tenant warn them by e-mail. */
  notifyTenantMessages: boolean;
  /** A tenant's word or request warns the desk by e-mail. */
  notifyManagerMessages: boolean;
}

export type SettingsProblem = "legalName" | "iban" | "bic" | "documentLang" | "email";

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, "").trim().slice(0, max) : "");

/** ISO 7064 mod 97-10 over the rearranged IBAN; empty is allowed (nothing typed yet). */
export function validIban(iban: string): boolean {
  const s = iban.replace(/\s+/g, "").toUpperCase();
  if (s === "") return true;
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const code = ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of code) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

export function parseSettingsInput(body: Record<string, unknown>): LessorSettings | { problem: SettingsProblem } {
  const legalName = str(body.legalName, 160);
  if (!legalName) return { problem: "legalName" };
  const iban = str(body.iban, 40).replace(/\s+/g, "").toUpperCase();
  if (!validIban(iban)) return { problem: "iban" };
  const bic = str(body.bic, 11).replace(/\s+/g, "").toUpperCase();
  if (bic && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic)) return { problem: "bic" };
  const email = str(body.email, 160);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { problem: "email" };
  const documentLang = str(body.documentLang, 2) || "fr";
  if (!(LOCALES as readonly string[]).includes(documentLang)) return { problem: "documentLang" };
  return {
    legalName,
    signatoryName: str(body.signatoryName, 160),
    addressStreet: str(body.addressStreet, 160),
    addressNumber: str(body.addressNumber, 20),
    postalCode: str(body.postalCode, 12),
    city: str(body.city, 80),
    country: (str(body.country, 2).toUpperCase() || "LU"),
    email,
    phone: str(body.phone, 40),
    iban,
    bic,
    holderName: str(body.holderName, 140),
    documentLang: documentLang as Locale,
    // Absent from the form, a preference stays on: silence never turns a notification off.
    notifyTenantMessages: body.notifyTenantMessages !== false,
    notifyManagerMessages: body.notifyManagerMessages !== false,
  };
}

/** What a document of the kind needs from the settings before it can be produced. */
export function missingForDocuments(s: Pick<LessorSettings, "legalName" | "addressStreet" | "postalCode" | "city" | "iban" | "holderName">, needsPayment: boolean): string[] {
  const missing: string[] = [];
  if (!s.legalName) missing.push("legalName");
  if (!s.addressStreet || !s.postalCode || !s.city) missing.push("address");
  if (needsPayment && (!s.iban || !s.holderName)) missing.push("payment");
  return missing;
}

/** The one-line postal address the documents print. */
export function postalAddress(s: Pick<LessorSettings, "addressStreet" | "addressNumber" | "postalCode" | "city" | "country">): string {
  const line1 = [s.addressNumber, s.addressStreet].filter(Boolean).join(", ");
  const line2 = [s.postalCode ? `${s.country === "LU" && !/^L-/i.test(s.postalCode) ? "L-" : ""}${s.postalCode}` : "", s.city].filter(Boolean).join(" ");
  return [line1, line2].filter(Boolean).join(", ");
}
