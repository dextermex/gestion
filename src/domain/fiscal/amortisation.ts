/**
 * Amortisation engine — Art. 106(3)(4) LIR, RGD 19.11.1999 (as amended),
 * circulaires L.I.R. n° 106/2 and 129e/1.
 *
 * Regimes (fiscal brief §1.4):
 *  • 2%  normal — building completed ≥ 5 years ago, indefinite.
 *  • 4%  accelerated — acquired/completed from 1.1.2021, until 5 years after
 *        completion, MAX 2 BUILDINGS per taxpayer (enforced at taxpayer level
 *        across all vehicles — the ownership graph resolves through to natural
 *        persons).
 *  • 6%  grandfathered — pre-2021 acquisition, completion < 6 years;
 *        transitional, exhausted after tax year 2026.
 *  • 6%  VEFA-2024 — dwelling built for letting, notarial deed 2024 (extended
 *        to 30.06.2025), 6 years, base capped €250,000/year.
 *  • 6% → 10% energy renovation — works < 9 years, Klimabonus received;
 *        10% from tax year 2026; reverts to 2% after the 9-year window.
 *
 * Base: acquisition price EXCLUDING land (20% default when unknown) + deed
 * costs + capitalised investment − Klimabonus subsidies (for energy works).
 *
 * Abattement immobilier spécial: 1% of the base actually amortised at 4%,
 * capped €10,000 per taxpayer per year (€20,000 jointly taxed).
 */

import { Cents, pct, roundCents } from "@/domain/money";
import { ISODate } from "@/domain/dates";
import { LegalParamError, getParamValue } from "@/domain/legal/params";

export type AmortRegime =
  | "normal_2"
  | "accelerated_4"
  | "grandfathered_6"
  | "vefa2024_6"
  | "energy_renovation";

export interface AcquisitionFacts {
  /** Notarial deed date. */
  acquiredOn: ISODate;
  /** Building completion date (achèvement). */
  completedOn: ISODate;
  /** Total acquisition price incl. land, excl. VAT. */
  totalPrice: Cents;
  /** Known land price; null → 20% rule applies. */
  landPrice: Cents | null;
  /** VAT borne (residential letting: not recoverable → capitalised). */
  vatPaid: Cents;
  /** Notary + deed costs. */
  deedCosts: Cents;
  /** Capitalised investment expenditure (non-energy). */
  investments: Cents;
  /** Energy-renovation works: eligible cost and subsidy. */
  energyWorksCost: Cents;
  energyWorksCompletedOn: ISODate | null;
  klimabonusReceived: Cents;
  /** Dwelling built for letting acquired by notarial deed (VEFA 2024 package). */
  vefa2024Eligible: boolean;
}

export interface DepreciationBase {
  base: Cents;
  landShare: Cents;
  landRule: "actual" | "default_20pct";
  energyBase: Cents;
}

/**
 * Depreciation base per form 190/210: price excl. land + deed costs + VAT +
 * investments. Land unknown → land = 20% of (total price + deed costs).
 * Energy base = eligible works − Klimabonus (computed separately: its own
 * rate and window).
 */
export function computeDepreciationBase(facts: AcquisitionFacts, onDate: ISODate): DepreciationBase {
  const grossWithCosts = facts.totalPrice + facts.deedCosts;
  let landShare: Cents;
  let landRule: DepreciationBase["landRule"];
  if (facts.landPrice !== null) {
    landShare = facts.landPrice;
    landRule = "actual";
  } else {
    landShare = pct(grossWithCosts, getParamValue("amort.land_default_share_pct", onDate));
    landRule = "default_20pct";
  }
  const base =
    facts.totalPrice + facts.deedCosts + facts.vatPaid + facts.investments - landShare;
  const energyBase = Math.max(0, facts.energyWorksCost - facts.klimabonusReceived);
  return { base: Math.max(0, base), landShare, landRule, energyBase };
}

export type RegimeReason =
  | "normal"
  | "accelerated"
  | "slots_exhausted"
  | "grandfathered"
  | "vefa2024";

export interface RegimeResolution {
  regime: AmortRegime;
  ratePct: number;
  /** Whether this regime consumes a slot under the max-2-buildings rule. */
  consumesAcceleratedSlot: boolean;
  cappedBase: Cents;
  /** Stable code — the UI translates from this, never from `note`. */
  reason: RegimeReason;
  /** English internal note for logs/audit; not user-facing. */
  note: string;
}

/**
 * Resolve the applicable regime for one property and one tax year.
 * `acceleratedSlotsUsed` counts OTHER buildings of the same taxpayer already
 * amortising at 4% this year (the max-2 rule bites at taxpayer level).
 */
export function resolveRegime(
  facts: AcquisitionFacts,
  base: DepreciationBase,
  taxYear: number,
  acceleratedSlotsUsed: number,
): RegimeResolution {
  const jan1 = `${taxYear}-01-01` as ISODate;
  const completionYear = Number(facts.completedOn.slice(0, 4));
  const yearsSinceCompletion = taxYear - completionYear;

  // VEFA-2024 package: 6% for 6 years on a base capped €250,000/year.
  if (facts.vefa2024Eligible) {
    const duration = getParamValue("amort.vefa2024_duration_years", jan1);
    const deedYear = Number(facts.acquiredOn.slice(0, 4));
    if (taxYear < deedYear + duration) {
      const capEuros = getParamValue("amort.vefa2024_base_cap_eur_per_year", jan1);
      return {
        regime: "vefa2024_6",
        ratePct: getParamValue("amort.rate_vefa2024_pct", jan1),
        consumesAcceleratedSlot: false,
        cappedBase: Math.min(base.base, capEuros * 100),
        reason: "vefa2024",
        note: `2024 housing package — 6%/6 yrs, base capped €${capEuros.toLocaleString("en")}/yr. Closed cohort (deeds to 30.06.2025); keeps computing at 6% through ${deedYear + duration - 1}.`,
      };
    }
  }

  // Grandfathered 6%: acquired before 1.1.2021, completion < 6 years ago.
  // Rates/window/expiry come from the registry: the param's effective range
  // (open until 2027-01-01) IS the transitional cutoff — a legislative
  // extension is a data change, never a release.
  if (facts.acquiredOn < "2021-01-01") {
    try {
      const gRate = getParamValue("amort.rate_grandfathered_pct", jan1);
      const gWindow = getParamValue("amort.grandfathered_window_years", jan1);
      if (yearsSinceCompletion < gWindow) {
        return {
          regime: "grandfathered_6",
          ratePct: gRate,
          consumesAcceleratedSlot: false,
          cappedBase: base.base,
          reason: "grandfathered",
          note: "Transitional pre-2021 regime — exhausted after tax year 2026.",
        };
      }
    } catch (e) {
      if (!(e instanceof LegalParamError)) throw e;
      // Param no longer in force for this tax year → regime expired.
    }
  }

  // Accelerated 4%: acquired/completed from 1.1.2021, < 5 years since completion.
  if (facts.acquiredOn >= "2021-01-01") {
    const windowYears = getParamValue("amort.accelerated_window_years", jan1);
    const maxBuildings = getParamValue("amort.accelerated_max_buildings_per_taxpayer", jan1);
    if (yearsSinceCompletion < windowYears) {
      if (acceleratedSlotsUsed < maxBuildings) {
        return {
          regime: "accelerated_4",
          ratePct: getParamValue("amort.rate_accelerated_pct", jan1),
          consumesAcceleratedSlot: true,
          cappedBase: base.base,
          reason: "accelerated",
          note: `Accelerated 4% (slot ${acceleratedSlotsUsed + 1}/${maxBuildings} for this taxpayer).`,
        };
      }
      return {
        regime: "normal_2",
        ratePct: getParamValue("amort.rate_normal_pct", jan1),
        consumesAcceleratedSlot: false,
        cappedBase: base.base,
        reason: "slots_exhausted",
        note: `Eligible for 4% but the taxpayer's ${maxBuildings}-building limit is exhausted — falls back to 2%.`,
      };
    }
  }

  return {
    regime: "normal_2",
    ratePct: getParamValue("amort.rate_normal_pct", jan1),
    consumesAcceleratedSlot: false,
    cappedBase: base.base,
    reason: "normal",
    note: "Normal 2% — building completed ≥ 5 years ago.",
  };
}

export type EnergyReason = "ok" | "no_klimabonus" | "window_closed" | "none";

export interface EnergyAmortisation {
  applicable: boolean;
  ratePct: number;
  amount: Cents;
  yearsRemaining: number;
  /** Stable code — the UI translates from this, never from `note`. */
  reason: EnergyReason;
  note: string;
}

/**
 * Energy-renovation amortisation runs IN ADDITION on its own base:
 * 6% up to tax year 2025, 10% from 2026, for 9 years from works completion
 * (Klimabonus condition), then the works base reverts to 2%.
 */
export function computeEnergyAmortisation(
  facts: AcquisitionFacts,
  base: DepreciationBase,
  taxYear: number,
): EnergyAmortisation {
  if (!facts.energyWorksCompletedOn || base.energyBase <= 0 || facts.klimabonusReceived <= 0) {
    return {
      applicable: false,
      ratePct: 0,
      amount: 0,
      yearsRemaining: 0,
      reason: facts.energyWorksCost > 0 && facts.klimabonusReceived <= 0 ? "no_klimabonus" : "none",
      note: facts.energyWorksCost > 0 && facts.klimabonusReceived <= 0
        ? "Energy works present but no Klimabonus aid recorded — special rate requires the subsidy."
        : "No qualifying energy renovation.",
    };
  }
  const jan1 = `${taxYear}-01-01` as ISODate;
  const worksYear = Number(facts.energyWorksCompletedOn.slice(0, 4));
  const windowYears = getParamValue("amort.energy_window_years", jan1);
  const yearsSince = taxYear - worksYear;
  if (yearsSince < 0 || yearsSince >= windowYears) {
    return {
      applicable: false,
      ratePct: getParamValue("amort.rate_normal_pct", jan1),
      amount: pct(base.energyBase, getParamValue("amort.rate_normal_pct", jan1)),
      yearsRemaining: 0,
      reason: "window_closed",
      note: "9-year energy window closed — works base reverts to 2%.",
    };
  }
  const rate = getParamValue("amort.rate_energy_pct", jan1);
  return {
    applicable: true,
    ratePct: rate,
    amount: pct(base.energyBase, rate),
    yearsRemaining: windowYears - yearsSince,
    reason: "ok",
    note: `Energy renovation at ${rate}% (Klimabonus deducted from base); ${windowYears - yearsSince} year(s) left in the window.`,
  };
}

export interface YearAmortisation {
  taxYear: number;
  regime: RegimeResolution;
  buildingAmount: Cents;
  energy: EnergyAmortisation;
  totalAmount: Cents;
  /** Abattement immobilier spécial — only when the 4% rate applies. */
  abattementSpecial: Cents;
}

/**
 * One property, one tax year. `abattementAlreadyUsed` is the taxpayer-level
 * abattement consumed by other properties this year (cap €10,000/taxpayer,
 * doubled for jointly-taxed couples).
 */
export function computeYearAmortisation(
  facts: AcquisitionFacts,
  taxYear: number,
  opts: {
    acceleratedSlotsUsed: number;
    abattementAlreadyUsed: Cents;
    jointlyTaxed: boolean;
  },
): YearAmortisation {
  const jan1 = `${taxYear}-01-01` as ISODate;
  const base = computeDepreciationBase(facts, jan1);
  const regime = resolveRegime(facts, base, taxYear, opts.acceleratedSlotsUsed);
  const buildingAmount = pct(regime.cappedBase, regime.ratePct);
  const energy = computeEnergyAmortisation(facts, base, taxYear);

  let abattementSpecial = 0;
  if (regime.regime === "accelerated_4") {
    const capEuros = getParamValue("amort.abattement_special_cap_eur_per_taxpayer", jan1);
    const cap = capEuros * 100 * (opts.jointlyTaxed ? 2 : 1);
    const raw = pct(regime.cappedBase, getParamValue("amort.abattement_special_pct_of_4pct_base", jan1));
    abattementSpecial = Math.max(0, Math.min(raw, cap - opts.abattementAlreadyUsed));
  }

  return {
    taxYear,
    regime,
    buildingAmount,
    energy,
    totalAmount: buildingAmount + energy.amount,
    abattementSpecial,
  };
}

export interface TaxpayerProperty {
  propertyId: string;
  label: string;
  facts: AcquisitionFacts;
  /** Taxpayer's share of this property (through the ownership graph), 0–1. */
  ownershipShare: number;
}

export interface TaxpayerAmortisationPlan {
  taxYear: number;
  rows: Array<{
    propertyId: string;
    label: string;
    result: YearAmortisation;
    taxpayerShareAmount: Cents;
  }>;
  acceleratedSlotsUsed: number;
  slotWaitlist: string[];
  totalAbattement: Cents;
  totalAmortisation: Cents;
}

/**
 * Taxpayer-level plan across the whole portfolio: allocates the two 4% slots
 * to the HIGHEST-base eligible buildings (the taxpayer-optimal assignment) and
 * accumulates the abattement against the shared cap. This is the cross-
 * portfolio counter the strategy calls out — it can only live at taxpayer
 * level, never per property.
 */
export function planTaxpayerYear(
  properties: TaxpayerProperty[],
  taxYear: number,
  opts: { jointlyTaxed: boolean },
): TaxpayerAmortisationPlan {
  const jan1 = `${taxYear}-01-01` as ISODate;
  const maxSlots = getParamValue("amort.accelerated_max_buildings_per_taxpayer", jan1);

  // Which properties WANT a 4% slot this year? Rank by base descending.
  const wantsSlot = properties
    .map((p) => {
      const base = computeDepreciationBase(p.facts, jan1);
      const trial = resolveRegime(p.facts, base, taxYear, 0);
      return { p, base, eligible: trial.regime === "accelerated_4" };
    })
    .filter((x) => x.eligible)
    .sort((a, b) => b.base.base - a.base.base);

  const slotted = new Set(wantsSlot.slice(0, maxSlots).map((x) => x.p.propertyId));
  const waitlist = wantsSlot.slice(maxSlots).map((x) => x.p.propertyId);

  let abattementUsed = 0;
  let slotsUsed = 0;
  const rows = properties.map((p) => {
    const hasSlot = slotted.has(p.propertyId);
    const result = computeYearAmortisation(p.facts, taxYear, {
      // A property holding a slot sees slotsUsed<max; one without sees the cap.
      acceleratedSlotsUsed: hasSlot ? slotsUsed : maxSlots,
      abattementAlreadyUsed: abattementUsed,
      jointlyTaxed: opts.jointlyTaxed,
    });
    if (result.regime.consumesAcceleratedSlot) slotsUsed += 1;
    abattementUsed += result.abattementSpecial;
    return {
      propertyId: p.propertyId,
      label: p.label,
      result,
      taxpayerShareAmount: roundCents(result.totalAmount * p.ownershipShare),
    };
  });

  return {
    taxYear,
    rows,
    acceleratedSlotsUsed: slotsUsed,
    slotWaitlist: waitlist,
    totalAbattement: abattementUsed,
    totalAmortisation: rows.reduce((a, r) => a + r.taxpayerShareAmount, 0),
  };
}
