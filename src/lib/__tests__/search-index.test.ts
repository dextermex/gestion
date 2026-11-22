import { describe, expect, it } from "vitest";
import * as cabinet from "@/lib/demo/data";
import { buildSearchIndex } from "@/lib/demo/search";
import { buildPortfolio, isLettable } from "@/lib/gestion/portfolio";

describe("the search palette's corpus", () => {
  const hits = buildSearchIndex(cabinet);
  const units = hits.filter((h) => h.type === "unit");
  const cards = buildPortfolio(cabinet);

  it("opens a lot of a building on the lot's own sheet", () => {
    const building = cards.find((c) => c.single === null && c.lots.length > 1)!;
    expect(building, "the sample has a building").toBeDefined();
    for (const line of building.lots) {
      const hit = units.find((h) => h.href.endsWith(`/lots/${line.unit.id}`));
      expect(hit?.href, line.unit.label).toBe(`/app/biens/${building.property.id}/lots/${line.unit.id}`);
    }
  });

  it("opens a single home on its property's sheet, and an annex on its own", () => {
    const home = cards.find((c) => c.single !== null)!;
    expect(home, "the sample has a single home").toBeDefined();
    expect(units.some((h) => h.href === `/app/biens/${home.property.id}`)).toBe(true);
    expect(units.some((h) => h.href === `/app/biens/${home.property.id}/lots/${home.single!.unit.id}`)).toBe(false);
    for (const annex of cabinet.UNITS.filter((u) => !isLettable(u))) {
      expect(units.some((h) => h.href === `/app/biens/${annex.propertyId}/lots/${annex.id}`), annex.label).toBe(true);
    }
  });
});
