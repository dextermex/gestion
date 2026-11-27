import { QUIZ_STEPS } from "./quiz";

/**
 * The sign-up as one journey, for the bar across the top of every step,
 * the iPhone app's (its `src/features/onboarding/journey.ts`): the account
 * first, then the questions (the interests last), the result and the plan.
 * The fill is front-loaded on purpose: the account steps fill half the bar,
 * the questions most of the rest, and it starts a little filled. The app's
 * notification step has no place in a browser; the web asks the role there
 * instead, so the journey keeps the app's length and its curve. The trial
 * screens carry no bar.
 */
export const JOURNEY = [
  "phone",
  "verify",
  "role",
  "name",
  "email",
  "create-password",
  ...QUIZ_STEPS.map((_, i) => `quiz:${i + 1}` as const),
  "interests",
  "potential",
  "reviews",
  "ready",
] as const;

export type JourneyStep = (typeof JOURNEY)[number];

const START = 0.06;
const CURVE = 1.8;

/** The bar's fill for a step, between 0 and 1. */
export function journeyProgress(step: JourneyStep): number {
  const i = JOURNEY.indexOf(step);
  if (i < 0) return 0;
  const x = i / (JOURNEY.length - 1);
  return Math.min(1, START + (1 - START) * (1 - Math.pow(1 - x, CURVE)));
}

/** The question at 1-based index `n`. */
export const quizStep = (n: number): JourneyStep => `quiz:${Math.min(QUIZ_STEPS.length, Math.max(1, Math.round(n)))}` as JourneyStep;
