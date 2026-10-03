/**
 * Whether the deployment takes subscriptions, read from its server-side
 * variables, never from a browser:
 *
 *   STRIPE_SECRET_KEY    the Stripe account's secret key: sk_live_… (or
 *                        sk_test_… for a test account; a restricted rk_ key
 *                        with the same rights works too). Any other value,
 *                        such as a publishable pk_ key or the key's identifier
 *                        shown in the dashboard, is refused by name.
 *   STRIPE_TAX           "1": Stripe Tax works out the VAT at checkout (Stripe
 *                        Tax must be set up on the account first).
 *   BILLING_EXEMPT_ORGS  workspace ids that never pay (the operator's own,
 *                        partners), comma-separated.
 *
 * Without a valid key nothing about subscriptions shows or applies: no trial
 * clock, no reminder, no read-only mode.
 */
export type BillingMode = "test" | "live";

export interface BillingStatus {
  configured: boolean;
  mode: BillingMode | null;
  /** A key is set that is not a secret key: said, not tried. */
  problem: "not_secret" | null;
  /** VAT worked out by Stripe Tax at checkout. */
  tax: boolean;
}

const SECRET = /^(sk|rk)_(test|live)_[A-Za-z0-9]{10,}$/;

export function billingProvider(env: Record<string, string | undefined> = process.env): BillingStatus {
  const key = env.STRIPE_SECRET_KEY?.trim() ?? "";
  const tax = env.STRIPE_TAX === "1";
  if (!key) return { configured: false, mode: null, problem: null, tax };
  const match = SECRET.exec(key);
  if (!match) return { configured: false, mode: null, problem: "not_secret", tax };
  return { configured: true, mode: match[2] as BillingMode, problem: null, tax };
}

/** Workspaces that never pay, by id. */
export function exemptOrgs(env: Record<string, string | undefined> = process.env): Set<string> {
  return new Set((env.BILLING_EXEMPT_ORGS ?? "").split(",").map((id) => id.trim().toLowerCase()).filter(Boolean));
}
