import { describe, expect, it } from "vitest";
import {
  AcquisitionFacts,
  computeDepreciationBase,
  computeYearAmortisation,
  planTaxpayerYear,
  resolveRegime,
} from "@/domain/fiscal/amortisation";
import { cents } from "@/domain/money";

const facts = (over: Partial<AcquisitionFacts> = {}): AcquisitionFacts => ({
  acquiredOn: "2024-03-15",
  completedOn: "2024-01-01",
  totalPrice: cents(800_000),
  landPrice: cents(160_000),
  vatPaid: cents(24_000),
  deedCosts: cents(56_000),
  investments: 0,
  energyWorksCost: 0,
  energyWorksCompletedOn: null,
  klimabonusReceived: 0,
  vefa2024Eligible: false,
  ...over,
});

describe("depreciation base", () => {
  it("uses the actual land price when known", () => {
    const base = computeDepreciationBase(facts(), "2026-01-01");
    expect(base.landRule).toBe("actual");
    expect(base.base).toBe(cents(800_000 + 56_000 + 24_000 - 160_000));
  });

  it("applies the 20% default land rule on (price + deed costs) when unknown", () => {
    const base = computeDepreciationBase(facts({ landPrice: null }), "2026-01-01");
    expect(base.landRule).toBe("default_20pct");
    expect(base.landShare).toBe(cents((800_000 + 56_000) * 0.2));
  });

  it("nets Klimabonus out of the energy base", () => {
    const base = computeDepreciationBase(
      facts({ energyWorksCost: cents(80_000), klimabonusReceived: cents(30_000) }),
      "2026-01-01",
    );
    expect(base.energyBase).toBe(cents(50_000));
  });
});

describe("regime resolution", () => {
  it("grants 4% accelerated inside the 5-year window when a slot is free", () => {
    const f = facts();
    const base = computeDepreciationBase(f, "2026-01-01");
    const r = resolveRegime(f, base, 2026, 0);
    expect(r.regime).toBe("accelerated_4");
    expect(r.consumesAcceleratedSlot).toBe(true);
  });

  it("falls back to 2% when the taxpayer's 2 slots are exhausted", () => {
    const f = facts();
    const base = computeDepreciationBase(f, "2026-01-01");
    const r = resolveRegime(f, base, 2026, 2);
    expect(r.regime).toBe("normal_2");
    expect(r.note).toContain("limit is exhausted");
  });

  it("reverts to 2% after 5 years since completion", () => {
    const f = facts({ completedOn: "2020-06-01", acquiredOn: "2021-02-01" });
    const base = computeDepreciationBase(f, "2026-01-01");
    expect(resolveRegime(f, base, 2026, 0).regime).toBe("normal_2");
  });

  it("keeps the VEFA-2024 closed cohort at 6% with the €250,000 base cap", () => {
    const f = facts({ vefa2024Eligible: true, acquiredOn: "2024-06-01" });
    const base = computeDepreciationBase(f, "2028-01-01");
    const r = resolveRegime(f, base, 2028, 0);
    expect(r.regime).toBe("vefa2024_6");
    expect(r.ratePct).toBe(6);
    expect(r.cappedBase).toBe(cents(250_000));
    // 6 years after the deed year the cohort closes:
    expect(resolveRegime(f, base, 2030, 0).regime).not.toBe("vefa2024_6");
  });

  it("grandfathers pre-2021 acquisitions at 6% until 2026 inclusive", () => {
    const f = facts({ acquiredOn: "2020-06-01", completedOn: "2020-06-01" });
    const base = computeDepreciationBase(f, "2026-01-01");
    expect(resolveRegime(f, base, 2025, 0).regime).toBe("grandfathered_6");
    expect(resolveRegime(f, base, 2027, 0).regime).toBe("normal_2");
  });
});

describe("year amortisation with abattement", () => {
  it("computes 4% + abattement (1% of the 4% base, capped €10,000)", () => {
    const res = computeYearAmortisation(facts(), 2026, {
      acceleratedSlotsUsed: 0,
      abattementAlreadyUsed: 0,
      jointlyTaxed: false,
    });
    const base = cents(800_000 + 56_000 + 24_000 - 160_000); // 720k
    expect(res.buildingAmount).toBe(Math.round(base * 0.04));
    // 1% of 720k = 7,200 < 10,000 cap
    expect(res.abattementSpecial).toBe(Math.round(base * 0.01));
  });

  it("caps the abattement at taxpayer level (€10,000, €20,000 joint)", () => {
    const res = computeYearAmortisation(facts({ totalPrice: cents(1_500_000), landPrice: cents(300_000) }), 2026, {
      acceleratedSlotsUsed: 0,
      abattementAlreadyUsed: cents(4_000),
      jointlyTaxed: false,
    });
    // Base = 1.5M + 56k + 24k − 300k = 1.28M → 1% = 12,800 → capped to 10,000 − 4,000 used = 6,000
    expect(res.abattementSpecial).toBe(cents(6_000));
    const joint = computeYearAmortisation(facts({ totalPrice: cents(1_500_000), landPrice: cents(300_000) }), 2026, {
      acceleratedSlotsUsed: 0,
      abattementAlreadyUsed: cents(4_000),
      jointlyTaxed: true,
    });
    expect(joint.abattementSpecial).toBe(cents(12_800));
  });

  it("switches the energy add-on 6% → 10% in tax year 2026", () => {
    const f = facts({
      energyWorksCost: cents(80_000),
      klimabonusReceived: cents(30_000),
      energyWorksCompletedOn: "2023-05-01",
    });
    const y2025 = computeYearAmortisation(f, 2025, { acceleratedSlotsUsed: 2, abattementAlreadyUsed: 0, jointlyTaxed: false });
    expect(y2025.energy.ratePct).toBe(6);
    expect(y2025.energy.amount).toBe(cents(3_000));
    const y2026 = computeYearAmortisation(f, 2026, { acceleratedSlotsUsed: 2, abattementAlreadyUsed: 0, jointlyTaxed: false });
    expect(y2026.energy.ratePct).toBe(10);
    expect(y2026.energy.amount).toBe(cents(5_000));
  });

  it("requires Klimabonus for the energy rate", () => {
    const f = facts({ energyWorksCost: cents(80_000), energyWorksCompletedOn: "2023-05-01" });
    const res = computeYearAmortisation(f, 2026, { acceleratedSlotsUsed: 0, abattementAlreadyUsed: 0, jointlyTaxed: false });
    expect(res.energy.applicable).toBe(false);
    expect(res.energy.note).toContain("Klimabonus");
  });
});

describe("taxpayer-level portfolio plan (max-2-buildings)", () => {
  it("allocates the two 4% slots to the highest bases and waitlists the third", () => {
    const plan = planTaxpayerYear(
      [
        { propertyId: "a", label: "A", ownershipShare: 1, facts: facts({ totalPrice: cents(500_000), landPrice: cents(100_000) }) },
        { propertyId: "b", label: "B", ownershipShare: 1, facts: facts({ totalPrice: cents(900_000), landPrice: cents(180_000) }) },
        { propertyId: "c", label: "C", ownershipShare: 1, facts: facts({ totalPrice: cents(700_000), landPrice: cents(140_000) }) },
      ],
      2026,
      { jointlyTaxed: false },
    );
    expect(plan.acceleratedSlotsUsed).toBe(2);
    expect(plan.slotWaitlist).toEqual(["a"]);
    const regimes = Object.fromEntries(plan.rows.map((r) => [r.propertyId, r.result.regime.regime]));
    expect(regimes.b).toBe("accelerated_4");
    expect(regimes.c).toBe("accelerated_4");
    expect(regimes.a).toBe("normal_2");
  });

  it("respects ownership shares in the taxpayer totals", () => {
    const plan = planTaxpayerYear(
      [{ propertyId: "a", label: "A", ownershipShare: 0.5, facts: facts() }],
      2026,
      { jointlyTaxed: false },
    );
    expect(plan.rows[0].taxpayerShareAmount).toBe(Math.round(plan.rows[0].result.totalAmount * 0.5));
  });

  it("caps the shared abattement across properties", () => {
    const big = facts({ totalPrice: cents(1_200_000), landPrice: cents(240_000) });
    const plan = planTaxpayerYear(
      [
        { propertyId: "a", label: "A", ownershipShare: 1, facts: big },
        { propertyId: "b", label: "B", ownershipShare: 1, facts: big },
      ],
      2026,
      { jointlyTaxed: false },
    );
    expect(plan.totalAbattement).toBe(cents(10_000));
  });
});
