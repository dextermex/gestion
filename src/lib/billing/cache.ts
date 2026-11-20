import "server-only";
import { revalidateTag, unstable_cache } from "next/cache";
import { stripeClient } from "./stripe";
import { readSnapshot, type BillingSnapshot } from "./service";

/**
 * A workspace's snapshot, kept five minutes in Next's data cache and
 * refreshed at once after a Checkout, a portal visit or a change made from
 * the subscription page (revalidateTag on billingTag). The layout, the
 * subscription page and every write route read it; Stripe is asked again
 * only when it has gone stale.
 */
export const billingTag = (orgId: string) => `billing:${orgId}`;

const NOT_YET = "billing_not_yet";

/** The snapshot, or null while the workspace has no customer yet (not cached, so its creation shows at once). */
export async function cachedSnapshot(orgId: string): Promise<BillingSnapshot | null> {
  const stripe = stripeClient();
  if (!stripe) return null;
  try {
    return await unstable_cache(
      async () => {
        const snapshot = await readSnapshot(stripe, orgId);
        if (!snapshot) throw Object.assign(new Error(NOT_YET), { code: NOT_YET });
        return snapshot;
      },
      ["billing-snapshot", orgId],
      { tags: [billingTag(orgId)], revalidate: 300 },
    )();
  } catch (error) {
    if ((error as { code?: string }).code === NOT_YET) return null;
    throw error;
  }
}

/**
 * The snapshot read from Stripe now, past the cache, which is then dropped
 * so the screens follow. Asked only when the cached one says the workspace
 * is locked: a payment made without coming back through the return route
 * (another tab, the invoice e-mail, the team) unlocks at the next write
 * instead of up to five minutes later.
 */
export async function freshSnapshot(orgId: string): Promise<BillingSnapshot | null> {
  const stripe = stripeClient();
  if (!stripe) return null;
  const snapshot = await readSnapshot(stripe, orgId);
  try {
    revalidateTag(billingTag(orgId));
  } catch {
    /* outside a request (a test, a script): there is no cache to drop */
  }
  return snapshot;
}

/** A promise that gives up after `ms`: a slow Stripe never holds a page or a write. */
export function within<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`billing: no answer within ${ms} ms`)), ms);
    work.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}
