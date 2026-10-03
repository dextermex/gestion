import { NextResponse, type NextRequest } from "next/server";
import { revalidateTag } from "next/cache";
import { billingTag } from "@/lib/billing/cache";
import { billingRoute, stripeFailure } from "@/lib/billing/route";
import { extendTrial } from "@/lib/billing/service";

export const runtime = "nodejs";

/** The one seven-day extension of a trial that is over or nearly, nothing subscribed. */
export async function POST(req: NextRequest) {
  const r = await billingRoute(req);
  if (r instanceof NextResponse) return r;
  try {
    const result = await extendTrial(r.stripe, r.snapshot, Math.floor(Date.now() / 1000));
    revalidateTag(billingTag(r.ctx.org.id));
    if ("error" in result) return NextResponse.json(result, { status: 409 });
    return NextResponse.json({ ok: true, trialEnd: result.trialEnd });
  } catch (error) {
    return stripeFailure("extension", error);
  }
}
