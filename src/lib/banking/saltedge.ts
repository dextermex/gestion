/**
 * Salt Edge Account Information API, v5 — the thinnest possible client.
 *
 * SERVER ONLY. The App-id and Secret come from the environment
 * (SALTEDGE_APP_ID / SALTEDGE_SECRET, set in the deployment, never in the
 * repository and never in any NEXT_PUBLIC_* variable) and must not reach a
 * client bundle: import this module from route handlers only.
 *
 * Scope today: create (or find) the Salt Edge customer for a Morada account
 * and open a connect session, whose URL hosts the bank-consent journey.
 * Reading back accounts and transactions starts once the gestion banking
 * tables are approved and applied; nothing is persisted before that.
 */

const BASE = "https://www.saltedge.com/api/v5";

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

/** Create the customer, or find it again when it already exists. */
export async function ensureCustomer(identifier: string): Promise<string> {
  try {
    const created = await se<{ data: { id: string } }>("/customers", {
      method: "POST",
      body: { data: { identifier } },
    });
    return created.data.id;
  } catch (e) {
    if (!(e instanceof SaltEdgeError) || e.code !== "DuplicatedCustomer") throw e;
  }

  // Walk the paginated list to recover the existing customer's id.
  let fromId: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const q = fromId ? `?from_id=${encodeURIComponent(fromId)}` : "";
    const list = await se<{
      data: Array<{ id: string; identifier: string }>;
      meta?: { next_id?: string | null };
    }>(`/customers${q}`);
    const hit = list.data.find((c) => c.identifier === identifier);
    if (hit) return hit.id;
    if (!list.meta?.next_id) break;
    fromId = list.meta.next_id;
  }
  throw new SaltEdgeError("CustomerNotFound", `No customer with identifier ${identifier}`);
}

/** Open a consent journey; the returned URL hosts the bank selection. */
export async function createConnectSession(
  customerId: string,
  returnTo: string,
  locale: "fr" | "en" | "de",
): Promise<string> {
  const session = await se<{ data: { connect_url: string } }>("/connect_sessions/create", {
    method: "POST",
    body: {
      data: {
        customer_id: customerId,
        consent: { scopes: ["account_details", "transactions_details"] },
        attempt: { return_to: returnTo, locale },
      },
    },
  });
  return session.data.connect_url;
}
