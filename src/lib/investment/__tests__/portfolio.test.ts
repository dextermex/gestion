import { describe, expect, it } from "vitest";
import { financePropertiesOf } from "../portfolio";

describe("rental inputs to investment scenarios", () => {
  it("includes only rents in force on the projection date, without tenant charges or deposits", () => {
    const lease = {unitId: "u1", status: "active", startDate: "2026-01-01", endDate: null, rentCents: 150_000, chargesCents: 25_000, depositCents: 300_000};
    const source = {
      TODAY: "2026-09-27",
      PROPERTIES: [{id: "p1", name: "Test property"}, {id: "p2", name: "Empty property"}],
      UNITS: [{id: "u1", propertyId: "p1", label: "Unit A"}, {id: "u2", propertyId: "p1", label: "Unit B"}],
      LEASES: [lease, {...lease, unitId: "u2", status: "notice", rentCents: 120_000},
        {...lease, status: "draft"}, {...lease, status: "ended"}, {...lease, startDate: "2026-10-01"},
        {...lease, endDate: "2026-09-26"}],
    };
    const before = JSON.stringify(source);
    const result = financePropertiesOf(source);
    expect(result[0].monthlyRentCents).toBe(270_000);
    expect(result[0].units.map((u) => u.monthlyRentCents)).toEqual([150_000, 120_000]);
    expect(result[1]).toMatchObject({units: [], monthlyRentCents: 0});
    expect(JSON.stringify(source)).toBe(before);
  });
});
