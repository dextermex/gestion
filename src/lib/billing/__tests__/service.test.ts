import { describe, expect, it } from "vitest";
import Stripe from "stripe";
import { DAY } from "@/domain/billing/trial";
import {
  META, PRODUCT, checkoutBelongs, chooseRhythm, createCheckout, customerFacts, ensureSnapshot, extendTrial, findCustomer,
  pickSubscription, portalUrl, snapshotOf, stepLoyalty, subscriptionView, syncPrice, type BillingSnapshot,
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
const search = (data: unknown[], url = "/v1/customers/search") => ({ object: "search_result", data, has_more: false, next_page: null, url });
const missing = { status: 404, body: { error: { type: "invalid_request_error", code: "resource_missing", message: "No such product" } } };

/** Three lots let at 1 200 € (the second band, 14 € a lot): 42 € a month, 126 € a quarter. */
const RENTS = [120_000, 120_000, 120_000];

function customer(over: Record<string, unknown> = {}) {
  return { id: "cus_A", object: "customer", created: NOW - 3 * DAY, email: "owner@example.lu", metadata: { [META.app]: "gestion", [META.org]: ORG, [META.rhythm]: "quarter", [META.locale]: "fr" }, ...over };
}

function price(over: Record<string, unknown> = {}) {
  return { id: "price_inline", object: "price", unit_amount: 12_600, recurring: { interval: "month", interval_count: 3 }, metadata: {}, ...over };
}

function subscription(over: Record<string, unknown> = {}, meta: Record<string, string> = {}, item: Record<string, unknown> = {}) {
  return {
    id: "sub_1", object: "subscription", status: "trialing", created: NOW - DAY, start_date: NOW - DAY, trial_end: NOW + 27 * DAY, cancel_at_period_end: false, cancel_at: null,
    metadata: { [META.app]: "gestion", [META.org]: ORG, [META.rhythm]: "quarter", [META.pricing]: "portfolio", [META.lots]: "3", [META.base]: "12600", ...meta },
    default_payment_method: { id: "pm_1", object: "payment_method", card: { brand: "visa", last4: "4242" } },
    items: { object: "list", data: [{ id: "si_1", object: "subscription_item", quantity: 1, current_period_end: NOW + 27 * DAY, price: price(), ...item }], has_more: false },
    ...over,
  };
}

const view = (...args: Parameters<typeof subscription>) => subscriptionView(subscription(...args) as unknown as Stripe.Subscription);

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

  it("starts the trial on the first visit: a customer carrying the workspace id and the rhythm picked at sign-up", async () => {
    const { stripe, calls } = standIn((c) => {
      if (c.path === "/v1/customers/search") return { body: search([]) };
      if (c.path === "/v1/customers" && c.method === "GET") return { body: list([]) };
      if (c.path === "/v1/customers" && c.method === "POST") return { body: customer({ id: "cus_new", created: NOW, metadata: Object.fromEntries([...c.form].filter(([k]) => k.startsWith("metadata[")).map(([k, v]) => [k.slice(9, -1), v])) }) };
      return undefined;
    });
    const snapshot = await ensureSnapshot(stripe, { orgId: ORG, orgName: "Cabinet Test", email: "owner@example.lu", userId: "u1", locale: "de", rhythm: "year" });
    const create = calls.find((c) => c.method === "POST")!;
    expect(create.form.get(`metadata[${META.org}]`)).toBe(ORG);
    expect(create.form.get(`metadata[${META.rhythm}]`)).toBe("year");
    expect(create.form.get("preferred_locales[0]")).toBe("de");
    expect(create.idempotency).toBe(`morada-gestion-customer-${ORG}-u1`);
    expect(snapshot.customer).toMatchObject({ id: "cus_new", trialEnd: NOW + 30 * DAY, rhythm: "year", extended: false });
    expect(snapshot.subscription).toBeNull();
  });

  it("dates the trial from Stripe's creation date, an extension only from the server", () => {
    expect(customerFacts(customer() as unknown as Stripe.Customer).trialEnd).toBe(NOW - 3 * DAY + 30 * DAY);
    const extended = customer({ metadata: { ...customer().metadata, [META.trialEnd]: String(NOW + 40 * DAY) } });
    expect(customerFacts(extended as unknown as Stripe.Customer)).toMatchObject({ trialEnd: NOW + 40 * DAY, extended: true });
  });
});

describe("reading the subscription", () => {
  it("reads the rhythm from the price, the pricing it records, the period, the charge and the card", () => {
    expect(view()).toMatchObject({
      id: "sub_1", status: "trialing", rhythm: "quarter", managed: true, itemId: "si_1", charged: 12_600, lots: 3, base: 12_600,
      paidFrom: NOW + 27 * DAY, periodEnd: NOW + 27 * DAY, card: { brand: "visa", last4: "4242" }, trialEnd: NOW + 27 * DAY,
    });
    expect(view({}, {}, { price: price({ unit_amount: 100_000, recurring: { interval: "year", interval_count: 1 } }) })).toMatchObject({ rhythm: "year", charged: 100_000 });
    expect(view({ trial_end: null })).toMatchObject({ paidFrom: NOW - DAY });
  });

  it("leaves terms set up with the team to the team: no mark, or more than one price", () => {
    const team = subscription();
    delete (team.metadata as Record<string, string>)[META.pricing];
    expect(subscriptionView(team as unknown as Stripe.Subscription).managed).toBe(false);
    const two = subscription();
    two.items.data.push({ ...two.items.data[0], id: "si_2" });
    expect(subscriptionView(two as unknown as Stripe.Subscription).managed).toBe(false);
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
    expect(snapshot.subscription?.lots).toBe(3);
  });
});

const snapshot = (over: Partial<BillingSnapshot> = {}): BillingSnapshot => ({
  customer: { id: "cus_A", created: NOW - 3 * DAY, email: "owner@example.lu", trialEnd: NOW + 27 * DAY, extended: false, rhythm: "quarter", locale: "fr", reminders: [] },
  subscription: null,
  ...over,
});

/** Stripe's answers for the product (absent the first time) and the calls that create or change a subscription. */
const priced = (c: Call): Reply | undefined => {
  if (c.path === `/v1/products/${PRODUCT.id}` && c.method === "GET") return missing;
  if (c.path === "/v1/products" && c.method === "POST") return { body: { id: PRODUCT.id, object: "product" } };
  if (c.path === "/v1/checkout/sessions" && c.method === "POST") return { body: { id: "cs_test_abc12345", object: "checkout.session", url: "https://checkout.stripe.com/c/pay/cs_test_abc12345" } };
  if (c.path === "/v1/customers/cus_A") return { body: customer() };
  if (c.path === "/v1/subscriptions/sub_1") return { body: subscription() };
  return undefined;
};
const subscriptionUpdate = (calls: Call[]) => calls.find((c) => c.path === "/v1/subscriptions/sub_1")?.form ?? null;

describe("Checkout", () => {
  const input = { orgId: ORG, rhythm: "quarter" as const, rents: RENTS, locale: "fr", origin: "https://app.morada.lu", now: NOW, tax: false, submitMessage: "Aucun prélèvement avant le 2 novembre." };

  it("creates the subscription at the portfolio's own price, with the rest of the trial, the workspace named", async () => {
    const { stripe, calls } = standIn(priced);
    const result = await createCheckout(stripe, { ...input, snapshot: snapshot() });
    expect(result).toEqual({ url: "https://checkout.stripe.com/c/pay/cs_test_abc12345" });
    expect(calls.find((c) => c.path === "/v1/products" && c.method === "POST")!.form.get("id")).toBe(PRODUCT.id);
    const f = calls.find((c) => c.path === "/v1/checkout/sessions")!.form;
    expect(f.get("mode")).toBe("subscription");
    expect(f.get("customer")).toBe("cus_A");
    expect(f.get("client_reference_id")).toBe(ORG);
    expect(f.get("line_items[0][price_data][unit_amount]")).toBe("12600");
    expect(f.get("line_items[0][price_data][currency]")).toBe("eur");
    expect(f.get("line_items[0][price_data][product]")).toBe(PRODUCT.id);
    expect(f.get("line_items[0][price_data][recurring][interval]")).toBe("month");
    expect(f.get("line_items[0][price_data][recurring][interval_count]")).toBe("3");
    expect(f.get("line_items[0][price_data][tax_behavior]")).toBe("inclusive");
    expect(f.get("line_items[0][quantity]")).toBe("1");
    expect(f.get("line_items[1][price_data][unit_amount]")).toBeNull();
    expect(f.get("subscription_data[trial_end]")).toBe(String(NOW + 27 * DAY));
    expect(f.get(`subscription_data[metadata][${META.org}]`)).toBe(ORG);
    expect(f.get(`subscription_data[metadata][${META.pricing}]`)).toBe("portfolio");
    expect(f.get(`subscription_data[metadata][${META.lots}]`)).toBe("3");
    expect(f.get(`subscription_data[metadata][${META.base}]`)).toBe("12600");
    expect(f.get("payment_method_collection")).toBe("always");
    expect(f.get("allow_promotion_codes")).toBe("true");
    expect(f.get("locale")).toBe("fr");
    expect(f.get("custom_text[submit][message]")).toBe(input.submitMessage);
    expect(f.get("success_url")).toBe("https://app.morada.lu/api/abonnement/retour?session_id={CHECKOUT_SESSION_ID}");
  });

  it("charges a year as ten months, once a year", async () => {
    const { stripe, calls } = standIn(priced);
    await createCheckout(stripe, { ...input, rhythm: "year", snapshot: snapshot() });
    const f = calls.find((c) => c.path === "/v1/checkout/sessions")!.form;
    expect(f.get("line_items[0][price_data][unit_amount]")).toBe(String(4200 * 10));
    expect(f.get("line_items[0][price_data][recurring][interval]")).toBe("year");
    expect(f.get("line_items[0][price_data][recurring][interval_count]")).toBeNull();
  });

  it("charges at once after the trial, and gives the shortest trial Stripe allows in its last two days", async () => {
    const late = standIn(priced);
    await createCheckout(late.stripe, { ...input, snapshot: snapshot({ customer: { ...snapshot().customer, trialEnd: NOW - DAY } }) });
    const lateForm = late.calls.find((c) => c.path === "/v1/checkout/sessions")!.form;
    expect(lateForm.get("subscription_data[trial_end]")).toBeNull();
    expect(lateForm.get("subscription_data[trial_period_days]")).toBeNull();
    const close = standIn(priced);
    await createCheckout(close.stripe, { ...input, snapshot: snapshot({ customer: { ...snapshot().customer, trialEnd: NOW + 20 * 3600 } }) });
    expect(close.calls.find((c) => c.path === "/v1/checkout/sessions")!.form.get("subscription_data[trial_period_days]")).toBe("2");
  });

  it("refuses a second subscription, and more lots than the published terms take", async () => {
    const { stripe, calls } = standIn(priced);
    expect(await createCheckout(stripe, { ...input, snapshot: snapshot({ subscription: view() }) })).toEqual({ error: "already_subscribed" });
    expect(await createCheckout(stripe, { ...input, rents: Array.from({ length: 51 }, () => 90_000), snapshot: snapshot() })).toEqual({ error: "too_many_lots" });
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

describe("rhythm and price of a running subscription", () => {
  it("notes the rhythm before a card, and reprices a subscription in its trial without charging", async () => {
    const plain = standIn(priced);
    expect(await chooseRhythm(plain.stripe, snapshot(), "year", RENTS, NOW)).toEqual({ ok: true });
    expect(plain.calls[0].form.get(`metadata[${META.rhythm}]`)).toBe("year");
    expect(plain.calls).toHaveLength(1);

    const running = standIn(priced);
    await chooseRhythm(running.stripe, snapshot({ subscription: view() }), "year", RENTS, NOW);
    const update = subscriptionUpdate(running.calls)!;
    expect(update.get("items[0][id]")).toBe("si_1");
    expect(update.get("items[0][price_data][unit_amount]")).toBe("42000");
    expect(update.get("items[0][price_data][recurring][interval]")).toBe("year");
    expect(update.get("items[0][quantity]")).toBe("1");
    expect(update.get(`metadata[${META.rhythm}]`)).toBe("year");
    expect(update.get(`metadata[${META.base}]`)).toBe("42000");
    expect(update.get("proration_behavior")).toBe("none");
  });

  it("changes nothing on terms set up with the team", async () => {
    const { stripe, calls } = standIn(priced);
    expect(await chooseRhythm(stripe, snapshot({ subscription: view({}, { [META.pricing]: "" }) }), "year", RENTS, NOW)).toEqual({ error: "custom_terms" });
    expect(await syncPrice(stripe, snapshot({ subscription: view({ status: "active" }, { [META.pricing]: "" }) }), [...RENTS, 250_000], NOW)).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("follows the portfolio: free in the trial, prorated when dearer afterwards, from the next period when cheaper", async () => {
    const trial = standIn(priced);
    expect(await syncPrice(trial.stripe, snapshot({ subscription: view() }), [...RENTS, 250_000], NOW)).toBe(true);
    const t = subscriptionUpdate(trial.calls)!;
    expect(t.get("items[0][price_data][unit_amount]")).toBe(String((4200 + 2500) * 3));
    expect(t.get(`metadata[${META.lots}]`)).toBe("4");
    expect(t.get("proration_behavior")).toBe("none");

    const active = { status: "active", trial_end: null };
    const item = { current_period_end: NOW + 40 * DAY };
    const grows = standIn(priced);
    await syncPrice(grows.stripe, snapshot({ subscription: view(active, {}, item) }), [...RENTS, 250_000], NOW);
    expect(subscriptionUpdate(grows.calls)!.get("proration_behavior")).toBe("create_prorations");
    const shrinks = standIn(priced);
    await syncPrice(shrinks.stripe, snapshot({ subscription: view(active, {}, item) }), RENTS.slice(1), NOW);
    expect(subscriptionUpdate(shrinks.calls)!.get("items[0][price_data][unit_amount]")).toBe(String(2800 * 3));
    expect(subscriptionUpdate(shrinks.calls)!.get("proration_behavior")).toBe("none");
    const same = standIn(priced);
    expect(await syncPrice(same.stripe, snapshot({ subscription: view(active, {}, item) }), RENTS, NOW)).toBe(false);
    expect(same.calls).toHaveLength(0);
    const leaving = standIn(priced);
    expect(await syncPrice(leaving.stripe, snapshot({ subscription: view({ ...active, cancel_at_period_end: true }, {}, item) }), [...RENTS, 250_000], NOW)).toBe(false);
    expect(leaving.calls).toHaveLength(0);
  });

  it("lowers the price for the second year from the renewal that opens it, never the period already paid", async () => {
    const paidFrom = Date.UTC(2025, 10, 2) / 1000;
    const renewal = Date.UTC(2026, 10, 2) / 1000;
    const { stripe, calls } = standIn(priced);
    const sub = view({ status: "active", trial_end: null, start_date: paidFrom }, {}, { current_period_end: renewal });
    expect(await syncPrice(stripe, snapshot({ subscription: sub }), RENTS, renewal - 20 * DAY)).toBe(true);
    const f = subscriptionUpdate(calls)!;
    expect(f.get("items[0][price_data][unit_amount]")).toBe("11970");
    expect(f.get(`metadata[${META.base}]`)).toBe("12600");
    expect(f.get("proration_behavior")).toBe("none");
  });

  it("steps the loyalty years every day from Stripe alone, leaving trials, team terms and settled prices", async () => {
    const paidFrom = Date.UTC(2025, 10, 2) / 1000;
    const renewal = Date.UTC(2027, 10, 2) / 1000;
    const due = subscription({ id: "sub_1", status: "active", trial_end: null, start_date: paidFrom }, {}, { current_period_end: renewal });
    const settled = subscription({ id: "sub_2", status: "active", trial_end: null, start_date: NOW - 40 * DAY }, {}, { current_period_end: NOW + 50 * DAY });
    const trialing = subscription({ id: "sub_3" });
    const team = subscription({ id: "sub_4", status: "active", trial_end: null, start_date: paidFrom }, { [META.pricing]: "" }, { current_period_end: renewal });
    const { stripe, calls } = standIn((c) => c.path === "/v1/subscriptions/search"
      ? { body: search([due, settled, trialing, team], "/v1/subscriptions/search") }
      : priced(c));
    expect(await stepLoyalty(stripe, renewal - 30 * DAY)).toEqual({ checked: 2, stepped: 1, failed: 0 });
    expect(calls[0].query.get("query")).toBe(`metadata['morada_app']:'gestion' AND metadata['morada_pricing']:'portfolio'`);
    const updates = calls.filter((c) => c.path.startsWith("/v1/subscriptions/sub_"));
    expect(updates.map((c) => c.path)).toEqual(["/v1/subscriptions/sub_1"]);
    expect(updates[0].form.get("items[0][price_data][unit_amount]")).toBe("11340");
    expect(updates[0].form.get("proration_behavior")).toBe("none");
  });
});

describe("portal and extension", () => {
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
    const paying = snapshot({ customer: over.customer, subscription: view({ status: "active" }) });
    expect(await lockedFor(ORG, async () => paying, env, NOW)).toBe(false);
    expect(await lockedFor(ORG, async () => null, env, NOW)).toBe(false);
    expect(await lockedFor(ORG, async () => { throw new Error("stripe down"); }, env, NOW)).toBe(false);
    expect(await lockedFor(ORG, async () => over, {}, NOW)).toBe(false);
    expect(await lockedFor(ORG, async () => over, { ...env, BILLING_EXEMPT_ORGS: ORG }, NOW)).toBe(false);
  });

  it("reads the rhythm picked at sign-up defensively, an older choice's plan name ignored", () => {
    expect(signupChoice({ morada_signup: { plan: { rhythm: "year" } } })).toEqual({ rhythm: "year" });
    expect(signupChoice({ morada_signup: { plan: { id: "landlord", rhythm: "quarter" } } })).toEqual({ rhythm: "quarter" });
    expect(signupChoice({ morada_signup: { plan: { rhythm: "weekly" } } })).toEqual({ rhythm: null });
    expect(signupChoice(undefined)).toEqual({ rhythm: null });
  });
});
