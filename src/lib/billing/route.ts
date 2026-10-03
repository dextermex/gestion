import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { BILLED_UNIT_KINDS } from "@/domain/billing/plans";
import { withOrgAndClient, type OrgContext } from "@/lib/gestion/api";
import { getSession } from "@/lib/supabase/server";
import { getI18n } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n/config";
import type { Dict } from "@/lib/i18n/fr";
import { getDatasetId } from "@/lib/demo";
import type { SupabaseClient } from "@supabase/supabase-js";
import { stripeClient } from "./stripe";
import { canManageBilling, visitSnapshot } from "./view";
import type { BillingSnapshot } from "./service";

/**
 * The spine of the subscription routes: same origin, a session, the active
 * workspace, its owner or an admin, real data (never the sample cabinet),
 * subscriptions on, and the workspace's snapshot. Subscribing is itself a
 * read for the write lock: a workspace whose trial is over must still be
 * able to pay.
 */
export interface BillingRoute {
  ctx: OrgContext & { client: SupabaseClient };
  stripe: Stripe;
  snapshot: BillingSnapshot;
  locale: Locale;
  d: Dict;
  origin: string;
}

export async function billingRoute(req: NextRequest): Promise<BillingRoute | NextResponse> {
  if (req.method !== "GET" && req.headers.get("origin") !== req.nextUrl.origin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const ctx = await withOrgAndClient();
  if (ctx instanceof NextResponse) return ctx;
  if (!canManageBilling(ctx.org.role)) return NextResponse.json({ error: "not_manager" }, { status: 403 });
  if ((await getDatasetId()) !== "real") return NextResponse.json({ error: "sample_read_only" }, { status: 403 });
  const stripe = stripeClient();
  if (!stripe) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const session = await getSession();
  const { locale, d } = await getI18n();
  const snapshot = await visitSnapshot({ org: ctx.org, userId: ctx.userId, email: session?.email ?? "", locale, metadata: session?.metadata });
  if (!snapshot) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  return { ctx, stripe, snapshot, locale, d, origin: req.nextUrl.origin };
}

/** The lots a subscription counts and the workspace's active users, read under the caller's own rights. */
export async function portfolioCounts(ctx: OrgContext & { client: SupabaseClient }): Promise<{ lots: number; seats: number } | NextResponse> {
  const [units, members] = await Promise.all([
    ctx.g.from("units").select("id", { count: "exact", head: true }).eq("org_id", ctx.org.id).is("archived_at", null).in("kind", [...BILLED_UNIT_KINDS]),
    ctx.client.from("crm_members").select("user_id", { count: "exact", head: true }).eq("agency_id", ctx.org.id).eq("status", "active"),
  ]);
  if (units.error) {
    console.error("billing lot count failed:", units.error.code);
    return NextResponse.json({ error: "storage_failed" }, { status: 502 });
  }
  return { lots: units.count ?? 0, seats: Math.max(1, members.count ?? 1) };
}

/** A Stripe call that failed: logged by kind and code (never a payload), answered as unavailable. */
export function stripeFailure(context: string, error: unknown): NextResponse {
  const e = error as { type?: string; code?: string; statusCode?: number; message?: string };
  console.error(`billing ${context} failed:`, e?.type ?? "error", e?.code ?? "", e?.statusCode ?? "", (e?.message ?? "").slice(0, 200));
  return NextResponse.json({ error: "unavailable" }, { status: 502 });
}
