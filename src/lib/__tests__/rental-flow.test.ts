import { describe, expect, it } from "vitest";
import {
  CREATION_STEP,
  RENTAL_STEPS,
  RENTAL_TOTAL,
  canLeave,
  isAfterCreation,
  isFirstStep,
  isLastStep,
  nextStep,
  prevStep,
  shouldCreateOnLeaving,
  stepAt,
  stepNumber,
  type RentalStep,
} from "@/lib/gestion/rental-flow";

/**
 * The guided rental used to lose steps: the inspection step navigated away to
 * the état des lieux and never came back, Retour left the wizard instead of
 * going back one, and returning to the creation step wrote a second lease.
 * The flow is now a list, and these are the rules that list has to keep.
 */

const ALL = RENTAL_STEPS as readonly RentalStep[];
const FILLED = { tenant: true, rent: true };
const EMPTY = { tenant: false, rent: false };

describe("the eight steps", () => {
  it("is exactly the flow the product promises, in order", () => {
    expect(ALL).toEqual([
      "tenant",
      "lease",
      "rent",
      "payment",
      "guarantee",
      "inspection",
      "insurance",
      "review",
    ]);
    expect(RENTAL_TOTAL).toBe(8);
  });

  it("numbers every step by its position, with no gaps", () => {
    expect(ALL.map(stepNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("shows a number that always matches the step on screen", () => {
    // The indicator and the body read the same list, so walking the flow must
    // produce 1/8 through 8/8 with nothing repeated or missed.
    const seen: number[] = [];
    let step: RentalStep = ALL[0];
    for (let i = 0; i < RENTAL_TOTAL; i++) {
      seen.push(stepNumber(step));
      step = nextStep(step);
    }
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("maps a position back to its step and rejects nothing in range", () => {
    for (let n = 1; n <= RENTAL_TOTAL; n++) expect(stepNumber(stepAt(n))).toBe(n);
  });
});

describe("Suivant", () => {
  it("always moves to the very next step, never further", () => {
    for (let i = 0; i < ALL.length - 1; i++) {
      expect(nextStep(ALL[i])).toBe(ALL[i + 1]);
    }
  });

  it("visits all eight steps when walked from the start", () => {
    const visited = new Set<RentalStep>();
    let step: RentalStep = ALL[0];
    visited.add(step);
    while (!isLastStep(step)) {
      step = nextStep(step);
      visited.add(step);
    }
    expect(visited.size).toBe(RENTAL_TOTAL);
    for (const s of ALL) expect(visited.has(s)).toBe(true);
  });

  it("stops at the last step rather than running off the end", () => {
    expect(nextStep("review")).toBe("review");
    expect(isLastStep("review")).toBe(true);
  });
});

describe("Retour", () => {
  it("always moves to the previous step", () => {
    for (let i = 1; i < ALL.length; i++) {
      expect(prevStep(ALL[i])).toBe(ALL[i - 1]);
    }
  });

  it("goes back from the three steps that used to have no way back", () => {
    // These followed the creation of the rental, and the header sent them to
    // the property instead of to the previous step.
    expect(prevStep("inspection")).toBe("guarantee");
    expect(prevStep("insurance")).toBe("inspection");
    expect(prevStep("review")).toBe("insurance");
  });

  it("stops at the first step rather than running off the start", () => {
    expect(prevStep("tenant")).toBe("tenant");
    expect(isFirstStep("tenant")).toBe(true);
  });

  it("round-trips: forward then back lands where it started", () => {
    for (const s of ALL) {
      if (!isLastStep(s)) expect(prevStep(nextStep(s))).toBe(s);
      if (!isFirstStep(s)) expect(nextStep(prevStep(s))).toBe(s);
    }
  });
});

describe("optional steps are shown, never computed away", () => {
  it("lets the owner leave every step but the two that make a tenancy", () => {
    // Nothing filled in at all: only the tenant and the rent hold the flow,
    // because without them there is no lease to write. Payment, guarantee,
    // inspection, insurance and documents all let the owner straight through.
    const blocked = ALL.filter((s) => !canLeave(s, EMPTY));
    expect(blocked).toEqual(["tenant", "rent"]);
  });

  it("lets the owner through every step once those two are filled", () => {
    for (const s of ALL) expect(canLeave(s, FILLED)).toBe(true);
  });

  it("never decides the next step from what is filled in", () => {
    // Same successor whatever the form holds: emptiness can block a step, it
    // can never reroute the flow around one.
    for (const s of ALL) expect(nextStep(s)).toBe(nextStep(s));
    const emptyWalk: RentalStep[] = [];
    const fullWalk: RentalStep[] = [];
    let a: RentalStep = ALL[0];
    let b: RentalStep = ALL[0];
    for (let i = 0; i < RENTAL_TOTAL; i++) {
      emptyWalk.push(a);
      fullWalk.push(b);
      a = nextStep(a);
      b = nextStep(b);
    }
    expect(emptyWalk).toEqual(fullWalk);
    expect(emptyWalk).toEqual([...ALL]);
  });
});

describe("creating the rental exactly once", () => {
  it("writes it when leaving the guarantee step with no lease yet", () => {
    expect(CREATION_STEP).toBe("guarantee");
    expect(shouldCreateOnLeaving("guarantee", null)).toBe(true);
  });

  it("never writes a second lease when the owner comes back to that step", () => {
    // This is what dead-ended the flow on a 409: Retour to the guarantee step
    // and pressing on again posted another lease onto a lot already let.
    expect(shouldCreateOnLeaving("guarantee", "lease-1")).toBe(false);
  });

  it("never writes from any other step", () => {
    for (const s of ALL) {
      if (s === CREATION_STEP) continue;
      expect(shouldCreateOnLeaving(s, null)).toBe(false);
      expect(shouldCreateOnLeaving(s, "lease-1")).toBe(false);
    }
  });

  it("knows which steps enrich a rental that already exists", () => {
    expect(ALL.filter(isAfterCreation)).toEqual(["inspection", "insurance", "review"]);
  });
});

describe("resuming a rental that already exists", () => {
  it("can open at any of the eight steps", () => {
    for (let n = 1; n <= RENTAL_TOTAL; n++) {
      expect(ALL).toContain(stepAt(n));
      expect(stepNumber(stepAt(n))).toBe(n);
    }
  });

  it("clamps a position outside the flow onto a real step", () => {
    // The resume position arrives in a URL, so it is whatever someone typed.
    expect(stepAt(0)).toBe("tenant");
    expect(stepAt(-5)).toBe("tenant");
    expect(stepAt(99)).toBe("review");
    expect(stepAt(Number.NaN)).toBe("tenant");
  });

  it("lands on the insurance step when the inspection hands back", () => {
    // The inspection sends the owner to the état des lieux with a return
    // address built from `nextStep`; coming back must be step 7 of 8.
    const back = nextStep("inspection");
    expect(back).toBe("insurance");
    expect(stepNumber(back)).toBe(7);
    expect(stepAt(stepNumber(back))).toBe("insurance");
  });

  it("still walks to the end from a resumed step", () => {
    let step: RentalStep = stepAt(7);
    const rest: RentalStep[] = [step];
    while (!isLastStep(step)) {
      step = nextStep(step);
      rest.push(step);
    }
    expect(rest).toEqual(["insurance", "review"]);
  });
});
