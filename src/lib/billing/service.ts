import "server-only";
import type Stripe from "stripe";
import { DEFAULT_PLAN, DEFAULT_RHYTHM, PLANS, PRICES_INCLUDE_VAT, RHYTHM_MONTHS, isPlanId, isRhythm, quote, type PlanId, type Rhythm } from "@/domain/billing/plans";
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
 *  - The plan chosen during the trial sits in the customer's metadata; the
 *    subscription is only created when a card is added, through Checkout,
 *    with the rest of the trial carried over so the first charge falls on
 *    the trial's last day.
 *  - Prices are created from the catalogue the first time they are needed,
 *    under a lookup key that carries the amount: what the screen shows is
 *    what Stripe charges.
 *
 * Every function takes the Stripe client, so tests drive it against a
 * recorded stand-in.
 */

/** Metadata Morada writes on Stripe objects; the workspace cannot reach any of it. */
export const META = {
  app: "morada_app",
  org: "morada_org",
  plan: "morada_plan",
  rhythm: "morada_rhythm",
  locale: "morada_locale",
  /** An extension's end, in unix seconds. */
  trialEnd: "morada_trial_end",
  /** The reminder e-mails already sent, comma-separated. */
  reminders: "morada_reminders",
  /** On a price: what it counts, lot or seat. */
  component: "morada_component",
} as const;
export const APP = "gestion";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CustomerFacts {
  id: string;
  created: number;
  email: string | null;
  /** The workspace's trial end: creation plus the trial, or the extension's end. */
  trialEnd: number;
  extended: boolean;
  /** The plan and rhythm chosen during the trial (the defaults until then). */
  plan: PlanId;
  rhythm: Rhythm;
  locale: string;
  reminders: string[];
}

export interface SubscriptionView extends SubscriptionFacts {
  id: string;
  plan: PlanId | null;
  rhythm: Rhythm | null;
  lots: number;
  seats: number;
  lotItemId: string | null;
  seatItemId: string | null;
  /** One charge at the current quantities, in cents. */
  charged: number;
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
  const plan = meta[META.plan];
  const rhythm = meta[META.rhythm];
  return {
    id: customer.id,
    created: customer.created,
    email: customer.email ?? null,
    trialEnd: trialEndOf(customer.created, extendedTo),
    extended: extendedTo !== null,
    plan: isPlanId(plan) ? plan : DEFAULT_PLAN,
    rhythm: isRhythm(rhythm) ? rhythm : DEFAULT_RHYTHM,
    locale: meta[META.locale] || "fr",
    reminders: (meta[META.reminders] ?? "").split(",").filter(Boolean),
  };
}

const rhythmOfPrice = (price: Stripe.Price): Rhythm | null =>
  price.recurring?.interval === "year" ? "year" : price.recurring?.interval === "month" && price.recurring.interval_count === 3 ? "quarter" : null;

export function subscriptionView(sub: Stripe.Subscription): SubscriptionView {
  const items = sub.items.data;
  const lotItem = items.find((i) => i.price.metadata?.[META.component] === "lot") ?? items[0] ?? null;
  const seatItem = items.find((i) => i.price.metadata?.[META.component] === "seat") ?? null;
  const planMeta = sub.metadata?.[META.plan] ?? lotItem?.price.metadata?.[META.plan];
  const rhythmMeta = sub.metadata?.[META.rhythm];
  const method = sub.default_payment_method && typeof sub.default_payment_method === "object" ? sub.default_payment_method : null;
  const card = method?.card ? { brand: method.card.brand, last4: method.card.last4 }
    : method?.sepa_debit?.last4 ? { brand: "sepa_debit", last4: method.sepa_debit.last4 } : null;
  return {
    id: sub.id,
    status: sub.status,
    trialEnd: sub.trial_end,
    periodEnd: lotItem?.current_period_end ?? null,
    cancelAtPeriodEnd: sub.cancel_at_period_end || sub.cancel_at !== null,
    plan: isPlanId(planMeta) ? planMeta : null,
    rhythm: isRhythm(rhythmMeta) ? rhythmMeta : lotItem ? rhythmOfPrice(lotItem.price) : null,
    lots: lotItem?.quantity ?? 0,
    seats: seatItem?.quantity ?? 0,
    lotItemId: lotItem?.id ?? null,
    seatItemId: seatItem?.id ?? null,
    charged: items.reduce((sum, i) => sum + (i.price.unit_amount ?? 0) * (i.quantity ?? 1), 0),
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
  /** The plan picked at sign-up, if any. */
  plan?: PlanId | null;
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
      [META.plan]: input.plan ?? DEFAULT_PLAN,
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

// ── Prices ────────────────────────────────────────────────────────────────

export type Component = "lot" | "seat";

const PRODUCTS: Record<`${PlanId}:${Component}`, { id: string; name: string } | null> = {
  "landlord:lot": { id: "morada_gestion_landlord_lot", name: "Morada Gestion · Propriétaire · par lot" },
  "landlord:seat": null,
  "professional:lot": { id: "morada_gestion_professional_lot", name: "Morada Gestion · Professionnel · par lot" },
  "professional:seat": { id: "morada_gestion_professional_seat", name: "Morada Gestion · Professionnel · par utilisateur" },
};

/** The monthly figure a component costs on a plan and rhythm, from the catalogue. */
export function monthlyOf(plan: PlanId, component: Component, rhythm: Rhythm): number | null {
  if (component === "lot") return PLANS[plan].lot[rhythm];
  return PLANS[plan].seat ? PLANS[plan].seat![rhythm] : null;
}

export const lookupKey = (plan: PlanId, component: Component, rhythm: Rhythm, monthly: number) => `morada_gestion_${plan}_${component}_${rhythm}_${monthly}`;

const prices = new Map<string, string>();

async function ensureProduct(stripe: Stripe, product: { id: string; name: string }): Promise<void> {
  try {
    await stripe.products.retrieve(product.id);
  } catch (error) {
    if (stripeStatus(error) !== 404) throw error;
    try {
      await stripe.products.create({ id: product.id, name: product.name, metadata: { [META.app]: APP } });
    } catch (again) {
      if (stripeCode(again) !== "resource_already_exists") throw again;
    }
  }
}

/** The Stripe price for one component of a plan, created from the catalogue the first time. */
export async function ensurePrice(stripe: Stripe, plan: PlanId, component: Component, rhythm: Rhythm): Promise<string> {
  const monthly = monthlyOf(plan, component, rhythm);
  const product = PRODUCTS[`${plan}:${component}`];
  if (monthly === null || !product) throw new Error(`ensurePrice: ${plan} has no ${component} price`);
  const key = lookupKey(plan, component, rhythm, monthly);
  const held = prices.get(key);
  if (held) return held;
  const lookup = async () => (await stripe.prices.list({ lookup_keys: [key], active: true, limit: 1 })).data[0]?.id ?? null;
  const known = await lookup();
  if (known) { prices.set(key, known); return known; }
  await ensureProduct(stripe, product);
  try {
    const price = await stripe.prices.create({
      product: product.id,
      currency: "eur",
      // Stripe charges per period: the monthly figure times its months.
      unit_amount: monthly * RHYTHM_MONTHS[rhythm],
      recurring: rhythm === "year" ? { interval: "year" } : { interval: "month", interval_count: 3 },
      tax_behavior: PRICES_INCLUDE_VAT ? "inclusive" : "exclusive",
      lookup_key: key,
      nickname: key,
      metadata: { [META.app]: APP, [META.plan]: plan, [META.component]: component, [META.rhythm]: rhythm, monthly_cents: String(monthly) },
    }, { idempotencyKey: `morada-gestion-price-${key}` });
    prices.set(key, price.id);
    return price.id;
  } catch (error) {
    // Created by a concurrent request a moment earlier.
    const again = await lookup();
    if (again) { prices.set(key, again); return again; }
    throw error;
  }
}

// ── Checkout, portal, plan, quantities, extension ────────────────────────

/** The language Checkout and the portal speak; Lëtzebuergesch readers get their browser's. */
export const checkoutLocale = (locale: string): "fr" | "en" | "de" | "auto" =>
  locale === "fr" || locale === "en" || locale === "de" ? locale : "auto";

const isRunning = (sub: SubscriptionView | null) => !!sub && ["trialing", "active", "past_due", "incomplete"].includes(sub.status);

export interface CheckoutInput {
  snapshot: BillingSnapshot;
  orgId: string;
  plan: PlanId;
  rhythm: Rhythm;
  lots: number;
  seats: number;
  locale: string;
  /** The app's own origin, for the return addresses. */
  origin: string;
  now: number;
  tax: boolean;
  /** Shown above Checkout's button: when the first charge falls. */
  submitMessage: string;
}

export type CheckoutResult = { url: string } | { error: "already_subscribed" | "plan_too_small" };

/** A Checkout page that creates the subscription, the rest of the trial carried over. */
export async function createCheckout(stripe: Stripe, input: CheckoutInput): Promise<CheckoutResult> {
  if (isRunning(input.snapshot.subscription)) return { error: "already_subscribed" };
  const q = quote(input.plan, input.rhythm, input.lots, input.seats);
  if (!q.fits) return { error: "plan_too_small" };
  const lotPrice = await ensurePrice(stripe, input.plan, "lot", input.rhythm);
  const seatPrice = PLANS[input.plan].seat ? await ensurePrice(stripe, input.plan, "seat", input.rhythm) : null;
  const trial = checkoutTrial(input.now, input.snapshot.customer.trialEnd);
  const meta = { [META.app]: APP, [META.org]: input.orgId, [META.plan]: input.plan, [META.rhythm]: input.rhythm };
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: input.snapshot.customer.id,
    client_reference_id: input.orgId,
    line_items: [{ price: lotPrice, quantity: q.lots }, ...(seatPrice ? [{ price: seatPrice, quantity: q.seats }] : [])],
    subscription_data: { ...(trial ?? {}), metadata: meta },
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
 * A plan or rhythm chosen: before a card, it is noted for the Checkout to
 * come; on a running subscription, its prices change (no charge during the
 * trial; Stripe prorates afterwards).
 */
export async function choosePlan(stripe: Stripe, snapshot: BillingSnapshot, plan: PlanId, rhythm: Rhythm, lots: number, seats: number): Promise<{ ok: true } | { error: "plan_too_small" }> {
  const q = quote(plan, rhythm, lots, seats);
  if (!q.fits) return { error: "plan_too_small" };
  await stripe.customers.update(snapshot.customer.id, { metadata: { [META.plan]: plan, [META.rhythm]: rhythm } });
  const sub = snapshot.subscription;
  if (!sub || !isRunning(sub) || !sub.lotItemId) return { ok: true };
  if (sub.plan === plan && sub.rhythm === rhythm) return { ok: true };
  const lotPrice = await ensurePrice(stripe, plan, "lot", rhythm);
  const seatPrice = PLANS[plan].seat ? await ensurePrice(stripe, plan, "seat", rhythm) : null;
  const items: Stripe.SubscriptionUpdateParams.Item[] = [{ id: sub.lotItemId, price: lotPrice, quantity: q.lots }];
  if (seatPrice) items.push(sub.seatItemId ? { id: sub.seatItemId, price: seatPrice, quantity: q.seats } : { price: seatPrice, quantity: q.seats });
  else if (sub.seatItemId) items.push({ id: sub.seatItemId, deleted: true });
  await stripe.subscriptions.update(sub.id, {
    items,
    metadata: { [META.plan]: plan, [META.rhythm]: rhythm },
    proration_behavior: sub.status === "trialing" ? "none" : "create_prorations",
  });
  return { ok: true };
}

/**
 * The lots and users a running subscription counts, brought to the
 * portfolio's: free during the trial; afterwards an addition is prorated
 * onto the next invoice and a removal applies from the next period.
 */
export async function syncQuantities(stripe: Stripe, snapshot: BillingSnapshot, lots: number, seats: number): Promise<boolean> {
  const sub = snapshot.subscription;
  if (!sub || !isRunning(sub) || !sub.lotItemId || !sub.plan) return false;
  const q = quote(sub.plan, sub.rhythm ?? DEFAULT_RHYTHM, lots, seats);
  const items: Stripe.SubscriptionUpdateParams.Item[] = [];
  if (q.lots !== sub.lots) items.push({ id: sub.lotItemId, quantity: q.lots });
  if (sub.seatItemId && q.seats !== sub.seats) items.push({ id: sub.seatItemId, quantity: q.seats });
  if (items.length === 0) return false;
  const grows = q.lots > sub.lots || (!!sub.seatItemId && q.seats > sub.seats);
  await stripe.subscriptions.update(sub.id, {
    items,
    proration_behavior: sub.status === "trialing" || !grows ? "none" : "create_prorations",
  });
  return true;
}

/** The one extension, written where only the server reaches it. */
export async function extendTrial(stripe: Stripe, snapshot: BillingSnapshot, now: number): Promise<{ trialEnd: number } | { error: "not_offered" }> {
  if (!canExtend({ now, trialEnd: snapshot.customer.trialEnd, subscription: snapshot.subscription }, snapshot.customer.extended)) return { error: "not_offered" };
  const trialEnd = extendedEnd(now, snapshot.customer.trialEnd);
  await stripe.customers.update(snapshot.customer.id, { metadata: { [META.trialEnd]: String(trialEnd), [META.reminders]: "" } });
  return { trialEnd };
}
