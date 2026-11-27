import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { BILLED_UNIT_KINDS, billedRents } from "@/domain/billing/pricing";
import type { Cents } from "@/domain/money";
import { refuseCrossOrigin, withOrgAndClient, type OrgContext } from "@/lib/gestion/api";
import { RATE, refuseOverRate } from "@/lib/gestion/rate-limit";
import { getSession } from "@/lib/supabase/server";
import { getI18n } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n/config";
import type { Dict } from "@/lib/i18n/fr";
import { getDatasetId } from "@/lib/demo";
import type { SupabaseClient } from "@supabase/supabase-js";
import { stripeClient } from "./stripe";
import { canManageBilling } from "./view";
import { cachedSnapshot, within } from "./cache";
import type { BillingSnapshot } from "./service";

/**
 * The spine of the subscription routes: same origin, a session, the active
 * workspace, its owner or an admin, real data (never the sample cabinet),
 * subscriptions on, a counted number of calls, and the workspace's snapshot
 * (null while it has no Stripe customer: Checkout creates it). Subscribing is
 * not a write to the workspace: a locked workspace must still be able to pay.
 */
export interface BillingRoute {
  ctx: OrgContext & { client: SupabaseClient };
  stripe: Stripe;
  snapshot: BillingSnapshot | null;
  /** The signed-in member's address, for the customer Checkout creates. */
  email: string;
  locale: Locale;
  d: Dict;
  origin: string;
}

export async function billingRoute(req: NextRequest): Promise<BillingRoute | NextResponse> {
  const refused = refuseCrossOrigin(req);
  if (refused) return refused;
  const ctx = await withOrgAndClient("act");
  if (ctx instanceof NextResponse) return ctx;
  if (!canManageBilling(ctx.org.role)) return NextResponse.json({ error: "not_manager" }, { status: 403 });
  if ((await getDatasetId()) !== "real") return NextResponse.json({ error: "sample_read_only" }, { status: 403 });
  const stripe = stripeClient();
  if (!stripe) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  // Every one of these routes opens a session or changes something at Stripe: counted per person and per workspace.
  const limited = await refuseOverRate(ctx.g, RATE.billingSession, ctx.org.id);
  if (limited) return limited;
  const session = await getSession();
  const { locale, d } = await getI18n();
  const email = session?.email ?? "";
  let snapshot: BillingSnapshot | null;
  try {
    snapshot = await within(cachedSnapshot(ctx.org.id, email), 5000);
  } catch (error) {
    return stripeFailure("read", error);
  }
  return { ctx, stripe, snapshot, email, locale, d, origin: req.nextUrl.origin };
}

/**
 * The rents of the lots a subscription bills, read under the caller's own
 * rights: the workspace's live dwellings, shops and offices, and the
 * running leases on them. A read that fails refuses the action rather than
 * pricing a portfolio short.
 */
export async function portfolioRents(ctx: OrgContext): Promise<{ rents: Cents[] } | NextResponse> {
  const [units, leases] = await Promise.all([
    ctx.g.from("units").select("id,kind").eq("org_id", ctx.org.id).is("archived_at", null).in("kind", [...BILLED_UNIT_KINDS]).limit(5000),
    ctx.g.from("leases").select("unit_id,status,rent_cents").eq("org_id", ctx.org.id).in("status", ["active", "notice"]).limit(5000),
  ]);
  if (units.error || leases.error) {
    console.error("billing portfolio read failed:", units.error?.code ?? leases.error?.code);
    return NextResponse.json({ error: "storage_failed" }, { status: 502 });
  }
  const rows = (data: unknown) => (Array.isArray(data) ? (data as Record<string, unknown>[]) : []);
  return {
    rents: billedRents(
      rows(units.data).map((u) => ({ id: String(u.id), kind: String(u.kind) })),
      rows(leases.data).map((l) => ({ unitId: String(l.unit_id), status: String(l.status), rentCents: Number(l.rent_cents) })),
    ),
  };
}

/** A Stripe call that failed: logged by kind and code (never a payload), answered as unavailable. */
export function stripeFailure(context: string, error: unknown): NextResponse {
  const e = error as { type?: string; code?: string; statusCode?: number; message?: string };
  console.error(`billing ${context} failed:`, e?.type ?? "error", e?.code ?? "", e?.statusCode ?? "", (e?.message ?? "").slice(0, 200));
  return NextResponse.json({ error: "unavailable" }, { status: 502 });
}
