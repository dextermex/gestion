import { describe, expect, it } from "vitest";
import { allowedWorkOrderActions, isTicketClosed, nextWorkOrderStep, stepAlreadyTaken, ticketAfterStep, ticketForRequestStatus, visitHasHour, visitHour, visitInstant } from "@/lib/gestion/interventions";
import { visitWhen } from "@/lib/portal/format";
import { requestState } from "@/lib/portal/types";
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

describe("a request's status, whichever screen moves it", () => {
  const tenant = (status: Parameters<typeof ticketAfterStep>[1]["status"]) => ({ status, source: "tenant" });
  const desk = (status: Parameters<typeof ticketAfterStep>[1]["status"]) => ({ status, source: "manager" });

  it("never sends a request backwards when a tradesperson is assigned or a visit planned", () => {
    // Marked "in progress" in Messages, then handed to a tradesperson: it stays in progress, for the desk and the tenant.
    expect(ticketAfterStep("assign", tenant("in_progress"))).toEqual({ status: "in_progress", closure: "clear" });
    expect(requestState("in_progress")).toBe("in_progress");
    // From a new request, the hand-over qualifies it: no longer "sent" for the tenant, no longer "to handle" at the desk.
    const assigned = ticketAfterStep("assign", tenant("new"));
    expect(assigned).toEqual({ status: "triaged", closure: "clear" });
    expect(requestState("triaged")).toBe("in_progress");
    // Planning moves it forward; assigning again afterwards (another tradesperson) does not move it back.
    expect(ticketAfterStep("schedule", tenant("triaged"))).toEqual({ status: "scheduled", closure: "clear" });
    expect(ticketAfterStep("assign", tenant("scheduled"))).toEqual({ status: "scheduled", closure: "clear" });
    expect(ticketAfterStep("decline", tenant("triaged"))).toEqual({ status: "offered", closure: "clear" });
    expect(ticketAfterStep("decline", tenant("in_progress"))).toEqual({ status: "in_progress", closure: "clear" });
  });

  it("does not reopen a resolved or refused request by a step: that takes the explicit reopening", () => {
    for (const closed of ["done", "closed", "cancelled"] as const) {
      expect(isTicketClosed(closed)).toBe(true);
      for (const action of ["assign", "schedule", "decline"] as const) expect(ticketAfterStep(action, tenant(closed))).toBe("request_closed");
    }
    // A refused request takes no "work done" either.
    for (const action of ["done", "invoice", "paid"] as const) expect(ticketAfterStep(action, tenant("cancelled"))).toBe("request_closed");
    expect(["new", "triaged", "offered", "scheduled", "in_progress", "pending_tenant"].map((s) => isTicketClosed(s as "new"))).toEqual([false, false, false, false, false, false]);
  });

  it("dates the closure once: the invoice and the payment do not move the day the work was done", () => {
    expect(ticketAfterStep("done", tenant("scheduled"))).toEqual({ status: "done", closure: "set" });
    expect(ticketAfterStep("invoice", tenant("done"))).toEqual({ status: "done", closure: "keep" });
    expect(ticketAfterStep("paid", tenant("done"))).toEqual({ status: "closed", closure: "keep" });
    // Resolved early in Messages, the work order finished afterwards: still resolved, the same day.
    expect(ticketAfterStep("done", tenant("done"))).toEqual({ status: "done", closure: "keep" });
    expect(ticketAfterStep("invoice", tenant("closed"))).toEqual({ status: "closed", closure: "keep" });
  });

  it("cancels the intervention without refusing the tenant's request; a ticket raised at the desk is cancelled with it", () => {
    expect(ticketAfterStep("cancel", tenant("scheduled"))).toEqual({ status: "triaged", closure: "keep" });
    expect(ticketAfterStep("cancel", tenant("offered"))).toEqual({ status: "triaged", closure: "keep" });
    expect(ticketAfterStep("cancel", tenant("in_progress"))).toEqual({ status: "in_progress", closure: "keep" });
    expect(ticketAfterStep("cancel", tenant("new"))).toEqual({ status: "new", closure: "keep" });
    expect(requestState("triaged")).not.toBe("refused");
    expect(ticketAfterStep("cancel", desk("scheduled"))).toEqual({ status: "cancelled", closure: "set" });
    // Already closed: the leftover work order is cancelled, the request is left as it was.
    expect(ticketAfterStep("cancel", tenant("done"))).toEqual({ status: "done", closure: "keep" });
  });

  it("heals a closing step that stopped halfway: asked again, only the ticket is brought along", () => {
    expect(stepAlreadyTaken("done", "done")).toBe(true);
    expect(stepAlreadyTaken("invoiced", "invoice")).toBe(true);
    expect(stepAlreadyTaken("paid", "paid")).toBe(true);
    expect(stepAlreadyTaken("done", "paid")).toBe(false);
    expect(stepAlreadyTaken("declined", "cancel")).toBe(false);
    expect(stepAlreadyTaken("accepted", "assign")).toBe(false);
  });

  it("writes the desk's four statuses with the work order in view", () => {
    const at = (status: Parameters<typeof ticketForRequestStatus>[1]["status"], workOrder: Parameters<typeof ticketForRequestStatus>[1]["workOrder"] = null) => ({ status, workOrder });
    // No intervention: the plain status of each family.
    expect(ticketForRequestStatus("todo", at("in_progress"))).toEqual({ status: "new", closure: "clear", held: false });
    expect(ticketForRequestStatus("in_progress", at("new"))).toEqual({ status: "in_progress", closure: "clear", held: false });
    expect(ticketForRequestStatus("resolved", at("in_progress"))).toEqual({ status: "done", closure: "set", held: false });
    expect(ticketForRequestStatus("refused", at("new"))).toEqual({ status: "cancelled", closure: "set", held: false });
    // The same closure asked twice keeps its day; a different one is a new closure.
    expect(ticketForRequestStatus("resolved", at("closed", "paid"))).toEqual({ status: "closed", closure: "keep", held: false });
    expect(ticketForRequestStatus("refused", at("cancelled"))).toEqual({ status: "cancelled", closure: "keep", held: false });
    expect(ticketForRequestStatus("refused", at("done"))).toEqual({ status: "cancelled", closure: "set", held: false });
    // An intervention under way: "to handle" is not what the request is. It stays in progress, and the desk is told.
    expect(ticketForRequestStatus("todo", at("scheduled", "scheduled"))).toEqual({ status: "scheduled", closure: "clear", held: true });
    expect(ticketForRequestStatus("todo", at("triaged", "accepted"))).toEqual({ status: "triaged", closure: "clear", held: true });
    // A work order only offered, or declined, holds nothing.
    expect(ticketForRequestStatus("todo", at("offered", "offered"))).toEqual({ status: "new", closure: "clear", held: false });
    expect(ticketForRequestStatus("todo", at("in_progress", "declined"))).toEqual({ status: "new", closure: "clear", held: false });
    // "In progress" does not flatten a planned request.
    expect(ticketForRequestStatus("in_progress", at("scheduled", "scheduled"))).toEqual({ status: "scheduled", closure: "clear", held: false });
    // The explicit reopening: the work order says where the request stands again.
    expect(ticketForRequestStatus("in_progress", at("done", "scheduled"))).toEqual({ status: "scheduled", closure: "clear", held: false });
    expect(ticketForRequestStatus("in_progress", at("cancelled", "accepted"))).toEqual({ status: "triaged", closure: "clear", held: false });
    expect(ticketForRequestStatus("todo", at("closed", "paid"))).toEqual({ status: "in_progress", closure: "clear", held: true });
    expect(ticketForRequestStatus("in_progress", at("done"))).toEqual({ status: "in_progress", closure: "clear", held: false });
  });
});

describe("a planned visit", () => {
  it("is kept for the day alone when no hour was entered, and no screen prints one", () => {
    const at = visitInstant("2026-08-28", null)!;
    expect(at).toBe("2026-08-28T12:00:01.000Z");
    expect(visitHasHour(at)).toBe(false);
    expect(visitHasHour("2026-08-28T12:00:01+00:00")).toBe(false);
    expect(visitHour(at)).toBe("");
    expect(visitWhen(at, "fr")).toEqual({ date: "ven. 28 août", time: "" });
    // The same calendar day in UTC and in Luxembourg, winter and summer.
    expect(at.slice(0, 10)).toBe("2026-08-28");
    expect(visitInstant("2026-01-15", "")?.slice(0, 10)).toBe("2026-01-15");
  });

  it("is kept at the hour the desk entered, on Luxembourg's clock", () => {
    // 08:30 in Luxembourg is 06:30 UTC in summer and 07:30 UTC in winter.
    expect(visitInstant("2026-08-28", "08:30")).toBe("2026-08-28T06:30:00.000Z");
    expect(visitInstant("2026-01-15", "08:30")).toBe("2026-01-15T07:30:00.000Z");
    // The days the clocks change: 29 March 2026 (forward), 25 October 2026 (back).
    expect(visitInstant("2026-03-29", "09:00")).toBe("2026-03-29T07:00:00.000Z");
    expect(visitInstant("2026-10-25", "09:00")).toBe("2026-10-25T08:00:00.000Z");
    const at = visitInstant("2026-08-28", "08:30")!;
    expect([visitHasHour(at), visitHour(at)]).toEqual([true, "08:30"]);
    expect(visitHour("2026-01-15T07:30:00+00:00")).toBe("08:30");
    expect(visitWhen(at, "fr")).toEqual({ date: "ven. 28 août", time: "08:30" });
    // 13:00 in winter is noon UTC, to the second: an hour somebody chose, and printed.
    expect(visitHasHour(visitInstant("2026-01-15", "13:00")!)).toBe(true);
  });

  it("refuses what is not a day or an hour", () => {
    expect(visitInstant("28/08/2026", null)).toBeNull();
    expect(visitInstant("2026-13-40", null)).toBeNull();
    expect(visitInstant("2026-08-28", "25:00")).toBeNull();
    expect(visitInstant("2026-08-28", "8h30")).toBeNull();
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
