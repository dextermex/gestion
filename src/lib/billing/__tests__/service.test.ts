import { describe, expect, it } from "vitest";
import Stripe from "stripe";
import { DAY } from "@/domain/billing/trial";
import {
  META, checkoutBelongs, choosePlan, createCheckout, customerFacts, ensurePrice, ensureSnapshot, extendTrial, findCustomer,
  lookupKey, pickSubscription, portalUrl, snapshotOf, subscriptionView, syncQuantities, type BillingSnapshot,
} from "@/lib/billing/service";
import { lockedFor } from "@/lib/billing/gate";
import { billingProvider, exemptOrgs } from "@/lib/billing/provider";
import { signupChoice } from "@/lib/billing/view";

/**
 * The billing service against a recorded stand-in for Stripe: the real SDK,
 * pointed at a fake HTTP layer, so these tests read the very parameters
 * Stripe would receive (form-encoded, as the API takes them) and feed back
 * answers in Stripe's own shapes.
 */
const ORG = "0f0f0f0f-0000-4000-8000-00000000b111";
const OTHER = "0f0f0f0f-0000-4000-8000-00000000b222";
const NOW = 1_790_000_000;

interface Call { method: string; path: string; query: URLSearchParams; form: URLSearchParams; idempotency: string | null }
type Reply = { status?: number; body: unknown };

function standIn(route: (call: Call) => Reply | undefined) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const headers = new Headers(init?.headers);
    const call: Call = {
      method: String(init?.method ?? "GET").toUpperCase(),
      path: url.pathname,
      query: url.searchParams,
      form: new URLSearchParams(typeof init?.body === "string" ? init.body : ""),
      idempotency: headers.get("idempotency-key"),
    };
    calls.push(call);
    const reply = route(call) ?? { status: 404, body: { error: { type: "invalid_request_error", code: "resource_missing", message: `no stand-in for ${call.method} ${call.path}` } } };
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200, headers: { "Content-Type": "application/json", "request-id": "req_test" } });
  }) as typeof fetch;
  const stripe = new Stripe("sk_test_standin0000000000", { httpClient: Stripe.createFetchHttpClient(fetchImpl), maxNetworkRetries: 0, telemetry: false });
  return { stripe, calls };
}

const list = (data: unknown[], url = "/v1/x") => ({ object: "list", data, has_more: false, url });
const search = (data: unknown[]) => ({ object: "search_result", data, has_more: false, next_page: null, url: "/v1/customers/search" });

function customer(over: Record<string, unknown> = {}) {
  return { id: "cus_A", object: "customer", created: NOW - 3 * DAY, email: "owner@example.lu", metadata: { [META.app]: "gestion", [META.org]: ORG, [META.plan]: "landlord", [META.rhythm]: "quarter", [META.locale]: "fr" }, ...over };
}

function price(over: Record<string, unknown> = {}) {
  return { id: "price_lot_q", object: "price", unit_amount: 1500, recurring: { interval: "month", interval_count: 3 }, metadata: { [META.component]: "lot", [META.plan]: "landlord" }, ...over };
}

function subscription(over: Record<string, unknown> = {}) {
  return {
    id: "sub_1", object: "subscription", status: "trialing", created: NOW - DAY, trial_end: NOW + 27 * DAY, cancel_at_period_end: false, cancel_at: null,
    metadata: { [META.org]: ORG, [META.plan]: "landlord", [META.rhythm]: "quarter" },
    default_payment_method: { id: "pm_1", object: "payment_method", card: { brand: "visa", last4: "4242" } },
    items: { object: "list", data: [{ id: "si_lot", object: "subscription_item", quantity: 12, current_period_end: NOW + 27 * DAY, price: price() }], has_more: false },
    ...over,
  };
}

describe("finding and creating the workspace's customer", () => {
  it("finds the customer by the workspace id, the oldest when two exist", async () => {
    const { stripe, calls } = standIn((c) => c.path === "/v1/customers/search"
      ? { body: search([customer({ id: "cus_new", created: NOW }), customer({ id: "cus_old", created: NOW - 9 * DAY }), customer({ id: "cus_x", metadata: { [META.org]: OTHER } })]) }
      : undefined);
    const found = await findCustomer(stripe, ORG);
    expect(found?.id).toBe("cus_old");
    expect(calls[0].query.get("query")).toBe(`metadata['morada_org']:'${ORG}'`);
  });

  it("falls back to the caller's e-mail while the search lags a creation", async () => {
    const { stripe, calls } = standIn((c) => c.path === "/v1/customers/search" ? { body: search([]) } : c.path === "/v1/customers" && c.method === "GET" ? { body: list([customer({ id: "cus_fresh" })]) } : undefined);
    expect((await findCustomer(stripe, ORG, "owner@example.lu"))?.id).toBe("cus_fresh");
    expect(calls[1].query.get("email")).toBe("owner@example.lu");
  });

  it("refuses anything but a workspace id in the search query", async () => {
    const { stripe } = standIn(() => undefined);
    await expect(findCustomer(stripe, "x' OR metadata['a']:'b")).rejects.toThrow();
  });

  it("starts the trial on the first visit: a customer carrying the workspace id and the plan picked at sign-up", async () => {
    const { stripe, calls } = standIn((c) => {
      if (c.path === "/v1/customers/search") return { body: search([]) };
      if (c.path === "/v1/customers" && c.method === "GET") return { body: list([]) };
      if (c.path === "/v1/customers" && c.method === "POST") return { body: customer({ id: "cus_new", created: NOW, metadata: Object.fromEntries([...c.form].filter(([k]) => k.startsWith("metadata[")).map(([k, v]) => [k.slice(9, -1), v])) }) };
      return undefined;
    });
    const snapshot = await ensureSnapshot(stripe, { orgId: ORG, orgName: "Cabinet Test", email: "owner@example.lu", userId: "u1", locale: "de", plan: "professional", rhythm: "year" });
    const create = calls.find((c) => c.method === "POST")!;
    expect(create.form.get(`metadata[${META.org}]`)).toBe(ORG);
    expect(create.form.get(`metadata[${META.plan}]`)).toBe("professional");
    expect(create.form.get(`metadata[${META.rhythm}]`)).toBe("year");
    expect(create.form.get("preferred_locales[0]")).toBe("de");
    expect(create.idempotency).toBe(`morada-gestion-customer-${ORG}-u1`);
    expect(snapshot.customer).toMatchObject({ id: "cus_new", trialEnd: NOW + 30 * DAY, plan: "professional", rhythm: "year", extended: false });
    expect(snapshot.subscription).toBeNull();
  });

  it("dates the trial from Stripe's creation date, an extension only from the server", () => {
    expect(customerFacts(customer() as unknown as Stripe.Customer).trialEnd).toBe(NOW - 3 * DAY + 30 * DAY);
    const extended = customer({ metadata: { ...customer().metadata, [META.trialEnd]: String(NOW + 40 * DAY) } });
    expect(customerFacts(extended as unknown as Stripe.Customer)).toMatchObject({ trialEnd: NOW + 40 * DAY, extended: true });
  });
});

describe("reading the subscription", () => {
  it("reads the plan, the quantities, the period, the charge and the card", () => {
    const view = subscriptionView(subscription() as unknown as Stripe.Subscription);
    expect(view).toMatchObject({ id: "sub_1", status: "trialing", plan: "landlord", rhythm: "quarter", lots: 12, seats: 0, lotItemId: "si_lot", seatItemId: null, charged: 18000, card: { brand: "visa", last4: "4242" }, trialEnd: NOW + 27 * DAY });
  });

  it("prefers a running subscription, the newest, over one that ended", () => {
    const ended = subscription({ id: "sub_old", status: "canceled", created: NOW });
    const running = subscription({ id: "sub_run", status: "active", created: NOW - 50 * DAY });
    expect(pickSubscription([ended, running] as unknown as Stripe.Subscription[])?.id).toBe("sub_run");
    expect(pickSubscription([ended] as unknown as Stripe.Subscription[])?.id).toBe("sub_old");
  });

  it("asks Stripe for every subscription of the customer, the card expanded", async () => {
    const { stripe, calls } = standIn((c) => (c.path === "/v1/subscriptions" ? { body: list([subscription()]) } : undefined));
    const snapshot = await snapshotOf(stripe, customer() as unknown as Stripe.Customer);
    expect(calls[0].query.get("customer")).toBe("cus_A");
    expect(calls[0].query.get("status")).toBe("all");
    expect(calls[0].query.get("expand[0]")).toBe("data.default_payment_method");
    expect(snapshot.subscription?.lots).toBe(12);
  });
});

const snapshot = (over: Partial<BillingSnapshot> = {}): BillingSnapshot => ({
  customer: { id: "cus_A", created: NOW - 3 * DAY, email: "owner@example.lu", trialEnd: NOW + 27 * DAY, extended: false, plan: "landlord", rhythm: "quarter", locale: "fr", reminders: [] },
  subscription: null,
  ...over,
});

describe("prices from the catalogue", () => {
  it("creates the price once, per period, under a lookup key that carries the monthly amount", async () => {
    const { stripe, calls } = standIn((c) => {
      if (c.path === "/v1/prices" && c.method === "GET") return { body: list([]) };
      if (c.path === "/v1/products/morada_gestion_professional_seat" && c.method === "GET") return { status: 404, body: { error: { type: "invalid_request_error", code: "resource_missing", message: "No such product" } } };
      if (c.path === "/v1/products" && c.method === "POST") return { body: { id: "morada_gestion_professional_seat", object: "product" } };
      if (c.path === "/v1/prices" && c.method === "POST") return { body: price({ id: "price_seat_y" }) };
      return undefined;
    });
    expect(await ensurePrice(stripe, "professional", "seat", "year")).toBe("price_seat_y");
    const created = calls.find((c) => c.path === "/v1/prices" && c.method === "POST")!;
    expect(created.form.get("unit_amount")).toBe(String(2320 * 12));
    expect(created.form.get("recurring[interval]")).toBe("year");
    expect(created.form.get("currency")).toBe("eur");
    expect(created.form.get("tax_behavior")).toBe("inclusive");
    expect(created.form.get("lookup_key")).toBe(lookupKey("professional", "seat", "year", 2320));
    expect(calls.find((c) => c.path === "/v1/products" && c.method === "POST")!.form.get("id")).toBe("morada_gestion_professional_seat");
    // Held for the instance: no second round-trip.
    const before = calls.length;
    expect(await ensurePrice(stripe, "professional", "seat", "year")).toBe("price_seat_y");
    expect(calls.length).toBe(before);
  });

  it("reuses a price that already exists under its lookup key", async () => {
    const { stripe, calls } = standIn((c) => (c.path === "/v1/prices" && c.method === "GET" ? { body: list([price({ id: "price_known" })]) } : undefined));
    expect(await ensurePrice(stripe, "landlord", "lot", "quarter")).toBe("price_known");
    expect(calls[0].query.get("lookup_keys[0]")).toBe("morada_gestion_landlord_lot_quarter_500");
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });
});

describe("Checkout", () => {
  const route = (c: Call): Reply | undefined => {
    if (c.path === "/v1/prices" && c.method === "GET") return { body: list([price({ id: `price_${c.query.get("lookup_keys[0]")}` })]) };
    if (c.path === "/v1/checkout/sessions" && c.method === "POST") return { body: { id: "cs_test_abc12345", object: "checkout.session", url: "https://checkout.stripe.com/c/pay/cs_test_abc12345" } };
    return undefined;
  };
  const input = { orgId: ORG, plan: "landlord" as const, rhythm: "quarter" as const, lots: 12, seats: 1, locale: "fr", origin: "https://app.morada.lu", now: NOW, tax: false, submitMessage: "Aucun prélèvement avant le 2 novembre." };

  it("creates the subscription with the rest of the trial, the lots counted and the workspace named", async () => {
    const { stripe, calls } = standIn(route);
    const result = await createCheckout(stripe, { ...input, snapshot: snapshot() });
    expect(result).toEqual({ url: "https://checkout.stripe.com/c/pay/cs_test_abc12345" });
    const f = calls.find((c) => c.path === "/v1/checkout/sessions")!.form;
    expect(f.get("mode")).toBe("subscription");
    expect(f.get("customer")).toBe("cus_A");
    expect(f.get("client_reference_id")).toBe(ORG);
    expect(f.get("line_items[0][quantity]")).toBe("12");
    expect(f.get("line_items[1][price]")).toBeNull();
    expect(f.get("subscription_data[trial_end]")).toBe(String(NOW + 27 * DAY));
    expect(f.get(`subscription_data[metadata][${META.org}]`)).toBe(ORG);
    expect(f.get("payment_method_collection")).toBe("always");
    expect(f.get("allow_promotion_codes")).toBe("true");
    expect(f.get("locale")).toBe("fr");
    expect(f.get("custom_text[submit][message]")).toBe(input.submitMessage);
    expect(f.get("success_url")).toBe("https://app.morada.lu/api/abonnement/retour?session_id={CHECKOUT_SESSION_ID}");
  });

  it("counts lots and users on the professional plan", async () => {
    const { stripe, calls } = standIn(route);
    await createCheckout(stripe, { ...input, plan: "professional", lots: 80, seats: 3, snapshot: snapshot() });
    const f = calls.find((c) => c.path === "/v1/checkout/sessions")!.form;
    expect(f.get("line_items[0][price]")).toBe("price_morada_gestion_professional_lot_quarter_400");
    expect(f.get("line_items[0][quantity]")).toBe("80");
    expect(f.get("line_items[1][price]")).toBe("price_morada_gestion_professional_seat_quarter_2900");
    expect(f.get("line_items[1][quantity]")).toBe("3");
  });

  it("charges at once after the trial, and gives the shortest trial Stripe allows in its last two days", async () => {
    const late = standIn(route);
    await createCheckout(late.stripe, { ...input, snapshot: snapshot({ customer: { ...snapshot().customer, trialEnd: NOW - DAY } }) });
    const lateForm = late.calls.find((c) => c.path === "/v1/checkout/sessions")!.form;
    expect(lateForm.get("subscription_data[trial_end]")).toBeNull();
    expect(lateForm.get("subscription_data[trial_period_days]")).toBeNull();
    const close = standIn(route);
    await createCheckout(close.stripe, { ...input, snapshot: snapshot({ customer: { ...snapshot().customer, trialEnd: NOW + 20 * 3600 } }) });
    expect(close.calls.find((c) => c.path === "/v1/checkout/sessions")!.form.get("subscription_data[trial_period_days]")).toBe("2");
  });

  it("refuses a second subscription and a plan the portfolio has outgrown", async () => {
    const { stripe, calls } = standIn(route);
    const running = snapshot({ subscription: subscriptionView(subscription() as unknown as Stripe.Subscription) });
    expect(await createCheckout(stripe, { ...input, snapshot: running })).toEqual({ error: "already_subscribed" });
    expect(await createCheckout(stripe, { ...input, lots: 51, snapshot: snapshot() })).toEqual({ error: "plan_too_small" });
    expect(calls).toHaveLength(0);
  });

  it("refreshes only for a session the workspace itself started", async () => {
    const { stripe } = standIn((c) => c.path === "/v1/checkout/sessions/cs_test_mine1234"
      ? { body: { id: "cs_test_mine1234", client_reference_id: ORG, metadata: { [META.org]: ORG } } }
      : c.path === "/v1/checkout/sessions/cs_test_other123" ? { body: { id: "cs_test_other123", client_reference_id: OTHER, metadata: { [META.org]: OTHER } } } : undefined);
    expect(await checkoutBelongs(stripe, ORG, "cs_test_mine1234")).toBe(true);
    expect(await checkoutBelongs(stripe, ORG, "cs_test_other123")).toBe(false);
    expect(await checkoutBelongs(stripe, ORG, "../../v1/customers")).toBe(false);
  });
});

describe("plan, quantities, portal and extension", () => {
  it("notes the plan before a card, and swaps the prices of a running subscription without charging during its trial", async () => {
    const plain = standIn((c) => (c.path === "/v1/customers/cus_A" ? { body: customer() } : undefined));
    expect(await choosePlan(plain.stripe, snapshot(), "landlord", "year", 4, 1)).toEqual({ ok: true });
    expect(plain.calls[0].form.get(`metadata[${META.rhythm}]`)).toBe("year");
    expect(plain.calls).toHaveLength(1);

    const running = standIn((c) => {
      if (c.path === "/v1/customers/cus_A") return { body: customer() };
      if (c.path === "/v1/prices" && c.method === "GET") return { body: list([price({ id: `price_${c.query.get("lookup_keys[0]")}` })]) };
      if (c.path === "/v1/subscriptions/sub_1") return { body: subscription() };
      return undefined;
    });
    const sub = subscriptionView(subscription() as unknown as Stripe.Subscription);
    await choosePlan(running.stripe, snapshot({ subscription: sub }), "professional", "quarter", 60, 2);
    const update = running.calls.find((c) => c.path === "/v1/subscriptions/sub_1")!.form;
    expect(update.get("items[0][id]")).toBe("si_lot");
    expect(update.get("items[0][price]")).toBe("price_morada_gestion_professional_lot_quarter_400");
    expect(update.get("items[0][quantity]")).toBe("60");
    expect(update.get("items[1][price]")).toBe("price_morada_gestion_professional_seat_quarter_2900");
    expect(update.get("proration_behavior")).toBe("none");
  });

  it("brings the lot count to the portfolio's: free in the trial, prorated when it grows afterwards, from the next period when it shrinks", async () => {
    const trial = standIn((c) => (c.path === "/v1/subscriptions/sub_1" ? { body: subscription() } : undefined));
    const trialing = subscriptionView(subscription() as unknown as Stripe.Subscription);
    expect(await syncQuantities(trial.stripe, snapshot({ subscription: trialing }), 15, 1)).toBe(true);
    expect(trial.calls[0].form.get("items[0][quantity]")).toBe("15");
    expect(trial.calls[0].form.get("proration_behavior")).toBe("none");

    const active = subscriptionView(subscription({ status: "active", trial_end: null }) as unknown as Stripe.Subscription);
    const grows = standIn((c) => (c.path === "/v1/subscriptions/sub_1" ? { body: subscription() } : undefined));
    await syncQuantities(grows.stripe, snapshot({ subscription: active }), 20, 1);
    expect(grows.calls[0].form.get("proration_behavior")).toBe("create_prorations");
    const shrinks = standIn((c) => (c.path === "/v1/subscriptions/sub_1" ? { body: subscription() } : undefined));
    await syncQuantities(shrinks.stripe, snapshot({ subscription: active }), 5, 1);
    expect(shrinks.calls[0].form.get("proration_behavior")).toBe("none");
    const same = standIn(() => undefined);
    expect(await syncQuantities(same.stripe, snapshot({ subscription: active }), 12, 1)).toBe(false);
    expect(same.calls).toHaveLength(0);
  });

  it("opens the portal on the app's own settings, created once", async () => {
    const { stripe, calls } = standIn((c) => {
      if (c.path === "/v1/billing_portal/configurations" && c.method === "GET") return { body: list([]) };
      if (c.path === "/v1/billing_portal/configurations" && c.method === "POST") return { body: { id: "bpc_1", object: "billing_portal.configuration" } };
      if (c.path === "/v1/billing_portal/sessions") return { body: { id: "bps_1", url: "https://billing.stripe.com/p/session/x" } };
      return undefined;
    });
    expect(await portalUrl(stripe, "cus_A", "https://app.morada.lu/app/abonnement", "lu", "payment_method_update")).toBe("https://billing.stripe.com/p/session/x");
    const config = calls.find((c) => c.path === "/v1/billing_portal/configurations" && c.method === "POST")!.form;
    expect(config.get("features[subscription_cancel][mode]")).toBe("at_period_end");
    expect(config.get("features[payment_method_update][enabled]")).toBe("true");
    const session = calls.find((c) => c.path === "/v1/billing_portal/sessions")!.form;
    expect(session.get("configuration")).toBe("bpc_1");
    expect(session.get("flow_data[type]")).toBe("payment_method_update");
    expect(session.get("locale")).toBe("auto");
  });

  it("extends a finished trial once, by seven days, server-side", async () => {
    const { stripe, calls } = standIn((c) => (c.path === "/v1/customers/cus_A" ? { body: customer() } : undefined));
    const over = snapshot({ customer: { ...snapshot().customer, trialEnd: NOW - DAY } });
    expect(await extendTrial(stripe, over, NOW)).toEqual({ trialEnd: NOW + 7 * DAY });
    expect(calls[0].form.get(`metadata[${META.trialEnd}]`)).toBe(String(NOW + 7 * DAY));
    expect(await extendTrial(stripe, { ...over, customer: { ...over.customer, extended: true } }, NOW)).toEqual({ error: "not_offered" });
    expect(await extendTrial(stripe, snapshot(), NOW)).toEqual({ error: "not_offered" });
  });
});

describe("configuration and the write lock", () => {
  it("takes only a secret key, and names a key that is not one", () => {
    expect(billingProvider({})).toMatchObject({ configured: false, problem: null });
    expect(billingProvider({ STRIPE_SECRET_KEY: "mk_1ULvHAC8d7bmeLN8xoLqepTm" })).toMatchObject({ configured: false, problem: "not_secret" });
    expect(billingProvider({ STRIPE_SECRET_KEY: "pk_live_51abcdefghijklmnop" })).toMatchObject({ configured: false, problem: "not_secret" });
    expect(billingProvider({ STRIPE_SECRET_KEY: "sk_test_51abcdefghijklmnop" })).toMatchObject({ configured: true, mode: "test" });
    expect(billingProvider({ STRIPE_SECRET_KEY: " rk_live_51abcdefghijklmnop ", STRIPE_TAX: "1" })).toMatchObject({ configured: true, mode: "live", tax: true });
    expect([...exemptOrgs({ BILLING_EXEMPT_ORGS: ` ${ORG.toUpperCase()}, ,${OTHER}` })]).toEqual([ORG, OTHER]);
  });

  it("locks writes only after an unpaid trial, and opens on every doubt", async () => {
    const env = { STRIPE_SECRET_KEY: "sk_test_51abcdefghijklmnop" };
    const over = snapshot({ customer: { ...snapshot().customer, trialEnd: NOW - DAY } });
    expect(await lockedFor(ORG, async () => over, env, NOW)).toBe(true);
    expect(await lockedFor(ORG, async () => snapshot(), env, NOW)).toBe(false);
    const paying = snapshot({ customer: over.customer, subscription: subscriptionView(subscription({ status: "active" }) as unknown as Stripe.Subscription) });
    expect(await lockedFor(ORG, async () => paying, env, NOW)).toBe(false);
    expect(await lockedFor(ORG, async () => null, env, NOW)).toBe(false);
    expect(await lockedFor(ORG, async () => { throw new Error("stripe down"); }, env, NOW)).toBe(false);
    expect(await lockedFor(ORG, async () => over, {}, NOW)).toBe(false);
    expect(await lockedFor(ORG, async () => over, { ...env, BILLING_EXEMPT_ORGS: ORG }, NOW)).toBe(false);
  });

  it("reads the plan picked at sign-up defensively", () => {
    expect(signupChoice({ morada_signup: { plan: { id: "professional", rhythm: "year" } } })).toEqual({ plan: "professional", rhythm: "year" });
    expect(signupChoice({ morada_signup: { plan: { id: "free", rhythm: "weekly" } } })).toEqual({ plan: null, rhythm: null });
    expect(signupChoice(undefined)).toEqual({ plan: null, rhythm: null });
  });
});
