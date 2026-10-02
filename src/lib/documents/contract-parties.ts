import type { Civility, ContractParty, PartyAddress, ResidentialContractData } from "./model";

/**
 * Who the parties to a residential contract are, read from the rows that
 * hold them, and what is still missing to name them as the contract does.
 * The lessor is the workspace's settings row (a person or a company); each
 * tenant is a contact (a person or a company). A party is complete or it
 * is listed with the fields to fill: the contract is never produced with a
 * blank. Pure, so the route, the signature flow and the tests read the
 * same answer.
 */
type Row = Record<string, unknown>;

const s = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const iso = (v: unknown): string => (/^\d{4}-\d{2}-\d{2}/.test(s(v)) ? s(v).slice(0, 10) : "");

export const CIVILITIES = ["m", "f", "x"] as const;
export const LEGAL_FORMS = ["sarl", "sarls", "sa", "sci", "sc", "senc", "scs", "scsp", "sca", "scoop", "asbl", "fondation", "other"] as const;
export type LegalForm = (typeof LEGAL_FORMS)[number];

export const isCivility = (v: unknown): v is Civility => (CIVILITIES as readonly string[]).includes(String(v));
export const isLegalForm = (v: unknown): v is LegalForm => (LEGAL_FORMS as readonly string[]).includes(String(v));

/** A field the contract still needs, as the screens name it. */
export type ContractField =
  | "kind"
  | "civility"
  | "name"
  | "birth_date"
  | "birth_place"
  | "nationality"
  | "address"
  | "legal_form"
  | "rcs_number"
  | "representative"
  | "representative_role"
  | "iban"
  | "holder"
  | "bic"
  | "cadastral"
  | "energy_class"
  | "cpe"
  | "smoke_detectors";

/** One party, or the dwelling, with what it lacks; `id` is the contact or property the fields live on. */
export interface MissingItem {
  subject: "lessor" | "tenant" | "property";
  id: string;
  name: string;
  fields: ContractField[];
}

/** An address as a contract prints it; a Luxembourg postcode carries its "L-". */
export function partyAddress(parts: { street?: unknown; number?: unknown; postalCode?: unknown; city?: unknown; country?: unknown }): PartyAddress {
  const country = s(parts.country).toUpperCase() || "LU";
  const postal = s(parts.postalCode);
  const prefixed = postal && country === "LU" && !/^L-/i.test(postal) ? `L-${postal}` : postal;
  return {
    line: [s(parts.number), s(parts.street)].filter(Boolean).join(", "),
    locality: [prefixed, s(parts.city)].filter(Boolean).join(" "),
    country,
  };
}

const complete = (a: PartyAddress, raw: { street?: unknown; postalCode?: unknown; city?: unknown }): boolean => Boolean(s(raw.street) && s(raw.postalCode) && s(raw.city) && a.line && a.locality);

/** The lessor, from the workspace's settings row. */
export function lessorParty(row: Row | null): { party: ContractParty | null; missing: ContractField[] } {
  const kind = s(row?.lessor_kind);
  const raw = { street: row?.address_street, number: row?.address_number, postalCode: row?.postal_code, city: row?.city, country: row?.country };
  const address = partyAddress(raw);
  const name = s(row?.legal_name);
  if (kind === "legal") {
    const missing: ContractField[] = [];
    if (!name) missing.push("name");
    if (!isLegalForm(s(row?.lessor_legal_form))) missing.push("legal_form");
    if (!s(row?.lessor_rcs_number)) missing.push("rcs_number");
    if (!complete(address, raw)) missing.push("address");
    if (!s(row?.signatory_name)) missing.push("representative");
    if (!s(row?.signatory_role)) missing.push("representative_role");
    if (missing.length > 0) return { party: null, missing };
    return {
      missing,
      party: { kind: "legal", name, legalForm: s(row?.lessor_legal_form), seat: address, rcsNumber: s(row?.lessor_rcs_number), representative: s(row?.signatory_name), representativeRole: s(row?.signatory_role) },
    };
  }
  if (kind === "natural") {
    const missing: ContractField[] = [];
    const civility = s(row?.lessor_civility);
    if (!isCivility(civility)) missing.push("civility");
    if (!name) missing.push("name");
    if (!iso(row?.lessor_birth_date)) missing.push("birth_date");
    if (!s(row?.lessor_birth_place)) missing.push("birth_place");
    if (!s(row?.lessor_nationality)) missing.push("nationality");
    if (!complete(address, raw)) missing.push("address");
    if (missing.length > 0 || !isCivility(civility)) return { party: null, missing };
    return {
      missing,
      party: { kind: "natural", civility, name, birthDate: iso(row?.lessor_birth_date), birthPlace: s(row?.lessor_birth_place), nationality: s(row?.lessor_nationality), address },
    };
  }
  // Not said yet whether the lessor is a person or a company: that first, and what is already known to be empty.
  const missing: ContractField[] = ["kind"];
  if (!name) missing.push("name");
  if (!complete(address, raw)) missing.push("address");
  return { party: null, missing };
}

/** A tenant, from their contact row (read whole: the identity columns may be newer than the rest). */
export function contactParty(row: Row): { party: ContractParty | null; missing: ContractField[] } {
  const addr = (row.address && typeof row.address === "object" ? row.address : {}) as Row;
  const raw = { street: addr.street, number: addr.number, postalCode: addr.postal_code, city: addr.city, country: addr.country };
  const address = partyAddress(raw);
  if (s(row.kind) === "legal") {
    const missing: ContractField[] = [];
    const name = s(row.legal_name);
    if (!name) missing.push("name");
    if (!isLegalForm(s(row.legal_form))) missing.push("legal_form");
    if (!s(row.rcs_number)) missing.push("rcs_number");
    if (!complete(address, raw)) missing.push("address");
    if (!s(row.representative_name)) missing.push("representative");
    if (!s(row.representative_role)) missing.push("representative_role");
    if (missing.length > 0) return { party: null, missing };
    return {
      missing,
      party: { kind: "legal", name, legalForm: s(row.legal_form), seat: address, rcsNumber: s(row.rcs_number), representative: s(row.representative_name), representativeRole: s(row.representative_role) },
    };
  }
  const missing: ContractField[] = [];
  const civility = s(row.civility);
  const name = [s(row.first_name), s(row.last_name)].filter(Boolean).join(" ");
  if (!isCivility(civility)) missing.push("civility");
  if (!s(row.first_name) || !s(row.last_name)) missing.push("name");
  if (!iso(row.birth_date)) missing.push("birth_date");
  if (!s(row.birth_place)) missing.push("birth_place");
  if (!s(row.nationality)) missing.push("nationality");
  if (!complete(address, raw)) missing.push("address");
  if (missing.length > 0 || !isCivility(civility)) return { party: null, missing };
  return { missing, party: { kind: "natural", civility, name, birthDate: iso(row.birth_date), birthPlace: s(row.birth_place), nationality: s(row.nationality), address } };
}

/** The banks a Luxembourg tenant pays into most, by BIC; any other bank is named by its BIC. */
const BANKS: Record<string, string> = {
  BCEELULL: "Banque et Caisse d'Épargne de l'État, Luxembourg",
  BGLLLULL: "BGL BNP Paribas",
  BILLLULL: "Banque Internationale à Luxembourg",
  CCRALULL: "Banque Raiffeisen",
  CELLLULL: "ING Luxembourg",
  CCPLLULL: "POST Luxembourg",
  BLUXLULL: "Banque de Luxembourg",
};

export function bankName(bic: string): string {
  const code = bic.replace(/\s+/g, "").toUpperCase();
  return BANKS[code.slice(0, 8)] ?? code;
}

/** What the dwelling is called in the contract's first sentence. */
export function dwellingOf(propertyType: string): ResidentialContractData["dwelling"] {
  if (propertyType === "house") return "house";
  if (["apartment_building", "apartment", "mixed_use"].includes(propertyType)) return "apartment";
  return "other";
}
