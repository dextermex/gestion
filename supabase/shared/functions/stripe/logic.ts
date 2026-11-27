// The pure part of the `stripe` webhook: Stripe's signature, and the row of
// gestion.billing_status an event leaves. No Deno global and no import, so
// the web app's tests (src/lib/billing/__tests__/stripe-webhook.test.ts) run
// this very file under Node; index.ts is the Deno server around it.

export type RowStatus = "trialing" | "active" | "past_due" | "unpaid" | "canceled" | "expired";

export interface StatusRow {
  org_id: string;
  source: "stripe";
  status: RowStatus;
  /** Omitted when the event does not say (a failed invoice): the stored end is kept. */
  current_period_end?: string | null;
  product?: string | null;
  /** The event's own time, so an older event never overwrites a newer one. */
  updated_at: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The product every web subscription bills (src/lib/billing/service.ts PRODUCT). */
export const PRODUCT = "morada_gestion";

/** Stripe's subscription status as the shared record keeps it (docs/WEB-ONBOARDING.md, Part B.3). */
export function rowStatusOf(status: string): RowStatus | null {
  switch (status) {
    case "trialing":
    case "active":
    case "past_due":
    case "unpaid":
    case "canceled":
      return status;
    case "incomplete":
      return "unpaid";
    case "incomplete_expired":
    // A subscription paused at the end of its trial charges nothing and opens nothing: it has ended.
    case "paused":
      return "expired";
    default:
      return null;
  }
}

type Meta = Record<string, unknown> | null | undefined;

/** The workspace a subscription is for, from the metadata the web writes (`morada_org`, or `org_id`), when it is the web app's own. */
export function orgOf(meta: Meta): string | null {
  if (!meta || meta.morada_app !== "gestion") return null;
  const org = typeof meta.morada_org === "string" ? meta.morada_org : typeof meta.org_id === "string" ? meta.org_id : "";
  return UUID.test(org) ? org.toLowerCase() : null;
}

const iso = (seconds: unknown): string | null => (typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null);

interface StripeEvent {
  type?: unknown;
  created?: unknown;
  data?: { object?: Record<string, unknown> };
}

/**
 * The row an event writes, or null for an event that changes nothing here
 * (another type, another app's subscription, a workspace not named).
 */
export function rowFromEvent(event: StripeEvent): StatusRow | null {
  const type = String(event.type ?? "");
  const object = event.data?.object ?? {};
  const updated_at = iso(event.created) ?? new Date().toISOString();
  if (type === "customer.subscription.created" || type === "customer.subscription.updated" || type === "customer.subscription.deleted") {
    const org = orgOf(object.metadata as Meta);
    if (!org) return null;
    // A deleted subscription has ended, whatever status it last showed.
    const status = type === "customer.subscription.deleted" ? "canceled" : rowStatusOf(String(object.status ?? ""));
    if (!status) return null;
    const items = ((object.items as { data?: Record<string, unknown>[] } | undefined)?.data ?? []);
    const item = items[0] ?? {};
    const end = status === "trialing" ? (object.trial_end ?? item.current_period_end) : (item.current_period_end ?? object.current_period_end);
    const price = item.price as { id?: unknown } | undefined;
    return {
      org_id: org,
      source: "stripe",
      status,
      current_period_end: iso(end),
      product: typeof price?.id === "string" ? price.id : PRODUCT,
      updated_at,
    };
  }
  if (type === "invoice.payment_failed") {
    // The invoice names its subscription by id only; the workspace is taken from the
    // subscription's metadata the invoice carries, or the event is left alone.
    const parent = object.parent as { subscription_details?: { metadata?: Meta } } | undefined;
    const details = object.subscription_details as { metadata?: Meta } | undefined;
    const org = orgOf(details?.metadata) ?? orgOf(parent?.subscription_details?.metadata);
    if (!org) return null;
    return { org_id: org, source: "stripe", status: "past_due", updated_at };
  }
  return null;
}

/** Stripe signs `t.payload`; events older than this are refused, so a captured one cannot be replayed later. */
export const TOLERANCE_SECONDS = 300;

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

const same = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

/** Whether `header` (Stripe-Signature) signs `payload` with `secret`, within the tolerance of `now` (unix seconds). */
export async function verifySignature(payload: string, header: string | null, secret: string, now: number, tolerance = TOLERANCE_SECONDS): Promise<boolean> {
  if (!header || !secret) return false;
  let t = "";
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const at = part.indexOf("=");
    if (at < 0) continue;
    const key = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    if (key === "t") t = value;
    else if (key === "v1") signatures.push(value);
  }
  const stamp = Number(t);
  if (!/^\d+$/.test(t) || signatures.length === 0 || Math.abs(now - stamp) > tolerance) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`)));
  let match = false;
  for (const s of signatures) match = same(s, expected) || match;
  return match;
}
