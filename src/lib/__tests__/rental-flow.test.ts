import { describe, expect, it } from "vitest";
import {
  DATA_STEPS,
  RENTAL_STEPS,
  RENTAL_TOTAL,
  canLeave,
  completedOnSave,
  completionFrom,
  dossierProgress,
  firstIncomplete,
  isFirstStep,
  isLastStep,
  isReadyToActivate,
  nextStep,
  prevStep,
  stepAt,
  stepNamed,
  stepNumber,
  type DossierFacts,
  type RentalStep,
} from "@/lib/gestion/rental-flow";

/**
 * The guided rental used to lose steps: the inspection step navigated away to
 * the état des lieux and never came back, Retour left the wizard instead of
 * going back one, and returning to the creation step wrote a second lease.
 * The flow is now a list with a memory, and these are the rules that list
 * has to keep: nine steps, one at a time, saved as the owner goes, resumed
 * at the first one not completed, and only the last one activates anything.
 */

const ALL = RENTAL_STEPS as readonly RentalStep[];
const FILLED = { tenant: true, rent: true };
const EMPTY = { tenant: false, rent: false };
const NOTHING: DossierFacts = { tenants: 0, rentCents: 0, hasPayer: false, hasDeposit: false, hasInspection: false, hasInsurance: false };

describe("the nine steps", () => {
  it("is exactly the flow the product promises, in order", () => {
    expect(ALL).toEqual(["tenant", "lease", "rent", "payment", "guarantee", "inspection", "insurance", "documents", "activation"]);
    expect(RENTAL_TOTAL).toBe(9);
    // The first eight collect the dossier; the ninth only activates it.
    expect(DATA_STEPS).toEqual(ALL.slice(0, 8));
  });

  it("numbers every step by its position, with no gaps", () => {
    expect(ALL.map(stepNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("shows a number that always matches the step on screen", () => {
    // The indicator and the body read the same list, so walking the flow must
    // produce 1/9 through 9/9 with nothing repeated or missed.
    const seen: number[] = [];
    let step: RentalStep = ALL[0];
    for (let i = 0; i < RENTAL_TOTAL; i++) {
      seen.push(stepNumber(step));
      step = nextStep(step);
    }
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("moves one step at a time and never computes an optional step away", () => {
    // The inventory, the insurance and the documents are optional to fill,
    // never optional to show: the successor is the successor.
    expect(nextStep("guarantee")).toBe("inspection");
    expect(nextStep("inspection")).toBe("insurance");
    expect(nextStep("insurance")).toBe("documents");
    expect(nextStep("documents")).toBe("activation");
    for (const step of ALL.slice(0, -1)) expect(stepNumber(nextStep(step))).toBe(stepNumber(step) + 1);
    for (const step of ALL.slice(1)) expect(stepNumber(prevStep(step))).toBe(stepNumber(step) - 1);
  });

  it("stops at both ends instead of falling off the list", () => {
    expect(prevStep("tenant")).toBe("tenant");
    expect(nextStep("activation")).toBe("activation");
    expect(isFirstStep("tenant")).toBe(true);
    expect(isFirstStep("lease")).toBe(false);
    expect(isLastStep("activation")).toBe(true);
    expect(isLastStep("documents")).toBe(false);
  });

  it("reads a position or a name from anywhere and lands on a real step", () => {
    // A URL can say anything; the flow must still open on a step.
    expect(stepAt(1)).toBe("tenant");
    expect(stepAt(7)).toBe("insurance");
    expect(stepAt(9)).toBe("activation");
    expect(stepAt(0)).toBe("tenant");
    expect(stepAt(99)).toBe("activation");
    expect(stepAt(3.6)).toBe("payment");
    expect(stepAt(Number.NaN)).toBe("tenant");
    expect(stepNamed("rent")).toBe("rent");
    expect(stepNamed("nope")).toBe("tenant");
    expect(stepNamed(undefined)).toBe("tenant");
  });
});

describe("leaving a step", () => {
  it("requires only what a tenancy cannot exist without", () => {
    expect(canLeave("tenant", EMPTY)).toBe(false);
    expect(canLeave("tenant", { tenant: true, rent: false })).toBe(true);
    expect(canLeave("rent", { tenant: true, rent: false })).toBe(false);
    expect(canLeave("rent", FILLED)).toBe(true);
    for (const step of ALL.filter((s) => s !== "tenant" && s !== "rent")) expect(canLeave(step, EMPTY)).toBe(true);
  });
});

describe("the dossier's memory, recomputed at every save", () => {
  it("counts the step being left and everything before it", () => {
    expect(completedOnSave([], "tenant", { tenant: true, rent: false })).toEqual(["tenant"]);
    expect(completedOnSave(["tenant"], "lease", { tenant: true, rent: false })).toEqual(["tenant", "lease"]);
    // Saving from the guarantee step: the owner went through the four before.
    expect(completedOnSave([], "guarantee", FILLED)).toEqual(["tenant", "lease", "rent", "payment", "guarantee"]);
  });

  it("does not count a required step whose fact is missing", () => {
    // Saved from the rent step with no rent: the rent step stays open.
    expect(completedOnSave(["tenant", "lease"], "rent", { tenant: true, rent: false })).toEqual(["tenant", "lease"]);
    // A rent cleared later reopens the rent step, whatever was remembered.
    expect(completedOnSave(["tenant", "lease", "rent", "payment"], "payment", { tenant: true, rent: false })).toEqual([
      "tenant",
      "lease",
      "payment",
    ]);
    // Everyone removed: the first step reopens, the rest stands.
    expect(completedOnSave(["tenant", "lease", "rent"], "lease", { tenant: false, rent: true })).toEqual(["lease", "rent"]);
  });

  it("keeps what an earlier visit completed when the owner goes back", () => {
    const before = ["tenant", "lease", "rent", "payment", "guarantee"];
    expect(completedOnSave(before, "lease", FILLED)).toEqual(before);
    expect(completedOnSave(before, "tenant", FILLED)).toEqual(before);
  });

  it("never records the activation as a step completed", () => {
    // Activation is the lease's status, not a box the dossier ticks.
    expect(completedOnSave([], "activation", FILLED)).toEqual([...DATA_STEPS]);
    expect(completedOnSave(["activation"], "documents", FILLED)).toEqual([...DATA_STEPS]);
  });

  it("resumes at the first step not completed, and at the activation once all are", () => {
    expect(firstIncomplete([])).toBe("tenant");
    expect(firstIncomplete(["tenant"])).toBe("lease");
    expect(firstIncomplete(["tenant", "lease", "rent"])).toBe("payment");
    expect(firstIncomplete([...DATA_STEPS])).toBe("activation");
    // A gap in the middle is where the owner is taken back to.
    expect(firstIncomplete(["tenant", "lease", "payment", "guarantee"])).toBe("rent");
  });
});

describe("what a saved dossier has completed, read from its rows", () => {
  it("believes the memory, and lets the rows add what happened elsewhere", () => {
    // Saved from the first step: one step done, the lease step not yet seen.
    expect(completionFrom({ ...NOTHING, tenants: 1 }, ["tenant"])).toEqual(["tenant"]);
    // An inventory done from the property, an insurance recorded there: they count.
    expect(
      completionFrom({ ...NOTHING, tenants: 1, rentCents: 1, hasInspection: true, hasInsurance: true }, ["tenant", "lease", "rent"]),
    ).toEqual(["tenant", "lease", "rent", "inspection", "insurance"]);
  });

  it("reads a dossier written before the flow kept a memory from its rows alone", () => {
    expect(completionFrom({ ...NOTHING, tenants: 1, rentCents: 90000, hasDeposit: true })).toEqual(["tenant", "lease", "rent", "guarantee"]);
    expect(completionFrom({ ...NOTHING, tenants: 2, rentCents: 90000, hasPayer: true })).toEqual(["tenant", "lease", "rent", "payment"]);
    expect(completionFrom(NOTHING)).toEqual([]);
  });

  it("reopens a required step whose fact is gone, whatever the memory says", () => {
    expect(completionFrom(NOTHING, ["tenant", "lease", "rent"])).toEqual(["lease"]);
    expect(completionFrom({ ...NOTHING, tenants: 1 }, ["tenant", "lease", "rent"])).toEqual(["tenant", "lease"]);
  });

  it("is ready to activate only with someone on it and a rent", () => {
    expect(isReadyToActivate({ tenants: 0, rentCents: 100 })).toBe(false);
    expect(isReadyToActivate({ tenants: 1, rentCents: 0 })).toBe(false);
    expect(isReadyToActivate({ tenants: 1, rentCents: 100 })).toBe(true);
  });

  it("says X/9 and where to resume, for the property and the flow alike", () => {
    expect(dossierProgress({ ...NOTHING, tenants: 2, rentCents: 125000 }, ["tenant", "lease", "rent"])).toEqual({
      completed: ["tenant", "lease", "rent"],
      done: 3,
      total: 9,
      resumeStep: "payment",
      ready: true,
    });
    const first = dossierProgress({ ...NOTHING, tenants: 1 }, ["tenant"]);
    expect([first.done, first.total, first.resumeStep, first.ready]).toEqual([1, 9, "lease", false]);
    // Every data step done: the dossier waits on the activation, and says so.
    const all = dossierProgress({ ...NOTHING, tenants: 1, rentCents: 1, hasPayer: true, hasDeposit: true, hasInspection: true, hasInsurance: true }, [
      ...DATA_STEPS,
    ]);
    expect([all.done, all.resumeStep, all.ready]).toEqual([8, "activation", true]);
  });
});
