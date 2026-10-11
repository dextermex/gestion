import { NextRequest, NextResponse } from "next/server";
import { demoProviderCode, fakeProvidersWanted, returnToFor, saltEdgeConfigured, saltEdgeProbe } from "@/lib/banking/saltedge";
import { hasPerm } from "@/lib/gestion/api";
import { authedClient, getSession } from "@/lib/supabase/server";
import { getIdentity } from "@/lib/workspace";

/**
 * Deployment X-ray for the bank connection: which commit is live, and whether
 * the two Salt Edge variables reached the runtime. Booleans and variable
 * NAMES only, never a value. Anyone may read which commit is deployed; the
 * rest (the environment's variable names, the journey's options, the return
 * address and the provider's verdict, which costs a call to Salt Edge) is
 * for a signed-in member who may see the workspace's finances.
 */
export async function GET(req: NextRequest) {
  const headers = { "Cache-Control": "no-store" };
  const deployedCommit = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null;

  const session = await getSession();
  const org = session ? (await getIdentity())?.active : null;
  const allowed = session && org ? await hasPerm(authedClient(session.accessToken).schema("gestion"), org.id, "gestion.finance.view") : false;
  if (!allowed) return NextResponse.json({ deployedCommit, detail: "sign_in_required" }, { headers });

  return NextResponse.json(
    {
      deployedCommit,
      deployedAt: process.env.VERCEL_DEPLOYMENT_ID ?? null,
      vercelEnv: process.env.VERCEL_ENV ?? null,
      saltedgeAppIdPresent: Boolean(process.env.SALTEDGE_APP_ID),
      saltedgeSecretPresent: Boolean(process.env.SALTEDGE_SECRET),
      // Catches typos like SALT_EDGE_APP_ID or a stray suffix: names only.
      saltVariableNamesSeen: Object.keys(process.env).filter((k) => k.toUpperCase().includes("SALT")),
      // The journey's options: fake banks listed for a test-status app, and the sample cabinet's bank.
      fakeProviders: fakeProvidersWanted(),
      demoProvider: demoProviderCode(),
      // The return address this deployment gives Salt Edge: it must be listed
      // among the app's allowed return URIs in the Salt Edge dashboard.
      returnTo: returnToFor(req.nextUrl.origin),
      // The provider's own verdict on the deployed credentials.
      saltedge: saltEdgeConfigured() ? await saltEdgeProbe() : { ok: false, code: "not_configured" },
    },
    { headers },
  );
}
