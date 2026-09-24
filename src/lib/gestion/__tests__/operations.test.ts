import { describe, expect, it } from "vitest";
import { allowedWorkOrderActions, nextWorkOrderStep } from "@/lib/gestion/interventions";
import { advancesBilledForYear, computeChargePeriod, decompteBalance } from "@/lib/gestion/charges";
import { depositTransitionAllowed, releaseDecision, settlementOpen } from "@/lib/gestion/deposits";
import { adjustmentLetterState, monthAfter } from "@/lib/gestion/indexation";
import { computeSettlement } from "@/domain/deposits/settlement";

/**
 * The rules the operations routes enforce, as tables: an intervention moves
 * only along its ladder and the ticket follows; a décompte's lines are
 * computed and a residential hard block reaches the tenant as zero; a
 * guarantee releases its two tranches once each, the balance only after the
 * décompte.
 */
describe("interventions", () => {
  it("walks offered → accepted → scheduled → done → invoiced → paid, the ticket following", () => {
    expect(nextWorkOrderStep("offered", "assign")).toEqual({ status: "accepted", ticketStatus: "triaged", closes: false });
    expect(nextWorkOrderStep("accepted", "schedule")).toEqual({ status: "scheduled", ticketStatus: "scheduled", closes: false });
    expect(nextWorkOrderStep("scheduled", "done")).toEqual({ status: "done", ticketStatus: "done", closes: true });
    expect(nextWorkOrderStep("done", "invoice")).toEqual({ status: "invoiced", ticketStatus: "done", closes: true });
    expect(nextWorkOrderStep("invoiced", "paid")).toEqual({ status: "paid", ticketStatus: "closed", closes: true });
  });
  it("refuses a step out of order, and offers only what is open", () => {
    expect(nextWorkOrderStep("offered", "paid")).toBeNull();
    expect(nextWorkOrderStep("done", "schedule")).toBeNull();
    expect(nextWorkOrderStep("paid", "cancel")).toBeNull();
    expect(allowedWorkOrderActions("offered")).toEqual(["assign", "decline", "cancel"]);
    expect(allowedWorkOrderActions("invoiced")).toEqual(["paid"]);
    expect(nextWorkOrderStep("accepted", "decline")).toEqual({ status: "declined", ticketStatus: "offered", closes: false });
    expect(nextWorkOrderStep("declined", "assign")?.status).toBe("accepted");
  });
});

describe("charges", () => {
  it("computes the lot share from tantièmes and lets the engine zero a residential hard block", () => {
    const period = computeChargePeriod(
      [
        { label: "Chauffage", category: "heating", buildingTotalCents: 1_840_000, tantiemes: 118, tantiemesTotal: 1000 },
        { label: "Honoraires syndic", category: "management_fee", buildingTotalCents: 780_000, tantiemes: 118, tantiemesTotal: 1000 },
        { label: "Compteur eau", category: "water", lotShareCents: 12_050 },
      ],
      "residential",
    );
    expect("problem" in period).toBe(false);
    if ("problem" in period) return;
    expect(period.lines[0]).toMatchObject({ lotShareCents: 217_120, tenantShareCents: 217_120, blocked: false });
    expect(period.lines[1]).toMatchObject({ lotShareCents: 92_040, tenantShareCents: 0, blocked: true });
    expect(period.lines[2]).toMatchObject({ lotShareCents: 12_050, tenantShareCents: 12_050, buildingTotalCents: null });
    expect(period.actualCents).toBe(229_170);
    expect(period.blockedCents).toBe(92_040);
  });
  it("names the line and the field a décompte lacks", () => {
    expect(computeChargePeriod([{ label: "", category: "heating", lotShareCents: 1 }], "residential")).toEqual({ problem: "label", index: 0 });
    expect(computeChargePeriod([{ label: "x", category: "heating" as never, tantiemes: 5 }], "residential")).toEqual({ problem: "share", index: 0 });
    expect(computeChargePeriod([{ label: "x", category: "nope" as never, lotShareCents: 1 }], "residential")).toEqual({ problem: "category", index: 0 });
  });
  it("sums the year's advances from the ledger and signs the balance", () => {
    const periods = [
      { period: "2025-11", chargesCents: 15_000 },
      { period: "2025-12", chargesCents: 15_000 },
      { period: "2026-01", chargesCents: 15_000 },
    ];
    expect(advancesBilledForYear(periods, 2025)).toBe(30_000);
    expect(decompteBalance(229_170, 180_000)).toBe(49_170);
    expect(decompteBalance(100_000, 180_000)).toBe(-80_000);
  });
});

describe("guarantees", () => {
  const settlement = computeSettlement({
    depositAmount: 290_000,
    depositForm: "cash",
    monthlyRent: 145_000,
    keyHandoverDate: "2026-09-01",
    decompteIssuedAt: null,
    entryEdlExists: true,
    deductions: [{ id: "d1", kind: "arrears", label: "Loyer août", amount: 40_000, justificationDocRef: "relevé", justifiedAt: "2026-09-02" }],
    miseEnDemeureArDate: null,
    releasedFirstTranche: 0,
    releasedBalance: 0,
    asOf: "2026-09-10",
  });
  it("releases the first tranche once, and the balance only after the décompte", () => {
    const first = releaseDecision("first", settlement, { releasedFirstTrancheCents: 0, releasedBalanceCents: 0, decompteIssuedOn: null });
    expect(first).toEqual({ amountCents: 145_000, nextStatus: "partially_released" });
    expect(releaseDecision("first", settlement, { releasedFirstTrancheCents: 145_000, releasedBalanceCents: 0, decompteIssuedOn: null })).toEqual({ refused: "already" });
    expect(releaseDecision("balance", settlement, { releasedFirstTrancheCents: 145_000, releasedBalanceCents: 0, decompteIssuedOn: null })).toEqual({ refused: "needs_decompte" });
    const after = computeSettlement({ ...settlementInput(), releasedFirstTranche: 145_000, decompteIssuedAt: "2026-09-20" });
    expect(releaseDecision("balance", after, { releasedFirstTrancheCents: 145_000, releasedBalanceCents: 0, decompteIssuedOn: "2026-09-20" })).toEqual({ amountCents: 105_000, nextStatus: "released" });
  });
  it("lets a person record only the moves that are theirs", () => {
    expect(depositTransitionAllowed("pending", "held")).toBe(true);
    expect(depositTransitionAllowed("held", "released")).toBe(false);
    expect(depositTransitionAllowed("release_pending", "disputed")).toBe(true);
    expect(depositTransitionAllowed("released", "held")).toBe(false);
    expect(settlementOpen("release_pending", "2026-09-01")).toBe(true);
    expect(settlementOpen("held", null)).toBe(false);
  });
  function settlementInput() {
    return {
      depositAmount: 290_000,
      depositForm: "cash" as const,
      monthlyRent: 145_000,
      keyHandoverDate: "2026-09-01",
      decompteIssuedAt: null as string | null,
      entryEdlExists: true,
      deductions: [{ id: "d1", kind: "arrears" as const, label: "Loyer août", amount: 40_000, justificationDocRef: "relevé", justifiedAt: "2026-09-02" }],
      miseEnDemeureArDate: null,
      releasedFirstTranche: 0,
      releasedBalance: 0,
      asOf: "2026-09-25",
    };
  }
});

describe("adjustment letters", () => {
  const dispatched = { id: "L1", status: "dispatched" as const, dispatchedOn: "2026-03-02", arReceivedOn: null };
  const received = { id: "L2", status: "ar_received" as const, dispatchedOn: "2026-03-02", arReceivedOn: "2026-03-09" };
  it("applies from the month after the AR, and never from the dispatch", () => {
    expect(monthAfter("2026-03-09")).toBe("2026-04-01");
    expect(monthAfter("2026-12-31")).toBe("2027-01-01");
    expect(adjustmentLetterState([received], null)).toEqual({ kind: "ar_received", letter: received, effectiveFrom: "2026-04-01" });
    expect(adjustmentLetterState([dispatched], null)).toEqual({ kind: "awaiting_ar", letter: dispatched });
  });
  it("spends a letter once an adjustment was applied after its AR, and ignores one that came back", () => {
    expect(adjustmentLetterState([received], "2026-04-01")).toEqual({ kind: "none" });
    expect(adjustmentLetterState([received], "2026-03-01")).toMatchObject({ kind: "ar_received" });
    expect(adjustmentLetterState([{ ...dispatched, status: "returned_undelivered" }], null)).toEqual({ kind: "none" });
    expect(adjustmentLetterState([], null)).toEqual({ kind: "none" });
  });
});
