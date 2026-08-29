import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/supabase/server";
import { getIdentity } from "@/lib/workspace";
import { SaltEdgeError, createConnectSession, ensureCustomer, saltEdgeConfigured } from "@/lib/banking/saltedge";

/**
 * Starts the bank-consent journey for the signed-in Morada account: one Salt
 * Edge customer per user, one fresh connect session per click. The secrets
 * live in the deployment environment; the browser only ever receives the
 * consent URL.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!saltEdgeConfigured()) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  // Salt Edge shows the journey in the visitor's language; lb is not
  // supported there, so Luxembourgish falls back to French.
  const cookieLocale = req.cookies.get("morada_locale")?.value;
  const locale = cookieLocale === "en" || cookieLocale === "de" ? cookieLocale : "fr";

  // Bank data belongs to the WORKSPACE, not the person: one Salt Edge
  // customer per organisation, so every member sees the same connections.
  const identity = await getIdentity();
  const org = identity?.active;
  if (!org) return NextResponse.json({ error: "no_workspace" }, { status: 403 });

  try {
    const customerId = await ensureCustomer(`morada-ws-${org.id}`);
    const returnTo = new URL("/app/banque?connexion=retour", req.nextUrl.origin).toString();
    const url = await createConnectSession(customerId, returnTo, locale);
    return NextResponse.json({ url });
  } catch (e) {
    // The class is safe to log server-side; the browser gets a stable code
    // only, never provider internals.
    console.error("saltedge connect failed:", e instanceof SaltEdgeError ? `${e.code}: ${e.message}` : e);
    return NextResponse.json({ error: "saltedge_error" }, { status: 502 });
  }
}
