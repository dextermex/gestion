/**
 * Indexation & rent-adjustment engine.
 *
 * Residential (loi 21.9.2006, rev. 2024):
 *   • Annual rent ceiling = 5% of the REVALUED capital investi.
 *   • Revaluation coefficients come from Ministry circulars — ingested data
 *     (Circulaire 3/25 is the source to obtain), never hard-coded.
 *   • Décote de vétusté: −2% per full 2-year period beyond 15 years on the
 *     construction component.
 *   • Adjustments: max one per 24 months, max +10% per step.
 *   • CPI escalation clauses are prohibited (enforced in lease rules).
 *
 * Commercial (loi 3.2.2018):
 *   • No statutory indexation; contractual clause on the STATEC IPC (NICP)
 *     only. No Luxembourg equivalent of the French ILC/ILAT.
 */

import { Cents, roundCents } from "@/domain/money";
import { ISODate, fullMonthsBetween, fullYearsBetween } from "@/domain/dates";
import { getParamValue } from "@/domain/legal/params";

// ─── Revaluation coefficients (ingested, versioned) ─────────────────────────

/**
 * Coefficient table keyed by year of expenditure. Seed values are ILLUSTRATIVE
 * (status "uncertain") — production ingests the current Ministry circular and
 * the UI shows the table's provenance. The engine only reads this table.
 */
export interface RevaluationTable {
  circularRef: string;
  status: "verified" | "uncertain";
  coefficients: Record<number, number>;
}

export const SEED_REVALUATION_TABLE: RevaluationTable = {
  circularRef: "Circulaire ministérielle 3/25 — TO INGEST (seed values are placeholders)",
  status: "uncertain",
  coefficients: {
    1990: 1.72, 1995: 1.55, 2000: 1.41, 2005: 1.28, 2010: 1.17,
    2015: 1.1, 2018: 1.07, 2020: 1.05, 2021: 1.04, 2022: 1.02,
    2023: 1.01, 2024: 1.0, 2025: 1.0, 2026: 1.0,
  },
};

function coefficientFor(table: RevaluationTable, year: number): number {
  if (table.coefficients[year] !== undefined) return table.coefficients[year];
  const years = Object.keys(table.coefficients).map(Number).sort((a, b) => a - b);
  // Clamp outside the table, interpolate on gaps inside it.
  if (year <= years[0]) return table.coefficients[years[0]];
  if (year >= years[years.length - 1]) return table.coefficients[years[years.length - 1]];
  let lower = years[0];
  let upper = years[years.length - 1];
  for (const y of years) {
    if (y <= year) lower = y;
    if (y >= year) { upper = y; break; }
  }
  if (lower === upper) return table.coefficients[lower];
  const t = (year - lower) / (upper - lower);
  return table.coefficients[lower] + t * (table.coefficients[upper] - table.coefficients[lower]);
}

// ─── Capital investi ────────────────────────────────────────────────────────

export interface CapitalComponent {
  /** Year the money was spent (acquisition or works). */
  year: number;
  amount: Cents;
  kind: "land" | "construction" | "improvement";
}

export interface CapitalInvestiResult {
  revaluedTotal: Cents;
  /** Ceiling = 5% p.a. of the revalued capital investi. */
  annualRentCeiling: Cents;
  monthlyRentCeiling: Cents;
  components: Array<{
    component: CapitalComponent;
    coefficient: number;
    revalued: Cents;
    vetusteApplied: number;
  }>;
  tableProvenance: { circularRef: string; status: "verified" | "uncertain" };
}

/**
 * Compute the revalued capital investi and the statutory rent ceiling.
 * Décote de vétusté applies to construction/improvement components only:
 * −2% per full 2-year period beyond 15 years of age.
 */
export function computeCapitalInvesti(
  components: CapitalComponent[],
  asOf: ISODate,
  table: RevaluationTable = SEED_REVALUATION_TABLE,
): CapitalInvestiResult {
  const asOfYear = Number(asOf.slice(0, 4));
  const vetustePctPer2y = getParamValue("residential.decote_vetuste_pct_per_2y_beyond_15y", asOf);
  const ceilingPct = getParamValue("residential.rent_ceiling_pct_of_capital", asOf);

  const detailed = components.map((component) => {
    const coefficient = coefficientFor(table, component.year);
    let revalued = roundCents(component.amount * coefficient);
    let vetusteApplied = 0;
    if (component.kind !== "land") {
      const age = asOfYear - component.year;
      if (age > 15) {
        const periods = Math.floor((age - 15) / 2);
        vetusteApplied = Math.min(periods * vetustePctPer2y, 100);
        revalued = roundCents(revalued * (1 - vetusteApplied / 100));
      }
    }
    return { component, coefficient, revalued, vetusteApplied };
  });

  const revaluedTotal = detailed.reduce((a, c) => a + c.revalued, 0);
  const annualRentCeiling = roundCents((revaluedTotal * ceilingPct) / 100);
  return {
    revaluedTotal,
    annualRentCeiling,
    monthlyRentCeiling: roundCents(annualRentCeiling / 12),
    components: detailed,
    tableProvenance: { circularRef: table.circularRef, status: table.status },
  };
}

// ─── Residential adjustment proposal ────────────────────────────────────────

export interface AdjustmentInput {
  currentMonthlyRent: Cents;
  lastAdjustmentDate: ISODate | null;
  leaseStartDate: ISODate;
  proposedDate: ISODate;
  capital: CapitalInvestiResult;
}

export interface AdjustmentProposal {
  allowed: boolean;
  blockedReason: string | null;
  /** Next date an adjustment becomes lawful (if currently blocked by the 24-month rule). */
  nextAllowedDate: ISODate | null;
  currentMonthlyRent: Cents;
  /** The proposed new rent after applying every cap. */
  proposedMonthlyRent: Cents;
  caps: {
    ceilingMonthly: Cents;
    stepCapMonthly: Cents;
    stepCapPct: number;
  };
  /** Which cap bound the result. */
  bindingConstraint: "ceiling" | "step_cap" | "none";
  computationSnapshot: string;
}

/**
 * Propose a lawful residential rent adjustment. The proposal is the MINIMUM of
 * (a) the 5%-of-capital ceiling and (b) current rent + 10% — and it is only
 * allowed 24 months after the previous adjustment (or lease start).
 */
export function proposeResidentialAdjustment(input: AdjustmentInput): AdjustmentProposal {
  const d = input.proposedDate;
  const minIntervalMonths = getParamValue("residential.rent_adjustment_min_interval_months", d);
  const stepCapPct = getParamValue("residential.rent_adjustment_max_step_pct", d);

  const anchor = input.lastAdjustmentDate ?? input.leaseStartDate;
  const monthsSince = fullMonthsBetween(anchor, d);
  const caps = {
    ceilingMonthly: input.capital.monthlyRentCeiling,
    stepCapMonthly: roundCents(input.currentMonthlyRent * (1 + stepCapPct / 100)),
    stepCapPct,
  };

  if (monthsSince < minIntervalMonths) {
    const nextAllowed = addMonthsLocal(anchor, minIntervalMonths);
    return {
      allowed: false,
      blockedReason: `Only ${monthsSince} months since the last adjustment — the law allows one adjustment per ${minIntervalMonths} months.`,
      nextAllowedDate: nextAllowed,
      currentMonthlyRent: input.currentMonthlyRent,
      proposedMonthlyRent: input.currentMonthlyRent,
      caps,
      bindingConstraint: "none",
      computationSnapshot: snapshot(input, caps, input.currentMonthlyRent),
    };
  }

  const target = Math.min(caps.ceilingMonthly, caps.stepCapMonthly);
  if (target <= input.currentMonthlyRent) {
    const atCeiling = input.currentMonthlyRent >= caps.ceilingMonthly;
    return {
      allowed: false,
      blockedReason: atCeiling
        ? "Current rent already at or above the 5% capital-investi ceiling."
        : "No lawful increase available.",
      nextAllowedDate: null,
      currentMonthlyRent: input.currentMonthlyRent,
      proposedMonthlyRent: input.currentMonthlyRent,
      caps,
      bindingConstraint: atCeiling ? "ceiling" : "none",
      computationSnapshot: snapshot(input, caps, input.currentMonthlyRent),
    };
  }

  return {
    allowed: true,
    blockedReason: null,
    nextAllowedDate: null,
    currentMonthlyRent: input.currentMonthlyRent,
    proposedMonthlyRent: target,
    caps,
    bindingConstraint: target === caps.ceilingMonthly ? "ceiling" : "step_cap",
    computationSnapshot: snapshot(input, caps, target),
  };
}

function snapshot(input: AdjustmentInput, caps: AdjustmentProposal["caps"], result: Cents): string {
  return [
    `capital revalued=${input.capital.revaluedTotal}`,
    `ceiling monthly=${caps.ceilingMonthly}`,
    `step cap=${caps.stepCapMonthly} (${caps.stepCapPct}%)`,
    `current=${input.currentMonthlyRent}`,
    `result=${result}`,
    `table=${input.capital.tableProvenance.circularRef}`,
  ].join(" | ");
}

// Local helper (kept here so the module reads standalone in review).
import { addMonths as addMonthsLocal } from "@/domain/dates";

// ─── Rent-ceiling validation at listing/lease time ──────────────────────────

export interface CeilingCheck {
  compliant: boolean;
  monthlyCeiling: Cents;
  excess: Cents;
  isColocationCombined: boolean;
}

/**
 * Validate a (proposed) rent against the 5% ceiling. For colocation the cap
 * applies to the COMBINED rents of all co-tenants.
 */
export function checkRentCeiling(
  proposedMonthlyRent: Cents,
  capital: CapitalInvestiResult,
  opts: { colocationCombinedRents?: Cents } = {},
): CeilingCheck {
  const effective = opts.colocationCombinedRents ?? proposedMonthlyRent;
  const excess = Math.max(0, effective - capital.monthlyRentCeiling);
  return {
    compliant: excess === 0,
    monthlyCeiling: capital.monthlyRentCeiling,
    excess,
    isColocationCombined: opts.colocationCombinedRents !== undefined,
  };
}

// ─── Commercial IPC indexation ──────────────────────────────────────────────

export interface IpcObservation {
  /** STATEC IPC (indice des prix à la consommation) monthly value. */
  month: string; // YYYY-MM
  value: number;
}

export interface CommercialIndexationInput {
  currentMonthlyRent: Cents;
  /** The lease's contractual clause: base index value and adjustment frequency. */
  baseIndexValue: number;
  minMonthsBetweenAdjustments: number;
  lastAdjustmentDate: ISODate | null;
  leaseStartDate: ISODate;
  proposedDate: ISODate;
  latestIndex: IpcObservation;
}

export interface CommercialIndexationResult {
  allowed: boolean;
  blockedReason: string | null;
  newMonthlyRent: Cents;
  indexRatio: number;
}

/**
 * Apply a contractual IPC clause: rent × (current index / base index).
 * Purely contractual — the engine refuses nothing except the lease's own
 * frequency clause; statute imposes no cap on commercial rent.
 */
export function applyCommercialIndexation(
  input: CommercialIndexationInput,
): CommercialIndexationResult {
  const anchor = input.lastAdjustmentDate ?? input.leaseStartDate;
  const monthsSince = fullMonthsBetween(anchor, input.proposedDate);
  if (monthsSince < input.minMonthsBetweenAdjustments) {
    return {
      allowed: false,
      blockedReason: `Contractual clause allows adjustment every ${input.minMonthsBetweenAdjustments} months; ${monthsSince} elapsed.`,
      newMonthlyRent: input.currentMonthlyRent,
      indexRatio: 1,
    };
  }
  const ratio = input.latestIndex.value / input.baseIndexValue;
  return {
    allowed: true,
    blockedReason: null,
    newMonthlyRent: roundCents(input.currentMonthlyRent * ratio),
    indexRatio: ratio,
  };
}

// ─── INDEXATION_LAG detection (payment-culture revenue recovery) ────────────

export interface IndexationLagHit {
  detected: true;
  shortfall: Cents;
  message: string;
}

/**
 * Detect the Luxembourg standing-order pattern: after a rent adjustment the
 * tenant's bank transfer still arrives at the PREVIOUS rent exactly. The
 * matcher auto-matches at the old amount, opens a shortfall receivable and
 * queues the pre-filled "update your standing order" letter.
 */
export function detectIndexationLag(
  receivedAmount: Cents,
  currentRent: Cents,
  previousRent: Cents | null,
): IndexationLagHit | null {
  if (previousRent === null) return null;
  if (receivedAmount === previousRent && previousRent < currentRent) {
    return {
      detected: true,
      shortfall: currentRent - previousRent,
      message:
        "Payment equals the pre-adjustment rent exactly — standing order not updated. Auto-matched at the old amount; shortfall opened.",
    };
  }
  return null;
}

/** Age of the building in years — used for the 15-year flat-deduction gate and vétusté. */
export function buildingAgeYears(completionDate: ISODate, asOf: ISODate): number {
  return fullYearsBetween(completionDate, asOf);
}
