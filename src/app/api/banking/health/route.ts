import { NextRequest, NextResponse } from "next/server";
import { refuseWithout, withOrg } from "@/lib/gestion/api";
import { RATE, refuseOverRate } from "@/lib/gestion/rate-limit";
import { fakeProvidersWanted, returnToFor, saltEdgeConfigured, saltEdgeProbe } from "@/lib/banking/saltedge";

/**
 * The bank connection's diagnosis, for the people who can connect a bank:
 * a signed-in member of a workspace who may edit its finances. It says
 * whether the two Salt Edge variables reached the runtime (never their
 * values, never the names of other variables), which build answers, the
 * return address the provider must know, and the provider's own verdict on
 * the deployed credentials. Each call asks the provider once, so it is
 * counted. Anybody else gets a refusal and nothing about the deployment.
 */
export async function GET(req: NextRequest) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const refused = await refuseWithout(ctx, "gestion.finance.edit");
  if (refused) return refused;
  const limited = await refuseOverRate(ctx.g, RATE.bankProbe, ctx.org.id);
  if (limited) return limited;
  return NextResponse.json(
    {
      deployedCommit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      vercelEnv: process.env.VERCEL_ENV ?? null,
      saltedgeAppIdPresent: Boolean(process.env.SALTEDGE_APP_ID),
      saltedgeSecretPresent: Boolean(process.env.SALTEDGE_SECRET),
      // Fake banks listed in the journey: only a test-status app needs them.
      fakeProviders: fakeProvidersWanted(),
      // The return address this deployment gives Salt Edge: it must be listed
      // among the app's allowed return URIs in the Salt Edge dashboard.
      returnTo: returnToFor(req.nextUrl.origin),
      // The provider's own verdict on the deployed credentials.
      saltedge: saltEdgeConfigured() ? await saltEdgeProbe() : { ok: false, code: "not_configured" },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
