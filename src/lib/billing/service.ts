import "server-only";
import type Stripe from "stripe";
import { DEFAULT_RHYTHM, PRICES_INCLUDE_VAT, isRhythm, quote, subscriptionYear, withLoyalty, type Quote, type Rhythm } from "@/domain/billing/pricing";
import type { Cents } from "@/domain/money";
import { canExtend, checkoutTrial, extendedEnd, trialEndOf, type BillingFacts, type SubscriptionFacts } from "@/domain/billing/trial";
import { stripeCode, stripeStatus } from "./stripe";

/**
 * A workspace's subscription, kept entirely at Stripe: nothing about it is
 * stored in the shared database, so there is no migration, no service key
 * and no webhook (docs/ARCHITECTURE.md: the state is read back instead).
 *
 *  - One Stripe customer per workspace, found by the workspace id in its
 *    metadata. The trial runs from that customer's creation, a date Stripe
 *    sets and nobody edits: a workspace cannot lengthen its own trial, and
 *    deleting its records changes nothing.
 *  - The rhythm chosen during the trial sits in the customer's metadata;
 *    the subscription is only created when a card is added, through
 *    Checkout, with the rest of the trial carried over so the first charge
 *    falls on the trial's last day.
 *  - A subscription carries one price: the portfolio's charge, computed
 *    here from the rents of the lots it bills (src/domain/billing/pricing.ts)
 *    and handed to Stripe as is, loyalty included, so what the screen shows
 *    is what Stripe charges. The price follows the portfolio (on a visit,
 *    after the response) and the loyalty years (the daily run, from the
 *    charge before loyalty recorded on the subscription).
 *  - A subscription set up with the team (more than 50 lots, an agency's
 *    terms) carries no pricing mark and is never repriced here.
 *
 * Every function takes the Stripe client, so tests drive it against a
 * recorded stand-in.
 */

/** Metadata Morada writes on Stripe objects; the workspace cannot reach any of it. */
export const META = {
  app: "morada_app",
  org: "morada_org",
  rhythm: "morada_rhythm",
  locale: "morada_locale",
  /** An extension's end, in unix seconds. */
  trialEnd: "morada_trial_end",
  /** The reminder e-mails already sent, comma-separated. */
  reminders: "morada_reminders",
  /** On a subscription priced here from the portfolio: PORTFOLIO_PRICING. */
  pricing: "morada_pricing",
  /** On such a subscription: the lots counted at its last pricing. */
  lots: "morada_lots",
  /** On such a subscription: one charge before loyalty, in cents, at its last pricing. */
  base: "morada_base",
} as const;
export const APP = "gestion";
export const PORTFOLIO_PRICING = "portfolio";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CustomerFacts {
  id: string;
  created: number;
  email: string | null;
  /** The workspace's trial end: creation plus the trial, or the extension's end. */
  trialEnd: number;
  extended: boolean;
  /** The rhythm chosen during the trial (the default until then). */
  rhythm: Rhythm;
  locale: string;
  reminders: string[];
}

export interface SubscriptionView extends SubscriptionFacts {
  id: string;
  rhythm: Rhythm | null;
  /** Priced here from the portfolio; false for terms set up with the team. */
  managed: boolean;
  /** The item that carries the price. */
  itemId: string | null;
  /** One charge at the current price, in cents. */
  charged: Cents;
  /** The lots counted at the last pricing. */
  lots: number;
  /** One charge before loyalty at the last pricing; null when none is recorded. */
  base: Cents | null;
  /** The first paid day: the end of the subscription's trial, else its start. */
  paidFrom: number;
  /** The payment method on file, as its holder recognises it. */
  card: { brand: string; last4: string } | null;
}

export interface BillingSnapshot {
  customer: CustomerFacts;
  subscription: SubscriptionView | null;
}

export const factsOf = (snapshot: BillingSnapshot, now: number): BillingFacts => ({ now, trialEnd: snapshot.customer.trialEnd, subscription: snapshot.subscription });

/** Statuses under which a subscription is the workspace's current one. */
const CURRENT = ["trialing", "active", "past_due", "incomplete", "unpaid", "paused"];

export function customerFacts(customer: Stripe.Customer): CustomerFacts {
  const meta = customer.metadata ?? {};
  const extendedTo = Number(meta[META.trialEnd]) || null;
  const rhythm = meta[META.rhythm];
  return {
    id: customer.id,
    created: customer.created,
    email: customer.email ?? null,
    trialEnd: trialEndOf(customer.created, extendedTo),
    extended: extendedTo !== null,
    rhythm: isRhythm(rhythm) ? rhythm : DEFAULT_RHYTHM,
    locale: meta[META.locale] || "fr",
    reminders: (meta[META.reminders] ?? "").split(",").filter(Boolean),
  };
}

const rhythmOfPrice = (price: Stripe.Price): Rhythm | null =>
  price.recurring?.interval === "year" ? "year" : price.recurring?.interval === "month" && price.recurring.interval_count === 3 ? "quarter" : null;

export function subscriptionView(sub: Stripe.Subscription): SubscriptionView {
  const items = sub.items.data;
  const item = items[0] ?? null;
  const meta = sub.metadata ?? {};
  const rhythmMeta = meta[META.rhythm];
  const lots = Number(meta[META.lots]);
  const base = Number(meta[META.base]);
  const method = sub.default_payment_method && typeof sub.default_payment_method === "object" ? sub.default_payment_method : null;
  const card = method?.card ? { brand: method.card.brand, last4: method.card.last4 }
    : method?.sepa_debit?.last4 ? { brand: "sepa_debit", last4: method.sepa_debit.last4 } : null;
  return {
    id: sub.id,
    status: sub.status,
    trialEnd: sub.trial_end,
    periodEnd: item?.current_period_end ?? null,
    cancelAtPeriodEnd: sub.cancel_at_period_end || sub.cancel_at !== null,
    // What Stripe charges by is the price's own interval; the mark only stands in without one.
    rhythm: (item ? rhythmOfPrice(item.price) : null) ?? (isRhythm(rhythmMeta) ? rhythmMeta : null),
    managed: meta[META.pricing] === PORTFOLIO_PRICING && items.length === 1,
    itemId: item?.id ?? null,
    charged: items.reduce((sum, i) => sum + (i.price.unit_amount ?? 0) * (i.quantity ?? 1), 0),
    lots: Number.isInteger(lots) && lots >= 0 ? lots : 0,
    base: Number.isInteger(base) && base > 0 ? base : null,
    paidFrom: sub.trial_end ?? sub.start_date,
    card,
  };
}

/** The current subscription among a customer's: a running one, the latest first; else the latest that ended. */
export function pickSubscription(subs: readonly Stripe.Subscription[]): Stripe.Subscription | null {
  const newest = [...subs].sort((a, b) => b.created - a.created);
  return newest.find((s) => CURRENT.includes(s.status)) ?? newest[0] ?? null;
}

/**
 * The workspace's customer: by its id in the metadata (Stripe's search, which
 * lags creation by up to a minute), else among the customers carrying the
 * caller's e-mail (immediate). Should two exist, the oldest is the one.
 */
export async function findCustomer(stripe: Stripe, orgId: string, email?: string | null): Promise<Stripe.Customer | null> {
  if (!UUID.test(orgId)) throw new Error("findCustomer: not a workspace id");
  const found = await stripe.customers.search({ query: `metadata['${META.org}']:'${orgId}'`, limit: 10 });
  let candidates = found.data.filter((c) => c.metadata?.[META.org] === orgId);
  if (candidates.length === 0 && email) {
    const listed = await stripe.customers.list({ email, limit: 100 });
    candidates = listed.data.filter((c) => c.metadata?.[META.org] === orgId);
  }
  if (candidates.length === 0) return null;
  return candidates.reduce((oldest, c) => (c.created < oldest.created ? c : oldest));
}

export interface NewCustomer {
  orgId: string;
  orgName: string;
  email: string;
  userId: string;
  locale: string;
  /** The rhythm picked at sign-up, if any. */
  rhythm?: Rhythm | null;
}

/** The languages Stripe writes to the customer in (receipts, its own e-mails). */
export const preferredLocales = (locale: string): string[] => (locale === "lu" ? ["de", "fr"] : [locale === "en" || locale === "de" ? locale : "fr"]);

/** The workspace's customer, created now: the trial starts here. */
export async function createCustomer(stripe: Stripe, input: NewCustomer): Promise<Stripe.Customer> {
  if (!UUID.test(input.orgId)) throw new Error("createCustomer: not a workspace id");
  const params: Stripe.CustomerCreateParams = {
    name: input.orgName.slice(0, 250) || undefined,
    email: input.email || undefined,
    preferred_locales: preferredLocales(input.locale),
    metadata: {
      [META.app]: APP,
      [META.org]: input.orgId,
      [META.rhythm]: input.rhythm ?? DEFAULT_RHYTHM,
      [META.locale]: input.locale,
    },
  };
  try {
    // One customer however many of this user's requests arrive together.
    return await stripe.customers.create(params, { idempotencyKey: `morada-gestion-customer-${input.orgId}-${input.userId}` });
  } catch (error) {
    // The same key with other parameters (a language switched meanwhile): the first one exists.
    const existing = await findCustomer(stripe, input.orgId, input.email);
    if (existing) return existing;
    throw error;
  }
}

/** The customer's subscriptions, read with the payment method on file. */
export async function snapshotOf(stripe: Stripe, customer: Stripe.Customer): Promise<BillingSnapshot> {
  const subs = await stripe.subscriptions.list({ customer: customer.id, status: "all", limit: 10, expand: ["data.default_payment_method"] });
  const current = pickSubscription(subs.data);
  return { customer: customerFacts(customer), subscription: current ? subscriptionView(current) : null };
}

/** The snapshot of a workspace whose customer already exists; null when it does not yet. */
export async function readSnapshot(stripe: Stripe, orgId: string, email?: string | null): Promise<BillingSnapshot | null> {
  const customer = await findCustomer(stripe, orgId, email);
  return customer ? snapshotOf(stripe, customer) : null;
}

/** The snapshot, creating the customer (and so starting the trial) on the workspace's first visit. */
export async function ensureSnapshot(stripe: Stripe, input: NewCustomer): Promise<BillingSnapshot> {
  const existing = await findCustomer(stripe, input.orgId, input.email);
  if (existing) return snapshotOf(stripe, existing);
  const created = await createCustomer(stripe, input);
  return { customer: customerFacts(created), subscription: null };
}

// ── The price ──────────────────────────────────────────────────────────────

/** The one product every subscription bills: its price is the portfolio's own. */
export const PRODUCT = { id: "morada_gestion", name: "Morada Gestion" } as const;

const productConfirmed = new WeakSet<object>();

/** The product, created in the Stripe account the first time a price needs it. */
async function ensureProduct(stripe: Stripe): Promise<void> {
  if (productConfirmed.has(stripe)) return;
  try {
    await stripe.products.retrieve(PRODUCT.id);
  } catch (error) {
    if (stripeStatus(error) !== 404) throw error;
    try {
      await stripe.products.create({ id: PRODUCT.id, name: PRODUCT.name, metadata: { [META.app]: APP } });
    } catch (again) {
      if (stripeCode(again) !== "resource_already_exists") throw again;
    }
  }
  productConfirmed.add(stripe);
}

/** One charge as Stripe takes it: the amount, every three months or once a year, VAT included. */
export function priceData(amount: Cents, rhythm: Rhythm) {
  return {
    currency: "eur",
    product: PRODUCT.id,
    unit_amount: amount,
    recurring: rhythm === "year" ? { interval: "year" as const } : { interval: "month" as const, interval_count: 3 },
    tax_behavior: PRICES_INCLUDE_VAT ? ("inclusive" as const) : ("exclusive" as const),
  };
}

/** What a subscription records of its pricing: the mark, the rhythm, the lots and the charge before loyalty. */
const pricingMeta = (q: Quote) => ({ [META.pricing]: PORTFOLIO_PRICING, [META.rhythm]: q.rhythm, [META.lots]: String(q.lots), [META.base]: String(q.base) });

/** The year of subscription the next charge falls in: the trial's end, else the current period's. */
const nextChargeYear = (sub: SubscriptionView, now: number) => subscriptionYear(sub.paidFrom, sub.periodEnd ?? now);

// ── Checkout, portal, rhythm, price, extension ────────────────────────────

/** The language Checkout and the portal speak; Lëtzebuergesch readers get their browser's. */
export const checkoutLocale = (locale: string): "fr" | "en" | "de" | "auto" =>
  locale === "fr" || locale === "en" || locale === "de" ? locale : "auto";

const isRunning = (sub: SubscriptionView | null) => !!sub && ["trialing", "active", "past_due", "incomplete"].includes(sub.status);

export interface CheckoutInput {
  snapshot: BillingSnapshot;
  orgId: string;
  rhythm: Rhythm;
  /** The rents of the lots the subscription bills, read here (never taken from the browser). */
  rents: readonly Cents[];
  locale: string;
  /** The app's own origin, for the return addresses. */
  origin: string;
  now: number;
  tax: boolean;
  /** Shown above Checkout's button: when the first charge falls. */
  submitMessage: string;
}

export type CheckoutResult = { url: string } | { error: "already_subscribed" | "too_many_lots" };

/** A Checkout page that creates the subscription, the rest of the trial carried over. */
export async function createCheckout(stripe: Stripe, input: CheckoutInput): Promise<CheckoutResult> {
  if (isRunning(input.snapshot.subscription)) return { error: "already_subscribed" };
  const q = quote(input.rents, input.rhythm, 1);
  // Beyond the published terms, the price is built with the team.
  if (!q.fits) return { error: "too_many_lots" };
  await ensureProduct(stripe);
  const trial = checkoutTrial(input.now, input.snapshot.customer.trialEnd);
  const meta = { [META.app]: APP, [META.org]: input.orgId, [META.rhythm]: input.rhythm };
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: input.snapshot.customer.id,
    client_reference_id: input.orgId,
    line_items: [{ price_data: priceData(q.charged, input.rhythm), quantity: 1 }],
    subscription_data: { ...(trial ?? {}), metadata: { ...meta, ...pricingMeta(q) } },
    payment_method_collection: "always",
    allow_promotion_codes: true,
    billing_address_collection: "auto",
    tax_id_collection: { enabled: true },
    customer_update: { name: "auto", address: "auto" },
    automatic_tax: { enabled: input.tax },
    locale: checkoutLocale(input.locale),
    custom_text: input.submitMessage ? { submit: { message: input.submitMessage.slice(0, 1200) } } : undefined,
    success_url: `${input.origin}/api/abonnement/retour?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${input.origin}/app/abonnement`,
    metadata: meta,
  });
  if (!session.url) throw new Error("createCheckout: Stripe returned no address");
  return { url: session.url };
}

/** Whether a finished Checkout session is this workspace's own, before anything is refreshed for it. */
export async function checkoutBelongs(stripe: Stripe, orgId: string, sessionId: string): Promise<boolean> {
  if (!/^cs_(test|live)_[A-Za-z0-9]{8,}$/.test(sessionId)) return false;
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  return session.client_reference_id === orgId && session.metadata?.[META.org] === orgId;
}

let portalConfiguration: string | null = null;

/** The portal's settings this app relies on, created once in the Stripe account. */
async function ensurePortalConfiguration(stripe: Stripe): Promise<string> {
  if (portalConfiguration) return portalConfiguration;
  const list = await stripe.billingPortal.configurations.list({ active: true, limit: 100 });
  const ours = list.data.find((c) => c.metadata?.[META.app] === APP);
  if (ours) return (portalConfiguration = ours.id);
  const created = await stripe.billingPortal.configurations.create({
    features: {
      customer_update: { enabled: true, allowed_updates: ["name", "email", "address", "tax_id"] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: {
        enabled: true,
        mode: "at_period_end",
        cancellation_reason: { enabled: true, options: ["too_expensive", "missing_features", "switched_service", "unused", "other"] },
      },
    },
    metadata: { [META.app]: APP },
  }, { idempotencyKey: "morada-gestion-portal-v1" });
  return (portalConfiguration = created.id);
}

/** Stripe's page for the card, the invoices and cancelling, back to the subscription page after. */
export async function portalUrl(stripe: Stripe, customerId: string, returnUrl: string, locale: string, flow?: "payment_method_update"): Promise<string> {
  const configuration = await ensurePortalConfiguration(stripe);
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    configuration,
    return_url: returnUrl,
    locale: checkoutLocale(locale),
    ...(flow ? { flow_data: { type: flow } } : {}),
  });
  return session.url;
}

/**
 * A rhythm chosen: before a card, it is noted for the Checkout to come; on
 * a running subscription priced here, its price changes to the rhythm's
 * (nothing charged during the trial; Stripe prorates afterwards). Terms set
 * up with the team change with the team.
 */
export async function chooseRhythm(stripe: Stripe, snapshot: BillingSnapshot, rhythm: Rhythm, rents: readonly Cents[], now: number): Promise<{ ok: true } | { error: "custom_terms" }> {
  const sub = snapshot.subscription;
  if (sub && isRunning(sub) && !sub.managed) return { error: "custom_terms" };
  await stripe.customers.update(snapshot.customer.id, { metadata: { [META.rhythm]: rhythm } });
  if (!sub || !isRunning(sub) || !sub.itemId || sub.rhythm === rhythm) return { ok: true };
  // A paying subscription changing interval starts its new period today; a trial keeps its end.
  const q = quote(rents, rhythm, subscriptionYear(sub.paidFrom, sub.status === "trialing" ? (sub.periodEnd ?? now) : now));
  await ensureProduct(stripe);
  await stripe.subscriptions.update(sub.id, {
    items: [{ id: sub.itemId, price_data: priceData(q.charged, rhythm), quantity: 1 }],
    metadata: pricingMeta(q),
    proration_behavior: sub.status === "trialing" ? "none" : "create_prorations",
  });
  return { ok: true };
}

/** What a running subscription priced here should charge next, from the portfolio's rents; null when it is not repriced here. */
export function nextQuote(snapshot: BillingSnapshot, rents: readonly Cents[], now: number): Quote | null {
  const sub = snapshot.subscription;
  if (!sub || !isRunning(sub) || !sub.managed || !sub.itemId || !sub.rhythm || sub.cancelAtPeriodEnd) return null;
  return quote(rents, sub.rhythm, nextChargeYear(sub, now));
}

/**
 * A running subscription's price brought to the portfolio and its year:
 * free during the trial; afterwards a dearer portfolio is prorated onto the
 * next invoice, while a cheaper one or a loyalty year applies from the next
 * period. Nothing is sent when nothing changed.
 */
export async function syncPrice(stripe: Stripe, snapshot: BillingSnapshot, rents: readonly Cents[], now: number): Promise<boolean> {
  const sub = snapshot.subscription;
  const q = nextQuote(snapshot, rents, now);
  if (!sub || !q) return false;
  if (q.charged === sub.charged && q.lots === sub.lots && q.base === sub.base) return false;
  const params: Stripe.SubscriptionUpdateParams = { metadata: pricingMeta(q) };
  if (q.charged !== sub.charged) {
    await ensureProduct(stripe);
    params.items = [{ id: sub.itemId!, price_data: priceData(q.charged, sub.rhythm!), quantity: 1 }];
    params.proration_behavior = sub.status !== "trialing" && sub.base !== null && q.base > sub.base ? "create_prorations" : "none";
  }
  await stripe.subscriptions.update(sub.id, params);
  return true;
}

export interface LoyaltyRun { checked: number; stepped: number; failed: number }

/**
 * The loyalty years, applied before the renewal that opens each one: every
 * running subscription priced here is brought to the charge its next
 * renewal's year calls for, from the charge before loyalty recorded at its
 * last pricing, so no workspace data is read. Run daily; the change applies
 * from the next period, never to the one already paid.
 */
export async function stepLoyalty(stripe: Stripe, now: number): Promise<LoyaltyRun> {
  const run: LoyaltyRun = { checked: 0, stepped: 0, failed: 0 };
  const query = `metadata['${META.app}']:'${APP}' AND metadata['${META.pricing}']:'${PORTFOLIO_PRICING}'`;
  for await (const raw of stripe.subscriptions.search({ query, limit: 100 })) {
    const sub = subscriptionView(raw);
    if (!["active", "past_due"].includes(sub.status) || sub.cancelAtPeriodEnd || !sub.managed || !sub.itemId || !sub.rhythm || sub.base === null) continue;
    run.checked += 1;
    const target = withLoyalty(sub.base, nextChargeYear(sub, now));
    if (target === sub.charged) continue;
    try {
      await ensureProduct(stripe);
      await stripe.subscriptions.update(sub.id, { items: [{ id: sub.itemId, price_data: priceData(target, sub.rhythm), quantity: 1 }], proration_behavior: "none" });
      run.stepped += 1;
    } catch (error) {
      run.failed += 1;
      console.error("billing loyalty step failed:", stripeCode(error) ?? (error instanceof Error ? error.message.slice(0, 120) : "unknown"));
    }
  }
  return run;
}

/** The one extension, written where only the server reaches it. */
export async function extendTrial(stripe: Stripe, snapshot: BillingSnapshot, now: number): Promise<{ trialEnd: number } | { error: "not_offered" }> {
  if (!canExtend({ now, trialEnd: snapshot.customer.trialEnd, subscription: snapshot.subscription }, snapshot.customer.extended)) return { error: "not_offered" };
  const trialEnd = extendedEnd(now, snapshot.customer.trialEnd);
  await stripe.customers.update(snapshot.customer.id, { metadata: { [META.trialEnd]: String(trialEnd), [META.reminders]: "" } });
  return { trialEnd };
}
