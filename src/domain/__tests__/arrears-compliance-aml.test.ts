import { describe, expect, it } from "vitest";
import { assessArrears } from "@/domain/arrears/ladder";
import {
  agConvocationDeadline,
  communeArrivalDeadline,
  cpeExpiryDeadline,
  deadlineStatus,
  syndicMandateDeadline,
  vacancyClock,
} from "@/domain/compliance/deadlines";
import { amlRetentionUntil, assessRisk, resolveCddTier, resolveUbo } from "@/domain/aml/engine";
import { cents } from "@/domain/money";

describe("arrears ladder", () => {
  const base = {
    invoiceId: "inv-1",
    dueDate: "2026-05-01",
    openAmount: cents(1850),
    paymentPlanActive: false,
    executed: {},
    miseEnDemeureArDate: null,
  };

  it("proposes the friendly reminder from D+3", () => {
    const res = assessArrears(base, "2026-05-05");
    expect(res.nextStep?.stage).toBe("friendly");
    expect(res.nextStep?.autoSend).toBe(true);
  });

  it("requires a registered letter for the mise en demeure and never auto-sends it", () => {
    const res = assessArrears({ ...base, executed: { friendly: "2026-05-05", formal: "2026-05-12" } }, "2026-06-01");
    expect(res.nextStep?.stage).toBe("mise_en_demeure");
    expect(res.nextStep?.autoSend).toBe(false);
    expect(res.nextStep?.requiresRegisteredLetter).toBe(true);
  });

  it("refuses the justice dossier without AR evidence", () => {
    const res = assessArrears(
      { ...base, executed: { friendly: "2026-05-05", formal: "2026-05-12", mise_en_demeure: "2026-05-26" } },
      "2026-07-01",
    );
    expect(res.nextStep).toBeNull();
    expect(res.notes.some((n) => n.includes("AR evidence"))).toBe(true);
  });

  it("unlocks the justice dossier once the AR exists", () => {
    const res = assessArrears(
      {
        ...base,
        executed: { friendly: "2026-05-05", formal: "2026-05-12", mise_en_demeure: "2026-05-26" },
        miseEnDemeureArDate: "2026-05-28",
      },
      "2026-07-01",
    );
    expect(res.nextStep?.stage).toBe("justice_dossier");
  });

  it("pauses the ladder under a payment plan", () => {
    const res = assessArrears({ ...base, paymentPlanActive: true }, "2026-07-01");
    expect(res.paused).toBe(true);
    expect(res.nextStep).toBeNull();
  });
});

describe("compliance deadlines", () => {
  it("computes CPE expiry at 10 years and statuses around it", () => {
    const d = cpeExpiryDeadline("12 rue de la Gare", "2017-03-01");
    expect(d.dueAt).toBe("2027-03-01");
    expect(deadlineStatus(d, "2026-08-23")).toBe("upcoming");
    expect(deadlineStatus(d, "2027-02-15")).toBe("due_soon");
    expect(deadlineStatus(d, "2027-04-01")).toBe("overdue");
    expect(deadlineStatus(d, "2027-04-01", "2027-02-20")).toBe("done");
  });

  it("computes the 8-day commune arrival window", () => {
    expect(communeArrivalDeadline("Jean Muller", "2026-09-01").dueAt).toBe("2026-09-09");
  });

  it("computes syndic mandate (3y) and AG convocation (15/8 days)", () => {
    expect(syndicMandateDeadline("Résidence Beaulieu", "2024-06-01").dueAt).toBe("2027-06-01");
    expect(agConvocationDeadline("Résidence Beaulieu", "2026-10-20", false).dueAt).toBe("2026-10-05");
    expect(agConvocationDeadline("Résidence Beaulieu", "2026-10-20", true).dueAt).toBe("2026-10-12");
  });

  it("runs the INOL vacancy clock with the [U] caveat", () => {
    const clock = vacancyClock("Apt 4A", "2026-01-10", "2026-08-23");
    expect(clock.inolTriggerAt).toBe("2026-07-10");
    expect(clock.triggered).toBe(true);
    expect(clock.note).toContain("[U]");
  });
});

describe("AML engine", () => {
  it("keeps an ordinary tenancy in the light tier", () => {
    const res = resolveCddTier({
      relationship: "tenancy",
      monthlyRent: cents(1850),
      counterpartyIsLegalEntity: false,
      cashMovements: [],
      onDate: "2026-08-23",
    });
    expect(res.tier).toBe("light");
  });

  it("triggers full CDD on ≥€10,000 rent, cash ≥€10,000 (linked), legal entities and sale mandates", () => {
    expect(
      resolveCddTier({ relationship: "letting_mandate", monthlyRent: cents(10_000), counterpartyIsLegalEntity: false, cashMovements: [], onDate: "2026-08-23" }).tier,
    ).toBe("full_cdd");
    expect(
      resolveCddTier({ relationship: "tenancy", monthlyRent: cents(2_000), counterpartyIsLegalEntity: false, cashMovements: [cents(6_000), cents(5_000)], onDate: "2026-08-23" }).tier,
    ).toBe("full_cdd");
    expect(
      resolveCddTier({ relationship: "tenancy", monthlyRent: cents(2_000), counterpartyIsLegalEntity: true, cashMovements: [], onDate: "2026-08-23" }).tier,
    ).toBe("full_cdd");
    expect(
      resolveCddTier({ relationship: "sale_mandate", monthlyRent: null, counterpartyIsLegalEntity: false, cashMovements: [], onDate: "2026-08-23" }).tier,
    ).toBe("full_cdd");
  });

  it("resolves UBOs through chained entities (>25% effective)", () => {
    const res = resolveUbo(
      [
        {
          name: "HoldCo SA",
          sharePct: 100,
          isNaturalPerson: false,
          children: [
            { name: "Alice", sharePct: 60, isNaturalPerson: true },
            { name: "Bob", sharePct: 20, isNaturalPerson: true },
            {
              name: "SubCo Sàrl",
              sharePct: 20,
              isNaturalPerson: false,
              children: [{ name: "Alice", sharePct: 100, isNaturalPerson: true }],
            },
          ],
        },
      ],
      "2026-08-23",
    );
    expect(res.complete).toBe(true);
    expect(res.ubos).toEqual([{ name: "Alice", effectivePct: 80 }]); // 60 + 20 via SubCo
  });

  it("flags incomplete chains ending at a legal entity", () => {
    const res = resolveUbo(
      [{ name: "Opaque Ltd", sharePct: 100, isNaturalPerson: false }],
      "2026-08-23",
    );
    expect(res.complete).toBe(false);
    expect(res.issues[0]).toContain("Opaque Ltd");
  });

  it("scores risk bands and review intervals", () => {
    const high = assessRisk({ countryRisk: "high", clientType: "legal_foreign", isPep: false, complexOwnership: true, cashIntensive: false });
    expect(high.band).toBe("high");
    expect(high.nextReviewMonths).toBe(12);
    const low = assessRisk({ countryRisk: "low", clientType: "natural_resident", isPep: false, complexOwnership: false, cashIntensive: false });
    expect(low.band).toBe("low");
  });

  it("computes retention 5 years from END of relationship", () => {
    expect(amlRetentionUntil("2026-03-31")).toBe("2031-03-31");
  });
});
