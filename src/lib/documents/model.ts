import type { Locale } from "@/lib/i18n/config";
import type { DocumentKind } from "./kinds";

/**
 * What a document says, laid out as blocks, before any PDF exists: the
 * composer fills a validated template with real rows into this model, the
 * renderer draws it. Tests read the model; nothing legally significant
 * lives in the renderer.
 */
export interface Party {
  name: string;
  lines: string[];
}

export interface TableSpec {
  columns: Array<{ label: string; align?: "left" | "right"; width?: number }>;
  rows: string[][];
  /** A closing row, bold. */
  total?: string[];
}

export interface Section {
  heading?: string;
  paragraphs?: string[];
  keyValues?: Array<[string, string]>;
  table?: TableSpec;
  note?: string;
  qr?: { payload: string; caption: string };
}

export interface DocumentModel {
  kind: DocumentKind;
  lang: Locale;
  version: string;
  title: string;
  subtitle?: string;
  sender: Party;
  recipient?: Party;
  dateLine: string;
  reference?: string;
  subject?: string;
  sections: Section[];
  closing?: string[];
  signature?: { label: string; name: string; second?: { label: string; name: string } };
  footer: string;
  /** Printed across the page: a preview with fictitious values, never a stored document. */
  watermark?: string;
}

/** The lessor as the documents print it: the settings row, plus the person signing. */
export interface Lessor {
  legalName: string;
  signatoryName: string;
  addressLine: string;
  city: string;
  email: string;
  phone: string;
  iban: string;
  bic: string;
  holderName: string;
}

export interface Place {
  unitLabel: string;
  propertyName: string;
  propertyAddress: string;
}

export interface RentNoticeData {
  period: string;
  dueDate: string;
  rentCents: number;
  chargesCents: number;
  otherCents: number;
  otherLabel: string | null;
  vatCents: number;
  totalCents: number;
  allocatedCents: number;
  rfReference: string | null;
}

export interface RentReceiptData {
  period: string;
  totalCents: number;
  allocations: Array<{ on: string; cents: number }>;
}

export interface OpenPeriod {
  period: string;
  dueDate: string;
  totalCents: number;
  openCents: number;
}

export interface ArrearsData {
  period: string;
  dueDate: string;
  totalCents: number;
  openCents: number;
  /** The day the step was recorded (the letter's date). */
  on: string;
  friendlyOn: string | null;
  formalOn: string | null;
  rfReference: string | null;
  openPeriods: OpenPeriod[];
}

export interface IndexationNoticeData {
  dispatchedOn: string;
  currentRentCents: number;
  proposedRentCents: number;
  ceilingMonthlyCents: number;
  bindingConstraint: string;
  lastAdjustmentOn: string | null;
  leaseStartDate: string;
}

export interface ChargesStatementData {
  year: number;
  regime: string;
  issuedOn: string | null;
  dueOn: string | null;
  lines: Array<{
    label: string;
    category: string;
    buildingTotalCents: number | null;
    tantiemes: number | null;
    tantiemesTotal: number | null;
    lotShareCents: number;
    tenantShareCents: number;
    blocked: boolean;
  }>;
  actualCents: number;
  blockedCents: number;
  advancesCents: number;
  balanceCents: number;
}

export interface DepositSettlementData {
  depositCents: number;
  form: string;
  receivedOn: string | null;
  keyHandoverOn: string;
  decompteIssuedOn: string | null;
  lines: Array<{ kind: string; label: string; amountCents: number; status: string; retainedCents: number; justifiedOn: string | null; deadline: string | null }>;
  totalRetainedCents: number;
  firstTrancheCents: number;
  firstTrancheDueOn: string;
  balanceCents: number;
  balanceDueOn: string | null;
  releasedFirstTrancheCents: number;
  releasedBalanceCents: number;
  outstandingCents: number;
  penaltyMonths: number;
  penaltyCents: number;
}

export interface LeaseContractData {
  leaseType: string;
  startDate: string;
  endDate: string | null;
  rentCents: number;
  chargesCents: number;
  chargesRegime: string;
  paymentDay: number;
  rfReference: string | null;
  depositMonths: number;
  depositCents: number;
  depositForm: string;
  furnished: boolean;
  furnitureSupplementCents: number;
  colocation: boolean;
  capitalComponents: Array<{ year: number; cents: number; kind: string }>;
  tenants: Array<{ name: string; email: string | null }>;
  unit: { label: string; floor: string | null; areaSqm: number; rooms: number; bedrooms: number | null };
  energyClass: string | null;
  cadastral: string | null;
}

export interface HousingCertificateData {
  tenants: string[];
  startDate: string;
  endDate: string | null;
}

export interface EdlReportData {
  kind: string;
  completedAt: string | null;
  keyHandoverAt: string | null;
  signed: boolean;
  manifestSha256: string;
  rooms: Array<{ room: string; items: Array<{ category: string; condition: string; notes: string; photos: number }> }>;
  readings: Array<{ meter: string; value: string; readOn: string }>;
  photos: Array<{ room: string; category: string; capturedAt: string; sha256: string }>;
  tenants: string[];
}

export type KindData = {
  rent_notice: RentNoticeData;
  rent_receipt: RentReceiptData;
  arrears_formal: ArrearsData;
  arrears_mise_en_demeure: ArrearsData;
  indexation_notice: IndexationNoticeData;
  charges_statement: ChargesStatementData;
  deposit_settlement: DepositSettlementData;
  lease_contract: LeaseContractData;
  housing_certificate: HousingCertificateData;
  edl_report: EdlReportData;
};

export interface ComposeInput<K extends DocumentKind = DocumentKind> {
  kind: K;
  lang: Locale;
  lessor: Lessor;
  /** The tenants of the tenancy, as named on the lease. */
  tenants: string[];
  place: Place;
  /** The day the document is made, ISO. */
  on: string;
  /** A short reference the document prints (its own id, once stored, or the source's). */
  reference: string;
  data: KindData[K];
  watermark?: string;
}
