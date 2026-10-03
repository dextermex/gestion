import "server-only";
import { after } from "next/server";
import { DEFAULT_RHYTHM, isRhythm, subscriptionYear, type Rhythm } from "@/domain/billing/pricing";
import type { Cents } from "@/domain/money";
import { billingState, canExtend, type BillingPhase, type BillingState, type Nudge } from "@/domain/billing/trial";
import type { Workspace } from "@/lib/workspace";
import { billingProvider, exemptOrgs, type BillingMode } from "./provider";
import { stripeClient } from "./stripe";
import { ensureSnapshot, factsOf, nextQuote, syncPrice, type BillingSnapshot } from "./service";
import { cachedSnapshot, within } from "./cache";

/** Who may choose the rhythm, add the card and open the invoices: the workspace's owner and admins. */
export const canManageBilling = (role: string) => role === "owner" || role === "admin";

/** What the shell shows of the subscription: the chip, the banner, the paywall. */
export interface BillingBrief {
  phase: BillingPhase;
  daysLeft: number;
  nudge: Nudge;
  /** Unix seconds. */
  trialEnd: number;
  firstChargeAt: number | null;
  canManage: boolean;
  canExtend: boolean;
}

export interface Visitor {
  org: Workspace;
  userId: string;
  email: string;
  locale: string;
  /** Auth metadata: the rhythm picked at sign-up, if any. */
  metadata?: Record<string, unknown>;
}

/** The rhythm a visitor picked at sign-up, read defensively (metadata is the user's own). */
export function signupChoice(metadata: Record<string, unknown> | undefined): { rhythm: Rhythm | null } {
  const signup = (metadata?.morada_signup ?? null) as { plan?: { rhythm?: unknown } } | null;
  const chosen = signup?.plan?.rhythm;
  return { rhythm: isRhythm(chosen) ? chosen : null };
}

/**
 * The workspace's snapshot. On its first visit with subscriptions on, its
 * Stripe customer is created, which starts the trial. Null when
 * subscriptions are off, the workspace never pays, or Stripe does not
 * answer in five seconds: the screens then show nothing about it.
 */
export async function visitSnapshot(visitor: Visitor): Promise<BillingSnapshot | null> {
  const stripe = stripeClient();
  if (!stripe || exemptOrgs().has(visitor.org.id.toLowerCase())) return null;
  const choice = signupChoice(visitor.metadata);
  try {
    return await within((async () => (await cachedSnapshot(visitor.org.id)) ?? ensureSnapshot(stripe, {
      orgId: visitor.org.id, orgName: visitor.org.name, email: visitor.email, userId: visitor.userId, locale: visitor.locale,
      rhythm: choice.rhythm,
    }))(), 5000);
  } catch (error) {
    console.error("billing read failed:", error instanceof Error ? error.message : "unknown");
    return null;
  }
}

export function briefOf(snapshot: BillingSnapshot, role: string, now: number = Math.floor(Date.now() / 1000)): BillingBrief {
  const facts = factsOf(snapshot, now);
  const state = billingState(facts);
  return {
    phase: state.phase, daysLeft: state.daysLeft, nudge: state.nudge, firstChargeAt: state.firstChargeAt,
    trialEnd: snapshot.customer.trialEnd,
    canManage: canManageBilling(role),
    canExtend: canExtend(facts, snapshot.customer.extended),
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
export function shellBillingOf(snapshot: BillingSnapshot, role: string, counts: { lots: number; leases: number; rents: readonly Cents[] }): BillingBrief & { lots: number; leases: number } {
  reconcilePrice(snapshot, counts.rents);
  return { ...briefOf(snapshot, role), lots: counts.lots, leases: counts.leases };
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
  /** ready: subscriptions run; off: no key; not_secret: a key that is not a secret key; unreachable: Stripe silent; exempt: the workspace never pays. */
  status: "ready" | "off" | "not_secret" | "unreachable" | "exempt";
  mode: BillingMode | null;
  canManage: boolean;
  /** The rhythm in force, or chosen for the trial. */
  rhythm: Rhythm;
  /** The year of subscription the next charge falls in (loyalty): 1 until a subscription has run a year. */
  year: number;
  trialEnd: number | null;
  canExtend: boolean;
  state: BillingState | null;
  subscription: SubscriptionSummary | null;
}

export async function billingPage(visitor: Visitor, now: number = Math.floor(Date.now() / 1000)): Promise<BillingPageData> {
  const provider = billingProvider();
  const canManage = canManageBilling(visitor.org.role);
  const base = { mode: provider.mode, canManage, rhythm: DEFAULT_RHYTHM, year: 1, trialEnd: null, canExtend: false, state: null, subscription: null };
  if (!provider.configured) return { ...base, status: provider.problem === "not_secret" ? "not_secret" : "off" };
  if (exemptOrgs().has(visitor.org.id.toLowerCase())) return { ...base, status: "exempt" };
  const snapshot = await visitSnapshot(visitor);
  if (!snapshot) return { ...base, status: "unreachable" };
  const facts = factsOf(snapshot, now);
  const sub = snapshot.subscription;
  const running = !!sub && ["trialing", "active", "past_due", "incomplete"].includes(sub.status);
  return {
    ...base,
    status: "ready",
    rhythm: running && sub!.rhythm ? sub!.rhythm : snapshot.customer.rhythm,
    year: running && sub!.managed ? subscriptionYear(sub!.paidFrom, sub!.periodEnd ?? now) : 1,
    trialEnd: snapshot.customer.trialEnd,
    canExtend: canExtend(facts, snapshot.customer.extended),
    state: billingState(facts),
    subscription: sub ? {
      status: sub.status, rhythm: sub.rhythm, periodEnd: sub.periodEnd, cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      card: sub.card, charged: sub.charged, managed: sub.managed,
    } : null,
  };
}
