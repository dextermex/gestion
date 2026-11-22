import { NextRequest, NextResponse } from "next/server";
import { can, withOrg } from "@/lib/gestion/api";
import { RATE, refuseOverRate } from "@/lib/gestion/rate-limit";
import { fakeProvidersWanted, returnToFor, saltEdgeConfigured, saltEdgeProbe } from "@/lib/banking/saltedge";

/**
 * Health of the bank connection. The public answer is only liveness
 * ({ ok: true }): an anonymous caller, or a member who may not connect a
 * bank, learns nothing about the deployment and triggers no call to the
 * provider. A signed-in member who may edit the workspace's finances gets
 * the diagnosis: whether the two Salt Edge variables reached the runtime
 * (never their values, never the names of other variables), which build
 * answers, the return address the provider must know, and the provider's
 * own verdict on the deployed credentials. Each diagnosis asks the provider
 * once, so it is counted.
 */
export async function GET(req: NextRequest) {
  const headers = { "Cache-Control": "no-store" } as const;
  const ctx = await withOrg();
  if (ctx instanceof NextResponse || !(await can(ctx, "gestion.finance.edit"))) {
    return NextResponse.json({ ok: true }, { headers });
  }
  const limited = await refuseOverRate(ctx.g, RATE.bankProbe, ctx.org.id);
  if (limited) return limited;
  return NextResponse.json(
    {
      ok: true,
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
    { headers },
  );
}
