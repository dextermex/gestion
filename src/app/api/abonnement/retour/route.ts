import { NextResponse, type NextRequest } from "next/server";
import { revalidateTag } from "next/cache";
import { withOrg } from "@/lib/gestion/api";
import { getSession } from "@/lib/supabase/server";
import { updateSignupUser } from "@/lib/signup/update-user";
import { billingTag } from "@/lib/billing/cache";
import { stripeClient } from "@/lib/billing/stripe";
import { checkoutReturn, type CheckoutReturn } from "@/lib/billing/service";
import { returnMetadata, returnPath } from "@/lib/billing/retour";

export const runtime = "nodejs";

/**
 * Where Stripe sends the browser back, from Checkout or from the portal. A
 * Checkout the workspace itself started is recorded on the account (the
 * offer it priced and the trial's start, `morada_mobile`, the shape the
 * iPhone app writes: bookkeeping, never access), the workspace's
 * subscription is read afresh, and the person goes on: a sign-up to
 * "Bienvenue", the locked screen's "resume" to the space, anything else to
 * the subscription page.
 */
export async function GET(req: NextRequest) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return NextResponse.redirect(new URL("/connexion?next=/app/abonnement", req.url), 303);
  const sessionId = req.nextUrl.searchParams.get("session_id") ?? "";
  let done: CheckoutReturn | null = null;
  const stripe = stripeClient();
  if (stripe && sessionId) {
    try {
      done = await checkoutReturn(stripe, ctx.org.id, sessionId);
    } catch (error) {
      console.error("billing return check failed:", (error as { code?: string }).code ?? "unknown");
    }
  }
  if (done && (done.offer || done.trialing)) {
    const session = await getSession();
    if (session) {
      const saved = await updateSignupUser(session.accessToken, { data: { morada_mobile: returnMetadata(session.metadata?.morada_mobile, done, new Date()) } })
        .catch(() => ({ error: { code: "unreachable" } }));
      // Bookkeeping only: the subscription itself is Stripe's, and opens the space without it.
      if (saved.error) console.error("billing return: offer not noted on the account:", saved.error.code);
    }
  }
  revalidateTag(billingTag(ctx.org.id));
  return NextResponse.redirect(new URL(returnPath(done), req.url), 303);
}
