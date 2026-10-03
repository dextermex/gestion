import { describe, expect, it } from "vitest";
import { BILLED_UNIT_KINDS, PLANS, PLAN_IDS, RHYTHMS, bestPlan, billedLots, quote, yearlyDiscountPct } from "@/domain/billing/plans";
import { DAY, billingState, canExtend, checkoutTrial, extendedEnd, reminderDue, trialEndOf, type BillingFacts } from "@/domain/billing/trial";
import { isLettable } from "@/lib/gestion/portfolio";
import type { DemoUnit } from "@/lib/demo/data";

const NOW = 1_790_000_000;

describe("subscription catalogue", () => {
  it("charges exactly the monthly figure times the months, in whole cents", () => {
    for (const plan of PLAN_IDS) {
      for (const rhythm of RHYTHMS) {
        const q = quote(plan, rhythm, 7, 2);
        expect(Number.isInteger(q.monthly)).toBe(true);
        expect(q.charged).toBe(q.monthly * q.months);
      }
    }
  });

  it("prices the landlord plan per lot, the professional plan per lot and per user", () => {
    expect(quote("landlord", "quarter", 12, 3)).toMatchObject({ lots: 12, seats: 0, monthly: 6000, charged: 18000, months: 3 });
    expect(quote("landlord", "year", 12, 3)).toMatchObject({ monthly: 4800, charged: 57600, months: 12, yearlySaving: 14400 });
    expect(quote("professional", "quarter", 60, 2)).toMatchObject({ lots: 60, seats: 2, monthly: 60 * 400 + 2 * 2900, charged: (60 * 400 + 2 * 2900) * 3 });
  });

  it("bills at least one lot and one user, and says when a portfolio outgrows the plan", () => {
    expect(quote("landlord", "quarter", 0, 0)).toMatchObject({ lots: 1, monthly: 500 });
    expect(quote("professional", "quarter", 0, 0)).toMatchObject({ lots: 1, seats: 1, monthly: 400 + 2900 });
    expect(quote("landlord", "quarter", 51, 1).fits).toBe(false);
    expect(quote("professional", "quarter", 400, 1).fits).toBe(true);
  });

  it("recommends the plan that costs the portfolio least among those that take it", () => {
    expect(bestPlan(3, 1, "quarter")).toBe("landlord");
    expect(bestPlan(29, 1, "quarter")).toBe("landlord");
    expect(bestPlan(40, 1, "quarter")).toBe("professional");
    expect(bestPlan(45, 5, "quarter")).toBe("landlord");
    expect(bestPlan(51, 9, "quarter")).toBe("professional");
  });

  it("gives the yearly rhythm a whole-percent discount on both plans", () => {
    expect(yearlyDiscountPct("landlord")).toBe(20);
    expect(yearlyDiscountPct("professional")).toBe(20);
    expect(PLANS.professional.seat!.year).toBe(Math.round(PLANS.professional.seat!.quarter * 0.8));
  });

  it("counts the lots that carry a lease of their own, as the portfolio does", () => {
    const kinds: DemoUnit["kind"][] = ["dwelling", "commercial", "office", "parking", "cellar", "other"];
    for (const kind of kinds) expect(BILLED_UNIT_KINDS.includes(kind)).toBe(isLettable({ kind }));
    expect(billedLots(kinds.map((kind) => ({ kind })))).toBe(3);
  });
});

const facts = (over: Partial<BillingFacts> = {}): BillingFacts => ({ now: NOW, trialEnd: NOW + 20 * DAY, subscription: null, ...over });

describe("trial and subscription state", () => {
  it("runs the trial without a card, louder in its last week and last two days", () => {
    expect(billingState(facts())).toMatchObject({ phase: "trial", daysLeft: 20, nudge: "quiet", writable: true, firstChargeAt: null });
    expect(billingState(facts({ trialEnd: NOW + 7 * DAY }))).toMatchObject({ daysLeft: 7, nudge: "soon" });
    expect(billingState(facts({ trialEnd: NOW + 2 * DAY }))).toMatchObject({ daysLeft: 2, nudge: "urgent" });
    expect(billingState(facts({ trialEnd: NOW + 60 }))).toMatchObject({ phase: "trial", daysLeft: 1, writable: true });
  });

  it("locks writing once the trial is over with nothing subscribed, and deletes nothing", () => {
    expect(billingState(facts({ trialEnd: NOW }))).toMatchObject({ phase: "expired", daysLeft: 0, nudge: "locked", writable: false });
  });

  it("charges a card added during the trial on the trial's last day, not before", () => {
    const trialEnd = NOW + 12 * DAY;
    const s = billingState(facts({ subscription: { status: "trialing", trialEnd, periodEnd: trialEnd, cancelAtPeriodEnd: false } }));
    expect(s).toMatchObject({ phase: "trial_card", daysLeft: 12, firstChargeAt: trialEnd, nudge: "none", writable: true });
  });

  it("keeps a paying workspace working, through a failed payment too", () => {
    const sub = { trialEnd: null, periodEnd: NOW + 80 * DAY, cancelAtPeriodEnd: false };
    expect(billingState(facts({ trialEnd: NOW - DAY, subscription: { ...sub, status: "active" } }))).toMatchObject({ phase: "active", writable: true });
    expect(billingState(facts({ trialEnd: NOW - DAY, subscription: { ...sub, status: "past_due" } }))).toMatchObject({ phase: "past_due", nudge: "urgent", writable: true });
    expect(billingState(facts({ trialEnd: NOW - DAY, subscription: { ...sub, status: "canceled" } }))).toMatchObject({ phase: "ended", writable: false });
    expect(billingState(facts({ trialEnd: NOW - DAY, subscription: { ...sub, status: "unpaid" } }))).toMatchObject({ phase: "ended", writable: false });
  });

  it("falls back to the workspace's own trial when a subscription is cancelled during it", () => {
    const s = billingState(facts({ subscription: { status: "canceled", trialEnd: NOW + 5 * DAY, periodEnd: null, cancelAtPeriodEnd: false } }));
    expect(s).toMatchObject({ phase: "trial", daysLeft: 20, writable: true });
  });

  it("dates the trial from its start, an extension only ever moving it later", () => {
    expect(trialEndOf(NOW, null)).toBe(NOW + 30 * DAY);
    expect(trialEndOf(NOW, NOW + 37 * DAY)).toBe(NOW + 37 * DAY);
    expect(trialEndOf(NOW, NOW + DAY)).toBe(NOW + 30 * DAY);
    expect(extendedEnd(NOW, NOW - 3 * DAY)).toBe(NOW + 7 * DAY);
    expect(extendedEnd(NOW, NOW + DAY)).toBe(NOW + 8 * DAY);
  });

  it("offers the extension once, at the end of a trial with nothing subscribed", () => {
    expect(canExtend(facts({ trialEnd: NOW - DAY }), false)).toBe(true);
    expect(canExtend(facts({ trialEnd: NOW + DAY }), false)).toBe(true);
    expect(canExtend(facts({ trialEnd: NOW + 10 * DAY }), false)).toBe(false);
    expect(canExtend(facts({ trialEnd: NOW - DAY }), true)).toBe(false);
  });

  it("hands Checkout the trial's exact end, or Stripe's shortest trial, or none", () => {
    expect(checkoutTrial(NOW, NOW + 10 * DAY)).toEqual({ trial_end: NOW + 10 * DAY });
    expect(checkoutTrial(NOW, NOW + 47 * 3600)).toEqual({ trial_period_days: 2 });
    expect(checkoutTrial(NOW, NOW - 1)).toBeNull();
  });

  it("reminds by email a week before, two days before and once at the end, each once", () => {
    expect(reminderDue(facts({ trialEnd: NOW + 10 * DAY }), [])).toBeNull();
    expect(reminderDue(facts({ trialEnd: NOW + 6 * DAY }), [])).toBe("d7");
    expect(reminderDue(facts({ trialEnd: NOW + 6 * DAY }), ["d7"])).toBeNull();
    expect(reminderDue(facts({ trialEnd: NOW + DAY }), ["d7"])).toBe("d2");
    expect(reminderDue(facts({ trialEnd: NOW - DAY }), ["d7", "d2"])).toBe("ended");
    expect(reminderDue(facts({ trialEnd: NOW - 5 * DAY }), ["d7", "d2"])).toBeNull();
    const waiting = { status: "trialing", trialEnd: NOW + 5 * DAY, periodEnd: NOW + 5 * DAY, cancelAtPeriodEnd: false };
    expect(reminderDue(facts({ trialEnd: NOW + 5 * DAY, subscription: waiting }), [])).toBe("d7");
    expect(reminderDue(facts({ trialEnd: NOW + 5 * DAY, subscription: { ...waiting, status: "active" } }), [])).toBeNull();
  });
});
