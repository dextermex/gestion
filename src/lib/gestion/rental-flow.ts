/**
 * The order of the guided rental, as data.
 *
 * The flow used to live as magic numbers scattered through the component —
 * `setStep(7)` here, `step > LAST_INPUT` there — and that is exactly how a
 * step goes missing: every place that moves the wizard got to invent its own
 * idea of what comes next. Here there is one list, and every move is a lookup
 * in it.
 *
 * Two rules the whole product depends on:
 *
 *  1. **No step is ever computed away.** `nextStep` is the successor in this
 *     list, full stop. It does not consult whether a field is filled, whether
 *     a record exists, or whether a section is optional. An optional step
 *     shows itself and offers to be skipped; skipping is the owner's click,
 *     never the code's inference.
 *
 *  2. **The number shown is the position in this list.** `stepNumber` is the
 *     only source of "Étape 6/8", so the indicator cannot drift from what is
 *     on screen.
 */

export const RENTAL_STEPS = [
  "tenant",
  "lease",
  "rent",
  "payment",
  "guarantee",
  "inspection",
  "insurance",
  "review",
] as const;

export type RentalStep = (typeof RENTAL_STEPS)[number];

export const RENTAL_TOTAL = RENTAL_STEPS.length;

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

/**
 * The last step that collects what a lease needs. Leaving it is what creates
 * the tenancy; the three that follow enrich a rental that already exists,
 * which is why they cannot come earlier.
 */
export const CREATION_STEP: RentalStep = "guarantee";

/** True once the rental has been written and the remaining steps enrich it. */
export function isAfterCreation(step: RentalStep): boolean {
  return stepNumber(step) > stepNumber(CREATION_STEP);
}

/**
 * Whether leaving this step should create the rental.
 *
 * Only on the creation step, and only while no rental exists yet. Coming back
 * to an earlier step after the lease was written and pressing on again must
 * advance, never write a second lease onto the same lot — that is what used
 * to dead-end the flow on a 409.
 */
export function shouldCreateOnLeaving(step: RentalStep, leaseId: string | null): boolean {
  return step === CREATION_STEP && leaseId === null;
}

/** Steps that cannot be left until something has been entered. */
const REQUIRED: Partial<Record<RentalStep, "tenant" | "rent">> = {
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
export function canLeave(step: RentalStep, filled: { tenant: boolean; rent: boolean }): boolean {
  const need = REQUIRED[step];
  return need === undefined ? true : filled[need];
}
