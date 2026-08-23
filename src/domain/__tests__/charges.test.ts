import { describe, expect, it } from "vitest";
import {
  DEFAULT_VETUSTE_GRID,
  computeVetuste,
  decideRecharge,
  mapSyndicDecompte,
} from "@/domain/charges/recharge";
import { cents } from "@/domain/money";

describe("recharge decision engine", () => {
  it("hard-blocks the seven never-rechargeable categories for residential", () => {
    for (const cat of [
      "management_fee",
      "building_insurance",
      "impot_foncier",
      "energy_passport",
      "meter_rental",
      "major_repair",
      "vetuste_renewal",
    ] as const) {
      const d = decideRecharge(cat, "residential");
      expect(d.blocked).toBe(true);
      expect(d.rechargeable).toBe(false);
    }
  });

  it("allows genuine consumption charges with invoice evidence", () => {
    const d = decideRecharge("heating", "residential");
    expect(d.rechargeable).toBe(true);
    expect(d.requiresInvoiceEvidence).toBe(true);
  });

  it("lets commercial leases recharge per contract", () => {
    const d = decideRecharge("management_fee", "commercial");
    expect(d.blocked).toBe(false);
  });
});

describe("vétusté grid", () => {
  it("computes the tenant's residual share linearly with a floor", () => {
    const paint = DEFAULT_VETUSTE_GRID.find((g) => g.category === "paint")!;
    // 3.5 of 7 years → 50% worn → tenant pays 50%.
    const mid = computeVetuste(cents(1000), 3.5, paint);
    expect(mid.tenantShare).toBe(cents(500));
    // Fully worn → floor 10%.
    const old = computeVetuste(cents(1000), 12, paint);
    expect(old.tenantShare).toBe(cents(100));
    expect(old.ownerShare).toBe(cents(900));
  });
});

describe("syndic décompte mapping", () => {
  it("maps tantièmes and strips blocked lines with provenance", () => {
    const res = mapSyndicDecompte(
      [
        { label: "Chauffage collectif", category: "heating", totalBuilding: cents(12_000), tantiemes: 120, tantiemesTotal: 1000 },
        { label: "Honoraires syndic", category: "management_fee", totalBuilding: cents(6_000), tantiemes: 120, tantiemesTotal: 1000 },
        { label: "Assurance immeuble", category: "building_insurance", totalBuilding: cents(4_000), tantiemes: 120, tantiemesTotal: 1000 },
      ],
      "residential",
    );
    expect(res.lines[0].lotShare).toBe(cents(1_440));
    expect(res.lines[0].tenantRecoverable).toBe(cents(1_440));
    expect(res.lines[1].tenantRecoverable).toBe(0);
    expect(res.lines[1].blocked).toBe(true);
    expect(res.totalRecoverable).toBe(cents(1_440));
    expect(res.totalBlocked).toBe(cents(720 + 480));
  });
});
