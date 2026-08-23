import { describe, expect, it } from "vitest";
import { computeSettlement } from "@/domain/deposits/settlement";
import { cents } from "@/domain/money";

const base = {
  depositAmount: cents(3700), // 2 months of €1,850
  depositForm: "cash" as const,
  monthlyRent: cents(1850),
  keyHandoverDate: "2026-06-15",
  decompteIssuedAt: null,
  entryEdlExists: true,
  deductions: [],
  miseEnDemeureArDate: null,
  releasedFirstTranche: 0,
  releasedBalance: 0,
  asOf: "2026-06-20",
};

describe("deposit settlement engine", () => {
  it("schedules the 50% tranche 1 month after key handover", () => {
    const res = computeSettlement(base);
    expect(res.firstTrancheDueAt).toBe("2026-07-15");
    expect(res.firstTrancheAmount).toBe(cents(1850));
    expect(res.balanceDueAt).toBeNull();
  });

  it("zeroes damage deductions entirely when no entry EDL exists", () => {
    const res = computeSettlement({
      ...base,
      entryEdlExists: false,
      deductions: [
        { id: "d1", kind: "damage", label: "Broken door", amount: cents(400) },
        { id: "d2", kind: "arrears", label: "Unpaid July", amount: cents(1850), justificationDocRef: "inv-1", justifiedAt: "2026-06-16" },
      ],
    });
    const damage = res.lines.find((l) => l.id === "d1")!;
    expect(damage.status).toBe("blocked_no_entry_edl");
    expect(damage.retained).toBe(0);
    expect(res.totalRetained).toBe(cents(1850));
  });

  it("forfeits deductions left unjustified past the 1-month window", () => {
    const res = computeSettlement({
      ...base,
      asOf: "2026-08-01",
      deductions: [{ id: "d1", kind: "damage", label: "Repaint wall", amount: cents(300) }],
    });
    expect(res.lines[0].status).toBe("expired_forfeited");
    expect(res.totalRetained).toBe(0);
  });

  it("keeps justified deductions retained", () => {
    const res = computeSettlement({
      ...base,
      asOf: "2026-08-01",
      deductions: [
        {
          id: "d1",
          kind: "damage",
          label: "Repaint wall",
          amount: cents(300),
          justificationDocRef: "devis-12",
          justifiedAt: "2026-07-01",
        },
      ],
    });
    expect(res.lines[0].status).toBe("justified");
    expect(res.totalRetained).toBe(cents(300));
  });

  it("accrues 10% of monthly rent per COMMENCED month after mise en demeure", () => {
    const res = computeSettlement({
      ...base,
      asOf: "2026-09-16", // AR 2026-08-01 → 1 full month + 15 days = 2 commenced
      miseEnDemeureArDate: "2026-08-01",
    });
    expect(res.penaltyMonths).toBe(2);
    expect(res.penaltyAccrued).toBe(cents(370)); // 185 × 2
  });

  it("computes the balance clock from the décompte date", () => {
    const res = computeSettlement({ ...base, decompteIssuedAt: "2026-09-30" });
    expect(res.balanceDueAt).toBe("2026-10-30");
    expect(res.balanceAmount).toBe(cents(1850));
  });

  it("warns when the first tranche is overdue without a mise en demeure yet", () => {
    const res = computeSettlement({ ...base, asOf: "2026-07-20" });
    expect(res.warnings.some((w) => w.includes("overdue"))).toBe(true);
  });
});
