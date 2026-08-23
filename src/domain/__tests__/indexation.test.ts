import { describe, expect, it } from "vitest";
import {
  RevaluationTable,
  applyCommercialIndexation,
  checkRentCeiling,
  computeCapitalInvesti,
  detectIndexationLag,
  proposeResidentialAdjustment,
} from "@/domain/indexation/engine";
import { cents } from "@/domain/money";

const FLAT_TABLE: RevaluationTable = {
  circularRef: "test",
  status: "verified",
  coefficients: { 2000: 1.5, 2010: 1.2, 2020: 1.0, 2026: 1.0 },
};

describe("capital investi & rent ceiling", () => {
  it("revalues components and applies the 5% annual ceiling", () => {
    const res = computeCapitalInvesti(
      [
        { year: 2020, amount: cents(400_000), kind: "land" },
        { year: 2020, amount: cents(300_000), kind: "construction" },
      ],
      "2026-01-01",
      FLAT_TABLE,
    );
    expect(res.revaluedTotal).toBe(cents(700_000));
    expect(res.annualRentCeiling).toBe(cents(35_000));
    expect(res.monthlyRentCeiling).toBe(cents(35_000 / 12));
  });

  it("applies décote de vétusté (−2% per 2 years beyond 15) on construction, never land", () => {
    // 2000 → 2026 = 26 years old; beyond 15 = 11 → 5 full 2-year periods → −10%.
    const res = computeCapitalInvesti(
      [
        { year: 2000, amount: cents(100_000), kind: "construction" },
        { year: 2000, amount: cents(100_000), kind: "land" },
      ],
      "2026-01-01",
      FLAT_TABLE,
    );
    const construction = res.components.find((c) => c.component.kind === "construction")!;
    const land = res.components.find((c) => c.component.kind === "land")!;
    expect(construction.vetusteApplied).toBe(10);
    expect(construction.revalued).toBe(cents(100_000 * 1.5 * 0.9));
    expect(land.vetusteApplied).toBe(0);
    expect(land.revalued).toBe(cents(150_000));
  });

  it("checks colocation against COMBINED rents", () => {
    const capital = computeCapitalInvesti(
      [{ year: 2020, amount: cents(240_000), kind: "construction" }],
      "2026-01-01",
      FLAT_TABLE,
    );
    // Ceiling: 5% of 240k = 12k/yr = 1000/mo.
    const single = checkRentCeiling(cents(600), capital);
    expect(single.compliant).toBe(true);
    const combined = checkRentCeiling(cents(600), capital, { colocationCombinedRents: cents(1200) });
    expect(combined.compliant).toBe(false);
    expect(combined.excess).toBe(cents(200));
  });
});

describe("residential adjustment proposal", () => {
  const capital = computeCapitalInvesti(
    [{ year: 2020, amount: cents(480_000), kind: "construction" }],
    "2026-01-01",
    FLAT_TABLE,
  ); // ceiling 24k/yr → 2000/mo

  it("blocks adjustments inside the 24-month interval", () => {
    const res = proposeResidentialAdjustment({
      currentMonthlyRent: cents(1500),
      lastAdjustmentDate: "2025-01-01",
      leaseStartDate: "2022-01-01",
      proposedDate: "2026-06-01",
      capital,
    });
    expect(res.allowed).toBe(false);
    expect(res.nextAllowedDate).toBe("2027-01-01");
  });

  it("caps the step at +10% when below the ceiling", () => {
    const res = proposeResidentialAdjustment({
      currentMonthlyRent: cents(1500),
      lastAdjustmentDate: null,
      leaseStartDate: "2023-01-01",
      proposedDate: "2026-06-01",
      capital,
    });
    expect(res.allowed).toBe(true);
    expect(res.proposedMonthlyRent).toBe(cents(1650)); // 1500 × 1.10
    expect(res.bindingConstraint).toBe("step_cap");
  });

  it("binds at the 5% ceiling when the step cap would exceed it", () => {
    const res = proposeResidentialAdjustment({
      currentMonthlyRent: cents(1950),
      lastAdjustmentDate: null,
      leaseStartDate: "2023-01-01",
      proposedDate: "2026-06-01",
      capital,
    });
    expect(res.allowed).toBe(true);
    expect(res.proposedMonthlyRent).toBe(cents(2000));
    expect(res.bindingConstraint).toBe("ceiling");
  });

  it("refuses an increase when already at the ceiling", () => {
    const res = proposeResidentialAdjustment({
      currentMonthlyRent: cents(2000),
      lastAdjustmentDate: null,
      leaseStartDate: "2023-01-01",
      proposedDate: "2026-06-01",
      capital,
    });
    expect(res.allowed).toBe(false);
    expect(res.bindingConstraint).toBe("ceiling");
  });
});

describe("commercial IPC clause", () => {
  it("applies the contractual index ratio when the clause's frequency allows", () => {
    const res = applyCommercialIndexation({
      currentMonthlyRent: cents(4000),
      baseIndexValue: 100,
      minMonthsBetweenAdjustments: 12,
      lastAdjustmentDate: "2025-01-01",
      leaseStartDate: "2020-01-01",
      proposedDate: "2026-02-01",
      latestIndex: { month: "2026-01", value: 104.5 },
    });
    expect(res.allowed).toBe(true);
    expect(res.newMonthlyRent).toBe(cents(4180));
  });

  it("respects the clause frequency", () => {
    const res = applyCommercialIndexation({
      currentMonthlyRent: cents(4000),
      baseIndexValue: 100,
      minMonthsBetweenAdjustments: 12,
      lastAdjustmentDate: "2025-09-01",
      leaseStartDate: "2020-01-01",
      proposedDate: "2026-02-01",
      latestIndex: { month: "2026-01", value: 104.5 },
    });
    expect(res.allowed).toBe(false);
  });
});

describe("INDEXATION_LAG detection", () => {
  it("detects a standing order stuck at the previous rent", () => {
    const hit = detectIndexationLag(cents(1500), cents(1650), cents(1500));
    expect(hit?.detected).toBe(true);
    expect(hit?.shortfall).toBe(cents(150));
  });

  it("stays silent when amounts differ from the old rent", () => {
    expect(detectIndexationLag(cents(1400), cents(1650), cents(1500))).toBeNull();
    expect(detectIndexationLag(cents(1650), cents(1650), cents(1500))).toBeNull();
    expect(detectIndexationLag(cents(1500), cents(1650), null)).toBeNull();
  });
});
