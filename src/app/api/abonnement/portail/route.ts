import { NextResponse, type NextRequest } from "next/server";
import { billingRoute, stripeFailure } from "@/lib/billing/route";
import { portalUrl } from "@/lib/billing/service";

export const runtime = "nodejs";

/** The address of Stripe's portal (card, invoices, cancelling), back through the return route. */
export async function POST(req: NextRequest) {
  const r = await billingRoute(req);
  if (r instanceof NextResponse) return r;
  const body = (await req.json().catch(() => null)) as { flow?: unknown } | null;
  const flow = body?.flow === "payment_method_update" ? "payment_method_update" : undefined;
  try {
    const url = await portalUrl(r.stripe, r.snapshot.customer.id, `${r.origin}/api/abonnement/retour?portail=1`, r.locale, flow);
    return NextResponse.json({ url });
  } catch (error) {
    return stripeFailure("portal", error);
  }
}
