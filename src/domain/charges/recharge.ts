/**
 * Charge-recharge decision engine (strategy §3.1, §4.2).
 *
 * A residential tenant may only be recharged actually-incurred,
 * invoice-evidenced expenses for the tenant's benefit. Some categories are
 * NEVER rechargeable — hard blocks the manager cannot override:
 * management fees, building insurance, impôt foncier, energy-passport cost,
 * meter rental/reading, major repairs, vétusté.
 *
 * The vétusté grid computes the tenant's residual share of a repair that
 * mixes wear-and-tear with tenant damage.
 */

import { Cents, roundCents } from "@/domain/money";
import { LeaseType } from "@/domain/lease/rules";

export type ChargeCategory =
  | "heating"
  | "water"
  | "waste"
  | "sewerage"
  | "common_electricity"
  | "cleaning_common"
  | "lift_maintenance"
  | "caretaker"
  | "garden"
  | "minor_common_maintenance"
  | "management_fee"
  | "building_insurance"
  | "impot_foncier"
  | "energy_passport"
  | "meter_rental"
  | "major_repair"
  | "vetuste_renewal"
  | "other";

export interface HardBlock {
  category: ChargeCategory;
  reason: string;
}

/** Never rechargeable to a residential tenant. Non-overridable. */
export const RESIDENTIAL_HARD_BLOCKS: HardBlock[] = [
  { category: "management_fee", reason: "Frais de gérance are the owner's cost — recharging them to a residential tenant is unlawful." },
  { category: "building_insurance", reason: "Building insurance protects the owner's asset — not rechargeable." },
  { category: "impot_foncier", reason: "Impôt foncier is the owner's tax — not rechargeable." },
  { category: "energy_passport", reason: "The CPE (energy passport) is an owner obligation — not rechargeable." },
  { category: "meter_rental", reason: "Meter rental/reading fees are not rechargeable." },
  { category: "major_repair", reason: "Major repairs are the owner's capital burden — not rechargeable." },
  { category: "vetuste_renewal", reason: "Normal wear-and-tear (vétusté) renewal is never the tenant's cost." },
];

export interface RechargeDecision {
  category: ChargeCategory;
  rechargeable: boolean;
  blocked: boolean;
  blockReason: string | null;
  requiresInvoiceEvidence: boolean;
  note: string;
}

export function decideRecharge(category: ChargeCategory, leaseType: LeaseType): RechargeDecision {
  if (leaseType === "residential") {
    const block = RESIDENTIAL_HARD_BLOCKS.find((b) => b.category === category);
    if (block) {
      return {
        category,
        rechargeable: false,
        blocked: true,
        blockReason: block.reason,
        requiresInvoiceEvidence: false,
        note: "Hard legal block — non-overridable in product.",
      };
    }
    return {
      category,
      rechargeable: true,
      blocked: false,
      blockReason: null,
      requiresInvoiceEvidence: true,
      note:
        "Rechargeable only as actually incurred, invoice-evidenced and for the tenant's benefit. Disputes go to the justice de paix (not the commission des loyers); syndic AG-approved décomptes carry a presumption of justification.",
    };
  }
  // Commercial: freedom of contract — the lease's charges clause governs.
  return {
    category,
    rechargeable: true,
    blocked: false,
    blockReason: null,
    requiresInvoiceEvidence: true,
    note: "Commercial lease — recharge per the contractual charges clause.",
  };
}

// ─── Vétusté grid ───────────────────────────────────────────────────────────

export interface VetusteGridEntry {
  /** EDL category this line applies to (paint, flooring, appliance…). */
  category: string;
  /** Expected lifetime in years. */
  lifetimeYears: number;
  /** Residual floor: the share that always stays chargeable (e.g. 10%). */
  residualFloorPct: number;
}

/** Default grid — org-configurable data, referenced from the lease annexe. */
export const DEFAULT_VETUSTE_GRID: VetusteGridEntry[] = [
  { category: "paint", lifetimeYears: 7, residualFloorPct: 10 },
  { category: "wallpaper", lifetimeYears: 7, residualFloorPct: 10 },
  { category: "carpet", lifetimeYears: 7, residualFloorPct: 10 },
  { category: "parquet_finish", lifetimeYears: 10, residualFloorPct: 10 },
  { category: "tiling", lifetimeYears: 20, residualFloorPct: 20 },
  { category: "kitchen_appliance", lifetimeYears: 10, residualFloorPct: 10 },
  { category: "boiler", lifetimeYears: 15, residualFloorPct: 20 },
  { category: "sanitary", lifetimeYears: 15, residualFloorPct: 15 },
  { category: "interior_joinery", lifetimeYears: 15, residualFloorPct: 15 },
  { category: "electrics", lifetimeYears: 20, residualFloorPct: 20 },
];

export interface VetusteComputation {
  repairCost: Cents;
  ageYears: number;
  lifetimeYears: number;
  /** Share of value already consumed by normal wear (0–1). */
  wearShare: number;
  /** Tenant's residual chargeable amount. */
  tenantShare: Cents;
  ownerShare: Cents;
}

/**
 * Linear depreciation over the grid lifetime with a residual floor:
 * tenant pays the un-worn share of the repair, never less than the floor.
 */
export function computeVetuste(
  repairCost: Cents,
  itemAgeYears: number,
  entry: VetusteGridEntry,
): VetusteComputation {
  const wearShare = Math.min(1, Math.max(0, itemAgeYears / entry.lifetimeYears));
  const residualPct = Math.max((1 - wearShare) * 100, entry.residualFloorPct);
  const tenantShare = roundCents((repairCost * residualPct) / 100);
  return {
    repairCost,
    ageYears: itemAgeYears,
    lifetimeYears: entry.lifetimeYears,
    wearShare,
    tenantShare,
    ownerShare: repairCost - tenantShare,
  };
}

// ─── Syndic décompte mapping ────────────────────────────────────────────────

export interface SyndicDecompteLine {
  label: string;
  category: ChargeCategory;
  totalBuilding: Cents;
  /** The lot's tantièmes (millièmes) over the building total. */
  tantiemes: number;
  tantiemesTotal: number;
}

export interface TenantChargeLine {
  label: string;
  category: ChargeCategory;
  lotShare: Cents;
  tenantRecoverable: Cents;
  blocked: boolean;
  blockReason: string | null;
}

/**
 * Map a copropriété décompte to the (smaller) tenant-recoverable subset with
 * full line provenance: lot share by tantièmes, then the recharge decision.
 */
export function mapSyndicDecompte(
  lines: SyndicDecompteLine[],
  leaseType: LeaseType,
): { lines: TenantChargeLine[]; totalRecoverable: Cents; totalBlocked: Cents } {
  const out: TenantChargeLine[] = lines.map((l) => {
    const lotShare = roundCents((l.totalBuilding * l.tantiemes) / l.tantiemesTotal);
    const decision = decideRecharge(l.category, leaseType);
    return {
      label: l.label,
      category: l.category,
      lotShare,
      tenantRecoverable: decision.blocked ? 0 : lotShare,
      blocked: decision.blocked,
      blockReason: decision.blockReason,
    };
  });
  return {
    lines: out,
    totalRecoverable: out.reduce((a, l) => a + l.tenantRecoverable, 0),
    totalBlocked: out.filter((l) => l.blocked).reduce((a, l) => a + l.lotShare, 0),
  };
}
