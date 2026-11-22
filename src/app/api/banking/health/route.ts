import { NextRequest, NextResponse } from "next/server";
import { withOrg } from "@/lib/gestion/api";
import { demoProviderCode, fakeProvidersWanted, returnToFor, saltEdgeConfigured, saltEdgeProbe } from "@/lib/banking/saltedge";

/**
 * Health of the bank connection. The public answer is only liveness
 * ({ ok: true }); the deployment X-ray (commit, environment, which Salt Edge
 * variables reached the runtime) and the live provider probe are shown only
 * to a signed-in owner/admin of a workspace. An anonymous caller learns
 * nothing and triggers no upstream call: the endpoint is neither a recon
 * surface nor a reflected amplifier against the operator's Salt Edge quota.
 */
export async function GET(req: NextRequest) {
  const headers = { "Cache-Control": "no-store" } as const;
  const ctx = await withOrg();
  const admin = !(ctx instanceof NextResponse) && (ctx.org.role === "owner" || ctx.org.role === "admin");
  if (!admin) {
    return NextResponse.json({ ok: true }, { headers });
  }
  return NextResponse.json(
    {
      ok: true,
      deployedCommit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      deployedAt: process.env.VERCEL_DEPLOYMENT_ID ?? null,
      vercelEnv: process.env.VERCEL_ENV ?? null,
      saltedgeAppIdPresent: Boolean(process.env.SALTEDGE_APP_ID),
      saltedgeSecretPresent: Boolean(process.env.SALTEDGE_SECRET),
      saltVariableNamesSeen: Object.keys(process.env).filter((k) => k.toUpperCase().includes("SALT")),
      fakeProviders: fakeProvidersWanted(),
      demoProvider: demoProviderCode(),
      returnTo: returnToFor(req.nextUrl.origin),
      saltedge: saltEdgeConfigured() ? await saltEdgeProbe() : { ok: false, code: "not_configured" },
    },
    { headers },
  );
}
