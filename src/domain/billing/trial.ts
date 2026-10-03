/**
 * Where a workspace stands with its subscription, from two facts: its own
 * trial clock (30 days from its first visit, kept by Stripe, out of the
 * workspace's reach) and the subscription Stripe holds for it, if any.
 *
 * The trial needs no card. A card added during the trial starts nothing
 * before the trial's end: the first charge falls on that day. Without a
 * card, the trial simply ends: nothing is charged and nothing is deleted,
 * the workspace reads everything and changes nothing until it subscribes.
 * Times are unix seconds, as Stripe gives them.
 */
import { REMINDER_DAYS, TRIAL_DAYS, TRIAL_EXTENSION_DAYS } from "./pricing";

export const DAY = 86_400;

/**
 *  trial       the trial runs, no card yet
 *  trial_card  the trial runs and a subscription waits for its end (card on file)
 *  active      a paid subscription runs
 *  past_due    a payment failed: Stripe retries, the workspace keeps working
 *  expired     the trial is over and nothing was subscribed
 *  ended       a subscription existed and has ended
 */
export type BillingPhase = "trial" | "trial_card" | "active" | "past_due" | "expired" | "ended";

/** How loudly the screens remind: not at all, a quiet chip, a banner, an urgent banner, the paywall. */
export type Nudge = "none" | "quiet" | "soon" | "urgent" | "locked";

export interface SubscriptionFacts {
  /** Stripe's status, verbatim. */
  status: string;
  /** The end of the subscription's own trial, if it has one. */
  trialEnd: number | null;
  /** The end of the period paid for (or of the trial). */
  periodEnd: number | null;
  /** Set to end at the period's end. */
  cancelAtPeriodEnd: boolean;
}

export interface BillingFacts {
  now: number;
  /** The workspace's trial end. */
  trialEnd: number;
  subscription: SubscriptionFacts | null;
}

export interface BillingState {
  phase: BillingPhase;
  /** Days left in the trial, the current one counted (1 on its last day); 0 once over. */
  daysLeft: number;
  /** When the first charge falls, for a card added during the trial; null otherwise. */
  firstChargeAt: number | null;
  nudge: Nudge;
  /** Whether the workspace may still change its records. */
  writable: boolean;
}

/** Statuses under which the workspace keeps working. */
const RUNNING = new Set(["trialing", "active", "past_due", "incomplete"]);

export const daysUntil = (now: number, end: number): number => (end > now ? Math.ceil((end - now) / DAY) : 0);

export function billingState(facts: BillingFacts): BillingState {
  const sub = facts.subscription;
  if (sub && RUNNING.has(sub.status)) {
    if (sub.status === "trialing") {
      const end = sub.trialEnd ?? facts.trialEnd;
      return { phase: "trial_card", daysLeft: daysUntil(facts.now, end), firstChargeAt: end, nudge: "none", writable: true };
    }
    if (sub.status === "active") return { phase: "active", daysLeft: 0, firstChargeAt: null, nudge: "none", writable: true };
    // A failed payment: Stripe retries on its own schedule, the screens ask for another card meanwhile.
    return { phase: "past_due", daysLeft: 0, firstChargeAt: null, nudge: "urgent", writable: true };
  }
  const daysLeft = daysUntil(facts.now, facts.trialEnd);
  if (daysLeft > 0) {
    const nudge: Nudge = daysLeft <= 2 ? "urgent" : daysLeft <= REMINDER_DAYS ? "soon" : "quiet";
    return { phase: "trial", daysLeft, firstChargeAt: null, nudge, writable: true };
  }
  return { phase: sub ? "ended" : "expired", daysLeft: 0, firstChargeAt: null, nudge: "locked", writable: false };
}

/** The workspace's trial end: its start plus the trial, unless an extension moved it. */
export function trialEndOf(start: number, extendedTo: number | null): number {
  const base = start + TRIAL_DAYS * DAY;
  return extendedTo && extendedTo > base ? extendedTo : base;
}

/** The one extension: offered when the trial is over or ends within two days, nothing subscribed, none taken. */
export function canExtend(facts: BillingFacts, alreadyExtended: boolean): boolean {
  if (alreadyExtended) return false;
  const state = billingState(facts);
  return state.phase === "expired" || (state.phase === "trial" && state.daysLeft <= 2);
}

/** The extended end: seven days from the later of now and the current end. */
export function extendedEnd(now: number, trialEnd: number): number {
  return Math.max(now, trialEnd) + TRIAL_EXTENSION_DAYS * DAY;
}

/** Stripe refuses a Checkout trial ending within 48 hours; a small margin covers the clock. */
const CHECKOUT_MIN_TRIAL = 48 * 3600 + 600;

/**
 * What remains of the trial, in the form Checkout takes: its exact end when
 * that is far enough, else Stripe's shortest trial (a gift of under two days
 * rather than a charge before the promised date), else nothing (charged now).
 */
export function checkoutTrial(now: number, trialEnd: number): { trial_end: number } | { trial_period_days: number } | null {
  if (trialEnd - now >= CHECKOUT_MIN_TRIAL) return { trial_end: trialEnd };
  if (trialEnd > now) return { trial_period_days: 2 };
  return null;
}

export type Reminder = "d7" | "d2" | "ended";

/**
 * The reminder a trial is due by email, if any: seven days before its end,
 * two days before, and once it has ended without a subscription. Windows,
 * not exact days, so a missed daily run still sends each one once.
 */
export function reminderDue(facts: BillingFacts, sent: readonly string[]): Reminder | null {
  const state = billingState(facts);
  if (state.phase === "trial") {
    if (state.daysLeft <= 2) return sent.includes("d2") ? null : "d2";
    if (state.daysLeft <= REMINDER_DAYS) return sent.includes("d7") ? null : "d7";
    return null;
  }
  if (state.phase === "trial_card") {
    // The first charge announced a week ahead, as card schemes ask of trials.
    return state.daysLeft <= REMINDER_DAYS && !sent.includes("d7") ? "d7" : null;
  }
  if (state.phase === "expired" && facts.now - facts.trialEnd < 3 * DAY) return sent.includes("ended") ? null : "ended";
  return null;
}
