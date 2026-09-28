import type { Cents } from "../money";

/** Pure estimates, not payment records, tax calculations or lending decisions. */
export type InvestmentInputCode = "invalid_money" | "invalid_rate" | "invalid_term" | "invalid_occupancy" | "loan_exceeds_cost" | "amount_overflow";

export class InvestmentInputError extends RangeError {
  constructor(public readonly code: InvestmentInputCode, public readonly field: string) {
    super(`${code}: ${field}`);
    this.name = "InvestmentInputError";
  }
}

// An allocation limit, not a legal limit or a bank's maximum mortgage duration.
const MAX_SCHEDULE_MONTHS = 1_200;

function money(value: number, field: string, signed = false): Cents {
  if (!Number.isSafeInteger(value) || (!signed && value < 0)) {
    throw new InvestmentInputError("invalid_money", field);
  }
  return value;
}

function amount(value: number, field: string): Cents {
  if (!Number.isSafeInteger(value)) throw new InvestmentInputError("amount_overflow", field);
  return value;
}

export interface AmortizationInput {
  balanceCents: Cents;
  /** Nominal annual borrowing rate, not APRC/TAEG. Assumed unchanged. */
  annualRatePct: number;
  remainingMonths: number;
}

export interface AmortizationRow {
  month: number;
  openingCents: Cents;
  interestCents: Cents;
  principalCents: Cents;
  paymentCents: Cents;
  balanceCents: Cents;
}

export interface AmortizationResult {
  schedule: AmortizationRow[];
  monthlyPaymentCents: Cents;
  totalInterestCents: Cents;
  totalPaymentCents: Cents;
}

/**
 * Monthly, fully amortising estimate from a dated statement balance. Insurance,
 * fees, future rate changes, deferrals and extra payments are excluded. Rows are
 * projected instalments, never evidence that the bank received a payment.
 */
export function amortize(input: AmortizationInput): AmortizationResult {
  const { balanceCents, annualRatePct, remainingMonths } = input;
  money(balanceCents, "balanceCents");
  if (!Number.isFinite(annualRatePct) || annualRatePct < 0 || annualRatePct > 100) {
    throw new InvestmentInputError("invalid_rate", "annualRatePct");
  }
  if (!Number.isInteger(remainingMonths) || remainingMonths < 0 || remainingMonths > MAX_SCHEDULE_MONTHS || (balanceCents > 0 && remainingMonths === 0)) {
    throw new InvestmentInputError("invalid_term", "remainingMonths");
  }
  if (balanceCents === 0) {
    return { schedule: [], monthlyPaymentCents: 0, totalInterestCents: 0, totalPaymentCents: 0 };
  }

  const rate = annualRatePct / 1_200;
  // log1p/expm1 retain precision close to zero, where 1 - (1 + r)^-n cancels.
  const factor = rate === 0 ? 1 / remainingMonths : rate / -Math.expm1(-remainingMonths * Math.log1p(rate));
  const monthlyPaymentCents = amount(Math.round(balanceCents * factor), "monthlyPaymentCents");
  const schedule: AmortizationRow[] = [];
  let balance = balanceCents;
  let totalInterestCents = 0;
  let totalPaymentCents = 0;

  for (let month = 1; month <= remainingMonths && balance > 0; month++) {
    const openingCents = balance;
    const interestCents = amount(Math.round(openingCents * rate), "interestCents");
    const settlementCents = amount(openingCents + interestCents, "paymentCents");
    // Clear the final cent-rounding remainder; never create a negative balance.
    const paymentCents = month === remainingMonths ? settlementCents : Math.min(monthlyPaymentCents, settlementCents);
    const principalCents = paymentCents - interestCents;
    balance = amount(openingCents - principalCents, "balanceCents");
    totalInterestCents = amount(totalInterestCents + interestCents, "totalInterestCents");
    totalPaymentCents = amount(totalPaymentCents + paymentCents, "totalPaymentCents");
    schedule.push({ month, openingCents, interestCents, principalCents, paymentCents, balanceCents: balance });
  }
  return { schedule, monthlyPaymentCents, totalInterestCents, totalPaymentCents };
}

/** Capital repaid is distinct from property equity or confirmed payment status. */
export function repaidProgress(originalCents: Cents, balanceCents: Cents): {
  repaidCents: Cents;
  repaidPct: number | null;
  balanceIncreased: boolean;
} {
  money(originalCents, "originalCents");
  money(balanceCents, "balanceCents");
  const repaidCents = Math.max(0, originalCents - balanceCents);
  return {
    repaidCents,
    repaidPct: originalCents === 0 ? null : (repaidCents / originalCents) * 100,
    balanceIncreased: balanceCents > originalCents,
  };
}

export interface InvestmentCashflowInput {
  /** Base rent only: exclude tenant charge advances, deposits and VAT. */
  monthlyRentCents: Cents;
  occupancyPct: number;
  /** Owner-paid operating costs only; exclude the separately supplied debt. */
  monthlyOwnerCostsCents: Cents;
  /** Full principal plus interest payment; exclude separately supplied insurance. */
  monthlyDebtCents: Cents;
  monthlyInsuranceCents: Cents;
  totalAcquisitionCents?: Cents;
}

export function investmentCashflow(input: InvestmentCashflowInput): {
  effectiveRentCents: Cents;
  operatingSurplusCents: Cents;
  cashflowCents: Cents;
  /** Annual operating yield before financing and taxes, not return on equity. */
  netYieldPct: number | null;
} {
  const { monthlyRentCents, occupancyPct, monthlyOwnerCostsCents, monthlyDebtCents, monthlyInsuranceCents, totalAcquisitionCents } = input;
  money(monthlyRentCents, "monthlyRentCents");
  money(monthlyOwnerCostsCents, "monthlyOwnerCostsCents");
  money(monthlyDebtCents, "monthlyDebtCents");
  money(monthlyInsuranceCents, "monthlyInsuranceCents");
  if (!Number.isFinite(occupancyPct) || occupancyPct < 0 || occupancyPct > 100) {
    throw new InvestmentInputError("invalid_occupancy", "occupancyPct");
  }
  if (totalAcquisitionCents !== undefined) money(totalAcquisitionCents, "totalAcquisitionCents");
  const effectiveRentCents = amount(Math.round(monthlyRentCents * (occupancyPct / 100)), "effectiveRentCents");
  const operatingSurplusCents = amount(effectiveRentCents - monthlyOwnerCostsCents, "operatingSurplusCents");
  const afterDebtCents = amount(operatingSurplusCents - monthlyDebtCents, "cashflowCents");
  const cashflowCents = amount(afterDebtCents - monthlyInsuranceCents, "cashflowCents");
  return {
    effectiveRentCents,
    operatingSurplusCents,
    cashflowCents,
    netYieldPct: totalAcquisitionCents ? (operatingSurplusCents / totalAcquisitionCents) * 1_200 : null,
  };
}

export interface NextPurchaseInput {
  priceCents: Cents;
  loanCents: Cents;
  feesCents: Cents;
  worksCents: Cents;
  reserveCents: Cents;
  /** Available cash excluding tenant deposits and other restricted funds. */
  availableCashCents: Cents;
  /** Saving after existing commitments. A zero or negative saving is allowed. */
  monthlySavingCents: Cents;
}

/** A cash-target date only; no income underwriting, price growth or bank approval. */
export function nextPurchase(input: NextPurchaseInput): {
  targetCents: Cents;
  gapCents: Cents;
  months: number | null;
} {
  const { priceCents, loanCents, feesCents, worksCents, reserveCents, availableCashCents, monthlySavingCents } = input;
  for (const [field, value] of Object.entries({ priceCents, loanCents, feesCents, worksCents, reserveCents, availableCashCents })) {
    money(value, field);
  }
  money(monthlySavingCents, "monthlySavingCents", true);
  const priceAndFees = amount(priceCents + feesCents, "projectCostCents");
  const projectCostCents = amount(priceAndFees + worksCents, "projectCostCents");
  if (loanCents > projectCostCents) throw new InvestmentInputError("loan_exceeds_cost", "loanCents");
  const targetCents = amount(projectCostCents - loanCents + reserveCents, "targetCents");
  const gapCents = Math.max(0, targetCents - availableCashCents);
  return { targetCents, gapCents, months: gapCents === 0 ? 0 : monthlySavingCents > 0 ? Math.ceil(gapCents / monthlySavingCents) : null };
}
