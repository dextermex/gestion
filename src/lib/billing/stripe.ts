import "server-only";
import Stripe from "stripe";
import { billingProvider } from "./provider";

/**
 * The Stripe client, server-side only, on the secret key the deployment
 * carries. The SDK pins the API version it was built for, so a change on
 * Stripe's side never reshapes an answer under the code. Two retries on a
 * dropped connection; a page never waits more than twelve seconds.
 */
let held: { key: string; client: Stripe } | null = null;

export function stripeClient(env: Record<string, string | undefined> = process.env): Stripe | null {
  if (!billingProvider(env).configured) return null;
  const key = env.STRIPE_SECRET_KEY!.trim();
  if (held?.key === key) return held.client;
  const client = new Stripe(key, { maxNetworkRetries: 2, timeout: 12_000, appInfo: { name: "Morada Gestion" } });
  held = { key, client };
  return client;
}

/** The HTTP status of a Stripe failure, when it reached Stripe. */
export function stripeStatus(error: unknown): number | undefined {
  return error instanceof Stripe.errors.StripeError ? error.statusCode : undefined;
}

/** Stripe's error code (resource_missing, resource_already_exists…), when it gave one. */
export function stripeCode(error: unknown): string | undefined {
  return error instanceof Stripe.errors.StripeError ? error.code : undefined;
}
