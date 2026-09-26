import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/supabase/server";
import { getIdentity } from "@/lib/workspace";
import { DATASET_COOKIE } from "@/lib/demo";
import { SaltEdgeError, createConnectSession, demoProviderCode, fakeProvidersWanted, registerCustomer, returnToFor, saltEdgeConfigured } from "@/lib/banking/saltedge";

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
  // One return address for both journeys, on this deployment's own origin:
  // the page behind it tells a demonstration from a real return by the
  // dataset cookie. Salt Edge only sends the visitor back to an address
  // listed on the app, so this exact URL must be in that list.
  const returnTo = returnToFor(req.nextUrl.origin);

  try {
    if (sample) {
      const identifier = `morada-demo-${session.userId}`;
      await registerCustomer(identifier);
      const url = await createConnectSession(identifier, returnTo, locale, { includeFakeProviders: true, providerCode: demoProviderCode() });
      return NextResponse.json({ url, demo: true });
    }

    // Bank data belongs to the WORKSPACE, not the person: one Salt Edge
    // customer per organisation, so every member sees the same connections.
    const identity = await getIdentity();
    const org = identity?.active;
    if (!org) return NextResponse.json({ error: "no_workspace" }, { status: 403 });

    const identifier = `morada-ws-${org.id}`;
    await registerCustomer(identifier);
    const url = await createConnectSession(identifier, returnTo, locale, { includeFakeProviders: fakeProvidersWanted() });
    return NextResponse.json({ url });
  } catch (e) {
    // The class is safe to hand back: it names the refusal, never a person
    // or a secret. The message stays in the server log.
    if (e instanceof SaltEdgeError) {
      console.error("saltedge connect failed:", `${e.code}: ${e.message}`);
      const body: Record<string, string> = { error: "saltedge_error", code: e.code };
      // A refusal of the request's shape names fields, never a person or a
      // secret: it goes back too, with the return address the provider must
      // know, so the screen can say which field and which address.
      if (e.code === "WrongRequestFormat") {
        body.detail = e.message;
        body.returnTo = returnTo;
      }
      return NextResponse.json(body, { status: 502 });
    }
    console.error("saltedge connect failed:", e);
    return NextResponse.json({ error: "saltedge_error", code: "network" }, { status: 502 });
  }
}
