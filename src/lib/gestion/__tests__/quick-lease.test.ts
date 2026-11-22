import { describe, expect, it } from "vitest";
import * as frData from "@/lib/demo/data";
import { quickLeaseOptions } from "@/lib/gestion/quick-lease";

/**
 * The quick "Bail" sheet joins a lot that can be let to a recorded tenant.
 * It used to list every lot and every contact, the first of each selected.
 */
describe("what the quick lease sheet offers", () => {
  const live = new Set(frData.LEASES.filter((l) => l.status === "active" || l.status === "notice").map((l) => l.unitId));
  const { units, tenants } = quickLeaseOptions(frData);

  it("offers no lot that has a lease in force", () => {
    expect(units.length).toBeGreaterThan(0);
    for (const u of units) expect(live.has(u.id), u.label).toBe(false);
    // ...and every vacant lot that can be let is there.
    const vacant = frData.UNITS.filter((u) => ["dwelling", "commercial", "office"].includes(u.kind) && !live.has(u.id));
    expect(units.map((u) => u.id).sort()).toEqual(vacant.map((u) => u.id).sort());
  });

  it("offers no parking space, cellar or other annex", () => {
    const kinds = new Map(frData.UNITS.map((u) => [u.id, u.kind]));
    for (const u of units) expect(["dwelling", "commercial", "office"]).toContain(kinds.get(u.id));
  });

  it("offers a lot under a draft dossier or after a departure: neither occupies it", () => {
    const [first] = frData.UNITS.filter((u) => u.kind === "dwelling");
    const data = {
      ...frData,
      LEASES: [
        { ...frData.LEASES[0], id: "l-draft", unitId: first.id, status: "draft" as const },
        { ...frData.LEASES[0], id: "l-ended", unitId: first.id, status: "ended" as const },
      ],
    };
    expect(quickLeaseOptions(data).units.map((u) => u.id)).toContain(first.id);
  });

  it("offers only contacts recorded as tenants", () => {
    const roles = new Map(frData.CONTACTS.map((c) => [c.id, c.roles]));
    expect(tenants.length).toBeGreaterThan(0);
    for (const t of tenants) expect(roles.get(t.id)).toContain("tenant");
    const artisan = frData.CONTACTS.find((c) => c.roles.includes("artisan") && !c.roles.includes("tenant"))!;
    expect(tenants.map((t) => t.id)).not.toContain(artisan.id);
  });

  it("names a lot by its label and its property, and still names one whose property is not on screen", () => {
    const unit = frData.UNITS.find((u) => units.some((o) => o.id === u.id))!;
    const property = frData.PROPERTIES.find((p) => p.id === unit.propertyId)!;
    expect(units.find((o) => o.id === unit.id)!.label).toBe(`${unit.label} · ${property.name}`);
    const orphan = quickLeaseOptions({ ...frData, PROPERTIES: [] }).units.find((o) => o.id === unit.id)!;
    expect(orphan.label).toBe(unit.label);
  });
});
