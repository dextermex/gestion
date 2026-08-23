/**
 * Deposit settlement engine (residential — loi 21.9.2006 rev. 2024).
 *
 * Statutory mechanics encoded here:
 *  • Release: 50% within 1 month of key handover; balance within 1 month of
 *    the charge settlement (décompte). First-tranche delay is a configurable
 *    legal param (1 vs 2 months — uncertainty register #1).
 *  • Deductions must be justified by invoice/estimate within 1 month —
 *    unjustified lines auto-expire to FORFEITED (they cannot be deducted).
 *  • Penalty after mise en demeure: +10% of the monthly rent per COMMENCED
 *    month of delay.
 *  • No entry EDL → the deposit cannot be applied to damage AT ALL (hard gate).
 */

import { Cents, pct } from "@/domain/money";
import { ISODate, addMonths, commencedMonthsBetween } from "@/domain/dates";
import { getParamValue } from "@/domain/legal/params";
import { DepositForm } from "@/domain/lease/rules";

export type DeductionKind = "arrears" | "damage" | "charge_reserve";

export interface DeductionLine {
  id: string;
  kind: DeductionKind;
  label: string;
  amount: Cents;
  /** EDL exit line this damage ties to (required for damage). */
  edlItemRef?: string;
  /** Invoice or estimate evidencing the deduction. */
  justificationDocRef?: string;
  justifiedAt?: ISODate;
}

export interface SettlementInput {
  depositAmount: Cents;
  depositForm: DepositForm;
  monthlyRent: Cents;
  keyHandoverDate: ISODate;
  /** Date the final charge settlement (décompte) was issued, if yet. */
  decompteIssuedAt: ISODate | null;
  entryEdlExists: boolean;
  deductions: DeductionLine[];
  /** Mise en demeure by registered letter — AR date starts the penalty clock. */
  miseEnDemeureArDate: ISODate | null;
  /** Amounts already released to the tenant. */
  releasedFirstTranche: Cents;
  releasedBalance: Cents;
  asOf: ISODate;
}

export interface SettlementLineResult extends DeductionLine {
  status: "justified" | "pending" | "expired_forfeited" | "blocked_no_entry_edl";
  retained: Cents;
  /** Null for a charge reserve while the décompte does not exist yet. */
  justificationDeadline: ISODate | null;
}

export interface SettlementResult {
  lines: SettlementLineResult[];
  totalRetained: Cents;
  /** 50% tranche due date (key handover + configured months). */
  firstTrancheDueAt: ISODate;
  firstTrancheAmount: Cents;
  /** Balance due after décompte (null until the décompte exists). */
  balanceDueAt: ISODate | null;
  balanceAmount: Cents;
  /** Outstanding amount the landlord still owes the tenant as of `asOf`. */
  outstandingToTenant: Cents;
  /** Penalty accrued: 10% of monthly rent × commenced months since mise en demeure. */
  penaltyMonths: number;
  penaltyAccrued: Cents;
  /** Live exposure if nothing is released today. */
  warnings: string[];
}

export function computeSettlement(input: SettlementInput): SettlementResult {
  const d = input.asOf;
  const justificationMonths = getParamValue("residential.deposit_justification_window_months", d);
  const firstTrancheMonths = getParamValue("residential.deposit_first_tranche_months_after_keys", d);
  const balanceMonths = getParamValue("residential.deposit_balance_months_after_decompte", d);
  const penaltyPct = getParamValue("residential.deposit_penalty_pct_of_monthly_rent_per_month", d);

  const warnings: string[] = [];

  const lines: SettlementLineResult[] = input.deductions.map((line) => {
    // Damage/arrears run on the keys+1-month clock. A charge reserve runs on
    // the DÉCOMPTE clock — the statutory "balance at M+1 of the décompte"
    // mechanism means the reserve cannot forfeit before the décompte exists.
    const deadline: ISODate | null =
      line.kind === "charge_reserve"
        ? input.decompteIssuedAt
          ? addMonths(input.decompteIssuedAt, justificationMonths)
          : null
        : addMonths(input.keyHandoverDate, justificationMonths);

    // Hard gate: no entry EDL → the deposit cannot cover damage at all.
    if (line.kind === "damage" && !input.entryEdlExists) {
      return { ...line, status: "blocked_no_entry_edl", retained: 0, justificationDeadline: deadline };
    }

    const justified = Boolean(
      line.justificationDocRef && line.justifiedAt && (deadline === null || line.justifiedAt <= deadline),
    );
    if (justified) {
      return { ...line, status: "justified", retained: line.amount, justificationDeadline: deadline };
    }
    if (deadline !== null && d > deadline) {
      return { ...line, status: "expired_forfeited", retained: 0, justificationDeadline: deadline };
    }
    return { ...line, status: "pending", retained: line.amount, justificationDeadline: deadline };
  });

  if (!input.entryEdlExists && input.deductions.some((l) => l.kind === "damage")) {
    warnings.push(
      "No entry EDL exists — damage deductions are legally unavailable and have been zeroed.",
    );
  }
  for (const l of lines) {
    if (l.status === "expired_forfeited") {
      warnings.push(`Deduction “${l.label}” passed its 1-month justification window unjustified — forfeited.`);
    }
    if (l.status === "pending") {
      warnings.push(`Deduction “${l.label}” still needs an invoice/estimate before ${l.justificationDeadline}.`);
    }
  }

  const totalRetained = lines.reduce((a, l) => a + l.retained, 0);
  const netToTenant = Math.max(0, input.depositAmount - totalRetained);

  const firstTrancheDueAt = addMonths(input.keyHandoverDate, firstTrancheMonths);
  // Statute: 50% of the deposit within 1 month of key handover (retentions
  // permitting), balance after the décompte.
  const firstTrancheAmount = Math.min(Math.round(input.depositAmount / 2), netToTenant);
  const balanceAmount = netToTenant - Math.min(firstTrancheAmount, netToTenant);
  const balanceDueAt = input.decompteIssuedAt ? addMonths(input.decompteIssuedAt, balanceMonths) : null;

  const releasedTotal = input.releasedFirstTranche + input.releasedBalance;
  const outstandingToTenant = Math.max(0, netToTenant - releasedTotal);

  let penaltyMonths = 0;
  let penaltyAccrued = 0;
  if (input.miseEnDemeureArDate && outstandingToTenant > 0) {
    penaltyMonths = commencedMonthsBetween(input.miseEnDemeureArDate, d);
    penaltyAccrued = pct(input.monthlyRent, penaltyPct) * penaltyMonths;
    if (penaltyMonths > 0) {
      warnings.push(
        `Penalty clock running: ${penaltyMonths} commenced month(s) × ${penaltyPct}% of monthly rent = live exposure.`,
      );
    }
  } else if (
    input.releasedFirstTranche < firstTrancheAmount &&
    d > firstTrancheDueAt
  ) {
    warnings.push(
      `First tranche (${firstTrancheMonths} month(s) after keys) is overdue since ${firstTrancheDueAt}. A tenant mise en demeure would start the 10%/month penalty clock.`,
    );
  }

  return {
    lines,
    totalRetained,
    firstTrancheDueAt,
    firstTrancheAmount,
    balanceDueAt,
    balanceAmount,
    outstandingToTenant,
    penaltyMonths,
    penaltyAccrued,
    warnings,
  };
}

/** Per-form release instructions — the operational tail of a settlement. */
export function releaseInstructions(form: DepositForm): string {
  switch (form) {
    case "cash":
      return "SEPA refund to the tenant's IBAN.";
    case "bank_guarantee":
      return "Issue the mainlevée letter to the guaranteeing bank.";
    case "third_party_caution":
      return "Notify the guarantor that the caution is discharged.";
    case "insurance":
      return "File the release with the deposit insurer; claim pack for retained amounts.";
    case "state_guarantee":
      return "Notify the State guarantee service; claim pack for retained amounts.";
  }
}
