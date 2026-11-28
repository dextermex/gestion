import "server-only";
import type Stripe from "stripe";
import { DEFAULT_RHYTHM, PRICES_INCLUDE_VAT, isRhythm, quote, subscriptionYear, withLoyalty, type Quote, type Rhythm } from "@/domain/billing/pricing";
import type { Cents } from "@/domain/money";
import { checkoutTrial, isRunningStatus, trialOffered, type BillingFacts, type SubscriptionFacts } from "@/domain/billing/trial";
import { WINBACK_PCT, offerSchema, type Offer } from "@/lib/signup/offer";
import { stripeCode, stripeStatus } from "./stripe";

/**
 * A workspace's subscription, held at Stripe. Stripe's webhook copies its
 * status into gestion.billing_status (supabase/shared/functions/stripe), which
 * the gate reads first (./access.ts); this module talks to Stripe itself.
 *
 *  - One Stripe customer per workspace, found by the workspace id in its
 *    metadata, created when the workspace first opens Checkout (never
 *    because a page was opened).
 *  - The subscription is created by Checkout, the card taken first, with a
 *    thirty-day trial for a workspace that never had a subscription: the
 *    first charge falls on the trial's last day. A workspace that had one
 *    is charged at once (the free days are promised once).
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
  /** On a subscription in its trial: the reminder e-mails already sent, comma-separated. */
  reminders: "morada_reminders",
  /** On a Checkout session and its subscription: where it was started (signup, resume, page). */
  source: "morada_source",
  /** On a Checkout session: the offer it prices (lots and rent band), for the return route. */
  units: "morada_units",
  band: "morada_band",
  /** On a Checkout session: the one-time offer applied. */
  winback: "morada_winback",
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
  /** The rhythm last chosen (the default until then). */
  rhythm: Rhythm;
  locale: string;
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
  /** The trial reminders already sent. */
  reminders: string[];
}

export interface BillingSnapshot {
  customer: CustomerFacts;
  subscription: SubscriptionView | null;
  /** The customer ever had a subscription (the free days are then spent). */
  everSubscribed: boolean;
}

export const factsOf = (snapshot: BillingSnapshot, now: number): BillingFacts => ({ now, subscription: snapshot.subscription });

/** Whether the snapshot shows a subscription that runs (trialing or active). */
export const snapshotRuns = (snapshot: BillingSnapshot | null): boolean => isRunningStatus(snapshot?.subscription?.status);

/** Statuses under which a subscription is the workspace's current one. */
const CURRENT = ["trialing", "active", "past_due", "incomplete", "unpaid", "paused"];

export function customerFacts(customer: Stripe.Customer): CustomerFacts {
  const meta = customer.metadata ?? {};
  const rhythm = meta[META.rhythm];
  return {
    id: customer.id,
    created: customer.created,
    email: customer.email ?? null,
    rhythm: isRhythm(rhythm) ? rhythm : DEFAULT_RHYTHM,
    locale: meta[META.locale] || "fr",
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
    reminders: (meta[META.reminders] ?? "").split(",").filter(Boolean),
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

/** The workspace's customer, created now (at its first Checkout). */
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
    // One customer per workspace, however many requests arrive together and
    // whichever of its members they come from: the key names the workspace alone.
    return await stripe.customers.create(params, { idempotencyKey: `morada-gestion-customer-${input.orgId}` });
  } catch (error) {
    // The same key with other parameters (another member, a language switched
    // meanwhile): the first one exists, and is the workspace's.
    const existing = await findCustomer(stripe, input.orgId, input.email);
    if (existing) return existing;
    throw error;
  }
}

/** The customer's subscriptions, read with the payment method on file. */
export async function snapshotOf(stripe: Stripe, customer: Stripe.Customer): Promise<BillingSnapshot> {
  const subs = await stripe.subscriptions.list({ customer: customer.id, status: "all", limit: 10, expand: ["data.default_payment_method"] });
  const current = pickSubscription(subs.data);
  return { customer: customerFacts(customer), subscription: current ? subscriptionView(current) : null, everSubscribed: subs.data.length > 0 };
}

/** The snapshot of a workspace whose customer already exists; null when it does not yet. */
export async function readSnapshot(stripe: Stripe, orgId: string, email?: string | null): Promise<BillingSnapshot | null> {
  const customer = await findCustomer(stripe, orgId, email);
  return customer ? snapshotOf(stripe, customer) : null;
}

/** The snapshot, creating the customer when the workspace has none yet: called by Checkout only. */
export async function ensureSnapshot(stripe: Stripe, input: NewCustomer): Promise<BillingSnapshot> {
  const existing = await findCustomer(stripe, input.orgId, input.email);
  if (existing) return snapshotOf(stripe, existing);
  const created = await createCustomer(stripe, input);
  return { customer: customerFacts(created), subscription: null, everSubscribed: false };
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

/** The one-time offer: a quarter off the first year (one yearly charge, or four quarterly ones). */
export const WINBACK_COUPON = { id: `morada_winback_${WINBACK_PCT}`, percent_off: WINBACK_PCT, duration: "repeating" as const, duration_in_months: 12 };

const couponConfirmed = new WeakSet<object>();

/** The coupon, created in the Stripe account the first time the offer is taken. */
async function ensureWinbackCoupon(stripe: Stripe): Promise<void> {
  if (couponConfirmed.has(stripe)) return;
  try {
    await stripe.coupons.retrieve(WINBACK_COUPON.id);
  } catch (error) {
    if (stripeStatus(error) !== 404) throw error;
    try {
      await stripe.coupons.create({ ...WINBACK_COUPON, name: `Morada Gestion -${WINBACK_PCT} %`, metadata: { [META.app]: APP } });
    } catch (again) {
      if (stripeCode(again) !== "resource_already_exists") throw again;
    }
  }
  couponConfirmed.add(stripe);
}

// ── Checkout, portal, rhythm, price ───────────────────────────────────────

/** The language Checkout and the portal speak; Lëtzebuergesch readers get their browser's. */
export const checkoutLocale = (locale: string): "fr" | "en" | "de" | "auto" =>
  locale === "fr" || locale === "en" || locale === "de" ? locale : "auto";

/** A subscription the running price follows (repriced, rhythm changed): running, or waiting for a payment. */
const isRunning = (sub: SubscriptionView | null) => !!sub && ["trialing", "active", "past_due", "incomplete"].includes(sub.status);

/** A subscription that a new Checkout must not duplicate: running, or held until its payment is settled. */
const blocksCheckout = (sub: SubscriptionView | null) => !!sub && ["trialing", "active", "past_due", "unpaid", "incomplete"].includes(sub.status);

/** Where a Checkout was started: the sign-up's offer screen, the locked screen's "resume", the subscription page. */
export type CheckoutSource = "signup" | "resume" | "page";

/**
 * Morada's look on Stripe's payment page, sent with each Checkout rather than
 * set on the Stripe account, which other products share: the name, the app's
 * icon, the brand teal on the button (brand-700 in globals.css), the sand
 * background, Inter and pill buttons, as on the sign-up. Stripe fetches the
 * icon from its address, so it is sent only from a public https origin.
 */
export function checkoutBranding(origin: string) {
  const publicOrigin = /^https:\/\/(?!localhost|127\.)/.test(origin);
  return {
    display_name: "Morada",
    background_color: "#faf7f2",
    button_color: "#10505c",
    border_style: "pill" as const,
    font_family: "inter" as const,
    ...(publicOrigin ? { icon: { type: "url" as const, url: `${origin}/icons/icon-512.png` } } : {}),
  };
}

export interface CheckoutInput {
  snapshot: BillingSnapshot;
  orgId: string;
  /** The price: from the sign-up's answers (offerQuote) or the portfolio's rents, computed on the server. */
  quote: Quote;
  /** The offer it prices, when it came from one (recorded on the account on return). */
  offer?: Offer | null;
  source: CheckoutSource;
  /** The one-time offer: a quarter off the first year. */
  winback?: boolean;
  locale: string;
  /** The app's own origin, for the return addresses. */
  origin: string;
  tax: boolean;
  /** Shown above Checkout's button: when the first charge falls, that nothing is charged today. */
  submitMessage: string;
}

export type CheckoutResult = { url: string } | { error: "already_subscribed" | "too_many_lots" };

const CANCEL_PATH: Record<CheckoutSource, string> = { signup: "/inscription?etape=offre&retour=annule", resume: "/app", page: "/app/abonnement" };

/** A Checkout page that takes the card and creates the subscription, with the thirty free days when the workspace never had them. */
export async function createCheckout(stripe: Stripe, input: CheckoutInput): Promise<CheckoutResult> {
  if (blocksCheckout(input.snapshot.subscription)) return { error: "already_subscribed" };
  const q = input.quote;
  // Beyond the published terms, the price is built with the team.
  if (!q.fits) return { error: "too_many_lots" };
  await ensureProduct(stripe);
  if (input.winback) await ensureWinbackCoupon(stripe);
  const trial = checkoutTrial(trialOffered(input.snapshot.everSubscribed));
  const meta: Record<string, string> = { [META.app]: APP, [META.org]: input.orgId, [META.rhythm]: q.rhythm, [META.source]: input.source };
  const sessionMeta: Record<string, string> = { ...meta };
  if (input.offer) Object.assign(sessionMeta, { [META.units]: String(input.offer.units), [META.band]: String(input.offer.band) });
  if (input.winback) sessionMeta[META.winback] = "1";
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: input.snapshot.customer.id,
    client_reference_id: input.orgId,
    line_items: [{ price_data: priceData(q.charged, q.rhythm), quantity: 1 }],
    subscription_data: { ...(trial ?? {}), metadata: { ...meta, ...pricingMeta(q) } },
    payment_method_collection: "always",
    // Stripe takes a coupon or promotion codes, not both: the one-time offer comes without codes.
    ...(input.winback ? { discounts: [{ coupon: WINBACK_COUPON.id }] } : { allow_promotion_codes: true }),
    billing_address_collection: "auto",
    tax_id_collection: { enabled: true },
    customer_update: { name: "auto", address: "auto" },
    automatic_tax: { enabled: input.tax },
    locale: checkoutLocale(input.locale),
    branding_settings: checkoutBranding(input.origin),
    custom_text: input.submitMessage ? { submit: { message: input.submitMessage.slice(0, 1200) } } : undefined,
    success_url: `${input.origin}/api/abonnement/retour?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${input.origin}${CANCEL_PATH[input.source]}`,
    metadata: sessionMeta,
  });
  if (!session.url) throw new Error("createCheckout: Stripe returned no address");
  return { url: session.url };
}

/** What a finished Checkout session says, once it is known to be this workspace's own. */
export interface CheckoutReturn {
  source: CheckoutSource;
  /** The offer it priced, as the account records it (`morada_mobile.offer`); null when it priced the portfolio. */
  offer: (Offer & { addon: false }) | null;
  /** The subscription it created is in its trial. */
  trialing: boolean;
}

/** A finished Checkout session, when it is this workspace's own; null for anybody else's (nothing is then recorded or refreshed). */
export async function checkoutReturn(stripe: Stripe, orgId: string, sessionId: string): Promise<CheckoutReturn | null> {
  if (!/^cs_(test|live)_[A-Za-z0-9]{8,}$/.test(sessionId)) return null;
  const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["subscription"] });
  if (session.client_reference_id !== orgId || session.metadata?.[META.org] !== orgId) return null;
  const meta = session.metadata ?? {};
  const marked = meta[META.source];
  const source: CheckoutSource = marked === "signup" || marked === "resume" ? marked : "page";
  const parsed = meta[META.units] && meta[META.band]
    ? offerSchema.safeParse({ units: Number(meta[META.units]), band: Number(meta[META.band]), billing: meta[META.rhythm] })
    : null;
  const offer = parsed?.success ? { ...parsed.data, addon: false as const } : null;
  const sub = session.subscription && typeof session.subscription === "object" ? session.subscription : null;
  return { source, offer, trialing: sub?.status === "trialing" };
}

/** Whether a finished Checkout session is this workspace's own, before anything is refreshed for it. */
export async function checkoutBelongs(stripe: Stripe, orgId: string, sessionId: string): Promise<boolean> {
  return (await checkoutReturn(stripe, orgId, sessionId)) !== null;
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
