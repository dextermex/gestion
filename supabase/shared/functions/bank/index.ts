import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { DEFAULT_MATCH_CONFIG, allocateFifo, matchTransaction, type BankTransaction, type IbanBinding, type OpenInvoice } from "./matching.ts";

/**
 * The bank connection for the app, the same journey as app.morada.lu's
 * /api/banking routes, moved to an Edge Function so the phone never holds
 * a Salt Edge secret:
 *
 *   POST {action:"connect"}  with the person's JWT: one Salt Edge customer
 *        per workspace, one fresh consent session; returns its URL. The
 *        app opens it in an authentication session and waits for the
 *        return.
 *   GET  ?action=return      where Salt Edge sends the person back: a
 *        redirect into the app on morada://bank/return. This exact URL
 *        must be listed on the Salt Edge app (Settings, Return URLs).
 *   POST {action:"sync"}     with the person's JWT: imports connections,
 *        accounts and transactions through the person's OWN token (RLS
 *        decides, no service role), runs the matching engine, then tells
 *        the notify function what landed.
 *   POST {action:"status"}   whether the provider is configured here.
 *
 * Secrets: SALTEDGE_APP_ID and SALTEDGE_SECRET as Edge Function secrets
 * (the same values the web deployment holds). Without them the function
 * answers 503 not_configured and the app falls back to the web page.
 */
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const PUBLISHABLE = "sb_publishable_op56tIbcBkl6dOI7ZHdO7w_YzW4TAm3";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SE_BASE = "https://www.saltedge.com/api/v6";
const APP_ID = Deno.env.get("SALTEDGE_APP_ID") ?? "";
const SECRET = Deno.env.get("SALTEDGE_SECRET") ?? "";
const FAKE = (Deno.env.get("SALTEDGE_FAKE_PROVIDERS") ?? "").toLowerCase() === "true";
const APP_SCHEME = "morada://bank/return";

type Json = Record<string, unknown>;
type Row = Record<string, any>;

class SaltEdgeError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

async function se<T>(path: string, init?: { method?: string; body?: Json }): Promise<T> {
  const res = await fetch(`${SE_BASE}${path}`, {
    method: init?.method ?? "GET",
    headers: { Accept: "application/json", "Content-Type": "application/json", "App-id": APP_ID, Secret: SECRET },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const parsed = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok) {
    const err = (parsed.error ?? {}) as { class?: string; message?: string };
    throw new SaltEdgeError(err.class ?? (parsed.error_class as string | undefined) ?? `http_${res.status}`, err.message ?? (parsed.error_message as string | undefined) ?? res.statusText);
  }
  return parsed as unknown as T;
}

async function listAll<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  let nextId: string | null | undefined = undefined;
  for (let i = 0; i < 50; i++) {
    const sep = path.includes("?") ? "&" : "?";
    const page = await se<{ data: T[]; meta?: { next_id?: string | null } }>(`${path}${nextId ? `${sep}from_id=${encodeURIComponent(nextId)}` : ""}`);
    out.push(...(page.data ?? []));
    nextId = page.meta?.next_id ?? null;
    if (!nextId) break;
  }
  return out;
}

type CustomerShape = { id?: unknown; customer_id?: unknown; identifier?: unknown };
/** The customer's Salt Edge id, whichever field carries it (v6 says customer_id, v5 said id). */
const customerIdOf = (c: CustomerShape | undefined): string | null => {
  const v = c?.customer_id ?? c?.id;
  return typeof v === "string" && v ? v : typeof v === "number" ? String(v) : null;
};

/** Create the customer, or find it again when it already exists, and return its Salt Edge id. */
async function ensureCustomer(identifier: string): Promise<string> {
  try {
    const created = await se<{ data: CustomerShape }>("/customers", { method: "POST", body: { data: { identifier } } });
    const id = customerIdOf(created.data);
    if (id) return id;
    throw new SaltEdgeError("CustomerIdMissing", "customer answered without an id");
  } catch (e) {
    if (!(e instanceof SaltEdgeError) || e.code !== "DuplicatedCustomer") throw e;
  }
  const list = await listAll<CustomerShape>("/customers");
  const hit = list.find((c) => c.identifier === identifier);
  const id = hit ? customerIdOf(hit) : null;
  if (!id) throw new SaltEdgeError("CustomerNotFound", "customer exists but was not listed");
  return id;
}

interface SeConnection { id: string; provider_name?: string; status?: string }
interface SeAccount { id: string; name: string; balance: number; currency_code: string; extra?: { iban?: string; bban?: string; account_name?: string; client_name?: string } }
interface SeTransaction { id: string; made_on: string; amount: number; currency_code: string; description?: string; extra?: { payer?: string; payee?: string; payer_iban?: string; end_to_end_id?: string } }

const toCents = (amount: number) => Math.round(amount * 100);

/**
 * v6: session creation under /connections/connect, the customer by
 * identifier, what concerns the provider under a `provider` object (flat
 * keys are refused as WrongRequestFormat). Mirrors the web's call exactly.
 */
async function connectSession(customerIdentifier: string, returnTo: string, locale: string): Promise<string> {
  const data: Json = { customer_identifier: customerIdentifier, consent: { scopes: ["accounts", "transactions"] }, attempt: { return_to: returnTo, locale } };
  if (FAKE) data.provider = { include_fake_providers: true };
  const created = await se<{ data: { connect_url: string } }>("/connections/connect", { method: "POST", body: { data } });
  return created.data.connect_url;
}

/**
 * The consent session, returning to the function (which bounces into the
 * app) when Salt Edge allows that address, else to the web's own return
 * page, which every Morada deployment already lists. On the web page the
 * person taps Done and the app syncs on its own.
 */
const WEB_RETURN = "https://app.morada.lu/app/banque/retour";
const returnRefused = (e: unknown) => e instanceof SaltEdgeError && (/return_to|return url/i.test(e.message) || e.code === "InvalidAttemptReturnTo" || e.code === "ReturnUrlInvalid");

async function connectWithFallback(identifier: string, locale: string): Promise<{ url: string; returnTo: string; fallback: boolean }> {
  const own = `${SUPABASE_URL}/functions/v1/bank?action=return`;
  try {
    return { url: await connectSession(identifier, own, locale), returnTo: own, fallback: false };
  } catch (e) {
    if (!returnRefused(e)) throw e;
    return { url: await connectSession(identifier, WEB_RETURN, locale), returnTo: WEB_RETURN, fallback: true };
  }
}

// ─── Sync, under the person's own token ─────────────────────────────────────

async function reconcile(g: SupabaseClient, orgId: string): Promise<{ auto: number; review: number; ignored: number }> {
  const out = { auto: 0, review: 0, ignored: 0 };
  const { data: txRows } = await g.from("bank_transactions").select("id,booked_on,amount_cents,counterparty_name,counterparty_iban,remittance_info,end_to_end_id").eq("org_id", orgId).eq("match_status", "unmatched").order("booked_on").limit(500);
  if (!txRows?.length) return out;
  const [{ data: openRows }, { data: leases }, { data: parties }, { data: contacts }, { data: units }, { data: properties }, { data: bindings }] = await Promise.all([
    g.from("rent_period_status").select("id,lease_id,due_date,total_cents,allocated_cents,status").eq("org_id", orgId),
    g.from("leases").select("id,unit_id,rf_reference,previous_rent_cents").eq("org_id", orgId),
    g.from("lease_parties").select("lease_id,contact_id,role").eq("org_id", orgId),
    g.from("contacts").select("id,display_name,first_name,last_name,legal_name,iban").eq("org_id", orgId),
    g.from("units").select("id,property_id,label").eq("org_id", orgId),
    g.from("properties").select("id,name").eq("org_id", orgId),
    g.from("iban_bindings").select("payer_iban,lease_id").eq("org_id", orgId),
  ]);
  const byId = (rows: Row[] | null) => new Map((rows ?? []).map((r) => [String(r.id), r]));
  const C = byId(contacts), U = byId(units), P = byId(properties), L = byId(leases);
  const nameOf = (c?: Row) => String(c?.display_name ?? "") || String(c?.legal_name ?? "") || [c?.first_name, c?.last_name].filter(Boolean).join(" ");
  const tenantsByLease = new Map<string, string[]>();
  const ibansByLease = new Map<string, Set<string>>();
  for (const p of parties ?? []) {
    if (p.role !== "tenant") continue;
    const c = C.get(String(p.contact_id));
    tenantsByLease.set(String(p.lease_id), [...(tenantsByLease.get(String(p.lease_id)) ?? []), nameOf(c)]);
    const iban = String(c?.iban ?? "").replace(/\s/g, "");
    if (iban) ibansByLease.set(String(p.lease_id), new Set([...(ibansByLease.get(String(p.lease_id)) ?? []), iban]));
  }
  const unitLabelOfLease = (leaseId: string) => {
    const l = L.get(leaseId);
    const u = l ? U.get(String(l.unit_id)) : undefined;
    const p = u ? P.get(String(u.property_id)) : undefined;
    return u ? `${u.label}${p ? ` · ${p.name}` : ""}` : "";
  };
  let live: OpenInvoice[] = (openRows ?? []).filter((rp: Row) => rp.status !== "written_off" && rp.allocated_cents < rp.total_cents).map((rp: Row) => {
    const l = L.get(String(rp.lease_id));
    return { id: rp.id, leaseId: rp.lease_id, tenantNames: tenantsByLease.get(rp.lease_id) ?? [], rfReference: String(l?.rf_reference ?? ""), dueDate: rp.due_date, totalAmount: rp.total_cents, openAmount: rp.total_cents - rp.allocated_cents, previousRentAmount: typeof l?.previous_rent_cents === "number" ? l.previous_rent_cents : null, unitLabel: unitLabelOfLease(rp.lease_id) };
  });
  const ibanBindings: IbanBinding[] = (bindings ?? []).map((b: Row) => ({ payerIban: String(b.payer_iban), leaseId: String(b.lease_id) }));

  for (const row of txRows as Row[]) {
    const btx: BankTransaction = { id: row.id, bookedAt: row.booked_on, amount: Number(row.amount_cents), counterpartyName: String(row.counterparty_name ?? ""), counterpartyIban: row.counterparty_iban ?? null, remittanceInfo: String(row.remittance_info ?? ""), endToEndId: row.end_to_end_id ?? null };
    const decision = matchTransaction(btx, live, ibanBindings, ibansByLease, DEFAULT_MATCH_CONFIG);
    if (decision.kind === "auto") {
      const targets = live.filter((i) => decision.invoiceIds.includes(i.id));
      const allocations = allocateFifo(btx.amount, targets);
      if (allocations.length > 0) {
        const { data: payment, error: payErr } = await g.from("payments").insert({ org_id: orgId, lease_id: targets[0].leaseId, bank_transaction_id: btx.id, received_on: btx.bookedAt, amount_cents: btx.amount, method: "transfer" }).select("id").single();
        if (payErr || !payment) { console.error("payment insert failed", payErr?.code, payErr?.message); continue; }
        const { error: allocErr } = await g.from("payment_allocations").insert(allocations.map((a) => ({ org_id: orgId, payment_id: payment.id, rent_period_id: a.invoiceId, amount_cents: a.amount, auto: true })));
        if (allocErr) { console.error("allocation insert failed", allocErr.code, allocErr.message); continue; }
        const spent = new Map(allocations.map((a) => [a.invoiceId, a.amount]));
        live = live.map((i) => ({ ...i, openAmount: i.openAmount - (spent.get(i.id) ?? 0) })).filter((i) => i.openAmount > 0);
      }
      const explain = decision.tier === "rf" ? `RF ${targets[0]?.rfReference ?? ""}` : decision.tier === "iban_binding" ? `IBAN → ${targets[0]?.unitLabel ?? ""}` : `${decision.tier} · ${Math.round(decision.confidence * 100)} %`;
      await g.from("bank_transactions").update({ match_status: "auto", match_tier: decision.tier, match_confidence: decision.confidence, match_explain: decision.indexationLag ? `${explain} · Δ ${decision.indexationLag.shortfall}` : explain }).eq("org_id", orgId).eq("id", btx.id);
      out.auto += 1;
    } else if (decision.kind === "review") {
      await g.from("bank_transactions").update({ match_status: "review", match_explain: decision.reason }).eq("org_id", orgId).eq("id", btx.id);
      out.review += 1;
    } else {
      await g.from("bank_transactions").update({ match_status: "ignored", match_explain: decision.reason }).eq("org_id", orgId).eq("id", btx.id);
      out.ignored += 1;
    }
  }
  return out;
}

async function sync(g: SupabaseClient, orgId: string) {
  const customerId = await ensureCustomer(`morada-ws-${orgId}`);
  const connections = await listAll<SeConnection>(`/connections?customer_id=${customerId}`);
  const nowIso = new Date().toISOString();
  let accountCount = 0;
  let txCount = 0;
  for (const conn of connections) {
    const accounts = await listAll<SeAccount>(`/accounts?connection_id=${conn.id}`);
    for (const a of accounts) {
      const { data: acct, error: acctErr } = await g
        .from("bank_accounts")
        .upsert({ org_id: orgId, label: a.extra?.account_name || a.name || "Compte", iban: a.extra?.iban ?? a.extra?.bban ?? "", holder_name_verbatim: a.extra?.client_name ?? "", kind: "operating", provider: "salt_edge", provider_connection_id: conn.id, provider_account_id: a.id, balance_cents: toCents(a.balance), last_synced_at: nowIso }, { onConflict: "org_id,provider,provider_account_id" })
        .select("id")
        .single();
      if (acctErr || !acct) throw new Error(acctErr?.code === "42501" ? "forbidden" : "storage_failed");
      accountCount += 1;
      const txs = await listAll<SeTransaction>(`/transactions?connection_id=${conn.id}&account_id=${a.id}`);
      for (let i = 0; i < txs.length; i += 400) {
        const batch = txs.slice(i, i + 400).map((t) => ({
          org_id: orgId,
          bank_account_id: acct.id,
          booked_on: t.made_on,
          amount_cents: toCents(t.amount),
          currency: t.currency_code || "EUR",
          counterparty_name: (t.amount >= 0 ? t.extra?.payer : t.extra?.payee) ?? t.extra?.payer ?? t.extra?.payee ?? "",
          counterparty_iban: t.amount >= 0 ? t.extra?.payer_iban ?? null : null,
          remittance_info: t.description ?? "",
          end_to_end_id: t.extra?.end_to_end_id ?? null,
          bank_tx_id: t.id,
          match_status: "unmatched",
        }));
        const { error: txErr } = await g.from("bank_transactions").upsert(batch, { onConflict: "bank_account_id,bank_tx_id", ignoreDuplicates: true });
        if (txErr) throw new Error("storage_failed");
      }
      txCount += txs.length;
    }
  }
  const matched = await reconcile(g, orgId);
  return { connections: connections.length, accounts: accountCount, transactions: txCount, matched };
}

/** Tells the notify function what landed; the secret comes from the vault through the service role. */
async function announce(orgId: string, userId: string, result: { transactions: number; matched: { auto: number; review: number } }) {
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { db: { schema: "gestion" }, auth: { persistSession: false } });
    const { data: secret } = await admin.rpc("notify_secret");
    if (!secret) return;
    await fetch(`${SUPABASE_URL}/functions/v1/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-notify-secret": String(secret) },
      body: JSON.stringify({ mode: "notify", org_id: orgId, kind: "bank.synced", args: { transactions: String(result.transactions), matched: String(result.matched.auto), review: String(result.matched.review) }, href: "/finance", dedupe_key: `bank-synced:${orgId}:${Date.now()}`, only: [userId], severity: "low" }),
    });
  } catch (e) {
    console.error("announce failed", e);
  }
}

// ─── HTTP ───────────────────────────────────────────────────────────────────

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const configured = () => Boolean(APP_ID && SECRET);

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  // Salt Edge sends the browser here after consent: straight back into the app.
  if (req.method === "GET" && url.searchParams.get("action") === "return") {
    const target = `${APP_SCHEME}?${url.searchParams.toString()}`;
    return new Response(`<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${target}"><title>Morada</title><p style="font-family:-apple-system,sans-serif;text-align:center;margin-top:40vh">Retour vers Morada…</p>`, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", Location: target } });
  }
  if (req.method !== "POST") return json({ error: "method" }, 405);

  let body: Row;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  const action = String(body.action ?? "");
  if (action === "status") return json({ configured: configured(), fake: FAKE });

  // Health: secret-gated, no user. Proves the credentials, the customer and a consent
  // session with this function's return address (the one Salt Edge must allow).
  if (action === "health") {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { db: { schema: "gestion" }, auth: { persistSession: false } });
    const { data: secret } = await admin.rpc("notify_secret");
    if (!secret || req.headers.get("x-notify-secret") !== secret) return json({ error: "forbidden" }, 403);
    if (!configured()) return json({ ok: false, configured: false });
    try {
      await ensureCustomer("morada-health-check");
      const r = await connectWithFallback("morada-health-check", "fr");
      return json({ ok: true, configured: true, fake: FAKE, connect_url_host: new URL(r.url).host, returnTo: r.returnTo, fallback: r.fallback });
    } catch (e) {
      return json({ ok: false, configured: true, code: e instanceof SaltEdgeError ? e.code : "network", message: e instanceof Error ? e.message.slice(0, 300) : "" });
    }
  }

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "unauthenticated" }, 401);
  const anon = Deno.env.get("SUPABASE_ANON_KEY") || req.headers.get("apikey") || PUBLISHABLE;
  const g = createClient(SUPABASE_URL, anon, { db: { schema: "gestion" }, global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data: me } = await g.auth.getUser(token);
  if (!me.user) return json({ error: "unauthenticated" }, 401);
  const orgId = String(body.org_id ?? "");
  if (!orgId) return json({ error: "no_workspace" }, 400);
  // The person must be able to edit the organisation's finances; RLS on the writes decides for real.
  const { data: can } = await g.rpc("can", { p_org: orgId, p_perm: "gestion.finance.edit" });
  if (!can) return json({ error: "forbidden" }, 403);
  if (!configured()) return json({ error: "not_configured" }, 503);

  try {
    if (action === "connect") {
      const locale = body.locale === "en" || body.locale === "de" ? String(body.locale) : "fr";
      const identifier = `morada-ws-${orgId}`;
      await ensureCustomer(identifier);
      const r = await connectWithFallback(identifier, locale);
      return json({ url: r.url, returnTo: r.returnTo, fallback: r.fallback });
    }
    if (action === "sync") {
      const result = await sync(g, orgId);
      await announce(orgId, me.user.id, result);
      return json(result);
    }
    return json({ error: "action" }, 400);
  } catch (e) {
    if (e instanceof SaltEdgeError) {
      console.error("saltedge failed", e.code, e.message);
      return json({ error: "saltedge_error", code: e.code }, 502);
    }
    const msg = e instanceof Error ? e.message : "unknown";
    console.error("bank failed", msg);
    return json({ error: msg === "forbidden" ? "forbidden" : "storage_failed" }, msg === "forbidden" ? 403 : 502);
  }
});
