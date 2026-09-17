import type { DemoData } from "@/lib/demo";
import type { DemoLease, DemoProperty, DemoRentPeriod, DemoUnit } from "@/lib/demo/data";
import type { RentStatus } from "@/lib/types";
import { nextDueOn } from "@/lib/gestion/ledger";

/**
 * The portfolio projection: one property-shaped view of the whole dataset.
 *
 * Every Patrimoine screen reads the owner's holdings through this function,
 * so the Biens card and the property sheet can never disagree, and a sample
 * cabinet and a real account compute identically — it takes `DemoData`, which
 * is the same seam on both. It derives; it never stores. Paid-ness in
 * particular comes from the rent period the ledger produced, never from a
 * flag on the lease.
 */

/** Structural classification, derived from the lots rather than the free-text
 *  `type` label, so it holds on a dataset that never filled that label in. */
export type PropertyKind = "building" | "house" | "apartment" | "commercial";

/** Lots that can carry a lease of their own. A parking space or a cellar is
 *  part of a home, not a home, and must not count as a vacancy. */
const LETTABLE: ReadonlySet<DemoUnit["kind"]> = new Set(["dwelling", "commercial"]);

const LIVE: ReadonlySet<DemoLease["status"]> = new Set(["active", "notice"]);

export type UnitLine = {
  unit: DemoUnit;
  /** The lease in force, if any. A draft never occupies a lot. */
  lease: DemoLease | null;
  tenantNames: string[];
  /** Dossiers recorded on this lot that have not started: they are shown as
   *  such, so an owner can resume, activate or discard them, and they never
   *  make the lot read as occupied. Oldest first. */
  drafts: DemoLease[];
  /** Rent plus charges: what the tenant owes each month. */
  monthlyCents: number;
  /** This month's period, once the ledger has opened it. */
  period: DemoRentPeriod | null;
  status: RentStatus | null;
  vacant: boolean;
};

export type PropertyCard = {
  property: DemoProperty;
  kind: PropertyKind;
  /** Lots that can be let, each with its current tenancy. */
  lots: UnitLine[];
  /** Parking, cellars and other annexes: listed, never counted as vacancy. */
  annexes: DemoUnit[];
  occupied: number;
  vacant: number;
  monthlyCents: number;
  areaSqm: number;
  /** Count per status for the current month, over let lots only. */
  mix: Partial<Record<RentStatus, number>>;
  /** The single tenancy, when the property is one lot. Drives the compact
   *  card and the property header; null for a building. */
  single: UnitLine | null;
  /** Earliest upcoming due date across live leases, for "next payment". */
  nextDue: string | null;
};

function kindOf(p: DemoProperty, units: DemoUnit[]): PropertyKind {
  const dwellings = units.filter((u) => u.kind === "dwelling");
  const commercial = units.filter((u) => u.kind === "commercial");
  if (commercial.length > 0 && dwellings.length === 0) return "commercial";
  if (dwellings.length === 1 && units.filter((u) => LETTABLE.has(u.kind)).length === 1) {
    return p.isCopropriete ? "apartment" : "house";
  }
  return "building";
}

/** The month a screen is standing in, as YYYY-MM. */
export function currentMonth(today: string): string {
  return today.slice(0, 7);
}

export function buildPortfolio(demo: DemoData): PropertyCard[] {
  const month = currentMonth(demo.TODAY);
  const periodsByLease = new Map<string, DemoRentPeriod[]>();
  for (const rp of demo.RENT_PERIODS) {
    const list = periodsByLease.get(rp.leaseId);
    if (list) list.push(rp);
    else periodsByLease.set(rp.leaseId, [rp]);
  }

  return demo.PROPERTIES.map((property) => {
    const units = demo.UNITS.filter((u) => u.propertyId === property.id);
    const lettable = units.filter((u) => LETTABLE.has(u.kind));
    const annexes = units.filter((u) => !LETTABLE.has(u.kind));

    const lots: UnitLine[] = lettable.map((unit) => {
      const lease = demo.LEASES.find((l) => l.unitId === unit.id && LIVE.has(l.status)) ?? null;
      const drafts = demo.LEASES.filter((l) => l.unitId === unit.id && l.status === "draft")
        .slice()
        .sort((a, b) => a.seq - b.seq);
      const period = lease
        ? (periodsByLease.get(lease.id) ?? []).find((rp) => rp.period === month) ?? null
        : null;
      return {
        unit,
        lease,
        tenantNames: lease ? demo.leaseTenantNames(lease) : [],
        drafts,
        monthlyCents: lease ? lease.rentCents + lease.chargesCents : 0,
        period,
        status: period?.status ?? null,
        vacant: lease === null,
      };
    });

    const mix: Partial<Record<RentStatus, number>> = {};
    for (const line of lots) {
      if (line.status) mix[line.status] = (mix[line.status] ?? 0) + 1;
    }

    // The next rent to fall due, read from the lease's payment day rather
    // than from the open period: mid-month every period is already past, and
    // an owner still wants to know when the next one lands. A tenancy that
    // ends before then owes nothing more, so it contributes no date.
    const due = lots
      .filter((l) => l.lease)
      .map((l) => nextDueOn(demo.TODAY, l.lease!.paymentDay, l.lease!.startDate, l.lease!.endDate))
      .filter((d): d is string => d !== null)
      .sort();

    return {
      property,
      kind: kindOf(property, units),
      lots,
      annexes,
      occupied: lots.filter((l) => !l.vacant).length,
      vacant: lots.filter((l) => l.vacant).length,
      monthlyCents: lots.reduce((a, l) => a + l.monthlyCents, 0),
      areaSqm: units.reduce((a, u) => a + u.areaSqm, 0),
      mix,
      single: lots.length === 1 ? lots[0] : null,
      nextDue: due[0] ?? null,
    };
  });
}

export { nextDueOn };

export function findCard(cards: PropertyCard[], propertyId: string): PropertyCard | null {
  return cards.find((c) => c.property.id === propertyId) ?? null;
}

/** Occupancy in one word, for the badge on a card. */
export type Occupancy = "occupied" | "vacant" | "partial";
export function occupancyOf(card: PropertyCard): Occupancy {
  if (card.lots.length === 0 || card.occupied === 0) return "vacant";
  return card.vacant === 0 ? "occupied" : "partial";
}
