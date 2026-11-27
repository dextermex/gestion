// Stripe's webhook: what Stripe holds for a workspace's web subscription,
// recorded in gestion.billing_status (source 'stripe'), so the iPhone app
// opens for a landlord who subscribed on app.morada.lu and closes when that
// subscription stops. The web's own gate reads the same row first and asks
// Stripe only when none runs (src/lib/billing/access.ts).
//
// Set up once: in Stripe, Developers, Webhooks, an endpoint at
//   https://<project-ref>.supabase.co/functions/v1/stripe
// listening to customer.subscription.created, customer.subscription.updated,
// customer.subscription.deleted and invoice.payment_failed; its signing
// secret (whsec_…) is the function secret STRIPE_WEBHOOK_SECRET. Without the
// secret every call is refused. Deployed with verify_jwt off: Stripe signs
// with its own header, not a Supabase token.
import { createClient } from "npm:@supabase/supabase-js@2";
import { rowFromEvent, verifySignature } from "./logic.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const payload = await req.text();
  const now = Math.floor(Date.now() / 1000);
  if (!WEBHOOK_SECRET || !(await verifySignature(payload, req.headers.get("Stripe-Signature"), WEBHOOK_SECRET, now))) return json({ error: "forbidden" }, 403);
  let event: Parameters<typeof rowFromEvent>[0];
  try {
    event = JSON.parse(payload);
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  const row = rowFromEvent(event);
  if (!row) return json({ ok: true, ignored: event.type ?? null });

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const table = db.schema("gestion").from("billing_status");
  // Stripe does not promise the order of its events: an older one never overwrites what a newer one wrote.
  const { data: held, error: readError } = await table.select("updated_at").eq("org_id", row.org_id).eq("source", "stripe").maybeSingle();
  if (readError) return json({ error: "read_failed" }, 500);
  if (held && Date.parse(String(held.updated_at)) > Date.parse(row.updated_at)) return json({ ok: true, ignored: "older" });
  const { error: writeError } = await table.upsert(row, { onConflict: "org_id,source" });
  // A 500 makes Stripe retry the event later (it retries for three days).
  if (writeError) return json({ error: "write_failed" }, 500);
  return json({ ok: true, status: row.status });
});
