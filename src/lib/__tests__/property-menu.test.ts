import { describe, expect, it } from "vitest";
import * as cabinet from "@/lib/demo/data";
import { fr } from "@/lib/i18n/fr";
import { buildPortfolio, isLettable, lotCard } from "@/lib/gestion/portfolio";
import { propertyMenu } from "@/lib/gestion/property-menu";

/** What "Modifier" offers about a tenancy, by where it is opened. */
describe("the tenancy entries of the Modifier menu", () => {
  const cards = buildPortfolio(cabinet);
  const building = cards.find((c) => c.single === null && c.lots.filter((l) => l.lease).length > 1)!;
  const hrefs = (card: (typeof cards)[number]) => propertyMenu(card, cabinet, fr, "fr").groups.flatMap((g) => g.entries.map((e) => ("href" in e ? e.href : undefined))).filter(Boolean) as string[];

  it("offers none on a building: its tenancies are edited from their lots", () => {
    expect(building, "the sample has a building with several tenancies").toBeDefined();
    const menu = propertyMenu(building, cabinet, fr, "fr");
    expect(menu.hasLease).toBe(false);
    expect(menu.groups.some((g) => g.label.startsWith(fr.modify.groupRental))).toBe(false);
    expect(hrefs(building).some((h) => h.startsWith("/app/biens/depart") || h.startsWith("/app/biens/etat-des-lieux") || h.startsWith("/app/biens/locataire"))).toBe(false);
  });

  it("offers each lot's own tenancy on the lot's sheet", () => {
    for (const line of building.lots.filter((l) => l.lease)) {
      const lot = lotCard(building, line.unit.id, cabinet.TODAY)!;
      expect(propertyMenu(lot, cabinet, fr, "fr").hasLease, line.unit.label).toBe(true);
      expect(hrefs(lot), line.unit.label).toContain(`/app/biens/depart?bail=${line.lease!.id}`);
    }
  });

  it("offers no tenant to a parking space or a cellar", () => {
    const annexes = cards.flatMap((c) => c.annexes.map((u) => ({ card: c, unit: u })));
    expect(annexes.length, "the sample has annex lots").toBeGreaterThan(0);
    for (const { card, unit } of annexes) {
      expect(isLettable(unit)).toBe(false);
      const lot = lotCard(card, unit.id, cabinet.TODAY)!;
      expect(hrefs(lot).some((h) => h.startsWith("/app/biens/locataire")), unit.label).toBe(false);
    }
  });
});
