import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { orgOf, rowFromEvent, rowStatusOf, verifySignature } from "../../../../supabase/shared/functions/stripe/logic";

/**
 * The `stripe` Edge Function's own logic (supabase/shared/functions/stripe/logic.ts),
 * imported as it is deployed: the signature check and the row each event writes.
 */
const ORG = "0f0f0f0f-0000-4000-8000-00000000b111";
const NOW = 1_790_000_000;
const meta = { morada_app: "gestion", morada_org: ORG };

const subEvent = (type: string, object: Record<string, unknown>) => ({
  type, created: NOW,
  data: { object: { id: "sub_1", metadata: meta, trial_end: null, items: { data: [{ current_period_end: NOW + 90 * 86_400, price: { id: "price_1" } }] }, ...object } },
});

describe("the status Stripe's webhook records", () => {
  it("maps Stripe's statuses as Part B.3 says", () => {
    expect(["trialing", "active", "past_due", "unpaid", "incomplete", "canceled", "incomplete_expired", "paused", "weird"].map(rowStatusOf))
      .toEqual(["trialing", "active", "past_due", "unpaid", "unpaid", "canceled", "expired", "expired", null]);
  });

  it("records a trial's end as the period's end, else the item's period end, as a timestamp", () => {
    const trial = rowFromEvent(subEvent("customer.subscription.created", { status: "trialing", trial_end: NOW + 30 * 86_400 }));
    expect(trial).toEqual({ org_id: ORG, source: "stripe", status: "trialing", current_period_end: new Date((NOW + 30 * 86_400) * 1000).toISOString(), product: "price_1", updated_at: new Date(NOW * 1000).toISOString() });
    const active = rowFromEvent(subEvent("customer.subscription.updated", { status: "active" }));
    expect(active).toMatchObject({ status: "active", current_period_end: new Date((NOW + 90 * 86_400) * 1000).toISOString() });
    expect(rowFromEvent(subEvent("customer.subscription.updated", { status: "past_due", items: { data: [{}] } }))).toMatchObject({ status: "past_due", current_period_end: null, product: "morada_gestion" });
  });

  it("closes a deleted subscription, whatever status it last showed", () => {
    expect(rowFromEvent(subEvent("customer.subscription.deleted", { status: "active" }))).toMatchObject({ status: "canceled" });
  });

  it("reads the workspace from morada_org or org_id, only on the web app's own subscriptions", () => {
    expect(orgOf({ morada_app: "gestion", org_id: ORG.toUpperCase() })).toBe(ORG);
    expect(orgOf({ morada_app: "pro", morada_org: ORG })).toBeNull();
    expect(orgOf({ morada_org: ORG })).toBeNull();
    expect(orgOf({ morada_app: "gestion", morada_org: "not-a-uuid" })).toBeNull();
    expect(rowFromEvent(subEvent("customer.subscription.updated", { status: "active", metadata: { morada_app: "other", morada_org: ORG } }))).toBeNull();
  });

  it("marks a failed invoice past due only when it names the workspace, in either place Stripe puts it", () => {
    const failed = (object: Record<string, unknown>) => rowFromEvent({ type: "invoice.payment_failed", created: NOW, data: { object } });
    expect(failed({ subscription_details: { metadata: meta } })).toEqual({ org_id: ORG, source: "stripe", status: "past_due", updated_at: new Date(NOW * 1000).toISOString() });
    expect(failed({ parent: { subscription_details: { metadata: meta } } })).toMatchObject({ status: "past_due", org_id: ORG });
    expect(failed({ subscription: "sub_1" })).toBeNull();
  });

  it("ignores every other event", () => {
    expect(rowFromEvent({ type: "invoice.paid", created: NOW, data: { object: { subscription_details: { metadata: meta } } } })).toBeNull();
    expect(rowFromEvent({ type: "customer.subscription.trial_will_end", data: { object: { status: "trialing", metadata: meta } } })).toBeNull();
  });
});

describe("Stripe's signature", () => {
  const secret = "whsec_test_secret";
  const body = JSON.stringify({ id: "evt_1" });
  const sign = (t: number, payload = body, key = secret) => createHmac("sha256", key).update(`${t}.${payload}`).digest("hex");

  it("accepts Stripe's own signature, among others, within five minutes", async () => {
    expect(await verifySignature(body, `t=${NOW},v1=${sign(NOW)}`, secret, NOW)).toBe(true);
    expect(await verifySignature(body, `t=${NOW},v1=${"0".repeat(64)},v1=${sign(NOW)},v0=old`, secret, NOW + 299)).toBe(true);
  });

  it("refuses a changed body, another secret, an old or future stamp, and no header", async () => {
    expect(await verifySignature(body + " ", `t=${NOW},v1=${sign(NOW)}`, secret, NOW)).toBe(false);
    expect(await verifySignature(body, `t=${NOW},v1=${sign(NOW, body, "whsec_other")}`, secret, NOW)).toBe(false);
    expect(await verifySignature(body, `t=${NOW},v1=${sign(NOW)}`, secret, NOW + 301)).toBe(false);
    expect(await verifySignature(body, `t=${NOW},v1=${sign(NOW)}`, secret, NOW - 301)).toBe(false);
    expect(await verifySignature(body, null, secret, NOW)).toBe(false);
    expect(await verifySignature(body, `t=${NOW},v1=${sign(NOW)}`, "", NOW)).toBe(false);
    expect(await verifySignature(body, `v1=${sign(NOW)}`, secret, NOW)).toBe(false);
  });
});
