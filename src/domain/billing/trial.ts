/**
 * Who may enter a workspace, and what the screens say about its
 * subscription (owner's decision of 19 and 27 November 2026, the iPhone
 * app's src/lib/access.ts):
 *
 *  - A workspace is open only while a subscription runs: Stripe's status
 *    `trialing` or `active`. Everything else locks every page, with a reason:
 *    `no_trial` (never subscribed), `payment` (a payment failed or was never
 *    completed), `ended` (cancelled, expired, paused). Nothing is deleted
 *    when it locks.
 *  - The trial is the subscription's own: thirty days that start at Checkout,
 *    with the card taken before them, and a first charge on the last day
 *    unless the subscription is cancelled. There is no trial without a card
 *    and no extension. The free days are promised once: a workspace that
 *    ever had a subscription is charged at once on a new one.
 *
 * Pure: times are unix seconds, as Stripe gives them.
 */
import { REMINDER_DAYS, TRIAL_DAYS } from "./pricing";

export const DAY = 86_400;

/** Why a workspace is locked: the trial was never started, a payment failed, a subscription ended. */
export type LockReason = "no_trial" | "payment" | "ended";

/**
 *  none     no subscription ever: locked, `no_trial`
 *  trial    the subscription's trial runs, a card on file
 *  active   a paid subscription runs
 *  payment  a payment failed or was never completed: locked, `payment`
 *  ended    a subscription existed and has stopped: locked, `ended`
 */
export type BillingPhase = "none" | "trial" | "active" | "payment" | "ended";

/** How loudly the screens speak of the trial: not at all, a quiet counter, louder in its last week, urgent in its last two days; locked otherwise. */
export type Nudge = "none" | "quiet" | "soon" | "urgent" | "locked";

export interface SubscriptionFacts {
  /** Stripe's status, verbatim. */
  status: string;
  /** The end of the subscription's trial, if it has one. */
  trialEnd: number | null;
  /** The end of the period paid for (or of the trial). */
  periodEnd: number | null;
  /** Set to end at the period's end. */
  cancelAtPeriodEnd: boolean;
}

export interface BillingFacts {
  now: number;
  /** The workspace's current subscription (src/lib/billing/service.ts pickSubscription), if it ever had one. */
  subscription: SubscriptionFacts | null;
}

export interface BillingState {
  phase: BillingPhase;
  /** Whether the workspace opens at all. */
  open: boolean;
  reason: LockReason | null;
  /** Days left in the trial, the current one counted (1 on its last day); 0 outside a trial. */
  daysLeft: number;
  /** When the trial's first charge falls; null outside a trial. */
  firstChargeAt: number | null;
  nudge: Nudge;
}

/** Stripe statuses under which a subscription runs. */
export const RUNNING_STATUSES: readonly string[] = ["trialing", "active"];
/** Stripe statuses of a subscription waiting for a payment: it does not run. */
export const PAYMENT_STATUSES: readonly string[] = ["past_due", "unpaid", "incomplete"];

export const isRunningStatus = (status: string | null | undefined): boolean => !!status && RUNNING_STATUSES.includes(status);

/** The days of the trial from which the counter grows louder, then urgent. */
export const SOON_DAYS = REMINDER_DAYS;
export const URGENT_DAYS = 2;

export const daysUntil = (now: number, end: number): number => (end > now ? Math.ceil((end - now) / DAY) : 0);

/** Why a workspace whose subscription has this Stripe status is locked; null while it runs. No subscription at all is `no_trial`. */
export function lockReasonOf(status: string | null | undefined): LockReason | null {
  if (!status) return "no_trial";
  if (isRunningStatus(status)) return null;
  return PAYMENT_STATUSES.includes(status) ? "payment" : "ended";
}

export function billingState(facts: BillingFacts): BillingState {
  const sub = facts.subscription;
  const reason = lockReasonOf(sub?.status);
  if (reason) {
    const phase: BillingPhase = reason === "no_trial" ? "none" : reason === "payment" ? "payment" : "ended";
    return { phase, open: false, reason, daysLeft: 0, firstChargeAt: null, nudge: "locked" };
  }
  if (sub!.status === "trialing") {
    const end = sub!.trialEnd ?? sub!.periodEnd ?? facts.now;
    const daysLeft = daysUntil(facts.now, end);
    const nudge: Nudge = daysLeft <= URGENT_DAYS ? "urgent" : daysLeft <= SOON_DAYS ? "soon" : "quiet";
    return { phase: "trial", open: true, reason: null, daysLeft, firstChargeAt: sub!.cancelAtPeriodEnd ? null : end, nudge };
  }
  return { phase: "active", open: true, reason: null, daysLeft: 0, firstChargeAt: null, nudge: "none" };
}

/** Whether a new Checkout comes with the free days: only for a workspace that never had a subscription. */
export const trialOffered = (everSubscribed: boolean): boolean => !everSubscribed;

/** The trial a Checkout carries: the thirty days when offered, else none (charged at once). */
export const checkoutTrial = (offered: boolean): { trial_period_days: number } | null => (offered ? { trial_period_days: TRIAL_DAYS } : null);

/** When a Checkout started now first charges: at the trial's end when one is offered, else today. */
export const firstChargeOn = (now: number, offered: boolean): number => (offered ? now + TRIAL_DAYS * DAY : now);

// ── The shared record (gestion.billing_status) ─────────────────────────────

/** A row of gestion.billing_status, as either store's webhook writes it. */
export interface BillingRow {
  source: string;
  status: string;
  /** ISO timestamp, or null. */
  current_period_end: string | null;
}

/** Whether a recorded subscription runs at `now`: trialing or active, its period not over. */
export function rowRuns(row: BillingRow, now: number): boolean {
  if (!isRunningStatus(row.status)) return false;
  if (row.current_period_end === null) return true;
  const end = Date.parse(row.current_period_end);
  return Number.isFinite(end) && end / 1000 > now;
}

export const anyRowRuns = (rows: readonly BillingRow[], now: number): boolean => rows.some((r) => rowRuns(r, now));

/** The lock reason the recorded rows give when nothing runs: a failed payment first, then an ended subscription, else none ever. */
export function reasonFromRows(rows: readonly BillingRow[]): LockReason {
  if (rows.some((r) => r.status === "past_due" || r.status === "unpaid")) return "payment";
  return rows.length > 0 ? "ended" : "no_trial";
}

// ── The trial's e-mails ─────────────────────────────────────────────────────

/** A week before the first charge (as card schemes ask of trials), and two days before (the reminder the offer screen promises). */
export type Reminder = "d7" | "d2";

/**
 * The reminder a running trial is due by e-mail, if any. Windows, not exact
 * days, so a missed daily run still sends each one once; a trial already in
 * its last two days gets only the later one. A trial cancelled before its
 * end charges nothing and is not reminded.
 */
export function reminderDue(facts: BillingFacts, sent: readonly string[]): Reminder | null {
  const state = billingState(facts);
  if (state.phase !== "trial" || state.firstChargeAt === null || state.daysLeft === 0) return null;
  if (state.daysLeft <= URGENT_DAYS) return sent.includes("d2") ? null : "d2";
  if (state.daysLeft <= SOON_DAYS) return sent.includes("d7") || sent.includes("d2") ? null : "d7";
  return null;
}
