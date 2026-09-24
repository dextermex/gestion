import { decideRecharge, type ChargeCategory } from "@/domain/charges/recharge";
import { roundCents } from "@/domain/money";

/**
 * A décompte's lines, computed rather than typed: the lot's share comes from
 * the building total and the tantièmes when those are given, else it is the
 * share entered; what reaches the tenant is the recharge engine's decision
 * (a residential hard block leaves the line visible and zero). The totals
 * the period carries are sums of these, never a figure of their own.
 */
export const CHARGE_CATEGORIES: readonly ChargeCategory[] = [
  "heating", "water", "waste", "sewerage", "common_electricity", "cleaning_common", "lift_maintenance", "caretaker", "garden",
  "minor_common_maintenance", "management_fee", "building_insurance", "impot_foncier", "energy_passport", "meter_rental", "major_repair", "vetuste_renewal", "other",
];
export const CHARGE_SOURCES = ["invoice", "syndic_decompte", "meter", "estimate"] as const;
export type ChargeSource = (typeof CHARGE_SOURCES)[number];

export interface ChargeLineInput {
  label: string;
  category: ChargeCategory;
  source?: ChargeSource;
  buildingTotalCents?: number | null;
  tantiemes?: number | null;
  tantiemesTotal?: number | null;
  /** The lot's share, when the building total is not split by tantièmes. */
  lotShareCents?: number | null;
}

export interface ComputedChargeLine {
  label: string;
  category: ChargeCategory;
  source: ChargeSource;
  buildingTotalCents: number | null;
  tantiemes: number | null;
  tantiemesTotal: number | null;
  lotShareCents: number;
  tenantShareCents: number;
  blocked: boolean;
  blockReason: string | null;
}

export type ChargeLineProblem = "label" | "category" | "share";

/** One line, computed; or the field it lacks. */
export function computeChargeLine(input: ChargeLineInput, leaseType: "residential" | "commercial"): ComputedChargeLine | { problem: ChargeLineProblem } {
  const label = (input.label ?? "").trim();
  if (!label) return { problem: "label" };
  if (!CHARGE_CATEGORIES.includes(input.category)) return { problem: "category" };
  const bySplit = typeof input.buildingTotalCents === "number" && typeof input.tantiemes === "number" && typeof input.tantiemesTotal === "number" && input.tantiemesTotal > 0 && input.tantiemes >= 0 && input.tantiemes <= input.tantiemesTotal && input.buildingTotalCents >= 0;
  const byShare = typeof input.lotShareCents === "number" && input.lotShareCents >= 0;
  if (!bySplit && !byShare) return { problem: "share" };
  const lotShareCents = bySplit ? roundCents((input.buildingTotalCents! * input.tantiemes!) / input.tantiemesTotal!) : input.lotShareCents!;
  const decision = decideRecharge(input.category, leaseType);
  return {
    label: label.slice(0, 160),
    category: input.category,
    source: input.source && CHARGE_SOURCES.includes(input.source) ? input.source : "invoice",
    buildingTotalCents: bySplit ? input.buildingTotalCents! : null,
    tantiemes: bySplit ? input.tantiemes! : null,
    tantiemesTotal: bySplit ? input.tantiemesTotal! : null,
    lotShareCents,
    tenantShareCents: decision.blocked ? 0 : lotShareCents,
    blocked: decision.blocked,
    blockReason: decision.blockReason,
  };
}

export interface ComputedPeriod {
  lines: ComputedChargeLine[];
  actualCents: number;
  blockedCents: number;
}

export function computeChargePeriod(lines: ChargeLineInput[], leaseType: "residential" | "commercial"): ComputedPeriod | { problem: ChargeLineProblem; index: number } {
  const out: ComputedChargeLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = computeChargeLine(lines[i], leaseType);
    if ("problem" in line) return { problem: line.problem, index: i };
    out.push(line);
  }
  return {
    lines: out,
    actualCents: out.reduce((a, l) => a + l.tenantShareCents, 0),
    blockedCents: out.filter((l) => l.blocked).reduce((a, l) => a + l.lotShareCents, 0),
  };
}

/** The advances the ledger billed for a year: the charges part of that year's periods. */
export function advancesBilledForYear(periods: Array<{ period: string; chargesCents: number }>, year: number): number {
  return periods.filter((p) => p.period.slice(0, 4) === String(year)).reduce((a, p) => a + p.chargesCents, 0);
}

/** The balance a décompte leaves: positive, the tenant owes it; negative, the tenant is owed. */
export function decompteBalance(actualCents: number, advancesBilledCents: number): number {
  return actualCents - advancesBilledCents;
}
