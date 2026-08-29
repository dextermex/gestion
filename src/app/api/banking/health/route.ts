import { NextResponse } from "next/server";
import { saltEdgeConfigured, saltEdgeProbe } from "@/lib/banking/saltedge";

/**
 * Deployment X-ray for the bank connection: which commit is live, and whether
 * the two Salt Edge variables reached the runtime. Booleans and variable
 * NAMES only — no value ever leaves the server, so this can stay public.
 */
export async function GET() {
  return NextResponse.json(
    {
      deployedCommit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      deployedAt: process.env.VERCEL_DEPLOYMENT_ID ?? null,
      vercelEnv: process.env.VERCEL_ENV ?? null,
      saltedgeAppIdPresent: Boolean(process.env.SALTEDGE_APP_ID),
      saltedgeSecretPresent: Boolean(process.env.SALTEDGE_SECRET),
      // Catches typos like SALT_EDGE_APP_ID or a stray suffix: names only.
      saltVariableNamesSeen: Object.keys(process.env).filter((k) => k.toUpperCase().includes("SALT")),
      // The provider's own verdict on the deployed credentials.
      saltedge: saltEdgeConfigured() ? await saltEdgeProbe() : { ok: false, code: "not_configured" },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
