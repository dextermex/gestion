import type { DemoUnit, UnitKind } from "@/lib/demo/data";
import type { PropertyCard } from "@/lib/gestion/portfolio";

/**
 * What a building's page says about itself, derived from its lots and
 * nothing else: how many lots, how many are let, the occupancy rate, what
 * the month brings in, how many rents are late. The page formats; it never
 * types a figure in.
 */
export interface BuildingStats {
  /** Every lot of the building, annexes included. */
  lots: number;
  /** Lots that can carry a lease of their own. */
  lettable: number;
  occupied: number;
  vacant: number;
  /** occupied / lettable, or null when nothing here can be let. */
  occupancyRate: number | null;
  monthlyCents: number;
  /** This month's rents that are late, over let lots. */
  late: number;
  /** This month's rents that arrived in part. */
  partial: number;
}

export function buildingStats(card: PropertyCard): BuildingStats {
  const lettable = card.lots.length;
  return {
    lots: lettable + card.annexes.length,
    lettable,
    occupied: card.occupied,
    vacant: card.vacant,
    occupancyRate: lettable === 0 ? null : card.occupied / lettable,
    monthlyCents: card.monthlyCents,
    late: card.mix.late ?? 0,
    partial: card.mix.partial ?? 0,
  };
}

/** The four families the Lots tab filters by. */
export type LotFamily = "apartments" | "commercial" | "parking" | "other";
export const LOT_FAMILIES: readonly LotFamily[] = ["apartments", "commercial", "parking", "other"];

export function lotFamilyOf(unit: Pick<DemoUnit, "kind">): LotFamily {
  switch (unit.kind) {
    case "dwelling":
      return "apartments";
    case "commercial":
    case "office":
      return "commercial";
    case "parking":
      return "parking";
    default:
      return "other";
  }
}

/** How many lots each family holds, annexes included. */
export function lotFamilyCounts(card: PropertyCard): Record<LotFamily, number> {
  const counts: Record<LotFamily, number> = { apartments: 0, commercial: 0, parking: 0, other: 0 };
  for (const line of card.lots) counts[lotFamilyOf(line.unit)] += 1;
  for (const unit of card.annexes) counts[lotFamilyOf(unit)] += 1;
  return counts;
}

/** How many lots of each kind, in the order a sentence lists them. */
export function unitComposition(card: PropertyCard): Array<{ kind: UnitKind; n: number }> {
  const order: UnitKind[] = ["dwelling", "commercial", "office", "parking", "cellar", "other"];
  const counts = new Map<UnitKind, number>();
  for (const unit of [...card.lots.map((l) => l.unit), ...card.annexes]) counts.set(unit.kind, (counts.get(unit.kind) ?? 0) + 1);
  return order.filter((k) => (counts.get(k) ?? 0) > 0).map((k) => ({ kind: k, n: counts.get(k)! }));
}

/** The lots of a building in the order the grid shows them: by floor from the top, then by label. */
export function sortedUnits(card: PropertyCard): DemoUnit[] {
  const rank = (u: DemoUnit): number => {
    const f = (u.floor ?? "").trim().toLowerCase();
    if (f === "" || f === "—") return -1000;
    if (/^(rdc|rez|eg|ground|0)/.test(f)) return 0;
    const m = f.match(/-?\d+/);
    return m ? Number(m[0]) : -999;
  };
  return [...card.lots.map((l) => l.unit), ...card.annexes].sort((a, b) => rank(b) - rank(a) || a.label.localeCompare(b.label, undefined, { numeric: true }));
}
