import type { AttachmentCode, LineCode, Model190Line, TaxPack, TaxWarning } from "@/domain/fiscal/taxpack";
import type { AmortRegime } from "@/domain/fiscal/amortisation";
import { getParamValue } from "@/domain/legal/params";
import { euros } from "@/lib/types";
import { fmt, type Locale } from "@/lib/i18n/config";
import type { Dict } from "@/lib/i18n/fr";

/**
 * The words of the fiscal screens and files, from the engines' stable
 * codes: a section, a line the engine named, a regime, a piece to attach,
 * a warning. Said once here so the screen, the PDF and the CSV agree.
 */
export function sectionLabel(d: Dict, code: string): string {
  const map: Record<string, string> = { A: d.fiscalite.sectionA, B2: d.fiscalite.sectionB2, C: d.fiscalite.sectionC, D: d.fiscalite.sectionD, E: d.fiscalite.sectionE, F: d.fiscalite.sectionF };
  return map[code] ?? code;
}

export function lineLabel(d: Dict, line: Model190Line): string {
  if (!line.code) return line.label;
  const vars = line.vars ?? {};
  const map: Record<LineCode, string> = {
    building: fmt(d.fiscalite.lineBuilding, vars),
    energy: fmt(d.fiscalite.lineEnergy, vars),
    spread: fmt(d.fiscalite.lineSpread, vars),
    impot_foncier: d.fiscalite.lineImpotFoncier,
    management_fees: d.fiscalite.lineManagement,
    insurance: d.fiscalite.lineInsurance,
    permanent_charges: d.fiscalite.linePermanent,
  };
  return map[line.code];
}

export function regimeLabel(d: Dict, regime: AmortRegime): string {
  const map: Record<AmortRegime, string> = {
    normal_2: d.fiscalite.regimeNormal,
    accelerated_4: d.fiscalite.regimeAccel,
    grandfathered_6: d.fiscalite.regimeGrand,
    vefa2024_6: d.fiscalite.regimeVefa,
    energy_renovation: d.fiscalite.regimeEnergy,
  };
  return map[regime] ?? regime;
}

export function attachmentLabel(d: Dict, code: AttachmentCode): string {
  const map: Record<AttachmentCode, string> = {
    rent_ledger: d.fiscalite.attRentLedger,
    repair_invoices: d.fiscalite.attRepairs,
    interest_certificate: d.fiscalite.attInterest,
    impot_foncier_bulletin: d.fiscalite.attImpot,
    management_fee_statement: d.fiscalite.attManagement,
    insurance_notice: d.fiscalite.attInsurance,
    klimabonus_decision: d.fiscalite.attKlimabonus,
    deed_and_costs: d.fiscalite.attDeed,
  };
  return map[code];
}

export function warningText(d: Dict, w: TaxWarning, locale: Locale): string {
  const template = (d.legal.taxWarning as Record<string, string>)[w.code];
  if (!template) return "";
  const vars: Record<string, string | number> = { ...w.vars };
  if (typeof w.vars.amount === "number") vars.amount = euros(w.vars.amount, locale);
  return fmt(template, vars);
}

/** The forfait against the itemised costs, in one sentence, or why the forfait is closed. */
export function flatText(d: Dict, pack: TaxPack, locale: Locale): string {
  const f = pack.flatComparison;
  if (!f.eligible) return fmt(d.legal.flatIneligible, { age: f.buildingAge, min: f.minAge });
  const vars = { flat: euros(f.flatAmount, locale), itemised: euros(f.itemisedReplaceable, locale), savings: euros(f.savings, locale) };
  return fmt(f.recommendation === "flat" ? d.fiscalite.flatCompareFlat : d.fiscalite.flatCompareItemise, vars);
}

/** The modèle 100 deadline for an exercise, from the registry: the day of the following year. */
export function filingDeadline(taxYear: number): string {
  const jan1 = `${taxYear}-01-01`;
  const month = getParamValue("tax.model100_filing_deadline_month", jan1);
  const day = getParamValue("tax.model100_filing_deadline_day", jan1);
  return `${taxYear + 1}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
