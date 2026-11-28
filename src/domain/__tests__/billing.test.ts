import { describe, expect, it } from "vitest";
import { BILLED_UNIT_KINDS, LOYALTY_PCT, MAX_LOTS, RENT_BANDS, RHYTHMS, VOLUME, bandOf, billedRents, fromPerLot, portfolioLots, quote, subscriptionYear } from "@/domain/billing/pricing";
import { DAY, anyRowRuns, billingState, checkoutTrial, firstChargeOn, lockReasonOf, reasonFromRows, reminderDue, rowRuns, trialOffered, type BillingFacts, type SubscriptionFacts } from "@/domain/billing/trial";
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

const sub = (status: string, over: Partial<SubscriptionFacts> = {}): SubscriptionFacts => ({ status, trialEnd: null, periodEnd: NOW + 80 * DAY, cancelAtPeriodEnd: false, ...over });
const facts = (subscription: SubscriptionFacts | null): BillingFacts => ({ now: NOW, subscription });
const trialing = (days: number, over: Partial<SubscriptionFacts> = {}) => sub("trialing", { trialEnd: NOW + days * DAY, periodEnd: NOW + days * DAY, ...over });

describe("who may enter", () => {
  it("opens only while a subscription runs: trialing or active", () => {
    expect(billingState(facts(trialing(20)))).toMatchObject({ phase: "trial", open: true, reason: null, daysLeft: 20, firstChargeAt: NOW + 20 * DAY });
    expect(billingState(facts(sub("active")))).toMatchObject({ phase: "active", open: true, reason: null, nudge: "none", daysLeft: 0, firstChargeAt: null });
  });

  it("locks a workspace that never subscribed: no trial without a card", () => {
    expect(billingState(facts(null))).toMatchObject({ phase: "none", open: false, reason: "no_trial", nudge: "locked" });
  });

  it("locks at once on a failed or unfinished payment", () => {
    for (const status of ["past_due", "unpaid", "incomplete"]) {
      expect(billingState(facts(sub(status)))).toMatchObject({ phase: "payment", open: false, reason: "payment" });
    }
  });

  it("locks a subscription that has stopped, whatever stopped it", () => {
    for (const status of ["canceled", "incomplete_expired", "paused", "something_new"]) {
      expect(billingState(facts(sub(status)))).toMatchObject({ phase: "ended", open: false, reason: "ended" });
    }
    expect(lockReasonOf(undefined)).toBe("no_trial");
    expect(lockReasonOf("trialing")).toBeNull();
  });

  it("counts the trial quietly, louder in its last week and urgent in its last two days", () => {
    expect(billingState(facts(trialing(20))).nudge).toBe("quiet");
    expect(billingState(facts(trialing(8))).nudge).toBe("quiet");
    expect(billingState(facts(trialing(7))).nudge).toBe("soon");
    expect(billingState(facts(trialing(3))).nudge).toBe("soon");
    expect(billingState(facts(trialing(2))).nudge).toBe("urgent");
    expect(billingState(facts(sub("trialing", { trialEnd: NOW + 60 })))).toMatchObject({ daysLeft: 1, nudge: "urgent", open: true });
  });

  it("announces no first charge for a trial cancelled before its end", () => {
    expect(billingState(facts(trialing(10, { cancelAtPeriodEnd: true })))).toMatchObject({ phase: "trial", open: true, firstChargeAt: null });
  });

  it("promises the free days once: a workspace that ever subscribed is charged at once", () => {
    expect(trialOffered(false)).toBe(true);
    expect(trialOffered(true)).toBe(false);
    expect(checkoutTrial(true)).toEqual({ trial_period_days: 30 });
    expect(checkoutTrial(false)).toBeNull();
    expect(firstChargeOn(NOW, true)).toBe(NOW + 30 * DAY);
    expect(firstChargeOn(NOW, false)).toBe(NOW);
  });
});

describe("the shared record", () => {
  const iso = (t: number) => new Date(t * 1000).toISOString();
  it("runs a row trialing or active whose period is not over, of either store", () => {
    expect(rowRuns({ source: "stripe", status: "trialing", current_period_end: iso(NOW + DAY) }, NOW)).toBe(true);
    expect(rowRuns({ source: "apple", status: "active", current_period_end: null }, NOW)).toBe(true);
    expect(rowRuns({ source: "apple", status: "active", current_period_end: iso(NOW - 1) }, NOW)).toBe(false);
    expect(rowRuns({ source: "stripe", status: "past_due", current_period_end: iso(NOW + DAY) }, NOW)).toBe(false);
    expect(rowRuns({ source: "stripe", status: "active", current_period_end: "garbage" }, NOW)).toBe(false);
    expect(anyRowRuns([{ source: "stripe", status: "canceled", current_period_end: null }, { source: "apple", status: "active", current_period_end: null }], NOW)).toBe(true);
    expect(anyRowRuns([], NOW)).toBe(false);
  });

  it("gives the lock's reason from the rows: a failed payment, else an ended subscription, else none ever", () => {
    expect(reasonFromRows([])).toBe("no_trial");
    expect(reasonFromRows([{ source: "stripe", status: "canceled", current_period_end: null }])).toBe("ended");
    expect(reasonFromRows([{ source: "apple", status: "expired", current_period_end: null }, { source: "stripe", status: "past_due", current_period_end: null }])).toBe("payment");
  });
});

describe("the trial's e-mails", () => {
  it("reminds a week before the first charge and two days before, each once", () => {
    expect(reminderDue(facts(trialing(10)), [])).toBeNull();
    expect(reminderDue(facts(trialing(7)), [])).toBe("d7");
    expect(reminderDue(facts(trialing(6)), ["d7"])).toBeNull();
    expect(reminderDue(facts(trialing(2)), ["d7"])).toBe("d2");
    expect(reminderDue(facts(trialing(1)), ["d7", "d2"])).toBeNull();
  });

  it("sends only the later one to a trial already in its last two days", () => {
    expect(reminderDue(facts(trialing(1)), [])).toBe("d2");
    expect(reminderDue(facts(trialing(5)), ["d2"])).toBeNull();
  });

  it("reminds nobody whose trial is cancelled, over, paid or never started", () => {
    expect(reminderDue(facts(trialing(5, { cancelAtPeriodEnd: true })), [])).toBeNull();
    expect(reminderDue(facts(sub("active")), [])).toBeNull();
    expect(reminderDue(facts(sub("past_due")), [])).toBeNull();
    expect(reminderDue(facts(null), [])).toBeNull();
  });
});
