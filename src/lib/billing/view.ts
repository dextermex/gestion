import "server-only";
import { after } from "next/server";
import { DEFAULT_RHYTHM, subscriptionYear, type Rhythm } from "@/domain/billing/pricing";
import type { Cents } from "@/domain/money";
import { billingState, trialOffered, type BillingPhase, type BillingState, type Nudge } from "@/domain/billing/trial";
import type { Workspace } from "@/lib/workspace";
import { billingProvider, exemptOrgs, type BillingMode } from "./provider";
import { stripeClient } from "./stripe";
import { factsOf, nextQuote, syncPrice, type BillingSnapshot } from "./service";
import { cachedSnapshot, within } from "./cache";

/** Who may choose the rhythm, change the card and open the invoices: the workspace's owner and admins. */
export const canManageBilling = (role: string) => role === "owner" || role === "admin";

/** What the shell shows of a running subscription: the trial's counter, louder near its end. */
export interface BillingBrief {
  phase: BillingPhase;
  daysLeft: number;
  nudge: Nudge;
  /** Unix seconds; null outside a trial, or when the trial was cancelled. */
  firstChargeAt: number | null;
  /** The first charge, in cents. */
  charged: Cents;
  rhythm: Rhythm;
  canManage: boolean;
}

export interface Visitor {
  org: Workspace;
  userId: string;
  email: string;
  locale: string;
}

/**
 * The workspace's snapshot, as Stripe holds it, read through the five-minute
 * cache. Never creates anything: a customer exists only once the workspace
 * has opened Checkout. Null when subscriptions are off, the workspace never
 * pays, it has no customer yet, or Stripe does not answer in five seconds.
 */
export async function visitSnapshot(visitor: Visitor): Promise<BillingSnapshot | null> {
  if (!stripeClient() || exemptOrgs().has(visitor.org.id.toLowerCase())) return null;
  try {
    return await within(cachedSnapshot(visitor.org.id, visitor.email), 5000);
  } catch (error) {
    console.error("billing read failed:", error instanceof Error ? error.message : "unknown");
    return null;
  }
}

export function briefOf(snapshot: BillingSnapshot, role: string, now: number = Math.floor(Date.now() / 1000)): BillingBrief {
  const state = billingState(factsOf(snapshot, now));
  const sub = snapshot.subscription;
  return {
    phase: state.phase, daysLeft: state.daysLeft, nudge: state.nudge, firstChargeAt: state.firstChargeAt,
    charged: sub?.charged ?? 0,
    rhythm: sub?.rhythm ?? DEFAULT_RHYTHM,
    canManage: canManageBilling(role),
  };
}

const reconciled = new Set<string>();

/**
 * Brings a running subscription's price to the portfolio and its year,
 * after the response has gone, once per instance and figure: the first
 * charge after the trial, and every renewal, bill the lots actually let at
 * their actual rents.
 */
export function reconcilePrice(snapshot: BillingSnapshot, rents: readonly Cents[], now: number = Math.floor(Date.now() / 1000)): void {
  const sub = snapshot.subscription;
  const q = nextQuote(snapshot, rents, now);
  if (!sub || !q || (q.charged === sub.charged && q.lots === sub.lots && q.base === sub.base)) return;
  const key = `${sub.id}:${q.charged}:${q.lots}:${q.base}`;
  if (reconciled.has(key)) return;
  reconciled.add(key);
  after(async () => {
    const stripe = stripeClient();
    if (!stripe) return;
    try {
      await syncPrice(stripe, snapshot, rents, now);
    } catch (error) {
      reconciled.delete(key);
      console.error("billing price not updated:", error instanceof Error ? error.message : "unknown");
    }
  });
}

/** The shell's view of the subscription; a running subscription's price is reconciled after the response. */
export function shellBillingOf(snapshot: BillingSnapshot, role: string, rents: readonly Cents[]): BillingBrief {
  reconcilePrice(snapshot, rents);
  return briefOf(snapshot, role);
}

/** The subscription as the subscription page shows it. */
export interface SubscriptionSummary {
  status: string;
  rhythm: Rhythm | null;
  periodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  card: { brand: string; last4: string } | null;
  /** One charge, in cents. */
  charged: Cents;
  /** Priced here from the portfolio; false for terms set up with the team. */
  managed: boolean;
}

export interface BillingPageData {
  /** ready: subscriptions run; off: no key; not_secret: a key that is not a secret key; unreachable: Stripe silent; exempt: the workspace never pays; store: no Stripe subscription, the workspace is open through the App Store's. */
  status: "ready" | "off" | "not_secret" | "unreachable" | "exempt" | "store";
  mode: BillingMode | null;
  canManage: boolean;
  /** The rhythm in force. */
  rhythm: Rhythm;
  /** The year of subscription the next charge falls in (loyalty): 1 until a subscription has run a year. */
  year: number;
  state: BillingState | null;
  subscription: SubscriptionSummary | null;
  /** A new Checkout would come with the free days (the workspace never had a subscription). */
  trialOffered: boolean;
}

export async function billingPage(visitor: Visitor, now: number = Math.floor(Date.now() / 1000)): Promise<BillingPageData> {
  const provider = billingProvider();
  const canManage = canManageBilling(visitor.org.role);
  const base = { mode: provider.mode, canManage, rhythm: DEFAULT_RHYTHM, year: 1, state: null, subscription: null, trialOffered: false };
  if (!provider.configured) return { ...base, status: provider.problem === "not_secret" ? "not_secret" : "off" };
  if (exemptOrgs().has(visitor.org.id.toLowerCase())) return { ...base, status: "exempt" };
  let snapshot: BillingSnapshot | null;
  try {
    snapshot = await within(cachedSnapshot(visitor.org.id, visitor.email), 5000);
  } catch (error) {
    console.error("billing read failed:", error instanceof Error ? error.message : "unknown");
    return { ...base, status: "unreachable" };
  }
  // The page is reached only by an open workspace: without a Stripe customer, the subscription is the App Store's.
  if (!snapshot) return { ...base, status: "store" };
  const sub = snapshot.subscription;
  const running = !!sub && ["trialing", "active", "past_due", "incomplete"].includes(sub.status);
  return {
    ...base,
    status: "ready",
    rhythm: running && sub!.rhythm ? sub!.rhythm : snapshot.customer.rhythm,
    year: running && sub!.managed ? subscriptionYear(sub!.paidFrom, sub!.periodEnd ?? now) : 1,
    state: billingState(factsOf(snapshot, now)),
    trialOffered: trialOffered(snapshot.everSubscribed),
    subscription: sub ? {
      status: sub.status, rhythm: sub.rhythm, periodEnd: sub.periodEnd, cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      card: sub.card, charged: sub.charged, managed: sub.managed,
    } : null,
  };
}

/**
 * Whether the subscription page says a subscription was confirmed. The
 * return route adds `?confirme=1` only after Stripe vouched for the session,
 * but anybody can type the address: the sentence also needs a subscription
 * on the workspace's own record.
 */
export function confirmationShown(param: string | string[] | undefined, data: Pick<BillingPageData, "subscription">, sample: boolean): boolean {
  return param === "1" && !sample && data.subscription !== null;
}
