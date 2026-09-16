import { describe, expect, it } from "vitest";
import * as fr from "@/lib/demo/data";
import type { DemoData } from "@/lib/demo";
import { buildPortfolio, findCard, nextDueOn, occupancyOf } from "@/lib/gestion/portfolio";

/**
 * The portfolio projection is what both Patrimoine screens read, so a
 * regression here would quietly misreport an owner's month. The sample
 * cabinet stands in for any dataset: the function only ever sees `DemoData`,
 * which is the same shape a real account hydrates into.
 */

const demo = fr as unknown as DemoData;
const cards = buildPortfolio(demo);

describe("buildPortfolio", () => {
  it("covers every property exactly once", () => {
    expect(cards).toHaveLength(demo.PROPERTIES.length);
    expect(new Set(cards.map((c) => c.property.id)).size).toBe(cards.length);
  });

  it("classifies a multi-lot building, a house and a single apartment apart", () => {
    expect(findCard(cards, "p-beaulieu")?.kind).toBe("building");
    expect(findCard(cards, "p-bertrange")?.kind).toBe("house");
    expect(findCard(cards, "p-kirchberg")?.kind).toBe("commercial");
  });

  it("never counts a parking space as a vacancy", () => {
    const beaulieu = findCard(cards, "p-beaulieu")!;
    expect(demo.UNITS.some((u) => u.propertyId === "p-beaulieu" && u.kind === "parking")).toBe(true);
    expect(beaulieu.lots.every((l) => l.unit.kind !== "parking")).toBe(true);
    expect(beaulieu.annexes.some((u) => u.kind === "parking")).toBe(true);
    expect(beaulieu.occupied + beaulieu.vacant).toBe(beaulieu.lots.length);
  });

  it("exposes a single tenancy on a one-lot property and none on a building", () => {
    expect(findCard(cards, "p-bertrange")?.single).not.toBeNull();
    expect(findCard(cards, "p-beaulieu")?.single).toBeNull();
  });

  it("reads occupancy from live leases only, never from drafts", () => {
    for (const card of cards) {
      for (const line of card.lots) {
        if (line.lease) expect(["active", "notice"]).toContain(line.lease.status);
        expect(line.vacant).toBe(line.lease === null);
      }
    }
  });

  it("lists a draft dossier on its lot without letting it occupy the lot", () => {
    const draft = demo.LEASES.find((l) => l.status === "draft")!;
    const card = cards.find((c) => c.lots.some((l) => l.unit.id === draft.unitId))!;
    const line = card.lots.find((l) => l.unit.id === draft.unitId)!;
    expect(line.drafts.map((l) => l.id)).toEqual([draft.id]);
    expect(line.lease).toBeNull();
    expect(line.vacant).toBe(true);
    expect(line.monthlyCents).toBe(0);
    expect(cards.flatMap((c) => c.lots).filter((l) => l.lease?.status === "draft")).toEqual([]);
  });

  it("sums the monthly rent from rent plus charges of live leases", () => {
    const beaulieu = findCard(cards, "p-beaulieu")!;
    const expected = beaulieu.lots
      .filter((l) => l.lease)
      .reduce((a, l) => a + l.lease!.rentCents + l.lease!.chargesCents, 0);
    expect(beaulieu.monthlyCents).toBe(expected);
  });

  it("derives this month's status from the ledger, not from the lease", () => {
    const month = demo.TODAY.slice(0, 7);
    for (const card of cards) {
      for (const line of card.lots) {
        if (!line.period) continue;
        expect(line.period.period).toBe(month);
        expect(line.status).toBe(line.period.status);
        const ledger = demo.RENT_PERIODS.find((rp) => rp.id === line.period!.id);
        expect(ledger).toBeDefined();
      }
    }
  });

  it("counts the status mix over let lots only", () => {
    for (const card of cards) {
      const total = Object.values(card.mix).reduce((a, n) => a + n, 0);
      expect(total).toBe(card.lots.filter((l) => l.period).length);
      expect(total).toBeLessThanOrEqual(card.occupied);
    }
  });

  it("calls a property vacant when nothing is let and partial when some is", () => {
    for (const card of cards) {
      const state = occupancyOf(card);
      if (card.occupied === 0) expect(state).toBe("vacant");
      else if (card.vacant === 0) expect(state).toBe("occupied");
      else expect(state).toBe("partial");
    }
  });

  it("never proposes a next due date in the past", () => {
    for (const card of cards) {
      if (card.nextDue) expect(card.nextDue >= demo.TODAY).toBe(true);
    }
  });

  it("returns null rather than throwing for an unknown property", () => {
    expect(findCard(cards, "p-does-not-exist")).toBeNull();
  });
});

describe("buildPortfolio on an empty account", () => {
  it("produces no cards and no totals", () => {
    const empty = { ...demo, PROPERTIES: [], UNITS: [], LEASES: [], RENT_PERIODS: [] } as unknown as DemoData;
    expect(buildPortfolio(empty)).toEqual([]);
  });

  it("shows a property with no lots as vacant rather than crashing", () => {
    const bare = {
      ...demo,
      PROPERTIES: [demo.PROPERTIES[0]],
      UNITS: [],
      LEASES: [],
      RENT_PERIODS: [],
    } as unknown as DemoData;
    const [card] = buildPortfolio(bare);
    expect(card.lots).toEqual([]);
    expect(card.single).toBeNull();
    expect(card.monthlyCents).toBe(0);
    expect(occupancyOf(card)).toBe("vacant");
  });
});

describe("nextDueOn", () => {
  it("keeps this month's due day when it has not passed", () => {
    expect(nextDueOn("2026-09-03", 5)).toBe("2026-09-05");
    expect(nextDueOn("2026-09-05", 5)).toBe("2026-09-05");
  });

  it("rolls to next month once the day is behind us", () => {
    expect(nextDueOn("2026-09-20", 1)).toBe("2026-10-01");
  });

  it("rolls across a year boundary", () => {
    expect(nextDueOn("2026-12-20", 1)).toBe("2027-01-01");
  });

  it("clamps a payment day to what the schema accepts", () => {
    expect(nextDueOn("2026-09-01", 31)).toBe("2026-09-28");
    expect(nextDueOn("2026-09-01", 0)).toBe("2026-09-01");
  });
});

describe("a tenancy that ended", () => {
  // Closing a lease must free its lot without touching anything else: the
  // property goes back to vacant, and the old rent stops being counted.
  const ended = {
    ...demo,
    LEASES: demo.LEASES.map((l) => (l.unitId === "u-bert" ? { ...l, status: "ended" as const } : l)),
  } as unknown as DemoData;

  it("frees the lot and stops counting its rent", () => {
    const before = findCard(buildPortfolio(demo), "p-bertrange")!;
    const after = findCard(buildPortfolio(ended), "p-bertrange")!;
    expect(before.occupied).toBe(1);
    expect(after.occupied).toBe(0);
    expect(after.vacant).toBe(1);
    expect(after.monthlyCents).toBe(0);
    expect(occupancyOf(after)).toBe("vacant");
    expect(after.single?.lease).toBeNull();
  });

  it("leaves the ended lease and its ledger in the dataset", () => {
    expect(ended.LEASES.some((l) => l.unitId === "u-bert" && l.status === "ended")).toBe(true);
    expect(ended.RENT_PERIODS.length).toBe(demo.RENT_PERIODS.length);
  });

  it("does not disturb any other property", () => {
    const a = findCard(buildPortfolio(demo), "p-beaulieu")!;
    const b = findCard(buildPortfolio(ended), "p-beaulieu")!;
    expect(b.occupied).toBe(a.occupied);
    expect(b.monthlyCents).toBe(a.monthlyCents);
  });
});
