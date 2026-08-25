/**
 * Lease rule packs — `lease_type` is not a cosmetic label (strategy §3.1/§3.2,
 * fiscal brief §5b). The type drives: deposit ceiling, rent-cap regime,
 * agency-fee splitting, indexation regime, the renewal/notice calendar and
 * the VAT regime. One lease object, divergent rules tables.
 */

import { Cents } from "@/domain/money";
import { ISODate, addMonths } from "@/domain/dates";
import { getParamValue } from "@/domain/legal/params";

export type LeaseType = "residential" | "commercial";

export type DepositForm =
  | "cash"
  | "bank_guarantee"
  | "third_party_caution"
  | "insurance"
  | "state_guarantee";

/** The five statutory deposit forms — the landlord must accept the tenant's chosen permitted form. */
export const RESIDENTIAL_DEPOSIT_FORMS: DepositForm[] = [
  "cash",
  "bank_guarantee",
  "third_party_caution",
  "insurance",
  "state_guarantee",
];

/**
 * The 8 mandatory mentions of a residential lease (written on pain of
 * nullity). The generator refuses to emit a signable lease until every
 * mention is populated.
 */
export const RESIDENTIAL_MANDATORY_MENTIONS = [
  "parties_identity",
  "property_designation",
  "lease_start_date",
  "duration_or_indefinite",
  "rent_amount",
  "charges_regime",
  "deposit_terms",
  "capital_investi_declaration",
] as const;

export type MandatoryMention = (typeof RESIDENTIAL_MANDATORY_MENTIONS)[number];

export interface LeaseDraft {
  type: LeaseType;
  startDate: ISODate;
  /** null = indefinite duration */
  endDate: ISODate | null;
  monthlyRent: Cents;
  monthlyCharges: Cents;
  depositMonths: number;
  depositForm: DepositForm;
  /** Populated mandatory mentions (residential). */
  mentions: Partial<Record<MandatoryMention, string>>;
  /** True when the draft contains a CPI/index escalation clause. */
  hasCpiEscalationClause: boolean;
  furnished: boolean;
  /** Monthly furniture supplement, if furnished. */
  furnitureSupplement?: Cents;
  /** Total of itemised furniture invoices < 10 years old. */
  furnitureInvoiceTotal?: Cents;
  /** Agency fee charged to the tenant (residential must be ≤ 50% of total). */
  agencyFeeTenantShare?: Cents;
  agencyFeeTotal?: Cents;
  colocation: boolean;
  /** Colocation: the written pacte de colocation is in the signing envelope. */
  pacteColocationAttached?: boolean;
}

export type Severity = "blocking" | "warning";

export interface ValidationIssue {
  code: string;
  severity: Severity;
  message: string;
  /** Statute or rule the issue enforces — shown to the manager, always. */
  legalBasis: string;
}

/**
 * Validate a lease draft against the rule pack for its type.
 * Blocking issues stop the generator from emitting a signable lease.
 */
export function validateLeaseDraft(draft: LeaseDraft, onDate?: ISODate): ValidationIssue[] {
  const date = onDate ?? draft.startDate;
  const issues: ValidationIssue[] = [];

  // Deposit ceiling — 2 months residential (since 1.8.2024), 6 commercial.
  const maxMonths = getParamValue(
    draft.type === "residential" ? "residential.deposit_max_months" : "commercial.deposit_max_months",
    date,
  );
  if (draft.depositMonths > maxMonths) {
    issues.push({
      code: "DEPOSIT_OVER_CAP",
      severity: "blocking",
      message: `Deposit of ${draft.depositMonths} months exceeds the legal maximum of ${maxMonths} months for a ${draft.type} lease.`,
      legalBasis:
        draft.type === "residential"
          ? "Loi du 21.9.2006 as amended 2024, max 2 months (excl. charges)"
          : "Loi du 3.2.2018, garantie locative capped at 6 months",
    });
  }

  if (draft.type === "residential") {
    // 8 mandatory mentions, on pain of nullity.
    const missing = RESIDENTIAL_MANDATORY_MENTIONS.filter(
      (m) => !draft.mentions[m] || draft.mentions[m]!.trim() === "",
    );
    if (missing.length > 0) {
      issues.push({
        code: "MENTIONS_INCOMPLETE",
        severity: "blocking",
        message: `Missing mandatory mention(s): ${missing.join(", ")}. A residential lease must be written with all 8 mentions on pain of nullity.`,
        legalBasis: "Loi du 21.9.2006 (rev. 2024), written lease with mandatory mentions",
      });
    }

    // CPI escalation clauses are prohibited in residential leases.
    if (draft.hasCpiEscalationClause) {
      issues.push({
        code: "CPI_CLAUSE_PROHIBITED",
        severity: "blocking",
        message:
          "CPI/index escalation clauses are prohibited in residential leases (relative nullity). Use the statutory adjustment calendar instead.",
        legalBasis: "Loi du 21.9.2006 (rev. 2024), indexation clause nullifiable",
      });
    }

    // Agency fee split 50/50 by operation of law.
    if (
      draft.agencyFeeTenantShare !== undefined &&
      draft.agencyFeeTotal !== undefined &&
      draft.agencyFeeTenantShare * 2 > draft.agencyFeeTotal
    ) {
      issues.push({
        code: "AGENCY_FEE_SPLIT",
        severity: "blocking",
        message:
          "The tenant's share of the agency fee exceeds 50%. Since 1.8.2024 the fee is split 50/50 landlord/tenant by operation of law.",
        legalBasis: "Loi du 23.7.2024, agency commission split 50/50",
      });
    }

    // Furnished supplement: max 1.5%/month of itemised furniture invoices < 10y.
    if (draft.furnished && draft.furnitureSupplement !== undefined) {
      if (!draft.furnitureInvoiceTotal) {
        issues.push({
          code: "FURNITURE_NOT_ITEMISED",
          severity: "blocking",
          message:
            "Furnished supplement requires itemised furniture invoices (< 10 years old) on pain of nullity.",
          legalBasis: "Loi du 23.7.2024, furniture supplement itemised",
        });
      } else {
        const rate = getParamValue("residential.furnished_supplement_monthly_pct_of_furniture", date);
        const cap = Math.round((draft.furnitureInvoiceTotal * rate) / 100);
        if (draft.furnitureSupplement > cap) {
          issues.push({
            code: "FURNITURE_SUPPLEMENT_OVER_CAP",
            severity: "blocking",
            message: `Furniture supplement exceeds ${rate}% per month of the itemised furniture value.`,
            legalBasis: "Loi du 23.7.2024, max 1.5%/month of furniture invoices",
          });
        }
      }
    }

    // Colocation: single lease + written pacte in the same signing envelope.
    if (draft.colocation && !draft.pacteColocationAttached) {
      issues.push({
        code: "PACTE_COLOCATION_MISSING",
        severity: "blocking",
        message:
          "Colocation requires the written pacte de colocation in the same signing envelope as the lease.",
        legalBasis: "Loi du 23.7.2024, colocation regime (art. 2bis–2sexies map uncertain)",
      });
    }
  }

  if (draft.type === "commercial") {
    // Scope: leases < 1 year (pop-ups) fall outside the 2018 law.
    if (draft.endDate) {
      const months =
        (Number(draft.endDate.slice(0, 4)) - Number(draft.startDate.slice(0, 4))) * 12 +
        (Number(draft.endDate.slice(5, 7)) - Number(draft.startDate.slice(5, 7)));
      if (months < getParamValue("commercial.min_lease_duration_for_scope_months", date)) {
        issues.push({
          code: "COMMERCIAL_POPUP_OUT_OF_SCOPE",
          severity: "warning",
          message:
            "Lease shorter than 1 year, outside the scope of the loi du 3.2.2018 (pop-up). Renewal and eviction-indemnity protections do not apply.",
          legalBasis: "Loi du 3.2.2018, scope excludes leases < 1 year",
        });
      }
    }
  }

  return issues;
}

/** Pas-de-porte is void de plein droit for commercial leases concluded from 1.3.2018. */
export function validatePasDePorte(leaseType: LeaseType, concludedOn: ISODate, amount: Cents): ValidationIssue[] {
  if (leaseType !== "commercial" || amount <= 0) return [];
  if (concludedOn >= "2018-03-01") {
    return [
      {
        code: "PAS_DE_PORTE_VOID",
        severity: "blocking",
        message:
          "Any rent supplement paid for the conclusion of a commercial lease (pas-de-porte) is void de plein droit, with mandatory reimbursement.",
        legalBasis: "Loi du 3.2.2018, pas-de-porte nul de plein droit",
      },
    ];
  }
  return [
    {
      code: "PAS_DE_PORTE_GRANDFATHERED",
      severity: "warning",
      message: "Lease concluded before 1.3.2018, pas-de-porte unaffected by the 2018 law.",
      legalBasis: "Loi du 3.2.2018, transitional",
    },
  ];
}

// ─── Termination ────────────────────────────────────────────────────────────

export type TerminationGround =
  | "tenant_notice"
  | "landlord_personal_need"
  | "landlord_serious_ground"
  | "landlord_sale"; // never valid, blocked in product

/**
 * Art. 12(3) — a besoin-personnel notice must reproduce the STATUTORY TEXT
 * verbatim on pain of nullity.
 *
 * ⚠ UNCERTAIN / PLACEHOLDER. The string below DESCRIBES the obligation; it is
 * NOT the article text. Before any notice-generation flow renders a letter,
 * the real art. 12(3) wording must be sourced from Legilux and stored as a
 * `legal_params` text row (versioned, status "verified"), and this constant
 * retired. The engine only uses the boolean gate (`art12VerbatimIncluded`);
 * nothing renders this placeholder into a legal document.
 */
export const ART_12_3_VERBATIM_PLACEHOLDER =
  "Le congé pour besoin personnel doit, sous peine de nullité, indiquer le motif " +
  "invoqué et reproduire le texte de l'article 12 (3) de la loi modifiée du 21 " +
  "septembre 2006 sur le bail à usage d'habitation. Le locataire peut contester " +
  "le congé dans les trois mois de sa notification.";

export interface TerminationRequest {
  leaseType: LeaseType;
  ground: TerminationGround;
  /** Date the AR (avis de réception) was signed — legal effect date, never the send date. */
  arReceivedDate: ISODate;
  /** Fixed-term expiry, if any. */
  fixedTermEnd: ISODate | null;
  /** For besoin personnel: the letter includes the art. 12(3) verbatim. */
  art12VerbatimIncluded?: boolean;
}

export interface TerminationAssessment {
  valid: boolean;
  issues: ValidationIssue[];
  noticeMonths: number | null;
  /** Earliest date the lease can lawfully end, computed from the AR date. */
  earliestLawfulEnd: ISODate | null;
}

export function assessTermination(req: TerminationRequest): TerminationAssessment {
  const issues: ValidationIssue[] = [];
  const d = req.arReceivedDate;

  if (req.leaseType === "residential") {
    if (req.ground === "landlord_sale") {
      issues.push({
        code: "SALE_NOT_A_GROUND",
        severity: "blocking",
        message:
          "“Landlord is selling” is not a lawful termination ground for a residential lease. The grounds are exhaustive; a sale transfers the lease to the buyer.",
        legalBasis: "Loi du 21.9.2006, exhaustive termination grounds",
      });
      return { valid: false, issues, noticeMonths: null, earliestLawfulEnd: null };
    }

    if (req.ground === "landlord_personal_need" && !req.art12VerbatimIncluded) {
      issues.push({
        code: "ART_12_3_VERBATIM_MISSING",
        severity: "blocking",
        message:
          "A besoin-personnel notice must reproduce art. 12(3) verbatim on pain of nullity. Use the locked template partial.",
        legalBasis: "Loi du 21.9.2006 art. 12(3)",
      });
    }

    const noticeMonths =
      req.ground === "tenant_notice"
        ? getParamValue("residential.notice_tenant_months", d)
        : req.ground === "landlord_personal_need"
          ? getParamValue("residential.notice_landlord_personal_need_months", d)
          : getParamValue("residential.notice_landlord_months", d);

    let earliest = addMonths(d, noticeMonths);
    // Prorogation légale guard: a fixed-term lease not terminated for its exact
    // expiry renews indefinitely; the notice can only take effect at/after expiry.
    if (req.fixedTermEnd && earliest < req.fixedTermEnd) {
      earliest = req.fixedTermEnd;
      issues.push({
        code: "FIXED_TERM_DATE_GUARD",
        severity: "warning",
        message: `Notice takes effect at the fixed-term expiry (${req.fixedTermEnd}); missing the exact expiry renews the lease indefinitely (prorogation légale).`,
        legalBasis: "Loi du 21.9.2006, prorogation légale",
      });
    }

    return {
      valid: !issues.some((i) => i.severity === "blocking"),
      issues,
      noticeMonths,
      earliestLawfulEnd: earliest,
    };
  }

  // Commercial: minimum 6 months by registered letter with AR.
  const noticeMonths = getParamValue("commercial.termination_notice_min_months", d);
  const earliest = addMonths(d, noticeMonths);
  return { valid: true, issues, noticeMonths, earliestLawfulEnd: earliest };
}

// ─── Commercial renewal calendar ────────────────────────────────────────────

export interface CommercialRenewalCalendar {
  /** Last day the tenant can send the renewal request (registered letter). */
  renewalRequestDeadline: ISODate;
  /** Landlord must answer within 3 months of the request. */
  landlordAnswerDeadline: (requestDate: ISODate) => ISODate;
  /** Occupation date from which refusal without cause requires the eviction indemnity. */
  evictionIndemnityFrom: ISODate;
  /** Occupation date from which the tenant holds the pre-emption right on sale. */
  preemptionFrom: ISODate;
}

export function commercialRenewalCalendar(
  occupancyStart: ISODate,
  fixedTermEnd: ISODate,
): CommercialRenewalCalendar {
  const d = fixedTermEnd;
  return {
    renewalRequestDeadline: addMonths(
      fixedTermEnd,
      -getParamValue("commercial.renewal_request_min_months_before_expiry", d),
    ),
    landlordAnswerDeadline: (requestDate) =>
      addMonths(requestDate, getParamValue("commercial.landlord_answer_months", requestDate)),
    evictionIndemnityFrom: addMonths(
      occupancyStart,
      getParamValue("commercial.eviction_indemnity_occupancy_years", d) * 12,
    ),
    preemptionFrom: addMonths(
      occupancyStart,
      getParamValue("commercial.preemption_occupancy_years", d) * 12,
    ),
  };
}
