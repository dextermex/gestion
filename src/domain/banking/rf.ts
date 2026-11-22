/**
 * Structured payment references and EPC QR payloads (strategy §4.3).
 *
 *  • Per-lease permanent RF creditor reference — ISO 11649 (mod-97).
 *  • EPC069-12 QR payload for the avis d'échéance: IBAN, verbatim VoP-safe
 *    beneficiary name, amount, RF reference prefilled. Luxembourg retail apps
 *    have no structured-reference field, so the RF also rides the free-text
 *    remittance line, where the parser recovers it by checksum.
 */

import { Cents } from "@/domain/money";

/** mod-97 over the rearranged alphanumeric string (ISO 7064 / IBAN scheme). */
function mod97(input: string): number {
  let remainder = 0;
  for (const ch of input) {
    const code = /[0-9]/.test(ch) ? ch : String(ch.toUpperCase().charCodeAt(0) - 55);
    for (const digit of code) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder;
}

/**
 * Generate an ISO 11649 creditor reference from a raw body (alphanumeric,
 * ≤ 21 chars). Returns e.g. "RF18000000000539007547034".
 */
export function generateRF(body: string): string {
  const clean = body.toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (clean.length === 0 || clean.length > 21) {
    throw new Error("RF body must be 1–21 alphanumeric characters");
  }
  // Checksum: body + "RF00", check digits = 98 - mod97
  const check = 98 - mod97(clean + "RF00");
  return `RF${String(check).padStart(2, "0")}${clean}`;
}

export function isValidRF(ref: string): boolean {
  const clean = ref.toUpperCase().replace(/\s/g, "");
  if (!/^RF\d{2}[0-9A-Z]{1,21}$/.test(clean)) return false;
  // Validation: move "RFxx" to the end; result mod 97 must be 1.
  return mod97(clean.slice(4) + clean.slice(0, 4)) === 1;
}

/**
 * Scan free-text remittance info for an RF reference (checksum-validated) —
 * Luxembourg retail banking apps put everything in the unstructured line.
 *
 * The reference is looked for the way it is written before anything is glued
 * together: as a word of its own ("RF18539007547034 loyer"), then as the
 * printed groups of four ("RF18 5390 0754 7034"). Only then is the text
 * compacted and scanned, for a reference stuck to its neighbours. Compacting
 * first would run the reference into the next word, and one time in a
 * hundred that longer string passes the checksum too: "RF… loyer" then read
 * as another, valid, unknown reference, and the rent went to review.
 */
export function extractRF(text: string): string | null {
  const upper = text.toUpperCase();
  const tokens = upper.split(/[^0-9A-Z]+/).filter(Boolean);
  // 1. A whole word.
  for (const t of tokens) if (/^RF\d{2}[0-9A-Z]{1,21}$/.test(t) && isValidRF(t)) return t;
  // 2. Groups of up to four after an "RFnn…" word: the longest run that validates.
  for (let i = 0; i < tokens.length; i++) {
    if (!/^RF\d{2}[0-9A-Z]{0,2}$/.test(tokens[i]) && !/^RF\d{2}[0-9A-Z]{0,21}$/.test(tokens[i])) continue;
    const runs: string[] = [];
    let joined = tokens[i];
    for (let j = i + 1; j < tokens.length && tokens[j].length <= 4 && joined.length + tokens[j].length <= 25; j++) {
      joined += tokens[j];
      runs.push(joined);
    }
    for (const candidate of runs.reverse()) if (isValidRF(candidate)) return candidate;
  }
  // 3. Stuck to its neighbours: the compact text, longest candidates first.
  const compact = upper.replace(/[\s.-]/g, "");
  const matches = compact.match(/RF\d{2}[0-9A-Z]{1,21}/g);
  if (!matches) return null;
  for (const m of [...matches].sort((a, b) => b.length - a.length)) {
    for (let end = m.length; end >= 5; end--) {
      const candidate = m.slice(0, end);
      if (isValidRF(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * The references among `known` that a remittance text carries, whatever
 * surrounds them: the text is compacted and each known reference is looked
 * for as it is. A reference the workspace issued is found by what it is, not
 * by a checksum over whatever the payer typed around it.
 */
export function findKnownRF(text: string, known: Iterable<string>): string[] {
  const compact = text.toUpperCase().replace(/[^0-9A-Z]/g, "");
  const out: string[] = [];
  for (const ref of new Set(known)) {
    const clean = ref.toUpperCase().replace(/[^0-9A-Z]/g, "");
    if (clean.length >= 6 && compact.includes(clean)) out.push(clean);
  }
  return out;
}

/** Lease → permanent RF: org prefix + lease number, stable for the lease's life. */
export function leaseRF(orgSeq: number, leaseSeq: number): string {
  const body = `${String(orgSeq).padStart(4, "0")}${String(leaseSeq).padStart(8, "0")}`;
  return generateRF(body);
}

// ─── EPC QR (EPC069-12, version 002) ────────────────────────────────────────

export interface EpcQrInput {
  /** Beneficiary name EXACTLY as registered at the bank (VoP-safe, verbatim). */
  beneficiaryName: string;
  iban: string;
  bic?: string;
  amount: Cents;
  /** Structured creditor reference (RF) — preferred over free text. */
  rfReference?: string;
  /** Unstructured remittance info (used only when no RF). */
  freeText?: string;
}

/**
 * Serialize the EPC QR payload. Amount format: EUR with dot decimals.
 * A payer scanning this in any EU banking app gets IBAN, name, amount and
 * reference prefilled — the reference-discipline lever of the matching engine.
 */
export function epcQrPayload(input: EpcQrInput): string {
  const amount = (input.amount / 100).toFixed(2);
  return [
    "BCD", // service tag
    "002", // version
    "1", // charset: UTF-8
    "SCT", // SEPA credit transfer
    input.bic ?? "",
    input.beneficiaryName.slice(0, 70),
    input.iban.replace(/\s/g, ""),
    `EUR${amount}`,
    "", // purpose
    input.rfReference ?? "", // structured reference
    input.rfReference ? "" : (input.freeText ?? "").slice(0, 140),
    "", // beneficiary-to-payer info
  ].join("\n");
}

// ─── VoP (Verification of Payee) ────────────────────────────────────────────

export interface VopCheck {
  ok: boolean;
  normalizedStored: string;
  normalizedDisplayed: string;
  message: string | null;
}

/**
 * Since October 2025 every displayed IBAN is name-checked by the payer's
 * bank. The registered account-holder name is captured verbatim at
 * onboarding; any display name that diverges is a blocking error before an
 * avis or QR is emitted.
 */
export function vopNameCheck(registeredHolderName: string, displayedName: string): VopCheck {
  const norm = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9 ]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const a = norm(registeredHolderName);
  const b = norm(displayedName);
  const ok = a === b;
  return {
    ok,
    normalizedStored: a,
    normalizedDisplayed: b,
    message: ok
      ? null
      : "Displayed beneficiary name differs from the registered account-holder name — VoP will flag or block the payer's transfer. Use the verbatim registered name.",
  };
}
