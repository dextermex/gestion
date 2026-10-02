import { ADDON_COST_CENTS, ADDON_PRICE_CENTS, SIGNERS_PER_SENDING, type UsageKind } from "@/lib/billing/prices";

/**
 * An electronic-signature sending, provider-neutral and pure: who signs and
 * in which order (the tenants as the contract names them, then the lessor),
 * at which eIDAS level, how each person proves it is them, what is checked
 * before anything leaves, and what the sending puts on the usage ledger.
 */

export const SIGNATURE_LEVELS = ["electronic_signature", "advanced_electronic_signature", "qualified_electronic_signature"] as const;
export type SignatureLevel = (typeof SIGNATURE_LEVELS)[number];
export const isSignatureLevel = (v: unknown): v is SignatureLevel => typeof v === "string" && (SIGNATURE_LEVELS as readonly string[]).includes(v);

export type SignerRole = "tenant" | "lessor" | "guarantor";
export type AuthMode = "otp_email" | "otp_sms" | "no_otp";
export type SignerLocale = "fr" | "en" | "de";
export type EnvelopeStatus = "draft" | "ongoing" | "done" | "declined" | "expired" | "canceled" | "failed";
export type SignerStatus = "pending" | "notified" | "signed" | "declined" | "error";

/** A sending that is still out: nothing else may be sent for the same lease. */
export const isLive = (status: EnvelopeStatus): boolean => status === "draft" || status === "ongoing";

export const MAX_SIGNERS = 10;
/** How long signers have before the sending expires. */
export const EXPIRY_DAYS = 30;

/** A mobile number in international form (+352621123456), or null. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let v = raw.trim().replace(/[\s().\-/]/g, "");
  if (v.startsWith("00")) v = "+" + v.slice(2);
  return /^\+[1-9][0-9]{7,14}$/.test(v) ? v : null;
}

const PARTICLES = new Set(["de", "da", "di", "del", "della", "van", "von", "der", "den", "du", "le", "la", "dos", "das", "do", "zu"]);

/** A full name as a provider wants it: given names, then the family name with its particles. */
export function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: "", lastName: parts[0] };
  let i = parts.length - 1;
  while (i > 1 && PARTICLES.has(parts[i - 1].toLowerCase())) i--;
  return { firstName: parts.slice(0, i).join(" "), lastName: parts.slice(i).join(" ") };
}

/** The signing screens' language: the contact's own where the provider has it, French otherwise. */
export function signerLocale(language: string | null | undefined): SignerLocale {
  if (language === "en") return "en";
  if (language === "de" || language === "lu") return "de";
  return "fr";
}

/**
 * How a signer proves it is them. The simple level takes a code by SMS when
 * a mobile is known, by e-mail otherwise; the advanced level needs the
 * mobile (an SMS code, after the ID document), and null says the signer
 * cannot be sent at that level; the qualified level identifies the signer by
 * document and video, with no code mode at all.
 */
export function authModeFor(level: SignatureLevel, phone: string | null): AuthMode | null {
  if (level === "electronic_signature") return phone ? "otp_sms" : "otp_email";
  if (level === "advanced_electronic_signature") return phone ? "otp_sms" : null;
  return "no_otp";
}

export interface SignerInput {
  role: SignerRole;
  contactId: string | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  locale: SignerLocale;
  level: SignatureLevel;
}

export type SignerIssue = "name" | "email" | "phone";

const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;

/** What stops one signer from being sent. */
export function signerIssues(s: SignerInput): SignerIssue[] {
  const issues: SignerIssue[] = [];
  if (!s.firstName.trim() || !s.lastName.trim() || s.firstName.length > 80 || s.lastName.length > 80) issues.push("name");
  if (!EMAIL.test(s.email.trim()) || s.email.length > 254) issues.push("email");
  if ((s.phone !== null && normalizePhone(s.phone) === null) || authModeFor(s.level, s.phone ? normalizePhone(s.phone) : null) === null) issues.push("phone");
  return issues;
}

/**
 * The order the provider collects signatures in, and the anchors the
 * contract was drawn with: every tenant as the contract names them, then
 * the lessor last. A tenant the contract does not name is refused, and so
 * is a sending that leaves one out.
 */
export function orderSigners(tenantIds: string[], tenants: SignerInput[], lessor: SignerInput): SignerInput[] | null {
  if (tenantIds.length === 0 || tenantIds.length + 1 > MAX_SIGNERS) return null;
  const byId = new Map(tenants.filter((t) => t.role === "tenant" && t.contactId).map((t) => [t.contactId as string, t]));
  if (byId.size !== tenantIds.length || tenants.length !== tenantIds.length) return null;
  const ordered = tenantIds.map((id) => byId.get(id));
  if (ordered.some((t) => !t)) return null;
  return [...(ordered as SignerInput[]), { ...lessor, role: "lessor", contactId: null }];
}

export interface UsageLine {
  kind: UsageKind;
  quantity: number;
  unitPriceCents: number;
  unitCostCents: number;
}

/** What one sending puts on the workspace's usage ledger. */
export function usageForSending(signers: Array<{ level: SignatureLevel }>): UsageLine[] {
  const line = (kind: UsageKind, quantity: number): UsageLine => ({ kind, quantity, unitPriceCents: ADDON_PRICE_CENTS[kind], unitCostCents: ADDON_COST_CENTS[kind] });
  const lines = [line("signature_sending", 1)];
  const extra = signers.length - SIGNERS_PER_SENDING;
  if (extra > 0) lines.push(line("signature_extra_signer", extra));
  const advanced = signers.filter((s) => s.level === "advanced_electronic_signature").length;
  if (advanced > 0) lines.push(line("signature_advanced", advanced));
  const qualified = signers.filter((s) => s.level === "qualified_electronic_signature").length;
  if (qualified > 0) lines.push(line("signature_qualified", qualified));
  return lines;
}

/** How far a sending got: signatures collected out of those asked. */
export function progressOf(signers: Array<{ status: SignerStatus }>): { signed: number; total: number } {
  return { signed: signers.filter((s) => s.status === "signed").length, total: signers.length };
}
