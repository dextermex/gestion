/**
 * Salt Edge Account Information API, v6 — the thinnest possible client.
 * (v5 answers UnsupportedApiVersion for apps created today; the deployed
 * probe at /api/banking/health confirmed it.)
 *
 * SERVER ONLY. The App-id and Secret come from the environment
 * (SALTEDGE_APP_ID / SALTEDGE_SECRET, set in the deployment, never in the
 * repository and never in any NEXT_PUBLIC_* variable) and must not reach a
 * client bundle: import this module from route handlers only.
 *
 * Scope: create (or find) the Salt Edge customer for a workspace, open a
 * connect session (whose URL hosts the bank-consent journey), and read the
 * connections, accounts and transactions back for the sync route. While the
 * Salt Edge app is in its test status only the fake banks answer: the
 * deployment says so with SALTEDGE_FAKE_PROVIDERS=1, and the sample cabinet
 * always runs its demonstration journey on one of them.
 */

const BASE = "https://www.saltedge.com/api/v6";

export class SaltEdgeError extends Error {
  constructor(
    /** Salt Edge error class, e.g. "DuplicatedCustomer", or "http_<status>". */
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SaltEdgeError";
  }
}

export function saltEdgeConfigured(): boolean {
  return Boolean(process.env.SALTEDGE_APP_ID && process.env.SALTEDGE_SECRET);
}

/**
 * Whether the consent journey should list Salt Edge's fake banks next to
 * the real ones (SALTEDGE_FAKE_PROVIDERS=1). A Salt Edge app still in its
 * test status can only connect to those; a live app never needs them.
 */
export function fakeProvidersWanted(): boolean {
  const v = (process.env.SALTEDGE_FAKE_PROVIDERS ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** The fake bank the sample cabinet's journey opens on (SALTEDGE_DEMO_PROVIDER to change it). */
export function demoProviderCode(): string {
  return (process.env.SALTEDGE_DEMO_PROVIDER ?? "").trim() || "fakebank_simple_xf";
}

/**
 * Where Salt Edge sends the visitor back after the journey, on the given
 * origin: a clean path, no query, so that one entry per deployment in the
 * app's allowed return URIs covers it. The page behind it routes to the
 * bank screen's real or demonstration return.
 */
export const RETURN_PATH = "/app/banque/retour";
export function returnToFor(origin: string): string {
  return new URL(RETURN_PATH, origin).toString();
}

type Json = Record<string, unknown>;

async function se<T>(path: string, init?: { method?: string; body?: Json }): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      "App-id": process.env.SALTEDGE_APP_ID ?? "",
      Secret: process.env.SALTEDGE_SECRET ?? "",
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });

  let parsed: Json = {};
  try {
    parsed = (await res.json()) as Json;
  } catch {
    /* non-JSON body: fall through to the status check */
  }

  if (!res.ok) {
    // v5 reports { error: { class, message } }; older shapes use error_class.
    const err = (parsed.error ?? {}) as { class?: string; message?: string };
    const code = err.class ?? (parsed.error_class as string | undefined) ?? `http_${res.status}`;
    const message = err.message ?? (parsed.error_message as string | undefined) ?? res.statusText;
    throw new SaltEdgeError(code, message);
  }
  return parsed as T;
}

type CustomerShape = { id?: unknown; customer_id?: unknown; identifier?: unknown };

/** The customer's Salt Edge id, whichever field carries it (v6 says customer_id, v5 said id). */
function customerIdOf(c: CustomerShape | undefined): string | null {
  const v = c?.customer_id ?? c?.id;
  if (typeof v === "string" && v) return v;
  if (typeof v === "number") return String(v);
  return null;
}

function idMissing(c: CustomerShape | undefined): SaltEdgeError {
  // Field NAMES only: enough to see the shape, nothing of the customer.
  return new SaltEdgeError("CustomerIdMissing", `customer answered without an id (fields: ${Object.keys(c ?? {}).join(", ")})`);
}

/**
 * Make sure the customer exists; one that already does is fine. This is all
 * a consent journey needs, since v6 opens it on the identifier itself.
 */
export async function registerCustomer(identifier: string): Promise<void> {
  try {
    await se<{ data: CustomerShape }>("/customers", { method: "POST", body: { data: { identifier } } });
  } catch (e) {
    if (!(e instanceof SaltEdgeError) || e.code !== "DuplicatedCustomer") throw e;
  }
}

/** Create the customer, or find it again when it already exists, and return its Salt Edge id. */
export async function ensureCustomer(identifier: string): Promise<string> {
  try {
    const created = await se<{ data: CustomerShape }>("/customers", {
      method: "POST",
      body: { data: { identifier } },
    });
    const id = customerIdOf(created.data);
    if (!id) throw idMissing(created.data);
    return id;
  } catch (e) {
    if (!(e instanceof SaltEdgeError) || e.code !== "DuplicatedCustomer") throw e;
  }

  // Walk the paginated list to recover the existing customer's id.
  let fromId: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const q = fromId ? `?from_id=${encodeURIComponent(fromId)}` : "";
    const list = await se<{
      data: CustomerShape[];
      meta?: { next_id?: string | null };
    }>(`/customers${q}`);
    const hit = list.data.find((c) => c.identifier === identifier);
    if (hit) {
      const id = customerIdOf(hit);
      if (!id) throw idMissing(hit);
      return id;
    }
    if (!list.meta?.next_id) break;
    fromId = list.meta.next_id;
  }
  throw new SaltEdgeError("CustomerNotFound", `No customer with identifier ${identifier}`);
}

/**
 * One harmless read against the API with the deployed credentials, for the
 * health endpoint: reports the provider's error class when the call fails.
 * No customer data leaves — only ok/code/message.
 */
export async function saltEdgeProbe(): Promise<
  { ok: true } | { ok: false; code: string; message: string }
> {
  try {
    await se<{ data: unknown[] }>("/customers");
    return { ok: true };
  } catch (e) {
    if (e instanceof SaltEdgeError) return { ok: false, code: e.code, message: e.message };
    return { ok: false, code: "network", message: e instanceof Error ? e.message : String(e) };
  }
}

/* ------------------------- reading back the data ------------------------- */

export interface SeConnection {
  id: string;
  provider_name: string;
  status: string;
  last_success_at: string | null;
}

export interface SeAccount {
  id: string;
  connection_id: string;
  name: string;
  balance: number;
  currency_code: string;
  extra?: { iban?: string; bban?: string; client_name?: string; account_name?: string };
}

export interface SeTransaction {
  id: string;
  account_id: string;
  made_on: string;
  amount: number;
  currency_code: string;
  description: string;
  extra?: { payer?: string; payee?: string; end_to_end_id?: string; additional?: string };
}

async function listAll<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  let fromId: string | undefined;
  for (let page = 0; page < 50; page += 1) {
    const sep = path.includes("?") ? "&" : "?";
    const q = fromId ? `${sep}from_id=${encodeURIComponent(fromId)}` : "";
    const res = await se<{ data: T[]; meta?: { next_id?: string | null } }>(`${path}${q}`);
    out.push(...res.data);
    if (!res.meta?.next_id) break;
    fromId = res.meta.next_id;
  }
  return out;
}

export function listConnections(customerId: string): Promise<SeConnection[]> {
  return listAll<SeConnection>(`/connections?customer_id=${encodeURIComponent(customerId)}`);
}

export function listAccounts(connectionId: string): Promise<SeAccount[]> {
  return listAll<SeAccount>(`/accounts?connection_id=${encodeURIComponent(connectionId)}`);
}

export function listTransactions(connectionId: string, accountId: string): Promise<SeTransaction[]> {
  return listAll<SeTransaction>(
    `/transactions?connection_id=${encodeURIComponent(connectionId)}&account_id=${encodeURIComponent(accountId)}`,
  );
}

export interface DemoAccount {
  id: string;
  name: string;
  iban: string | null;
  balance: number;
  currency: string;
  transactions: number;
}

export interface DemoSnapshot {
  provider: string;
  accounts: DemoAccount[];
}

/**
 * What the sample cabinet's demonstration journey produced, read live and
 * never stored: the demo customer's latest connection, its accounts and the
 * number of operations each carries. Null while no journey has completed.
 */
export async function demoSnapshot(identifier: string): Promise<DemoSnapshot | null> {
  const customerId = await ensureCustomer(identifier);
  const connections = await listConnections(customerId);
  const latest = connections[connections.length - 1];
  if (!latest) return null;
  const accounts: DemoAccount[] = [];
  for (const a of await listAccounts(latest.id)) {
    const txs = await listTransactions(latest.id, a.id);
    accounts.push({
      id: a.id,
      name: a.name,
      iban: a.extra?.iban ?? null,
      balance: a.balance,
      currency: a.currency_code,
      transactions: txs.length,
    });
  }
  return { provider: latest.provider_name, accounts };
}

export interface ConnectOptions {
  /** List the fake banks too (a test-status app can connect to nothing else). */
  includeFakeProviders?: boolean;
  /** Open the journey on one provider instead of the bank list. */
  providerCode?: string;
}

/**
 * Open a consent journey for the customer with this identifier (ours, the
 * one given at registration); the returned URL hosts the bank selection.
 * `returnTo` must be listed among the app's allowed return URIs in the
 * Salt Edge dashboard, or the provider refuses the request.
 */
export async function createConnectSession(
  customerIdentifier: string,
  returnTo: string,
  locale: "fr" | "en" | "de",
  options: ConnectOptions = {},
): Promise<string> {
  // v6 moved session creation under /connections/connect, renamed the
  // consent scopes, takes the customer by identifier, and groups what
  // concerns the provider (its code, the fake ones) under a `provider`
  // object: the flat v5 keys are refused as WrongRequestFormat. Only what
  // is asked for is sent.
  const data: Json = {
    customer_identifier: customerIdentifier,
    consent: { scopes: ["accounts", "transactions"] },
    attempt: { return_to: returnTo, locale },
  };
  const provider: Json = {};
  if (options.includeFakeProviders) provider.include_fake_providers = true;
  if (options.providerCode) provider.code = options.providerCode;
  if (Object.keys(provider).length > 0) data.provider = provider;
  const session = await se<{ data: { connect_url: string } }>("/connections/connect", {
    method: "POST",
    body: { data },
  });
  return session.data.connect_url;
}
