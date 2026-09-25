import type { DocumentClass } from "@/lib/gestion/documents-rules";

/**
 * The documents the application produces itself, each from real rows: what
 * kind it is, which register class it files under, which record it is
 * generated from (its source) and which record it hangs off in the register
 * (its relation, always the tenancy, so the tenant may read what is theirs
 * under the policies that already exist).
 */
export const DOCUMENT_KINDS = [
  "rent_notice",
  "rent_receipt",
  "arrears_formal",
  "arrears_mise_en_demeure",
  "indexation_notice",
  "charges_statement",
  "deposit_settlement",
  "lease_contract",
  "housing_certificate",
  "edl_report",
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export type SourceType = "rent_period" | "arrears_action" | "registered_letter" | "charge_period" | "deposit" | "lease" | "edl_session";

export const KIND_SOURCE: Record<DocumentKind, SourceType> = {
  rent_notice: "rent_period",
  rent_receipt: "rent_period",
  arrears_formal: "arrears_action",
  arrears_mise_en_demeure: "registered_letter",
  indexation_notice: "registered_letter",
  charges_statement: "charge_period",
  deposit_settlement: "deposit",
  lease_contract: "lease",
  housing_certificate: "lease",
  edl_report: "edl_session",
};

export const KIND_CLASS: Record<DocumentKind, DocumentClass> = {
  rent_notice: "other",
  rent_receipt: "receipt",
  arrears_formal: "other",
  arrears_mise_en_demeure: "registered_letter",
  indexation_notice: "registered_letter",
  charges_statement: "decompte",
  deposit_settlement: "decompte",
  lease_contract: "lease",
  housing_certificate: "other",
  edl_report: "edl",
};

export const isDocumentKind = (v: unknown): v is DocumentKind => typeof v === "string" && (DOCUMENT_KINDS as readonly string[]).includes(v);
