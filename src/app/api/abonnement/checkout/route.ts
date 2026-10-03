import { NextResponse, type NextRequest } from "next/server";
import { isRhythm } from "@/domain/billing/pricing";
import { DAY, checkoutTrial } from "@/domain/billing/trial";
import { fmt } from "@/lib/i18n/config";
import { formatDate } from "@/lib/types";
import { billingProvider } from "@/lib/billing/provider";
import { dayOf } from "@/lib/billing/format";
import { billingRoute, portfolioRents, stripeFailure } from "@/lib/billing/route";
import { createCheckout } from "@/lib/billing/service";

export const runtime = "nodejs";

/**
 * The address of a Stripe Checkout page that creates the subscription: the
 * rhythm chosen, the price computed here from the rents of the lots let
 * (never taken from the browser), the rest of the trial carried over so the
 * first charge falls on its last day.
 */
export async function POST(req: NextRequest) {
  const r = await billingRoute(req);
  if (r instanceof NextResponse) return r;
  const body = (await req.json().catch(() => null)) as { rhythm?: unknown } | null;
  if (!isRhythm(body?.rhythm)) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const portfolio = await portfolioRents(r.ctx);
  if (portfolio instanceof NextResponse) return portfolio;
  const now = Math.floor(Date.now() / 1000);
  const trial = checkoutTrial(now, r.snapshot.customer.trialEnd);
  const chargeOn = !trial ? null : "trial_end" in trial ? trial.trial_end : now + trial.trial_period_days * DAY;
  const submitMessage = chargeOn ? fmt(r.d.billing.checkoutNoteTrial, { date: formatDate(dayOf(chargeOn), r.locale) }) : r.d.billing.checkoutNoteNow;
  try {
    const result = await createCheckout(r.stripe, {
      snapshot: r.snapshot, orgId: r.ctx.org.id, rhythm: body.rhythm, rents: portfolio.rents,
      locale: r.locale, origin: r.origin, now, tax: billingProvider().tax, submitMessage,
    });
    if ("error" in result) return NextResponse.json(result, { status: 409 });
    return NextResponse.json(result);
  } catch (error) {
    return stripeFailure("checkout", error);
  }
}
