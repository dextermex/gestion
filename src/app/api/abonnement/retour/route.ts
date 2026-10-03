import { NextResponse, type NextRequest } from "next/server";
import { revalidateTag } from "next/cache";
import { withOrg } from "@/lib/gestion/api";
import { billingTag } from "@/lib/billing/cache";
import { stripeClient } from "@/lib/billing/stripe";
import { checkoutBelongs } from "@/lib/billing/service";

export const runtime = "nodejs";

/**
 * Where Stripe sends the browser back, from Checkout or from the portal: the
 * workspace's subscription is read afresh, and a Checkout the workspace
 * itself started is acknowledged on the page.
 */
export async function GET(req: NextRequest) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return NextResponse.redirect(new URL("/connexion?next=/app/abonnement", req.url), 303);
  const sessionId = req.nextUrl.searchParams.get("session_id") ?? "";
  let confirmed = false;
  const stripe = stripeClient();
  if (stripe && sessionId) {
    try {
      confirmed = await checkoutBelongs(stripe, ctx.org.id, sessionId);
    } catch (error) {
      console.error("billing return check failed:", (error as { code?: string }).code ?? "unknown");
    }
  }
  revalidateTag(billingTag(ctx.org.id));
  return NextResponse.redirect(new URL(confirmed ? "/app/abonnement?confirme=1" : "/app/abonnement", req.url), 303);
}
