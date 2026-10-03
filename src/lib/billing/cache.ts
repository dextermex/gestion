import "server-only";
import { unstable_cache } from "next/cache";
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

/** A promise that gives up after `ms`: a slow Stripe never holds a page or a write. */
export function within<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`billing: no answer within ${ms} ms`)), ms);
    work.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}
