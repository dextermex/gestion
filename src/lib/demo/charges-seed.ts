import { mapSyndicDecompte, type ChargeCategory } from "@/domain/charges/recharge";

// ─── Charges: the décomptes as data ─────────────────────────────────────────
//
// A décompte is a period of a lease (one per year) and its lines: what the
// building paid, the lot's share, and what the recharge engine lets reach the
// tenant. The sample datasets build theirs from the syndic statement through
// `periodFromSyndic`; a real account reads its rows from `charge_periods` and
// `charge_lines`. The Charges screen renders both through the same shape.
//
// This module is deliberately NOT a dataset: everything a dataset exports
// becomes part of `DemoData`, and a helper is not data.

export interface DemoChargeLine {
  id: string;
  source: "invoice" | "syndic_decompte" | "meter" | "estimate";
  label: string;
  category: ChargeCategory;
  buildingTotalCents: number | null;
  tantiemes: number | null;
  tantiemesTotal: number | null;
  lotShareCents: number;
  tenantShareCents: number;
  blocked: boolean;
}

export interface DemoChargePeriod {
  id: string;
  leaseId: string;
  year: number;
  regime: "advances" | "forfait";
  status: "open" | "draft" | "issued" | "disputed" | "settled";
  advancesBilledCents: number;
  actualCents: number;
  issuedOn: string | null;
  dueOn: string | null;
  lines: DemoChargeLine[];
}

/** The syndic's statement recharged to one tenancy, as the period the screen shows. */
export function periodFromSyndic(
  decompte: { year: number; tantiemesTotal: number; lines: Array<{ label: string; category: ChargeCategory; totalBuilding: number }> },
  lease: { id: string; chargesCents: number; chargesRegime: "advances" | "forfait"; type: "residential" | "commercial" },
  tantiemes: number,
  dates: { issuedOn: string; dueOn: string },
): DemoChargePeriod {
  const mapped = mapSyndicDecompte(
    decompte.lines.map((l) => ({ label: l.label, category: l.category, totalBuilding: l.totalBuilding, tantiemes, tantiemesTotal: decompte.tantiemesTotal })),
    lease.type,
  );
  return {
    id: `cp-${lease.id}-${decompte.year}`,
    leaseId: lease.id,
    year: decompte.year,
    regime: lease.chargesRegime,
    status: "issued",
    advancesBilledCents: lease.chargesCents * 12,
    actualCents: mapped.totalRecoverable,
    issuedOn: dates.issuedOn,
    dueOn: dates.dueOn,
    lines: mapped.lines.map((l, i) => ({
      id: `cl-${lease.id}-${decompte.year}-${i + 1}`,
      source: "syndic_decompte",
      label: l.label,
      category: l.category,
      buildingTotalCents: decompte.lines[i].totalBuilding,
      tantiemes,
      tantiemesTotal: decompte.tantiemesTotal,
      lotShareCents: l.lotShare,
      tenantShareCents: l.tenantRecoverable,
      blocked: l.blocked,
    })),
  };
}
