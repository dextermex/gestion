import { describe, expect, it } from "vitest";
import { JOURNEY, journeyProgress, quizStep } from "../journey";
import { EMPTY_ANSWERS, QUIZ_STEPS, answer, answerOf, answersFromStored, firstOpen, optionsOf, questionFromParam, storedQuiz } from "../quiz";
import { DEFAULT_DASHBOARD, dashboardFromQuiz, fromInterests, visibleWidgets } from "../dashboard";
import { afterOfferClosed, afterPlan, billingState, checkoutTarget, offerFrom, priceLine, spaceAddress, winbackLine, REMINDER_DAY } from "../flow";
import { TESTIMONIALS, averageStars, reviewsAvailable } from "../reviews";

describe("the questions", () => {
  it("come in the app's order, with the app's answer keys", () => {
    expect(QUIZ_STEPS).toEqual(["kind", "manage", "units", "rent", "where", "today", "challenge", "time", "late", "goal", "source"]);
    expect(optionsOf("kind")).toEqual(["flats", "houses", "building", "mixed"]);
    expect(optionsOf("units")).toEqual(["1", "2-5", "6-10", "11-20", "21-50", "0"]);
    expect(optionsOf("rent")).toEqual(["0", "1", "2", "3", "4"]);
    expect(optionsOf("late")).toEqual(["same_day", "days", "month_end", "never"]);
    expect(optionsOf("source")).toEqual(["instagram", "tiktok", "word", "search", "press", "other"]);
  });
  it("take one answer each, the rent as a band, and nothing outside the keys", () => {
    let a = answer(EMPTY_ANSWERS, "rent", "3");
    expect(a.rent).toBe(3);
    a = answer(a, "manage", "family");
    expect(answerOf(a, "manage")).toBe("family");
    expect(answer(a, "kind", "castle")).toBe(a);
    expect(answer(a, "rent", "9")).toBe(a);
    expect(firstOpen(a)).toBe(1);
    expect(firstOpen(QUIZ_STEPS.reduce((acc, step) => answer(acc, step, optionsOf(step)[0]), EMPTY_ANSWERS))).toBe(12);
  });
  it("are saved in the app's quiz keys and read back from them", () => {
    const a = { ...EMPTY_ANSWERS, kind: "houses" as const, manage: "self" as const, units: "2-5" as const, rent: 1, late: "days" as const };
    const stored = storedQuiz(a);
    expect(Object.keys(stored).sort()).toEqual(["goal", "kind", "late", "manageFor", "source", "today", "units", "where"]);
    expect(stored).toMatchObject({ kind: "houses", manageFor: "self", units: "2-5", late: "days" });
    expect(answersFromStored({ ...stored, kind: "castle" }, 1)).toMatchObject({ kind: null, manage: "self", units: "2-5", rent: 1 });
  });
  it("open at the question the address names, within 1 and 11", () => {
    expect(["4", "0", "99", "x", null].map(questionFromParam)).toEqual([4, 1, 11, 1, 1]);
  });
});

describe("the bar across the funnel", () => {
  it("starts a little filled, always moves forward and ends full on the plan", () => {
    expect(journeyProgress("phone")).toBeCloseTo(0.06, 2);
    const values = JOURNEY.map(journeyProgress);
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThan(values[i - 1]);
    expect(journeyProgress("ready")).toBe(1);
  });
  it("is front-loaded: the account steps fill half of it, as in the app", () => {
    expect(JOURNEY).toHaveLength(21);
    expect(journeyProgress("quiz:1")).toBeGreaterThan(0.5);
    expect(journeyProgress("quiz:11")).toBeGreaterThan(0.85);
    expect(quizStep(0)).toBe("quiz:1");
    expect(quizStep(42)).toBe("quiz:11");
  });
});

describe("the home screen from the answers", () => {
  it("puts the pain named first and watches arrears for someone who hears of them late", () => {
    const rent = dashboardFromQuiz("rent", "same_day");
    expect(rent.order.slice(0, 3)).toEqual(["arrears", "actions", "cashflow"]);
    expect(dashboardFromQuiz("documents", "month_end").watch).toEqual(["edl_exit", "invite", "arrears"]);
    expect(dashboardFromQuiz("finances", null).horizon).toBe("year");
    expect(dashboardFromQuiz(null, null)).toEqual(DEFAULT_DASHBOARD);
  });
  it("switches on an optional section only when it is picked", () => {
    expect(visibleWidgets(fromInterests([]))).toEqual(["arrears", "cashflow", "actions", "activity"]);
    expect(visibleWidgets(fromInterests(["requests"]))[0]).toBe("requests");
    expect(fromInterests(["costs"], { horizon: "year", watch: ["ticket"] })).toMatchObject({ horizon: "year", watch: ["ticket"], interests: ["costs"] });
  });
});

describe("after the plan", () => {
  const state = (configured: boolean, access: "open" | "locked") => ({ configured, access, reason: null, trialOffered: true });
  it("opens the trial screens only on a deployment that takes payments, for a locked workspace", () => {
    expect(afterPlan(state(true, "locked"), false)).toBe("try");
    expect(afterPlan(state(false, "open"), false)).toBe("welcome");
    expect(afterPlan(state(true, "open"), false)).toBe("welcome");
    expect(afterPlan(null, false)).toBe("welcome");
    expect(afterPlan(state(true, "locked"), true)).toBe("welcome");
  });
  it("reads the subscription state only in the contract's shape", () => {
    expect(billingState({ configured: true, access: "locked", reason: "no_trial", trialOffered: false })).toEqual({ configured: true, access: "locked", reason: "no_trial", trialOffered: false });
    expect(billingState({ configured: "yes", access: "locked" })).toBeNull();
    expect(billingState({ error: "unauthenticated" })).toBeNull();
    expect(billingState(null)).toBeNull();
  });
  it("shows the one-time offer once, then leads to the space", () => {
    expect(afterOfferClosed(false)).toBe("winback");
    expect(afterOfferClosed(true)).toBe("leave");
  });
  it("opens the first property's form with the type from the first question, or the home screen without a lot", () => {
    expect(spaceAddress({ kind: "flats", units: "2-5" })).toBe("/app/biens/nouveau?type=apartment&tour=1");
    expect(spaceAddress({ kind: "houses", units: "1" })).toBe("/app/biens/nouveau?type=house&tour=1");
    expect(spaceAddress({ kind: "building", units: "21-50" })).toBe("/app/biens/nouveau?type=building&tour=1");
    expect(spaceAddress({ kind: "mixed", units: "6-10" })).toBe("/app/biens/nouveau?tour=1");
    expect(spaceAddress({ kind: "flats", units: "0" })).toBe("/app?tour=1");
    expect(spaceAddress(null)).toBe("/app?tour=1");
  });
});

describe("the offer's price line", () => {
  it("quotes the answers on the grid: 3 lots at 1 000 to 1 499 euros, 420 euros a year (35 a month)", () => {
    expect(priceLine(offerFrom("2-5", 1, "year"))).toEqual({ perPeriod: 42_000, monthly: 3_500 });
    expect(priceLine(offerFrom("2-5", 1, "quarter"))).toEqual({ perPeriod: 12_600, monthly: 4_200 });
  });
  it("quotes one lot for no lot yet and the first band for no rent answered", () => {
    expect(offerFrom("0", null, "year")).toEqual({ units: 1, band: 0, billing: "year" });
    expect(priceLine(offerFrom(null, null, "year")).perPeriod).toBe(10_000);
    expect(offerFrom("21-50", 7, "quarter")).toEqual({ units: 30, band: 4, billing: "quarter" });
  });
  it("takes a quarter off the first year in the one-time offer, always yearly", () => {
    expect(winbackLine(offerFrom("2-5", 1, "quarter"))).toEqual({ firstYear: 31_500, monthly: 2_625, fullYear: 42_000, fullMonthly: 3_500 });
  });
  it("puts the reminder two days before the trial's end", () => {
    expect(REMINDER_DAY).toBe(28);
  });
  it("sends the browser only to our pages or an https page", () => {
    expect(checkoutTarget("https://checkout.stripe.com/c/pay/cs_test_1")).toBe("https://checkout.stripe.com/c/pay/cs_test_1");
    expect(checkoutTarget("/inscription?etape=bienvenue")).toBe("/inscription?etape=bienvenue");
    expect(checkoutTarget("javascript:alert(1)")).toBeNull();
    expect(checkoutTarget("http://checkout.example")).toBeNull();
    expect(checkoutTarget("//evil.test")).toBeNull();
    expect(checkoutTarget(42)).toBeNull();
  });
});

describe("the reviews step", () => {
  it("is skipped while there is no real quote", () => {
    expect(TESTIMONIALS).toHaveLength(0);
    expect(reviewsAvailable()).toBe(false);
    const quote = { name: "A", place: "B", lead: { fr: "", en: "", de: "", lu: "" }, quote: { fr: "", en: "", de: "", lu: "" } };
    expect(averageStars([{ ...quote, stars: 5 }, { ...quote, stars: 4 }])).toBe(4.5);
  });
});
