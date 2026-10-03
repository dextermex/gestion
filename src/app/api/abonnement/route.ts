import { NextResponse, type NextRequest } from "next/server";
import { revalidateTag } from "next/cache";
import { isRhythm } from "@/domain/billing/pricing";
import { billingTag } from "@/lib/billing/cache";
import { billingRoute, portfolioRents, stripeFailure } from "@/lib/billing/route";
import { chooseRhythm } from "@/lib/billing/service";

export const runtime = "nodejs";

/**
 * The rhythm chosen on the subscription page. Before a card, it is noted
 * for the Checkout to come; on a running subscription, its price changes to
 * the rhythm's, computed here from the portfolio (nothing charged during the
 * trial, prorated afterwards).
 */
export async function POST(req: NextRequest) {
  const r = await billingRoute(req);
  if (r instanceof NextResponse) return r;
  const body = (await req.json().catch(() => null)) as { rhythm?: unknown } | null;
  if (!isRhythm(body?.rhythm)) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const portfolio = await portfolioRents(r.ctx);
  if (portfolio instanceof NextResponse) return portfolio;
  try {
    const result = await chooseRhythm(r.stripe, r.snapshot, body.rhythm, portfolio.rents, Math.floor(Date.now() / 1000));
    revalidateTag(billingTag(r.ctx.org.id));
    if ("error" in result) return NextResponse.json(result, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return stripeFailure("rhythm change", error);
  }
}
