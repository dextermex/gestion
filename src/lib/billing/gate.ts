import "server-only";
import { NextResponse } from "next/server";
import { billingState } from "@/domain/billing/trial";
import type { Workspace } from "@/lib/workspace";
import { billingProvider, exemptOrgs } from "./provider";
import { factsOf, type BillingSnapshot } from "./service";
import { cachedSnapshot, freshSnapshot, within } from "./cache";

/**
 * Whether a workspace's writes are refused: only once its trial is over with
 * nothing subscribed (or its subscription has ended), on a deployment that
 * takes subscriptions, for a workspace that pays. Every doubt opens: no key,
 * Stripe slow or unreachable, no customer yet. A paywall must never be the
 * reason a paying landlord cannot record a payment.
 *
 * The snapshot read is the cached one (five minutes); a lock it shows is
 * confirmed against Stripe before a write is refused, so a subscription
 * taken anywhere opens the workspace at once.
 */
export async function lockedFor(
  orgId: string,
  read: (orgId: string) => Promise<BillingSnapshot | null> = cachedSnapshot,
  env: Record<string, string | undefined> = process.env,
  now: number = Math.floor(Date.now() / 1000),
  confirm: (orgId: string) => Promise<BillingSnapshot | null> = freshSnapshot,
): Promise<boolean> {
  if (!billingProvider(env).configured || exemptOrgs(env).has(orgId.toLowerCase())) return false;
  let snapshot: BillingSnapshot | null = null;
  try {
    snapshot = await within(read(orgId), 4000);
  } catch (error) {
    console.error("billing gate: no answer, write allowed:", error instanceof Error ? error.message : "unknown");
    return false;
  }
  if (!snapshot) return false;
  if (billingState(factsOf(snapshot, now)).writable) return false;
  let current: BillingSnapshot | null = null;
  try {
    current = await within(confirm(orgId), 4000);
  } catch (error) {
    // Stripe said "locked" minutes ago and says nothing now: the last word stands.
    console.error("billing gate: lock not confirmed, cached answer kept:", error instanceof Error ? error.message : "unknown");
    return true;
  }
  return current ? !billingState(factsOf(current, now)).writable : false;
}

/** The answer a refused write gets: the client opens the subscription screen on it. */
export async function refuseWhenLocked(org: Workspace): Promise<NextResponse | null> {
  return (await lockedFor(org.id)) ? NextResponse.json({ error: "subscription_required" }, { status: 402 }) : null;
}
