import { NextResponse } from "next/server";
import { withOrg } from "@/lib/gestion/api";
import { getSession } from "@/lib/supabase/server";
import { accessFor } from "@/lib/billing/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Whether the signed-in account's active workspace may enter, for the
 * sign-up and the guided entry: `{ configured, access, reason, trialOffered }`.
 * A deployment without a Stripe key always answers open, so no payment step
 * shows there. Read only: nothing is created at Stripe by asking.
 */
export async function GET() {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const answer = await accessFor(ctx.org, await getSession());
  return NextResponse.json(
    { configured: answer.configured, access: answer.access, reason: answer.reason, trialOffered: answer.trialOffered },
    { headers: { "Cache-Control": "no-store" } },
  );
}
