// RevenueCat's webhook: what Apple holds for an account, recorded on the
// account's workspaces in gestion.billing_status (source 'apple'), so that
// app.morada.lu opens for a landlord who subscribed in the iPhone app and
// closes when that subscription stops. The app itself asks RevenueCat's SDK
// directly and does not wait for this.
//
// Set up once: in RevenueCat, Project settings, Integrations, Webhooks, the
// URL of this function and an Authorization header value of your choosing;
// the same value as the function secret REVENUECAT_WEBHOOK_AUTH. Without the
// secret every call is refused. Deployed with verify_jwt off: RevenueCat
// sends its own header, not a Supabase token.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_AUTH = Deno.env.get("REVENUECAT_WEBHOOK_AUTH") ?? "";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Status = "trialing" | "active" | "past_due" | "expired";

/** The status an event leaves the subscription in; null for events that change nothing here. */
export function statusOf(type: string, periodType: string): Status | null {
  switch (type) {
    case "INITIAL_PURCHASE":
    case "RENEWAL":
    case "UNCANCELLATION":
    case "PRODUCT_CHANGE":
    case "SUBSCRIPTION_EXTENDED":
    // Cancelled means "will not renew": it runs to the end of the period, and EXPIRATION closes it.
    case "CANCELLATION":
      return periodType === "TRIAL" ? "trialing" : "active";
    case "BILLING_ISSUE":
      return "past_due";
    case "EXPIRATION":
      return "expired";
    default:
      return null;
  }
}

const same = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!WEBHOOK_AUTH || !same(req.headers.get("Authorization") ?? "", WEBHOOK_AUTH)) return json({ error: "forbidden" }, 403);
  let event: Record<string, unknown>;
  try {
    event = ((await req.json()) as { event?: Record<string, unknown> }).event ?? {};
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  const status = statusOf(String(event.type ?? ""), String(event.period_type ?? ""));
  if (!status) return json({ ok: true, ignored: event.type ?? null });
  // The app logs RevenueCat in with the Supabase user id; an anonymous id belongs to nobody yet.
  const ids = [event.app_user_id, event.original_app_user_id, ...((event.aliases as unknown[]) ?? [])].map(String).filter((x) => UUID.test(x));
  const userId = ids[0];
  if (!userId) return json({ ok: true, ignored: "anonymous" });

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: members, error } = await db.from("crm_members").select("agency_id").eq("user_id", userId).eq("status", "active");
  if (error) return json({ error: "lookup_failed" }, 500);
  const orgs = [...new Set((members ?? []).map((m) => m.agency_id as string))];
  if (orgs.length === 0) return json({ ok: true, ignored: "no_workspace" });

  const end = Number(event.expiration_at_ms);
  const rows = orgs.map((org_id) => ({ org_id, source: "apple", status, current_period_end: Number.isFinite(end) && end > 0 ? new Date(end).toISOString() : null, product: event.product_id ? String(event.product_id) : null, updated_at: new Date().toISOString() }));
  const { error: writeError } = await db.schema("gestion").from("billing_status").upsert(rows, { onConflict: "org_id,source" });
  // A 500 makes RevenueCat retry the event later.
  if (writeError) return json({ error: "write_failed" }, 500);
  return json({ ok: true, orgs: orgs.length, status });
});
