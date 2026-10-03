import { describe, expect, it } from "vitest";
import { BILLED_UNIT_KINDS, LOYALTY_PCT, MAX_LOTS, RENT_BANDS, RHYTHMS, VOLUME, bandOf, billedRents, fromPerLot, portfolioLots, quote, subscriptionYear } from "@/domain/billing/pricing";
import { DAY, billingState, canExtend, checkoutTrial, extendedEnd, reminderDue, trialEndOf, type BillingFacts } from "@/domain/billing/trial";
import { isLettable } from "@/lib/gestion/portfolio";
import type { DemoUnit } from "@/lib/demo/data";

const NOW = 1_790_000_000;

/** A rent in each band, in cents: what a lot let at that rent is billed by. */
const RENT = [80_000, 120_000, 160_000, 250_000, 350_000];
const lots = (n: number, band: number) => Array.from({ length: n }, () => RENT[band]);

describe("the published pricing", () => {
  it("bands each lot by its rent, excluding charges, at the site's five prices", () => {
    expect(RENT_BANDS.map((b) => b.perLot)).toEqual([1000, 1400, 1900, 2500, 3200]);
    expect([0, 99_999, 100_000, 149_999, 150_000, 199_999, 200_000, 299_999, 300_000, 9_000_000].map(bandOf)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
    expect(VOLUME.map((v) => [v.from, v.to, v.offPct])).toEqual([[1, 5, 0], [6, 15, 10], [16, 30, 20], [31, 50, 30]]);
    expect(LOYALTY_PCT).toEqual([0, 5, 10]);
    expect(MAX_LOTS).toBe(50);
  });

  // The site's own calculator (src/lib/pricing.ts there), figure for figure, in cents.
  it("quotes what the site's calculator quotes", () => {
    expect(quote(lots(3, 1), "quarter")).toMatchObject({ monthly: 4200, base: 12_600, charged: 12_600, shownMonthly: 4200, yearlySaving: 8400 });
    expect(quote(lots(20, 2), "year")).toMatchObject({ monthly: 34_200, base: 342_000, charged: 342_000, shownMonthly: 28_500, fullMonthly: 34_200, yearlySaving: 68_400 });
    expect([1, 2, 3].map((year) => quote(lots(20, 2), "year", year).charged)).toEqual([342_000, 324_900, 307_800]);
    expect([1, 2, 3].map((year) => quote(lots(3, 1), "quarter", year).charged)).toEqual([12_600, 11_970, 11_340]);
    expect(quote(lots(50, 4), "quarter")).toMatchObject({ monthly: 128_000, charged: 384_000, fits: true });
    expect(quote(lots(1, 0), "year")).toMatchObject({ monthly: 1000, charged: 10_000, shownMonthly: 833, shownPerLot: 833 });
    expect(fromPerLot("quarter")).toBe(1000);
    expect(fromPerLot("year")).toBe(833);
  });

  it("charges whole cents, the monthly figure times the months the rhythm costs", () => {
    for (const rhythm of RHYTHMS) {
      for (const n of [1, 5, 6, 16, 31, 50]) {
        for (const year of [1, 2, 3, 7]) {
          const q = quote([...lots(n, 1), RENT[3]], rhythm, year);
          expect(Number.isInteger(q.charged) && Number.isInteger(q.shownMonthly)).toBe(true);
          expect(q.base).toBe(q.monthly * (rhythm === "year" ? 10 : 3));
          expect(q.loyaltyPct).toBe(LOYALTY_PCT[Math.min(year, 3) - 1]);
        }
      }
    }
  });

  it("puts the dearest lots in the first brackets, so a reduction lands on the cheaper ones", () => {
    const q = quote([RENT[4], ...lots(6, 1)], "quarter");
    expect(q.lines).toEqual([
      { band: 4, offPct: 0, perLot: 3200, count: 1 },
      { band: 1, offPct: 0, perLot: 1400, count: 4 },
      { band: 1, offPct: 10, perLot: 1260, count: 2 },
    ]);
    expect(q.monthly).toBe(3200 + 4 * 1400 + 2 * 1260);
  });

  it("never makes the other lots dearer when one is added", () => {
    let seed = 7;
    const next = () => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648;
    for (let round = 0; round < 300; round++) {
      const rents = Array.from({ length: Math.floor(next() * 55) }, () => Math.floor(next() * 400_000));
      const added = Math.floor(next() * 400_000);
      const before = quote(rents, "quarter").monthly;
      const after = quote([...rents, added], "quarter").monthly;
      expect(after).toBeGreaterThan(rents.length === 0 ? 0 : before);
      expect(after - before).toBeLessThanOrEqual(RENT_BANDS[bandOf(added)].perLot);
    }
  });

  it("bills at least one lot, and says when a portfolio passes the published 50", () => {
    expect(quote([], "quarter")).toMatchObject({ lots: 0, billed: 1, monthly: 1000 });
    expect(quote(lots(51, 0), "quarter")).toMatchObject({ lots: 51, fits: false, monthly: 5 * 1000 + 10 * 900 + 15 * 800 + 21 * 700 });
  });

  it("counts a dwelling, shop or office let under a running lease, by that lease's rent", () => {
    const kinds: DemoUnit["kind"][] = ["dwelling", "commercial", "office", "parking", "cellar", "other"];
    for (const kind of kinds) expect(BILLED_UNIT_KINDS.includes(kind)).toBe(isLettable({ kind }));
    expect(portfolioLots(kinds.map((kind) => ({ kind })))).toBe(3);
    const units = [
      { id: "a", kind: "dwelling" }, { id: "b", kind: "commercial" }, { id: "c", kind: "office" },
      { id: "d", kind: "dwelling" }, { id: "p", kind: "parking" },
    ];
    const leases = [
      { unitId: "a", status: "active", rentCents: 152_000 },
      { unitId: "b", status: "notice", rentCents: 410_000 },
      { unitId: "c", status: "ended", rentCents: 90_000 },
      { unitId: "d", status: "draft", rentCents: 95_000 },
      { unitId: "p", status: "active", rentCents: 12_000 },
    ];
    expect(billedRents(units, leases)).toEqual([152_000, 410_000]);
  });

  it("dates loyalty from the first paid day, a year at a time", () => {
    const paid = Date.UTC(2026, 10, 2, 8) / 1000;
    expect(subscriptionYear(paid, paid)).toBe(1);
    expect(subscriptionYear(paid, Date.UTC(2027, 7, 2, 8) / 1000)).toBe(1);
    expect(subscriptionYear(paid, Date.UTC(2027, 10, 2, 8) / 1000)).toBe(2);
    expect(subscriptionYear(paid, Date.UTC(2027, 10, 2, 7) / 1000)).toBe(2);
    expect(subscriptionYear(paid, Date.UTC(2028, 10, 2, 8) / 1000)).toBe(3);
    expect(subscriptionYear(paid, Date.UTC(2031, 10, 2, 8) / 1000)).toBe(6);
    const leap = Date.UTC(2028, 1, 29, 12) / 1000;
    expect(subscriptionYear(leap, Date.UTC(2029, 1, 28, 12) / 1000)).toBe(2);
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
