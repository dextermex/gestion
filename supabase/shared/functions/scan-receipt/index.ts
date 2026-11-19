import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";

/**
 * The receipt scanner: one photo in, the bill's fields out. The app sends
 * the picture (JPEG, base64, already downsized) with the person's JWT; the
 * function checks the person may edit the organisation's finances, asks
 * Claude to read the document with a JSON schema (structured outputs, so
 * the answer always parses), and returns the fields the bill form expects.
 * Nothing is written here: the app shows the fields, the person confirms,
 * the app writes gestion.bills under their own token.
 *
 * Secrets: ANTHROPIC_API_KEY (required), SCAN_MODEL (optional, default
 * claude-opus-5-5). Server-side refusal fallback is on ("default"), so a
 * classifier decline is retried on the recommended model in the same call.
 * `{mode:"health"}` with the vault's notify secret checks the key, the model
 * and the schema with a tiny text request; it never needs a user.
 */
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
// The anon key: the legacy JWT when the project still has it, else the publishable key the app sends.
const PUBLISHABLE = "sb_publishable_op56tIbcBkl6dOI7ZHdO7w_YzW4TAm3";
const API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL = Deno.env.get("SCAN_MODEL") || "claude-opus-5-5";

const CATEGORIES = ["maintenance_repairs", "permanent_charges", "insurance", "management_fees", "impot_foncier", "debt_interest", "other_frais"] as const;
const nullable = (type: string) => ({ anyOf: [{ type }, { type: "null" }] });
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["direction", "supplier_name", "supplier_id", "subject", "doc_no", "doc_date", "due_on", "amount_cents", "vat_cents", "vat_rate_pct", "category", "unit_id", "paid", "confidence"],
  properties: {
    direction: { type: "string", enum: ["expense", "income"] },
    supplier_name: { type: "string", description: "The issuer as printed." },
    supplier_id: { ...nullable("string"), description: "One of the known supplier ids when the issuer clearly matches, else null." },
    subject: { type: "string", description: "One short line: what was bought or done." },
    doc_no: { type: "string", description: "Invoice or receipt number, empty when none." },
    doc_date: { ...nullable("string"), description: "YYYY-MM-DD." },
    due_on: { ...nullable("string"), description: "YYYY-MM-DD." },
    amount_cents: { type: "integer", description: "Total including VAT, in cents." },
    vat_cents: { type: "integer", description: "VAT amount in cents, 0 when none is shown." },
    vat_rate_pct: { type: "integer", enum: [0, 3, 8, 14, 17] },
    category: { type: "string", enum: [...CATEGORIES] },
    unit_id: { ...nullable("string"), description: "One of the known lot ids when the document names the address or lot, else null." },
    paid: { type: "boolean", description: "True when the document itself shows it was paid (receipt, card slip, 'payé')." },
    confidence: { type: "number", description: "0 to 1: confidence in the amount and the date." },
  },
} as const;

const INSTRUCTIONS = `You read invoices, receipts and bills for a Luxembourg landlord's books and fill the bill form.
Amounts are in euro cents (integers). Use the Luxembourg VAT rate that fits: 17 when VAT is shown and the rate is unclear, 0 when exempt or no VAT.
Category guide: repairs, plumbing, electrics, painting, artisans: maintenance_repairs. Water, heating, electricity of common parts, syndic charges, lift, cleaning: permanent_charges. Insurance premiums: insurance. Agency or management fees: management_fees. Impôt foncier or communal property tax: impot_foncier. Loan interest: debt_interest. Anything else: other_frais.
Only use a supplier_id or unit_id from the lists given; otherwise null.`;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Reading = Record<string, unknown>;

async function read(content: Anthropic.Beta.BetaContentBlockParam[]): Promise<{ ok: true; reading: Reading; model: string } | { ok: false; status: number; error: string }> {
  const client = new Anthropic({ apiKey: API_KEY });
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      // Server-side fallback: a classifier decline is retried on the recommended model.
      ...({ fallbacks: "default" } as Record<string, unknown>),
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system: INSTRUCTIONS,
      messages: [{ role: "user", content }],
    } as Anthropic.Beta.MessageCreateParamsNonStreaming);
    if (response.stop_reason === "refusal") return { ok: false, status: 422, error: "refused" };
    const text = response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("");
    return { ok: true, reading: JSON.parse(text) as Reading, model: response.model };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { ok: false, status: 503, error: "bad_key" };
    if (e instanceof Anthropic.PermissionDeniedError) return { ok: false, status: 503, error: "forbidden_key" };
    if (e instanceof Anthropic.NotFoundError) return { ok: false, status: 503, error: "model_not_found" };
    if (e instanceof Anthropic.BadRequestError) return { ok: false, status: 502, error: `bad_request: ${e.message}`.slice(0, 300) };
    if (e instanceof Anthropic.RateLimitError) return { ok: false, status: 429, error: "rate_limited" };
    if (e instanceof Anthropic.APIError) return { ok: false, status: 502, error: `api_${e.status}` };
    if (e instanceof SyntaxError) return { ok: false, status: 422, error: "unreadable" };
    return { ok: false, status: 502, error: "network" };
  }
}

function clean(parsed: Reading, suppliers: { id: string }[], units: { id: string }[]) {
  const asInt = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0);
  const asDate = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const vat = Number(parsed.vat_rate_pct);
  return {
    direction: parsed.direction === "income" ? "income" : "expense",
    supplier_name: String(parsed.supplier_name ?? ""),
    supplier_id: typeof parsed.supplier_id === "string" && suppliers.some((s) => s.id === parsed.supplier_id) ? parsed.supplier_id : null,
    subject: String(parsed.subject ?? "").slice(0, 140),
    doc_no: String(parsed.doc_no ?? "").slice(0, 60),
    doc_date: asDate(parsed.doc_date),
    due_on: asDate(parsed.due_on),
    amount_cents: Math.max(0, asInt(parsed.amount_cents)),
    vat_cents: Math.max(0, asInt(parsed.vat_cents)),
    vat_rate_pct: [0, 3, 8, 14, 17].includes(vat) ? vat : 17,
    category: (CATEGORIES as readonly string[]).includes(String(parsed.category)) ? parsed.category : "other_frais",
    unit_id: typeof parsed.unit_id === "string" && units.some((u) => u.id === parsed.unit_id) ? parsed.unit_id : null,
    paid: parsed.paid === true,
    confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let body: { mode?: string; org_id?: string; image?: string; mime?: string; suppliers?: { id: string; name: string }[]; units?: { id: string; label: string }[] };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_json" }, 400);
  }

  // Health: secret-gated, no user, one tiny text extraction through the same schema.
  if (body.mode === "health") {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { db: { schema: "gestion" }, auth: { persistSession: false } });
    const { data: secret } = await admin.rpc("notify_secret");
    if (!secret || req.headers.get("x-notify-secret") !== secret) return json({ error: "forbidden" }, 403);
    if (!API_KEY) return json({ ok: false, key: false });
    const r = await read([{ type: "text", text: "Document text: 'Krier Chauffage Sàrl · Facture F-2041 · 12/09/2026 · Remplacement circulateur · Total TTC 1 240,00 EUR dont TVA 17 % 180,17 EUR'. Known suppliers: (none). Known lots: (none)." }]);
    return json({ ok: r.ok, key: true, model: MODEL, ...(r.ok ? { served_by: r.model, reading: r.reading } : { error: r.error }), anon_env: Boolean(Deno.env.get("SUPABASE_ANON_KEY")) });
  }

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "unauthenticated" }, 401);
  const anon = Deno.env.get("SUPABASE_ANON_KEY") || req.headers.get("apikey") || PUBLISHABLE;
  const g = createClient(SUPABASE_URL, anon, { db: { schema: "gestion" }, global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data: me } = await g.auth.getUser(token);
  if (!me.user) return json({ error: "unauthenticated" }, 401);
  if (!body.org_id) return json({ error: "no_workspace" }, 400);
  const { data: can } = await g.rpc("can", { p_org: body.org_id, p_perm: "gestion.finance.edit" });
  if (!can) return json({ error: "forbidden" }, 403);
  if (!API_KEY) return json({ error: "not_configured" }, 503);
  if (!body.image || body.image.length > 6_000_000) return json({ error: "bad_image" }, 400);

  const suppliers = (body.suppliers ?? []).slice(0, 200);
  const units = (body.units ?? []).slice(0, 300);
  const hints = `Known suppliers:\n${suppliers.map((s) => `${s.id} = ${s.name}`).join("\n") || "(none)"}\nKnown lots:\n${units.map((u) => `${u.id} = ${u.label}`).join("\n") || "(none)"}`;
  const r = await read([
    { type: "image", source: { type: "base64", media_type: body.mime === "image/png" ? "image/png" : "image/jpeg", data: body.image } },
    { type: "text", text: `Read this document and fill the bill form.\n${hints}` },
  ]);
  if (!r.ok) {
    console.error("scan failed", r.error);
    return json({ error: r.error }, r.status);
  }
  return json(clean(r.reading, suppliers, units));
});
