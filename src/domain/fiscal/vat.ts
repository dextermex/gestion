/**
 * VAT engine (loi TVA du 12.2.1979 — fiscal brief §4).
 *
 *  • Letting of immovable property is exempt (Art. 44(1)(g)); residential
 *    letting is ALWAYS exempt in practice — the option cannot be exercised
 *    because a private tenant has no right of deduction.
 *  • Option to tax (Art. 45 + RGD 7.3.1980): tenant must be a taxable person
 *    deducting ≥ 50%; AED prior approval; VAT applies from the FIRST DAY OF
 *    THE MONTH FOLLOWING the decision — never retroactively.
 *  • Management/agency/syndic fees are ALWAYS taxable at 17% — the letting
 *    exemption does not extend to the manager's fee (place of supply = where
 *    the building is, Art. 17(1)).
 *  • Invoices must state the exemption reason when exempt.
 */

import { Cents, pct } from "@/domain/money";
import { ISODate, addMonths, startOfMonth } from "@/domain/dates";
import { getParamValue } from "@/domain/legal/params";
import { LeaseType, ValidationIssue } from "@/domain/lease/rules";

export type VatRegime = "exempt" | "opted";

export interface VatOptionRequest {
  leaseType: LeaseType;
  tenantIsTaxablePerson: boolean;
  tenantDeductionRatioPct: number;
  aedApprovalRef: string | null;
  aedDecisionDate: ISODate | null;
}

export interface VatOptionAssessment {
  allowed: boolean;
  issues: ValidationIssue[];
  /** First day VAT may be charged (month after the AED decision). */
  effectiveFrom: ISODate | null;
}

export function assessVatOption(req: VatOptionRequest, asOf?: ISODate): VatOptionAssessment {
  const issues: ValidationIssue[] = [];
  // Param resolution date: the AED decision date when known, else the
  // caller-supplied assessment date — never a hard-coded literal.
  const resolutionDate = req.aedDecisionDate ?? asOf ?? new Date().toISOString().slice(0, 10);
  const minRatio = getParamValue("vat.option_min_tenant_deduction_pct", resolutionDate);

  if (req.leaseType === "residential") {
    issues.push({
      code: "VAT_OPTION_RESIDENTIAL",
      severity: "blocking",
      message:
        "Residential letting is always VAT-exempt — a private tenant is not a taxable person with a right of deduction, so the option cannot be exercised.",
      legalBasis: "Art. 44(1)(g) + Art. 45 loi TVA",
    });
  }
  if (!req.tenantIsTaxablePerson) {
    issues.push({
      code: "VAT_TENANT_NOT_TAXABLE",
      severity: "blocking",
      message: "The tenant must be a taxable person using the premises for deductible activities.",
      legalBasis: "Art. 45 loi TVA + RGD 7.3.1980",
    });
  }
  if (req.tenantDeductionRatioPct < minRatio) {
    issues.push({
      code: "VAT_DEDUCTION_RATIO_LOW",
      severity: "blocking",
      message: `Tenant's input-VAT deduction ratio (${req.tenantDeductionRatioPct}%) is below the required ${minRatio}%.`,
      legalBasis: "RGD 7.3.1980 — ratio ≥ 50% (option granularity per building/lot/lease: uncertainty register #4)",
    });
  }
  if (!req.aedApprovalRef || !req.aedDecisionDate) {
    issues.push({
      code: "VAT_AED_APPROVAL_MISSING",
      severity: "blocking",
      message:
        "Prior AED approval is mandatory (one month to decide from filing). Record the approval reference and decision date.",
      legalBasis: "Art. 45 loi TVA — approbation préalable",
    });
  }

  const allowed = issues.length === 0;
  return {
    allowed,
    issues,
    effectiveFrom:
      allowed && req.aedDecisionDate ? startOfMonth(addMonths(req.aedDecisionDate, 1)) : null,
  };
}

export interface RentVatLine {
  net: Cents;
  vatRatePct: number;
  vat: Cents;
  gross: Cents;
  exemptionMention: string | null;
}

/**
 * VAT on a rent invoice line as of an invoice date. Opted leases charge 17%
 * only from the option's effective date — never retroactively.
 */
export function rentVat(
  net: Cents,
  regime: VatRegime,
  invoiceDate: ISODate,
  optionEffectiveFrom: ISODate | null,
): RentVatLine {
  const optedActive = regime === "opted" && optionEffectiveFrom !== null && invoiceDate >= optionEffectiveFrom;
  if (!optedActive) {
    return {
      net,
      vatRatePct: 0,
      vat: 0,
      gross: net,
      exemptionMention:
        "Exonération de TVA — location de biens immeubles, art. 44, §1, g) de la loi modifiée du 12 février 1979 concernant la TVA.",
    };
  }
  const rate = getParamValue("vat.standard_rate_pct", invoiceDate);
  const vat = pct(net, rate);
  return { net, vatRatePct: rate, vat, gross: net + vat, exemptionMention: null };
}

/**
 * Management fee VAT — ALWAYS standard-rated (17%), even for exempt
 * residential lettings. For a residential landlord with no deduction right
 * this VAT is a sunk cost, deductible only as a frais d'obtention.
 */
export function managementFeeVat(net: Cents, invoiceDate: ISODate): RentVatLine {
  const rate = getParamValue("vat.standard_rate_pct", invoiceDate);
  const vat = pct(net, rate);
  return { net, vatRatePct: rate, vat, gross: net + vat, exemptionMention: null };
}

/** Mandatory invoice content check (AED — fiscal brief §6.1). */
export interface InvoiceContent {
  issueDate: ISODate;
  sequentialNumber: string;
  supplierVatNumber: string;
  supplierNameAddress: string;
  customerNameAddress: string;
  supplyDate: ISODate | null;
  natureOfSupply: string;
  netByRate: Array<{ ratePct: number; net: Cents; vat: Cents }>;
  exemptionReason: string | null;
  totalIncl: Cents;
}

export function validateInvoiceContent(inv: InvoiceContent): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const need = (cond: boolean, code: string, message: string) => {
    if (!cond) issues.push({ code, severity: "blocking", message, legalBasis: "AED — mentions obligatoires des factures" });
  };
  need(Boolean(inv.sequentialNumber), "INV_SEQ", "Sequential invoice number is mandatory.");
  need(Boolean(inv.supplierVatNumber), "INV_VAT_NO", "Supplier VAT identification number is mandatory.");
  need(Boolean(inv.supplierNameAddress), "INV_SUPPLIER", "Full supplier name and address are mandatory.");
  need(Boolean(inv.customerNameAddress), "INV_CUSTOMER", "Full customer name and address are mandatory.");
  need(Boolean(inv.natureOfSupply), "INV_NATURE", "Extent and nature of the supply are mandatory.");
  const hasExemptLine = inv.netByRate.some((l) => l.ratePct === 0);
  need(
    !hasExemptLine || Boolean(inv.exemptionReason),
    "INV_EXEMPTION_REASON",
    "Exempt supplies must state the reason for the exemption (cite art. 44(1)(g) for exempt letting).",
  );
  // Simplified invoice threshold — informational.
  const cap = getParamValue("vat.simplified_invoice_max_incl_eur", inv.issueDate) * 100;
  if (inv.totalIncl <= cap) {
    issues.push({
      code: "INV_SIMPLIFIED_OK",
      severity: "warning",
      message: `Total ≤ €${cap / 100} incl. VAT — the simplified invoice content set is permitted (domestic only).`,
      legalBasis: "Loi TVA — facture simplifiée",
    });
  }
  return issues;
}
