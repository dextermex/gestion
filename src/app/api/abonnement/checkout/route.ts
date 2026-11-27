import { NextResponse, type NextRequest } from "next/server";
import { isRhythm, quote, type Quote } from "@/domain/billing/pricing";
import { anyRowRuns, firstChargeOn, trialOffered } from "@/domain/billing/trial";
import { fmt } from "@/lib/i18n/config";
import { formatDate, euros } from "@/lib/types";
import { WINBACK_PCT, offerQuote, offerSchema, type Offer } from "@/lib/signup/offer";
import { billingProvider } from "@/lib/billing/provider";
import { dayOf } from "@/lib/billing/format";
import { recordedRows } from "@/lib/billing/access";
import { billingRoute, portfolioRents, stripeFailure } from "@/lib/billing/route";
import { createCheckout, ensureSnapshot, type CheckoutSource } from "@/lib/billing/service";

export const runtime = "nodejs";

/**
 * The address of a Stripe Checkout page that takes the card and creates the
 * subscription, with the thirty free days for a workspace that never had a
 * subscription (charged at once otherwise). Two bodies:
 *
 *  - `{ source: "signup" | "resume", units, band, billing, winback? }`: the
 *    offer the sign-up quoted (or the locked screen resumes), priced on the
 *    grid from those answers (src/lib/signup/offer.ts);
 *  - `{ rhythm }`: the subscription page, priced from the rents of the lots
 *    let, read here (never taken from the browser).
 *
 * The workspace's Stripe customer is created here, at its first Checkout.
 */
export async function POST(req: NextRequest) {
  if (!billingProvider().configured) return NextResponse.json({ error: "billing_unavailable" }, { status: 503 });
  const r = await billingRoute(req);
  if (r instanceof NextResponse) return r;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

  let q: Quote;
  let offer: Offer | null = null;
  let source: CheckoutSource;
  let winback = false;
  if (body?.source === "signup" || body?.source === "resume") {
    const parsed = offerSchema.safeParse(body);
    if (!parsed.success || (body.winback !== undefined && typeof body.winback !== "boolean")) return NextResponse.json({ error: "invalid" }, { status: 400 });
    offer = parsed.data;
    q = offerQuote(offer);
    source = body.source;
    winback = body.winback === true;
  } else if (isRhythm(body?.rhythm)) {
    const portfolio = await portfolioRents(r.ctx);
    if (portfolio instanceof NextResponse) return portfolio;
    q = quote(portfolio.rents, body.rhythm, 1);
    source = "page";
  } else {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  // A subscription taken in the iPhone app already opens the workspace: no second one here.
  try {
    if (anyRowRuns(await recordedRows(r.ctx.g, r.ctx.org.id), Math.floor(Date.now() / 1000))) return NextResponse.json({ error: "already_subscribed" }, { status: 409 });
  } catch {
    /* The record unread: Stripe's own check below still refuses a second Stripe subscription. */
  }

  const now = Math.floor(Date.now() / 1000);
  try {
    // Read afresh, never from the cache: a subscription made a minute ago must not be made twice.
    const snapshot = await ensureSnapshot(r.stripe, {
      orgId: r.ctx.org.id, orgName: r.ctx.org.name, email: r.email, userId: r.ctx.userId, locale: r.locale, rhythm: q.rhythm,
    });
    const offered = trialOffered(snapshot.everSubscribed);
    const chargeOn = formatDate(dayOf(firstChargeOn(now, offered)), r.locale);
    const submitMessage = offered
      ? fmt(r.d.billing.checkoutNoteTrial, { date: chargeOn, amount: euros(winback ? Math.round((q.charged * (100 - WINBACK_PCT)) / 100) : q.charged, r.locale) })
      : r.d.billing.checkoutNoteNow;
    const result = await createCheckout(r.stripe, {
      snapshot, orgId: r.ctx.org.id, quote: q, offer, source, winback,
      locale: r.locale, origin: r.origin, tax: billingProvider().tax, submitMessage,
    });
    if ("error" in result) return NextResponse.json(result, { status: 409 });
    return NextResponse.json(result);
  } catch (error) {
    return stripeFailure("checkout", error);
  }
}
