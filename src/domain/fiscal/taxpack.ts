/**
 * Year-end tax pack — the modèle 190/210 dataset builder (fiscal brief §1.5/§1.6).
 *
 * Per property, per owner, per tax year the engine produces exactly the data
 * the 4-page ACD form wants:
 *   p.2  months let, gross rents by category, retained deposits
 *   §A   maintenance/repairs deductible in year
 *   §B1  spreading of large current-year repairs (> 50% of annual rent → 2–5 yrs)
 *   §B2  prior-year spread instalments landing this year
 *   §C   amortissement (rate, base, amount)
 *   §D   other frais d'obtention
 *   §E   debt interest (no cap)
 *   §F   impôt foncier, management fees, permanent charges
 *   plus the 35%/€2,700 flat-deduction comparison (age ≥ 15 years gate).
 *
 * Non-residents: no withholding — declaration-based; the pack additionally
 * exports a raw gross-rent/expense/interest view usable for the Belgian
 * cadre III, French 2047+2044 and German Anlage V — with Luxembourg-only
 * depreciation reported separately so it is never wrongly carried into the
 * residence-state return.
 */

import { Cents, pct } from "@/domain/money";
import { ISODate } from "@/domain/dates";
import { getParamValue } from "@/domain/legal/params";
import { YearAmortisation } from "@/domain/fiscal/amortisation";

export type ExpenseBucket =
  | "maintenance_repairs" // §A
  | "other_frais" // §D
  | "debt_interest" // §E — bank certificate required
  | "impot_foncier" // §F
  | "management_fees" // §F
  | "insurance" // §F
  | "permanent_charges"; // §F — communal charges not recharged

export interface ExpenseEntry {
  date: ISODate;
  bucket: ExpenseBucket;
  label: string;
  amount: Cents;
  /** Recharged to tenant → NOT deductible for the owner. */
  rechargedToTenant: boolean;
  documentRef?: string;
}

export interface RentReceipt {
  period: string; // YYYY-MM
  category: "dwelling" | "garage_parking" | "furniture_supplement" | "retained_deposit" | "tenant_recharge";
  amount: Cents;
}

export interface RepairSpreadCarry {
  originYear: number;
  totalAmount: Cents;
  spreadYears: number;
  /** Instalments already deducted in prior years. */
  instalmentsTaken: number;
}

export interface TaxPackInput {
  taxYear: number;
  propertyLabel: string;
  cadastralRef: string;
  buildingCompletedOn: ISODate;
  monthsLet: number;
  vacancyMonths: number;
  receipts: RentReceipt[];
  expenses: ExpenseEntry[];
  /** Chosen spread (years) for this year's large repairs, if elected. */
  electedSpreadYears: number | null;
  priorSpreads: RepairSpreadCarry[];
  amortisation: YearAmortisation | null;
  ownerShare: number; // 0–1 through the ownership graph
  ownerResidency: "resident" | "non_resident";
  /** Let through an approved gestion locative sociale body. */
  socialRentalManagement: boolean;
}

export interface FlatDeductionComparison {
  eligible: boolean;
  ineligibleReason: string | null;
  /** Years between the building's completion and the tax year, and the minimum the forfait asks. */
  buildingAge: number;
  minAge: number;
  flatAmount: Cents;
  /** What the flat deduction replaces (maintenance, other frais, amortisation…). */
  itemisedReplaceable: Cents;
  /** Always separately deductible on top of the flat: interest, impôt foncier, mgmt, permanent. */
  alwaysDeductible: Cents;
  recommendation: "itemise" | "flat";
  savings: Cents;
}

/** A line the engine names itself: the screens translate from the code, never from the label. */
export type LineCode = "building" | "energy" | "spread" | "impot_foncier" | "management_fees" | "insurance" | "permanent_charges";

export interface Model190Line {
  label: string;
  amount: Cents;
  /** Absent on a line that carries the taxpayer's own wording (an expense as entered). */
  code?: LineCode;
  vars?: Record<string, number>;
}

export interface Model190Section {
  code: string;
  label: string;
  amount: Cents;
  lines: Model190Line[];
}

export type TaxWarningCode = "spread_clamped" | "large_repairs_spreadable" | "interest_certificate";

export interface TaxWarning {
  code: TaxWarningCode;
  vars: Record<string, number>;
}

export interface TaxPack {
  taxYear: number;
  propertyLabel: string;
  cadastralRef: string;
  grossRents: {
    dwelling: Cents;
    garageParking: Cents;
    furnitureSupplement: Cents;
    retainedDeposits: Cents;
    tenantRecharges: Cents;
    totalTaxable: Cents;
  };
  monthsLet: number;
  vacancyMonths: number;
  sections: Model190Section[];
  largeRepairs: {
    threshold: Cents;
    currentYearRepairs: Cents;
    triggered: boolean;
    electedSpreadYears: number | null;
    deductedThisYear: Cents;
    carryForward: Cents;
    priorInstalments: Cents;
  };
  flatComparison: FlatDeductionComparison;
  /** The deductions retained (the forfait or the itemised frais, plus what is always deductible). */
  deductionsTotal: Cents;
  netResult: Cents;
  socialExemptionApplied: Cents;
  ownerShareNet: Cents;
  nonResidentExport: {
    note: string;
    noteCode: "non_resident_assessment";
    grossRents: Cents;
    deductibleExpensesExclAmort: Cents;
    debtInterest: Cents;
    luxembourgOnlyAmortisation: Cents;
  } | null;
  warnings: string[];
  /** The same warnings as stable codes, for the screens and the pack. */
  warningCodes: TaxWarning[];
}

export function buildTaxPack(input: TaxPackInput): TaxPack {
  const jan1 = `${input.taxYear}-01-01` as ISODate;
  const warnings: string[] = [];
  const warningCodes: TaxWarning[] = [];

  const sum = (cat: RentReceipt["category"]) =>
    input.receipts.filter((r) => r.category === cat).reduce((a, r) => a + r.amount, 0);

  const dwelling = sum("dwelling");
  const garageParking = sum("garage_parking");
  const furnitureSupplement = sum("furniture_supplement");
  const retainedDeposits = sum("retained_deposit");
  const tenantRecharges = sum("tenant_recharge");
  // Recharges pass through: taxable only to the extent the owner deducts the
  // underlying charge — the form nets them; we keep them visible but exclude
  // from taxable rent and exclude recharged expenses symmetrically.
  const totalTaxable = dwelling + garageParking + furnitureSupplement + retainedDeposits;

  const deductible = (bucket: ExpenseBucket) =>
    input.expenses
      .filter((e) => e.bucket === bucket && !e.rechargedToTenant)
      .reduce((a, e) => a + e.amount, 0);

  const maintenanceTotal = deductible("maintenance_repairs");
  const otherFrais = deductible("other_frais");
  const debtInterest = deductible("debt_interest");
  const impotFoncier = deductible("impot_foncier");
  const managementFees = deductible("management_fees");
  const insurance = deductible("insurance");
  const permanentCharges = deductible("permanent_charges");

  // §B1 — large repairs spreading: current-year repairs > 50% of annual rent
  // may be spread over 2–5 years.
  const thresholdPct = getParamValue("tax.large_repairs_threshold_pct_of_annual_rent", jan1);
  const threshold = pct(totalTaxable, thresholdPct);
  const triggered = maintenanceTotal > threshold && totalTaxable > 0;
  let deductedThisYear = maintenanceTotal;
  let carryForward = 0;
  let electedSpreadYears: number | null = null;
  if (triggered && input.electedSpreadYears) {
    const minY = getParamValue("tax.large_repairs_spread_min_years", jan1);
    const maxY = getParamValue("tax.large_repairs_spread_max_years", jan1);
    electedSpreadYears = Math.min(Math.max(input.electedSpreadYears, minY), maxY);
    if (electedSpreadYears !== input.electedSpreadYears) {
      warnings.push(`Spread election clamped to the legal ${minY}–${maxY} year range.`);
      warningCodes.push({ code: "spread_clamped", vars: { min: minY, max: maxY } });
    }
    deductedThisYear = Math.round(maintenanceTotal / electedSpreadYears);
    carryForward = maintenanceTotal - deductedThisYear;
  } else if (triggered) {
    warnings.push(
      `Repairs (${(maintenanceTotal / 100).toFixed(0)} €) exceed ${thresholdPct}% of annual rent — the 2–5 year spreading election (form §B1) is available.`,
    );
    warningCodes.push({ code: "large_repairs_spreadable", vars: { amount: maintenanceTotal, pct: thresholdPct } });
  }

  // §B2 — instalments from prior-year spreads landing this year.
  let priorInstalments = 0;
  for (const c of input.priorSpreads) {
    const perYear = Math.round(c.totalAmount / c.spreadYears);
    const yearsElapsed = input.taxYear - c.originYear;
    if (yearsElapsed >= 1 && yearsElapsed < c.spreadYears) {
      priorInstalments += perYear;
    }
  }

  const amortAmount = input.amortisation?.totalAmount ?? 0;

  const sections: Model190Section[] = [
    {
      code: "A",
      label: "Frais d'entretien et de réparation (déductibles l'année)",
      amount: deductedThisYear,
      lines: input.expenses
        .filter((e) => e.bucket === "maintenance_repairs" && !e.rechargedToTenant)
        .map((e) => ({ label: e.label, amount: e.amount })),
    },
    {
      code: "B2",
      label: "Tranches des grosses réparations étalées (années antérieures)",
      amount: priorInstalments,
      lines: input.priorSpreads.map((c) => ({
        label: `Étalement ${c.originYear} (${c.spreadYears} ans)`,
        amount: Math.round(c.totalAmount / c.spreadYears),
        code: "spread" as const,
        vars: { year: c.originYear, years: c.spreadYears },
      })),
    },
    {
      code: "C",
      label: "Amortissement",
      amount: amortAmount,
      lines: input.amortisation
        ? [
            {
              label: `${input.amortisation.regime.ratePct}% — ${input.amortisation.regime.note}`,
              amount: input.amortisation.buildingAmount,
              code: "building" as const,
              vars: { rate: input.amortisation.regime.ratePct },
            },
            ...(input.amortisation.energy.applicable || input.amortisation.energy.amount > 0
              ? [{ label: input.amortisation.energy.note, amount: input.amortisation.energy.amount, code: "energy" as const, vars: { rate: input.amortisation.energy.ratePct } }]
              : []),
          ]
        : [],
    },
    { code: "D", label: "Autres frais d'obtention", amount: otherFrais, lines: [] },
    { code: "E", label: "Intérêts débiteurs (certificat bancaire)", amount: debtInterest, lines: [] },
    {
      code: "F",
      label: "Impôt foncier, frais de gérance, charges permanentes, assurances",
      amount: impotFoncier + managementFees + insurance + permanentCharges,
      lines: [
        { label: "Impôt foncier", amount: impotFoncier, code: "impot_foncier" as const },
        { label: "Frais de gérance", amount: managementFees, code: "management_fees" as const },
        { label: "Assurances", amount: insurance, code: "insurance" as const },
        { label: "Charges permanentes non refacturées", amount: permanentCharges, code: "permanent_charges" as const },
      ],
    },
  ];

  // Flat deduction: 35% of gross rent capped €2,700/building — replaces
  // maintenance, other frais and amortisation; NOT interest, impôt foncier,
  // management fees, communal charges.
  const minAge = getParamValue("tax.flat_deduction_min_building_age_years", jan1);
  const buildingAge = input.taxYear - Number(input.buildingCompletedOn.slice(0, 4));
  const flatEligible = buildingAge >= minAge;
  const flatRaw = pct(totalTaxable, getParamValue("tax.flat_deduction_pct_of_gross_rent", jan1));
  const flatCap = getParamValue("tax.flat_deduction_cap_eur", jan1) * 100;
  const flatAmount = flatEligible ? Math.min(flatRaw, flatCap) : 0;
  // The forfait replaces maintenance, other frais, insurance and amortisation.
  // Communal charges join interest, impôt foncier and management fees as
  // ALWAYS separately deductible on top (brief §1.3).
  const itemisedReplaceable = deductedThisYear + priorInstalments + otherFrais + amortAmount + insurance;
  const alwaysDeductible = debtInterest + impotFoncier + managementFees + permanentCharges;
  const recommendation: FlatDeductionComparison["recommendation"] =
    flatEligible && flatAmount > itemisedReplaceable ? "flat" : "itemise";
  const flatComparison: FlatDeductionComparison = {
    eligible: flatEligible,
    ineligibleReason: flatEligible
      ? null
      : `Building completed ${buildingAge} year(s) before the tax year — the flat deduction requires ≥ ${minAge} years.`,
    buildingAge,
    minAge,
    flatAmount,
    itemisedReplaceable,
    alwaysDeductible,
    recommendation,
    savings: Math.abs(flatAmount - itemisedReplaceable),
  };

  const chosenDeductions =
    recommendation === "flat" ? flatAmount + alwaysDeductible : itemisedReplaceable + alwaysDeductible;
  let netResult = totalTaxable - chosenDeductions;

  // Gestion locative sociale: 90% of net income exempt (since 2024).
  let socialExemptionApplied = 0;
  if (input.socialRentalManagement && netResult > 0) {
    socialExemptionApplied = pct(netResult, getParamValue("tax.social_rental_exemption_pct", jan1));
    netResult -= socialExemptionApplied;
  }

  if (debtInterest > 0) {
    warnings.push("Debt interest deducted — attach the bank certificat d'intérêts to the return.");
    warningCodes.push({ code: "interest_certificate", vars: { amount: debtInterest } });
  }

  const nonResidentExport =
    input.ownerResidency === "non_resident"
      ? {
          note:
            "No Luxembourg withholding on rent — taxation by assessment (modèle 100, due 31.12 of year N+1). " +
            "Residence state relieves by exemption-with-progression (BE, DE) or Luxembourg-tax credit (FR, 2018 treaty). " +
            "Luxembourg amortisation is reported separately: do NOT carry it into the residence-state return.",
          noteCode: "non_resident_assessment" as const,
          grossRents: totalTaxable,
          deductibleExpensesExclAmort:
            deductedThisYear + priorInstalments + otherFrais + insurance + permanentCharges + impotFoncier + managementFees,
          debtInterest,
          luxembourgOnlyAmortisation: amortAmount,
        }
      : null;

  return {
    taxYear: input.taxYear,
    propertyLabel: input.propertyLabel,
    cadastralRef: input.cadastralRef,
    grossRents: {
      dwelling,
      garageParking,
      furnitureSupplement,
      retainedDeposits,
      tenantRecharges,
      totalTaxable,
    },
    monthsLet: input.monthsLet,
    vacancyMonths: input.vacancyMonths,
    sections,
    largeRepairs: {
      threshold,
      currentYearRepairs: maintenanceTotal,
      triggered,
      electedSpreadYears,
      deductedThisYear: triggered && electedSpreadYears ? deductedThisYear : maintenanceTotal,
      carryForward,
      priorInstalments,
    },
    flatComparison,
    deductionsTotal: chosenDeductions,
    netResult,
    socialExemptionApplied,
    ownerShareNet: Math.round(netResult * input.ownerShare),
    nonResidentExport,
    warnings,
    warningCodes,
  };
}

// ─── The owner's year, and what to attach ───────────────────────────────────

/** One owner's exercise over every property let: the figures the screen leads with. */
export interface OwnerYearSummary {
  properties: number;
  grossRents: Cents;
  deductions: Cents;
  /** The §C amounts, whether the forfait replaced them or not. */
  amortisation: Cents;
  socialExemption: Cents;
  netResult: Cents;
  ownerShareNet: Cents;
}

export function ownerYearSummary(packs: readonly TaxPack[]): OwnerYearSummary {
  const sum = (pick: (p: TaxPack) => Cents) => packs.reduce((a, p) => a + pick(p), 0);
  return {
    properties: packs.length,
    grossRents: sum((p) => p.grossRents.totalTaxable),
    deductions: sum((p) => p.deductionsTotal),
    amortisation: sum((p) => p.sections.find((s) => s.code === "C")?.amount ?? 0),
    socialExemption: sum((p) => p.socialExemptionApplied),
    netResult: sum((p) => p.netResult),
    ownerShareNet: sum((p) => p.ownerShareNet),
  };
}

export type AttachmentCode =
  | "rent_ledger"
  | "repair_invoices"
  | "interest_certificate"
  | "impot_foncier_bulletin"
  | "management_fee_statement"
  | "insurance_notice"
  | "klimabonus_decision"
  | "deed_and_costs";

export interface Attachment {
  code: AttachmentCode;
  /** Who holds the piece: the cabinet (it produced or received it) or the owner. */
  providedBy: "cabinet" | "owner";
  /** The register class a matching piece would carry, when one can be looked for. */
  documentClass: string | null;
  amount: Cents | null;
}

/**
 * The pieces the return needs for one property, from what the pack
 * deducts: a certificate for every interest deducted, the bulletin for the
 * impôt foncier, the invoices behind the repairs, the Klimabonus decision
 * behind an energy rate, the deed behind every amortisation, and the two
 * the cabinet always produces (the rent ledger, its own fee statement).
 */
export function attachmentsFor(pack: TaxPack, amortisation: YearAmortisation | null): Attachment[] {
  const section = (code: string) => pack.sections.find((s) => s.code === code);
  const line = (code: string, lineCode: LineCode) => section(code)?.lines.find((l) => l.code === lineCode)?.amount ?? 0;
  const out: Attachment[] = [{ code: "rent_ledger", providedBy: "cabinet", documentClass: null, amount: pack.grossRents.totalTaxable }];
  const repairs = (section("A")?.amount ?? 0) + (section("B2")?.amount ?? 0);
  if (repairs > 0) out.push({ code: "repair_invoices", providedBy: "cabinet", documentClass: "invoice", amount: repairs });
  const interest = section("E")?.amount ?? 0;
  if (interest > 0) out.push({ code: "interest_certificate", providedBy: "owner", documentClass: "tax", amount: interest });
  const impot = line("F", "impot_foncier");
  if (impot > 0) out.push({ code: "impot_foncier_bulletin", providedBy: "owner", documentClass: "tax", amount: impot });
  const fees = line("F", "management_fees");
  if (fees > 0) out.push({ code: "management_fee_statement", providedBy: "cabinet", documentClass: null, amount: fees });
  const insurance = line("F", "insurance");
  if (insurance > 0) out.push({ code: "insurance_notice", providedBy: "owner", documentClass: "insurance", amount: insurance });
  if (amortisation?.energy.applicable) out.push({ code: "klimabonus_decision", providedBy: "owner", documentClass: "subsidy", amount: amortisation.energy.amount });
  if (amortisation) out.push({ code: "deed_and_costs", providedBy: "owner", documentClass: "deed", amount: null });
  return out;
}
