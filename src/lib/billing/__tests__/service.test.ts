import { describe, expect, it, vi } from "vitest";
import Stripe from "stripe";
import { DAY } from "@/domain/billing/trial";
import { quote } from "@/domain/billing/pricing";
import type { BillingRow } from "@/domain/billing/trial";
import { offerQuote } from "@/lib/signup/offer";
import {
  META, PRODUCT, WINBACK_COUPON, checkoutBelongs, checkoutReturn, chooseRhythm, createCheckout, customerFacts, ensureSnapshot, findCustomer,
  nextQuote, pickSubscription, portalUrl, snapshotOf, stepLoyalty, subscriptionView, syncPrice, type BillingSnapshot, type CheckoutInput,
} from "@/lib/billing/service";
import { decideAccess, recordedRows, type AccessDeps } from "@/lib/billing/access";
import { lockedFor } from "@/lib/billing/gate";
import { billingProvider, exemptOrgs } from "@/lib/billing/provider";
import { returnMetadata, returnPath } from "@/lib/billing/retour";
import { confirmationShown } from "@/lib/billing/view";

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

  it("creates the customer when Checkout first needs it: the workspace id, the rhythm, one per workspace", async () => {
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
    // The key names the workspace alone: two members arriving together make one customer.
    expect(create.idempotency).toBe(`morada-gestion-customer-${ORG}`);
    expect(snapshot.customer).toMatchObject({ id: "cus_new", rhythm: "year" });
    expect(snapshot.subscription).toBeNull();
    // A new customer has had no subscription: its first Checkout offers the free days.
    expect(snapshot.everSubscribed).toBe(false);
  });

  it("finds an existing customer instead of creating a second, and reads its language and rhythm", async () => {
    const { stripe, calls } = standIn((c) => c.path === "/v1/customers/search" ? { body: search([customer()]) } : c.path === "/v1/subscriptions" ? { body: list([]) } : undefined);
    await ensureSnapshot(stripe, { orgId: ORG, orgName: "Cabinet Test", email: "owner@example.lu", userId: "u1", locale: "fr" });
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    expect(customerFacts(customer({ metadata: { ...customer().metadata, [META.locale]: "lu", [META.rhythm]: "weekly" } }) as unknown as Stripe.Customer)).toMatchObject({ locale: "lu", rhythm: "quarter" });
  });
});

describe("reading the subscription", () => {
  it("reads the rhythm from the price, the pricing it records, the period, the charge and the card", () => {
    expect(view()).toMatchObject({
      id: "sub_1", status: "trialing", rhythm: "quarter", managed: true, itemId: "si_1", charged: 12_600, lots: 3, base: 12_600,
      paidFrom: NOW + 27 * DAY, periodEnd: NOW + 27 * DAY, card: { brand: "visa", last4: "4242" }, trialEnd: NOW + 27 * DAY, reminders: [],
    });
    expect(view({}, { [META.reminders]: "d7" }).reminders).toEqual(["d7"]);
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
    expect(snapshot.everSubscribed).toBe(true);
  });

  it("remembers a subscription that ended: the free days are spent", async () => {
    const { stripe } = standIn((c) => (c.path === "/v1/subscriptions" ? { body: list([subscription({ status: "canceled" })]) } : undefined));
    const snapshot = await snapshotOf(stripe, customer() as unknown as Stripe.Customer);
    expect(snapshot).toMatchObject({ everSubscribed: true, subscription: { status: "canceled" } });
    const none = standIn((c) => (c.path === "/v1/subscriptions" ? { body: list([]) } : undefined));
    expect((await snapshotOf(none.stripe, customer() as unknown as Stripe.Customer)).everSubscribed).toBe(false);
  });
});

const snapshot = (over: Partial<BillingSnapshot> = {}): BillingSnapshot => ({
  customer: { id: "cus_A", created: NOW - 3 * DAY, email: "owner@example.lu", rhythm: "quarter", locale: "fr" },
  subscription: null,
  everSubscribed: false,
  ...over,
});

/** Stripe's answers for the product (absent the first time) and the calls that create or change a subscription. */
const priced = (c: Call): Reply | undefined => {
  if (c.path === `/v1/products/${PRODUCT.id}` && c.method === "GET") return missing;
  if (c.path === "/v1/products" && c.method === "POST") return { body: { id: PRODUCT.id, object: "product" } };
  if (c.path === `/v1/coupons/${WINBACK_COUPON.id}` && c.method === "GET") return missing;
  if (c.path === "/v1/coupons" && c.method === "POST") return { body: { id: WINBACK_COUPON.id, object: "coupon" } };
  if (c.path === "/v1/checkout/sessions" && c.method === "POST") return { body: { id: "cs_test_abc12345", object: "checkout.session", url: "https://checkout.stripe.com/c/pay/cs_test_abc12345" } };
  if (c.path === "/v1/customers/cus_A") return { body: customer() };
  if (c.path === "/v1/subscriptions/sub_1") return { body: subscription() };
  return undefined;
};
const subscriptionUpdate = (calls: Call[]) => calls.find((c) => c.path === "/v1/subscriptions/sub_1")?.form ?? null;

describe("Checkout", () => {
  const input = (over: Partial<CheckoutInput> = {}): CheckoutInput => ({
    snapshot: snapshot(), orgId: ORG, quote: quote(RENTS, "quarter", 1), source: "page", locale: "fr", origin: "https://app.morada.lu", tax: false,
    submitMessage: "Rien n'est prélevé aujourd'hui.", ...over,
  });
  const form = (calls: Call[]) => calls.find((c) => c.path === "/v1/checkout/sessions")!.form;

  it("takes the card and gives the thirty free days to a workspace that never subscribed", async () => {
    const { stripe, calls } = standIn(priced);
    const result = await createCheckout(stripe, input());
    expect(result).toEqual({ url: "https://checkout.stripe.com/c/pay/cs_test_abc12345" });
    expect(calls.find((c) => c.path === "/v1/products" && c.method === "POST")!.form.get("id")).toBe(PRODUCT.id);
    const f = form(calls);
    expect(f.get("mode")).toBe("subscription");
    expect(f.get("customer")).toBe("cus_A");
    expect(f.get("client_reference_id")).toBe(ORG);
    expect(f.get("payment_method_collection")).toBe("always");
    expect(f.get("subscription_data[trial_period_days]")).toBe("30");
    expect(f.get("subscription_data[trial_end]")).toBeNull();
    expect(f.get("line_items[0][price_data][unit_amount]")).toBe("12600");
    expect(f.get("line_items[0][price_data][currency]")).toBe("eur");
    expect(f.get("line_items[0][price_data][product]")).toBe(PRODUCT.id);
    expect(f.get("line_items[0][price_data][recurring][interval]")).toBe("month");
    expect(f.get("line_items[0][price_data][recurring][interval_count]")).toBe("3");
    expect(f.get("line_items[0][price_data][tax_behavior]")).toBe("inclusive");
    expect(f.get("line_items[0][quantity]")).toBe("1");
    expect(f.get("line_items[1][price_data][unit_amount]")).toBeNull();
    expect(f.get(`subscription_data[metadata][${META.org}]`)).toBe(ORG);
    expect(f.get(`subscription_data[metadata][${META.app}]`)).toBe("gestion");
    expect(f.get(`subscription_data[metadata][${META.pricing}]`)).toBe("portfolio");
    expect(f.get(`subscription_data[metadata][${META.lots}]`)).toBe("3");
    expect(f.get(`subscription_data[metadata][${META.base}]`)).toBe("12600");
    expect(f.get("allow_promotion_codes")).toBe("true");
    expect(f.get("tax_id_collection[enabled]")).toBe("true");
    expect(f.get("billing_address_collection")).toBe("auto");
    expect(f.get("automatic_tax[enabled]")).toBe("false");
    expect(f.get("locale")).toBe("fr");
    expect(f.get("custom_text[submit][message]")).toBe("Rien n'est prélevé aujourd'hui.");
    expect(f.get("success_url")).toBe("https://app.morada.lu/api/abonnement/retour?session_id={CHECKOUT_SESSION_ID}");
    expect(f.get("cancel_url")).toBe("https://app.morada.lu/app/abonnement");
  });

  it("charges at once a workspace that had a subscription before: the free days are promised once", async () => {
    const { stripe, calls } = standIn(priced);
    await createCheckout(stripe, input({ snapshot: snapshot({ everSubscribed: true, subscription: view({ status: "canceled" }) }) }));
    const f = form(calls);
    expect(f.get("subscription_data[trial_period_days]")).toBeNull();
    expect(f.get("subscription_data[trial_end]")).toBeNull();
  });

  it("prices the sign-up's offer, names it for the return, and sends a cancelled Checkout back to the offer", async () => {
    const { stripe, calls } = standIn(priced);
    const offer = { units: 3, band: 1, billing: "year" as const };
    await createCheckout(stripe, input({ quote: offerQuote(offer), offer, source: "signup" }));
    const f = form(calls);
    // Three lots in the second band (14 € a lot), a year billed as ten months.
    expect(f.get("line_items[0][price_data][unit_amount]")).toBe(String(4200 * 10));
    expect(f.get("line_items[0][price_data][recurring][interval]")).toBe("year");
    expect(f.get("line_items[0][price_data][recurring][interval_count]")).toBeNull();
    expect(f.get(`metadata[${META.source}]`)).toBe("signup");
    expect(f.get(`subscription_data[metadata][${META.source}]`)).toBe("signup");
    expect(f.get(`metadata[${META.units}]`)).toBe("3");
    expect(f.get(`metadata[${META.band}]`)).toBe("1");
    expect(f.get(`metadata[${META.rhythm}]`)).toBe("year");
    expect(f.get("subscription_data[trial_period_days]")).toBe("30");
    expect(f.get("cancel_url")).toBe("https://app.morada.lu/inscription?etape=offre&retour=annule");
  });

  it("applies the one-time offer through a coupon installed once, a quarter off for twelve months, without promotion codes", async () => {
    const { stripe, calls } = standIn(priced);
    const offer = { units: 3, band: 1, billing: "quarter" as const };
    await createCheckout(stripe, input({ quote: offerQuote(offer), offer, source: "signup", winback: true }));
    const coupon = calls.find((c) => c.path === "/v1/coupons" && c.method === "POST")!.form;
    expect(coupon.get("id")).toBe("morada_winback_25");
    expect(coupon.get("percent_off")).toBe("25");
    expect(coupon.get("duration")).toBe("repeating");
    expect(coupon.get("duration_in_months")).toBe("12");
    const f = form(calls);
    expect(f.get("discounts[0][coupon]")).toBe("morada_winback_25");
    expect(f.get("allow_promotion_codes")).toBeNull();
    expect(f.get(`metadata[${META.winback}]`)).toBe("1");
    // The coupon is asked for once per client.
    await createCheckout(stripe, input({ quote: offerQuote(offer), offer, source: "signup", winback: true }));
    expect(calls.filter((c) => c.path.startsWith("/v1/coupons")).length).toBe(2);
  });

  it("refuses a second subscription, one waiting for its payment too, and more lots than the published terms take", async () => {
    const { stripe, calls } = standIn(priced);
    expect(await createCheckout(stripe, input({ snapshot: snapshot({ subscription: view() }) }))).toEqual({ error: "already_subscribed" });
    expect(await createCheckout(stripe, input({ snapshot: snapshot({ subscription: view({ status: "past_due" }) }) }))).toEqual({ error: "already_subscribed" });
    expect(await createCheckout(stripe, input({ quote: quote(Array.from({ length: 51 }, () => 90_000), "quarter") }))).toEqual({ error: "too_many_lots" });
    expect(calls).toHaveLength(0);
  });

  it("acknowledges only a session the workspace itself started, with the offer it priced and whether it is trialing", async () => {
    const mine = { id: "cs_test_mine1234", client_reference_id: ORG, metadata: { [META.org]: ORG, [META.source]: "signup", [META.units]: "8", [META.band]: "2", [META.rhythm]: "quarter" }, subscription: { id: "sub_1", object: "subscription", status: "trialing" } };
    const { stripe, calls } = standIn((c) => c.path === "/v1/checkout/sessions/cs_test_mine1234"
      ? { body: mine }
      : c.path === "/v1/checkout/sessions/cs_test_page1234" ? { body: { ...mine, id: "cs_test_page1234", metadata: { [META.org]: ORG, [META.rhythm]: "year" }, subscription: { id: "sub_2", status: "active" } } }
      : c.path === "/v1/checkout/sessions/cs_test_other123" ? { body: { id: "cs_test_other123", client_reference_id: OTHER, metadata: { [META.org]: OTHER } } } : undefined);
    expect(await checkoutReturn(stripe, ORG, "cs_test_mine1234")).toEqual({ source: "signup", offer: { units: 8, band: 2, billing: "quarter", addon: false }, trialing: true });
    expect(calls[0].query.get("expand[0]")).toBe("subscription");
    expect(await checkoutReturn(stripe, ORG, "cs_test_page1234")).toEqual({ source: "page", offer: null, trialing: false });
    expect(await checkoutBelongs(stripe, ORG, "cs_test_other123")).toBe(false);
    expect(await checkoutBelongs(stripe, ORG, "../../v1/customers")).toBe(false);
  });
});

describe("the return from Checkout", () => {
  const at = new Date("2026-11-27T10:00:00Z");
  it("records the offer and the trial's start beside what the account already holds", () => {
    const done = { source: "signup" as const, offer: { units: 3, band: 1, billing: "year" as const, addon: false as const }, trialing: true };
    expect(returnMetadata({ quiz: { kind: "flats" }, tour: 1 }, done, at)).toEqual({ quiz: { kind: "flats" }, tour: 1, offer: done.offer, trial_started_at: "2026-11-27T10:00:00.000Z" });
    // Charged at once: no trial is recorded; a malformed previous value is not kept.
    expect(returnMetadata("garbage", { ...done, trialing: false }, at)).toEqual({ offer: done.offer });
  });

  it("sends a sign-up to Bienvenue, a resumed subscription to the space, the rest to the subscription page", () => {
    expect(returnPath({ source: "signup", offer: null, trialing: true })).toBe("/inscription?etape=bienvenue");
    expect(returnPath({ source: "resume", offer: null, trialing: false })).toBe("/app");
    expect(returnPath({ source: "page", offer: null, trialing: false })).toBe("/app/abonnement?confirme=1");
    expect(returnPath(null)).toBe("/app/abonnement");
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

  it("brings a subscription quoted for three lots to the one lot a subscription bills at least, while nothing is let yet", async () => {
    // Quoted at sign-up for 3 lots in the second band (42 € a month), no lease recorded yet.
    const sub = view();
    expect(nextQuote(snapshot({ subscription: sub }), [], NOW)).toMatchObject({ lots: 0, charged: 1000 * 3 });
    const { stripe, calls } = standIn(priced);
    expect(await syncPrice(stripe, snapshot({ subscription: sub }), [], NOW)).toBe(true);
    const f = subscriptionUpdate(calls)!;
    expect(f.get("items[0][price_data][unit_amount]")).toBe("3000");
    expect(f.get(`metadata[${META.lots}]`)).toBe("0");
    // In the trial: nothing is charged by the change.
    expect(f.get("proration_behavior")).toBe("none");
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

describe("the portal", () => {
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

  const env = { STRIPE_SECRET_KEY: "sk_test_51abcdefghijklmnop" };
  const iso = (t: number) => new Date(t * 1000).toISOString();
  const deps = (over: Partial<AccessDeps> = {}): AccessDeps => ({
    env, now: NOW, sample: false,
    rows: async () => [],
    cached: async () => null,
    fresh: async () => { throw new Error("not asked"); },
    ...over,
  });
  const row = (source: string, status: string, end: number | null = NOW + 20 * DAY): BillingRow => ({ source, status, current_period_end: end === null ? null : iso(end) });
  const trialing = snapshot({ everSubscribed: true, subscription: view() });
  const ended = snapshot({ everSubscribed: true, subscription: view({ status: "canceled" }) });
  const failed = snapshot({ everSubscribed: true, subscription: view({ status: "past_due" }) });

  it("opens a workspace whose recorded subscription runs, of either store, without asking Stripe", async () => {
    const stripeNotAsked = { cached: async () => { throw new Error("asked"); }, fresh: async () => { throw new Error("asked"); } };
    expect(await decideAccess(ORG, deps({ rows: async () => [row("apple", "active")], ...stripeNotAsked }))).toMatchObject({ access: "open", configured: true, reason: null });
    expect(await decideAccess(ORG, deps({ rows: async () => [row("stripe", "trialing")], ...stripeNotAsked }))).toMatchObject({ access: "open" });
    expect(await decideAccess(ORG, deps({ rows: async () => [row("stripe", "canceled"), row("apple", "trialing", null)], ...stripeNotAsked }))).toMatchObject({ access: "open" });
  });

  it("opens on Stripe's word while the webhook trails a Checkout: the cached snapshot, then a fresh read", async () => {
    expect(await decideAccess(ORG, deps({ cached: async () => trialing }))).toMatchObject({ access: "open", snapshot: trialing, trialOffered: false });
    let asked = 0;
    const answer = await decideAccess(ORG, deps({ rows: async () => [row("stripe", "active", NOW - DAY)], cached: async () => ended, fresh: async () => { asked += 1; return trialing; } }));
    expect(answer).toMatchObject({ access: "open" });
    expect(asked).toBe(1);
  });

  it("locks with Stripe's reason when nothing runs: never subscribed, ended, payment failed", async () => {
    expect(await decideAccess(ORG, deps())).toMatchObject({ access: "locked", reason: "no_trial", trialOffered: true });
    expect(await decideAccess(ORG, deps({ cached: async () => ended, fresh: async () => ended }))).toMatchObject({ access: "locked", reason: "ended", trialOffered: false });
    expect(await decideAccess(ORG, deps({ cached: async () => failed, fresh: async () => failed }))).toMatchObject({ access: "locked", reason: "payment" });
    expect(await decideAccess(ORG, deps({ rows: async () => [row("stripe", "past_due")], cached: async () => failed, fresh: async () => failed }))).toMatchObject({ access: "locked", reason: "payment" });
  });

  it("locks when Stripe cannot be reached: no doubt lets a workspace through", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const down = async () => { throw new Error("stripe down"); };
    expect(await decideAccess(ORG, deps({ cached: async () => ended, fresh: down }))).toMatchObject({ access: "locked", reason: "ended" });
    expect(await decideAccess(ORG, deps({ cached: down, fresh: down }))).toMatchObject({ access: "locked", reason: "no_trial" });
    expect(await decideAccess(ORG, deps({ rows: async () => [row("stripe", "unpaid")], cached: down, fresh: down }))).toMatchObject({ access: "locked", reason: "payment", trialOffered: false });
    // The record unread too: still locked, on Stripe's last word.
    expect(await decideAccess(ORG, deps({ rows: down, cached: async () => ended, fresh: down }))).toMatchObject({ access: "locked", reason: "ended" });
  });

  it("opens with nothing about subscriptions on a deployment without a key, for an exempt workspace and on a sample cabinet", async () => {
    const asked = { rows: async () => { throw new Error("asked"); } };
    expect(await decideAccess(ORG, deps({ env: {}, ...asked }))).toEqual({ access: "open", reason: null, configured: false, trialOffered: false, snapshot: null });
    expect(await decideAccess(ORG, deps({ env: { STRIPE_SECRET_KEY: "pk_live_51abcdefghijklmnop" }, ...asked }))).toMatchObject({ access: "open", configured: false });
    expect(await decideAccess(ORG, deps({ env: { ...env, BILLING_EXEMPT_ORGS: ORG.toUpperCase() }, ...asked }))).toMatchObject({ access: "open", configured: true });
    expect(await decideAccess(ORG, deps({ sample: true, ...asked }))).toMatchObject({ access: "open", configured: true });
  });

  it("reads the record under the member's token, a table not there yet counting as no row", async () => {
    const g = (answer: { data: unknown; error: { code: string } | null }) => {
      const seen: string[] = [];
      const chain = { select: (cols: string) => { seen.push(cols); return chain; }, eq: (col: string, value: string) => { seen.push(`${col}=${value}`); return Promise.resolve(answer); } };
      return { client: { from: (table: string) => { seen.push(table); return chain; } } as unknown as Parameters<typeof recordedRows>[0], seen };
    };
    const ok = g({ data: [{ source: "apple", status: "active", current_period_end: null }], error: null });
    expect(await recordedRows(ok.client, ORG)).toEqual([{ source: "apple", status: "active", current_period_end: null }]);
    expect(ok.seen).toEqual(["billing_status", "source,status,current_period_end", `org_id=${ORG}`]);
    expect(await recordedRows(g({ data: null, error: { code: "PGRST205" } }).client, ORG)).toEqual([]);
    expect(await recordedRows(g({ data: null, error: { code: "42P01" } }).client, ORG)).toEqual([]);
    await expect(recordedRows(g({ data: null, error: { code: "57014" } }).client, ORG)).rejects.toThrow();
  });

  it("refuses writes with the same answer the pages get", async () => {
    expect(await lockedFor({ id: ORG }, async () => ({ access: "locked", reason: "ended", configured: true, trialOffered: false, snapshot: null }))).toBe(true);
    expect(await lockedFor({ id: ORG }, async () => ({ access: "open", reason: null, configured: false, trialOffered: false, snapshot: null }))).toBe(false);
  });

  it("says a subscription was confirmed only when one is on record, whatever the address says", () => {
    const sub = view({ status: "trialing" });
    expect(confirmationShown("1", { subscription: sub }, false)).toBe(true);
    expect(confirmationShown("1", { subscription: null }, false)).toBe(false);
    expect(confirmationShown(undefined, { subscription: sub }, false)).toBe(false);
    expect(confirmationShown("1", { subscription: sub }, true)).toBe(false);
  });
});
