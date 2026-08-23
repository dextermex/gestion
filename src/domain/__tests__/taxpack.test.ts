import { describe, expect, it } from "vitest";
import { TaxPackInput, buildTaxPack } from "@/domain/fiscal/taxpack";
import { cents } from "@/domain/money";

const rents = (monthly: number, months: number) =>
  Array.from({ length: months }, (_, i) => ({
    period: `2026-${String(i + 1).padStart(2, "0")}`,
    category: "dwelling" as const,
    amount: cents(monthly),
  }));

const base = (over: Partial<TaxPackInput> = {}): TaxPackInput => ({
  taxYear: 2026,
  propertyLabel: "Apt 2, 12 rue de la Gare",
  cadastralRef: "Luxembourg / Section A / 123/4567",
  buildingCompletedOn: "2005-06-01",
  monthsLet: 12,
  vacancyMonths: 0,
  receipts: rents(1850, 12),
  expenses: [],
  electedSpreadYears: null,
  priorSpreads: [],
  amortisation: null,
  ownerShare: 1,
  ownerResidency: "resident",
  socialRentalManagement: false,
  ...over,
});

describe("modèle 190/210 tax pack", () => {
  it("aggregates gross rents by category", () => {
    const pack = buildTaxPack(
      base({
        receipts: [
          ...rents(1850, 12),
          { period: "2026-01", category: "garage_parking", amount: cents(150) },
          { period: "2026-03", category: "retained_deposit", amount: cents(500) },
          { period: "2026-04", category: "tenant_recharge", amount: cents(200) },
        ],
      }),
    );
    expect(pack.grossRents.dwelling).toBe(cents(22_200));
    expect(pack.grossRents.garageParking).toBe(cents(150));
    expect(pack.grossRents.retainedDeposits).toBe(cents(500));
    // Recharges are pass-through, not taxable rent.
    expect(pack.grossRents.totalTaxable).toBe(cents(22_850));
  });

  it("excludes recharged expenses from the owner's deductions", () => {
    const pack = buildTaxPack(
      base({
        expenses: [
          { date: "2026-02-01", bucket: "maintenance_repairs", label: "Boiler fix", amount: cents(800), rechargedToTenant: false },
          { date: "2026-02-01", bucket: "permanent_charges", label: "Water recharged", amount: cents(600), rechargedToTenant: true },
        ],
      }),
    );
    const sectionA = pack.sections.find((s) => s.code === "A")!;
    expect(sectionA.amount).toBe(cents(800));
    const sectionF = pack.sections.find((s) => s.code === "F")!;
    expect(sectionF.lines.find((l) => l.label.includes("permanentes"))!.amount).toBe(0);
  });

  it("triggers the >50%-of-rent spreading rule and spreads over the elected years", () => {
    const pack = buildTaxPack(
      base({
        expenses: [
          { date: "2026-05-01", bucket: "maintenance_repairs", label: "Roof renovation", amount: cents(15_000), rechargedToTenant: false },
        ],
        electedSpreadYears: 5,
      }),
    );
    expect(pack.largeRepairs.triggered).toBe(true);
    expect(pack.largeRepairs.deductedThisYear).toBe(cents(3_000));
    expect(pack.largeRepairs.carryForward).toBe(cents(12_000));
  });

  it("lands prior-year spread instalments in §B2", () => {
    const pack = buildTaxPack(
      base({
        priorSpreads: [{ originYear: 2024, totalAmount: cents(10_000), spreadYears: 5, instalmentsTaken: 2 }],
      }),
    );
    expect(pack.largeRepairs.priorInstalments).toBe(cents(2_000));
  });

  it("compares itemised vs flat deduction (35% capped €2,700) with the 15-year age gate", () => {
    const eligible = buildTaxPack(base({ expenses: [] }));
    expect(eligible.flatComparison.eligible).toBe(true);
    // 35% of 22,200 = 7,770 → capped at 2,700.
    expect(eligible.flatComparison.flatAmount).toBe(cents(2_700));
    expect(eligible.flatComparison.recommendation).toBe("flat");

    const young = buildTaxPack(base({ buildingCompletedOn: "2020-01-01" }));
    expect(young.flatComparison.eligible).toBe(false);
    expect(young.flatComparison.recommendation).toBe("itemise");
  });

  it("keeps interest/impôt foncier/management deductible on top of the flat deduction", () => {
    const pack = buildTaxPack(
      base({
        expenses: [
          { date: "2026-01-15", bucket: "debt_interest", label: "BCEE loan", amount: cents(6_000), rechargedToTenant: false },
          { date: "2026-03-01", bucket: "impot_foncier", label: "Impôt foncier", amount: cents(300), rechargedToTenant: false },
          { date: "2026-06-01", bucket: "management_fees", label: "Gérance", amount: cents(1_200), rechargedToTenant: false },
        ],
      }),
    );
    expect(pack.flatComparison.alwaysDeductible).toBe(cents(7_500));
    // flat (2,700) + always (7,500) = 10,200 → net = 22,200 − 10,200
    expect(pack.netResult).toBe(cents(12_000));
    expect(pack.warnings.some((w) => w.includes("certificat"))).toBe(true);
  });

  it("applies the 90% social-rental exemption", () => {
    const pack = buildTaxPack(base({ socialRentalManagement: true }));
    const preExemption = pack.netResult + pack.socialExemptionApplied;
    expect(pack.socialExemptionApplied).toBe(Math.round(preExemption * 0.9));
  });

  it("produces the non-resident export with amortisation isolated", () => {
    const pack = buildTaxPack(
      base({
        ownerResidency: "non_resident",
        amortisation: {
          taxYear: 2026,
          regime: {
            regime: "normal_2",
            ratePct: 2,
            consumesAcceleratedSlot: false,
            cappedBase: cents(500_000),
            reason: "normal",
            note: "Normal",
          },
          buildingAmount: cents(10_000),
          energy: { applicable: false, ratePct: 0, amount: 0, yearsRemaining: 0, reason: "none", note: "" },
          totalAmount: cents(10_000),
          abattementSpecial: 0,
        },
      }),
    );
    expect(pack.nonResidentExport).not.toBeNull();
    expect(pack.nonResidentExport!.luxembourgOnlyAmortisation).toBe(cents(10_000));
    expect(pack.nonResidentExport!.note).toContain("No Luxembourg withholding");
  });

  it("splits the net by ownership share", () => {
    const pack = buildTaxPack(base({ ownerShare: 0.25 }));
    expect(pack.ownerShareNet).toBe(Math.round(pack.netResult * 0.25));
  });
});
