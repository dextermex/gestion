import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/supabase/server";
import { getIdentity } from "@/lib/workspace";
import { DATASET_COOKIE } from "@/lib/demo";
import { SaltEdgeError, createConnectSession, demoProviderCode, ensureCustomer, fakeProvidersWanted, saltEdgeConfigured } from "@/lib/banking/saltedge";

/**
 * Starts the bank-consent journey for the signed-in Morada account: one Salt
 * Edge customer per workspace, one fresh connect session per click. The
 * secrets live in the deployment environment; the browser only ever
 * receives the consent URL, and, when the provider refuses, the class of
 * its refusal (a stable code, never its message).
 *
 * On a sample cabinet the journey is the real one but opens on Salt Edge's
 * fake bank, for a demo customer of the signed-in account: nothing of it is
 * ever stored, the sample never writes.
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
  const dataset = req.cookies.get(DATASET_COOKIE)?.value;
  const sample = dataset === "fr" || dataset === "lu";

  try {
    if (sample) {
      const customerId = await ensureCustomer(`morada-demo-${session.userId}`);
      const returnTo = new URL("/app/banque?connexion=demo", req.nextUrl.origin).toString();
      const url = await createConnectSession(customerId, returnTo, locale, { includeFakeProviders: true, providerCode: demoProviderCode() });
      return NextResponse.json({ url, demo: true });
    }

    // Bank data belongs to the WORKSPACE, not the person: one Salt Edge
    // customer per organisation, so every member sees the same connections.
    const identity = await getIdentity();
    const org = identity?.active;
    if (!org) return NextResponse.json({ error: "no_workspace" }, { status: 403 });

    const customerId = await ensureCustomer(`morada-ws-${org.id}`);
    const returnTo = new URL("/app/banque?connexion=retour", req.nextUrl.origin).toString();
    const url = await createConnectSession(customerId, returnTo, locale, { includeFakeProviders: fakeProvidersWanted() });
    return NextResponse.json({ url });
  } catch (e) {
    // The class is safe to hand back: it names the refusal, never a person
    // or a secret. The message stays in the server log.
    if (e instanceof SaltEdgeError) {
      console.error("saltedge connect failed:", `${e.code}: ${e.message}`);
      return NextResponse.json({ error: "saltedge_error", code: e.code }, { status: 502 });
    }
    console.error("saltedge connect failed:", e);
    return NextResponse.json({ error: "saltedge_error", code: "network" }, { status: 502 });
  }
}
