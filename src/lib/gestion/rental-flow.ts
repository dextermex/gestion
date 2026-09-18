/**
 * The order of the guided rental, as data.
 *
 * The flow used to live as magic numbers scattered through the component —
 * `setStep(7)` here, `step > LAST_INPUT` there — and that is exactly how a
 * step goes missing: every place that moves the wizard got to invent its own
 * idea of what comes next. Here there is one list, and every move is a lookup
 * in it.
 *
 * Three rules the whole product depends on:
 *
 *  1. **No step is ever computed away.** `nextStep` is the successor in this
 *     list, full stop. It does not consult whether a field is filled, whether
 *     a record exists, or whether a section is optional. An optional step
 *     shows itself and offers to be skipped; skipping is the owner's click,
 *     never the code's inference.
 *
 *  2. **The number shown is the position in this list.** `stepNumber` is the
 *     only source of "Étape 6/9", so the indicator cannot drift from what is
 *     on screen.
 *
 *  3. **The dossier is a draft until its last step.** Everything the owner
 *     enters is saved to the lease row as they go, and the lease stays
 *     `draft` (the lot stays free, no rent falls due) until the ninth step,
 *     Activation, is the one thing that makes the rental active. The owner
 *     can stop on any step and come back, on any device, at the first step
 *     they have not completed.
 */

export const RENTAL_STEPS = [
  "tenant",
  "lease",
  "rent",
  "payment",
  "guarantee",
  "inspection",
  "insurance",
  "documents",
  "activation",
] as const;

export type RentalStep = (typeof RENTAL_STEPS)[number];

export const RENTAL_TOTAL = RENTAL_STEPS.length;

/** The eight steps that collect the dossier; the ninth only activates it. */
export const DATA_STEPS: readonly RentalStep[] = RENTAL_STEPS.slice(0, RENTAL_TOTAL - 1);

/** 1-based position, which is what the owner is shown. */
export function stepNumber(step: RentalStep): number {
  return RENTAL_STEPS.indexOf(step) + 1;
}

/**
 * The step at a 1-based position, clamped to the flow.
 *
 * The position can arrive from a URL, so it can be anything at all. Anything
 * that is not a real number starts the flow at the beginning rather than
 * resolving to no step, which would render an empty wizard.
 */
export function stepAt(position: number): RentalStep {
  if (!Number.isFinite(position)) return RENTAL_STEPS[0];
  const i = Math.min(Math.max(Math.round(position), 1), RENTAL_TOTAL) - 1;
  return RENTAL_STEPS[i];
}

/** A step name from outside (a URL, a saved row), or the first step. */
export function stepNamed(raw: unknown): RentalStep {
  return (RENTAL_STEPS as readonly string[]).includes(String(raw)) ? (raw as RentalStep) : RENTAL_STEPS[0];
}

export function nextStep(step: RentalStep): RentalStep {
  return stepAt(stepNumber(step) + 1);
}

export function prevStep(step: RentalStep): RentalStep {
  return stepAt(stepNumber(step) - 1);
}

export function isFirstStep(step: RentalStep): boolean {
  return step === RENTAL_STEPS[0];
}

export function isLastStep(step: RentalStep): boolean {
  return step === RENTAL_STEPS[RENTAL_TOTAL - 1];
}

/** What the two facts a tenancy cannot exist without look like, filled or not. */
export type Filled = { tenant: boolean; rent: boolean };

/** Steps that cannot be left until something has been entered. */
const REQUIRED: Partial<Record<RentalStep, keyof Filled>> = {
  tenant: "tenant",
  rent: "rent",
};

/**
 * Whether the owner may move on from this step.
 *
 * Only two facts are genuinely required, because without them there is no
 * tenancy to write: who the tenant is, and what the rent is. Everything else
 * lets the owner through with nothing filled in — the step still had to be
 * shown, and "Compléter plus tard" is a real answer.
 */
export function canLeave(step: RentalStep, filled: Filled): boolean {
  const need = REQUIRED[step];
  return need === undefined ? true : filled[need];
}

/**
 * The dossier's memory of what has been completed, recomputed at every save.
 *
 * Everything before the step the owner is on counts as completed (they went
 * through it), the step itself counts once it may be left, and whatever was
 * completed on an earlier visit stays so. A required step only stays
 * completed while its fact is still there: clearing the rent reopens the
 * rent step. Activation is never "completed" here; it is the lease's status.
 */
export function completedOnSave(previous: readonly string[], step: RentalStep, filled: Filled): RentalStep[] {
  const set = new Set<string>(previous);
  for (const s of RENTAL_STEPS.slice(0, stepNumber(step) - 1)) set.add(s);
  if (canLeave(step, filled)) set.add(step);
  return DATA_STEPS.filter((s) => {
    if (!set.has(s)) return false;
    const need = REQUIRED[s];
    return need === undefined ? true : filled[need];
  });
}

/** Where a saved dossier resumes: its first step not yet completed. */
export function firstIncomplete(completed: readonly string[]): RentalStep {
  return RENTAL_STEPS.find((s) => !completed.includes(s)) ?? RENTAL_STEPS[RENTAL_TOTAL - 1];
}

/**
 * The facts a dossier holds, read from its rows. They decide what a dossier
 * written before the flow kept its own memory has completed, they keep a
 * kept memory honest (an inventory done from the property later still
 * counts, a rent cleared later reopens its step), and they say whether the
 * rental may be activated at all.
 */
export interface DossierFacts {
  tenants: number;
  rentCents: number;
  hasPayer: boolean;
  hasDeposit: boolean;
  hasInspection: boolean;
  hasInsurance: boolean;
}

export function completionFrom(facts: DossierFacts, remembered: readonly string[] = []): RentalStep[] {
  const set = new Set<string>(remembered);
  // A dossier saved before the flow kept a memory is read from its rows,
  // and one with people on it has been through the lease step (its type and
  // dates always hold a value). A dossier with a memory is believed about
  // that step instead: the owner may not have seen it yet.
  if (remembered.length === 0 && facts.tenants > 0) set.add("lease");
  if (facts.tenants > 0) set.add("tenant");
  if (facts.rentCents > 0) set.add("rent");
  if (facts.hasPayer) set.add("payment");
  if (facts.hasDeposit) set.add("guarantee");
  if (facts.hasInspection) set.add("inspection");
  if (facts.hasInsurance) set.add("insurance");
  return DATA_STEPS.filter((s) => set.has(s) && (s === "tenant" ? facts.tenants > 0 : s === "rent" ? facts.rentCents > 0 : true));
}

/** Only a dossier with someone in it and a rent can become a tenancy. */
export function isReadyToActivate(facts: Pick<DossierFacts, "tenants" | "rentCents">): boolean {
  return facts.tenants > 0 && facts.rentCents > 0;
}

export interface DossierProgress {
  completed: RentalStep[];
  /** Steps completed, out of `total`: "3/9 étapes". */
  done: number;
  total: number;
  resumeStep: RentalStep;
  ready: boolean;
}

export function dossierProgress(facts: DossierFacts, remembered: readonly string[] = []): DossierProgress {
  const completed = completionFrom(facts, remembered);
  return {
    completed,
    done: completed.length,
    total: RENTAL_TOTAL,
    resumeStep: firstIncomplete(completed),
    ready: isReadyToActivate(facts),
  };
}
