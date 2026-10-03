import { NextResponse, type NextRequest } from "next/server";
import { revalidateTag } from "next/cache";
import { isPlanId, isRhythm } from "@/domain/billing/plans";
import { billingTag } from "@/lib/billing/cache";
import { billingRoute, portfolioCounts, stripeFailure } from "@/lib/billing/route";
import { choosePlan } from "@/lib/billing/service";

export const runtime = "nodejs";

/**
 * The plan and rhythm chosen on the subscription page. Before a card, they
 * are noted for the Checkout to come; on a running subscription, its prices
 * change (nothing charged during the trial, prorated afterwards).
 */
export async function POST(req: NextRequest) {
  const r = await billingRoute(req);
  if (r instanceof NextResponse) return r;
  const body = (await req.json().catch(() => null)) as { plan?: unknown; rhythm?: unknown } | null;
  if (!isPlanId(body?.plan) || !isRhythm(body?.rhythm)) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const counts = await portfolioCounts(r.ctx);
  if (counts instanceof NextResponse) return counts;
  try {
    const result = await choosePlan(r.stripe, r.snapshot, body.plan, body.rhythm, counts.lots, counts.seats);
    revalidateTag(billingTag(r.ctx.org.id));
    if ("error" in result) return NextResponse.json(result, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return stripeFailure("plan change", error);
  }
}
