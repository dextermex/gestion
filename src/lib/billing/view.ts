import "server-only";
import { after } from "next/server";
import { DEFAULT_PLAN, DEFAULT_RHYTHM, isPlanId, isRhythm, type PlanId, type Rhythm } from "@/domain/billing/plans";
import { billingState, canExtend, type BillingPhase, type BillingState, type Nudge } from "@/domain/billing/trial";
import type { Workspace } from "@/lib/workspace";
import { authedClient } from "@/lib/supabase/server";
import { billingProvider, exemptOrgs, type BillingMode } from "./provider";
import { stripeClient } from "./stripe";
import { ensureSnapshot, factsOf, syncQuantities, type BillingSnapshot } from "./service";
import { cachedSnapshot, within } from "./cache";

/** Who may choose the plan, add the card and open the invoices: the workspace's owner and admins. */
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
  /** Auth metadata: the plan picked at sign-up, if any. */
  metadata?: Record<string, unknown>;
}

/** The plan and rhythm a visitor picked at sign-up, read defensively (metadata is the user's own). */
export function signupChoice(metadata: Record<string, unknown> | undefined): { plan: PlanId | null; rhythm: Rhythm | null } {
  const signup = (metadata?.morada_signup ?? null) as { plan?: { id?: unknown; rhythm?: unknown } } | null;
  const chosen = signup?.plan;
  return { plan: isPlanId(chosen?.id) ? chosen!.id as PlanId : null, rhythm: isRhythm(chosen?.rhythm) ? chosen!.rhythm as Rhythm : null };
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
      plan: choice.plan, rhythm: choice.rhythm,
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
 * Brings a running subscription's lot count to the portfolio's, after the
 * response has gone, once per instance and figure: the first charge after
 * the trial, and every renewal, count the lots actually managed.
 */
export function reconcileLots(snapshot: BillingSnapshot, lots: number): void {
  const sub = snapshot.subscription;
  if (!sub || !sub.plan || !["trialing", "active", "past_due"].includes(sub.status)) return;
  const target = Math.max(1, lots);
  if (target === sub.lots) return;
  const key = `${sub.id}:${target}`;
  if (reconciled.has(key)) return;
  reconciled.add(key);
  after(async () => {
    const stripe = stripeClient();
    if (!stripe) return;
    try {
      await syncQuantities(stripe, snapshot, target, sub.seats);
    } catch (error) {
      reconciled.delete(key);
      console.error("billing lot count not updated:", error instanceof Error ? error.message : "unknown");
    }
  });
}

/** The shell's view of the subscription; a running subscription's lot count is reconciled after the response. */
export function shellBillingOf(snapshot: BillingSnapshot, role: string, counts: { lots: number; leases: number }): BillingBrief & { lots: number; leases: number } {
  reconcileLots(snapshot, counts.lots);
  return { ...briefOf(snapshot, role), lots: counts.lots, leases: counts.leases };
}

/** The subscription as the subscription page shows it. */
export interface SubscriptionSummary {
  status: string;
  plan: PlanId | null;
  rhythm: Rhythm | null;
  periodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  card: { brand: string; last4: string } | null;
  /** One charge, in cents. */
  charged: number;
  lots: number;
  seats: number;
}

export interface BillingPageData {
  /** ready: subscriptions run; off: no key; not_secret: a key that is not a secret key; unreachable: Stripe silent; exempt: the workspace never pays. */
  status: "ready" | "off" | "not_secret" | "unreachable" | "exempt";
  mode: BillingMode | null;
  canManage: boolean;
  /** The plan and rhythm in force, or chosen for the trial. */
  plan: PlanId;
  rhythm: Rhythm;
  trialEnd: number | null;
  canExtend: boolean;
  state: BillingState | null;
  subscription: SubscriptionSummary | null;
}

export async function billingPage(visitor: Visitor, now: number = Math.floor(Date.now() / 1000)): Promise<BillingPageData> {
  const provider = billingProvider();
  const canManage = canManageBilling(visitor.org.role);
  const base = { mode: provider.mode, canManage, plan: DEFAULT_PLAN, rhythm: DEFAULT_RHYTHM, trialEnd: null, canExtend: false, state: null, subscription: null };
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
    plan: running && sub!.plan ? sub!.plan : snapshot.customer.plan,
    rhythm: running && sub!.rhythm ? sub!.rhythm : snapshot.customer.rhythm,
    trialEnd: snapshot.customer.trialEnd,
    canExtend: canExtend(facts, snapshot.customer.extended),
    state: billingState(facts),
    subscription: sub ? {
      status: sub.status, plan: sub.plan, rhythm: sub.rhythm, periodEnd: sub.periodEnd, cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      card: sub.card, charged: sub.charged, lots: sub.lots, seats: sub.seats,
    } : null,
  };
}

/** The workspace's active users, for the plan that counts them; at least one. */
export async function memberCount(accessToken: string, orgId: string): Promise<number> {
  const { count, error } = await authedClient(accessToken).from("crm_members").select("user_id", { count: "exact", head: true }).eq("agency_id", orgId).eq("status", "active");
  if (error) console.error("billing member count failed:", error.code);
  return Math.max(1, count ?? 1);
}
