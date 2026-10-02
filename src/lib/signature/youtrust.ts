import "server-only";
import type { AuthMode, EnvelopeStatus, SignatureLevel, SignerLocale, SignerStatus } from "./envelope";
import type { ProviderEnv } from "./provider";

/**
 * Youtrust's eSignature API, version 3 (Yousign until July 2026), reduced to
 * what a lease needs: one signature request carrying the contract we
 * produced, its Smart Anchors placing each signer's field, the signers in
 * order, activation (Youtrust e-mails each signer when their turn comes),
 * then reading the request back, downloading the signed PDF and each
 * signer's audit trail, and cancelling. Nothing here throws: every failure
 * comes back as a code the screens can say.
 */

export const YOUTRUST_BASE: Record<ProviderEnv, string> = {
  sandbox: "https://api-sandbox.yousign.app/v3",
  production: "https://api.yousign.app/v3",
};

/**
 * The Smart Anchor that places a signer's signature field: the signer's
 * position in the request (s1 is the first signer added), then the field's
 * width and height in points, at the 2.3 to 1 ratio Youtrust expects.
 */
export const anchorFor = (position: number): string => `{{s${position}|signature|138|60}}`;

export type ProviderErrorCode = "unauthorized" | "forbidden" | "invalid" | "not_found" | "rate_limited" | "unavailable";
export interface ProviderError {
  error: ProviderErrorCode;
  status?: number;
  detail?: string;
}
export const isProviderError = (v: unknown): v is ProviderError => typeof v === "object" && v !== null && "error" in v;

export interface ProviderSigner {
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  locale: SignerLocale;
  level: SignatureLevel;
  authMode: AuthMode;
}

export interface SendRequest {
  name: string;
  externalId: string;
  fileName: string;
  pdf: Buffer;
  expiresOn: string;
  signers: ProviderSigner[];
}

export interface ProviderState {
  status: EnvelopeStatus;
  completedAt: string | null;
  signers: Array<{ id: string; status: SignerStatus }>;
}

/** What any signature provider does for us; Youtrust is the one implementation. */
export interface SignatureClient {
  send(req: SendRequest): Promise<{ requestId: string; signerIds: string[] } | ProviderError>;
  read(requestId: string): Promise<ProviderState | ProviderError>;
  /** When one signer signed, as the provider recorded it. */
  signedAt(requestId: string, signerId: string): Promise<string | null | ProviderError>;
  signedDocument(requestId: string): Promise<Buffer | ProviderError>;
  /** Every signer's audit trail, merged into one PDF once the request is done. */
  auditTrails(requestId: string): Promise<Buffer | ProviderError>;
  cancel(requestId: string): Promise<true | ProviderError>;
}

/** A request's state as Youtrust names it, here. */
export function requestStatusOf(raw: unknown): EnvelopeStatus {
  switch (raw) {
    case "draft":
      return "draft";
    case "ongoing":
    case "approval":
    case "paused":
      return "ongoing";
    case "done":
      return "done";
    case "declined":
    case "rejected":
      return "declined";
    case "expired":
      return "expired";
    case "canceled":
    case "deleted":
      return "canceled";
    default:
      return "ongoing";
  }
}

/** A signer's state as Youtrust names it, here. */
export function signerStatusOf(raw: unknown): SignerStatus {
  switch (raw) {
    case "signed":
      return "signed";
    case "declined":
      return "declined";
    case "error":
    case "aborted":
      return "error";
    case "initiated":
      return "pending";
    default:
      return "notified";
  }
}

type Fetch = typeof fetch;

interface ClientOptions {
  apiKey: string;
  env: ProviderEnv;
  /** Only for a stand-in server in tests; production always uses Youtrust's own host. */
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: Fetch;
}

export function youtrustClient(opts: ClientOptions): SignatureClient {
  const base = (opts.baseUrl || YOUTRUST_BASE[opts.env]).replace(/\/+$/, "");
  const doFetch: Fetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 25_000;

  const call = async (method: string, path: string, body?: unknown): Promise<Response | ProviderError> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = { Authorization: `Bearer ${opts.apiKey}`, Accept: "application/json" };
      let payload: BodyInit | undefined;
      if (body instanceof FormData) payload = body;
      else if (body !== undefined) {
        headers["Content-Type"] = "application/json";
        payload = JSON.stringify(body);
      }
      const res = await doFetch(`${base}${path}`, { method, headers, body: payload, signal: controller.signal, cache: "no-store" });
      if (res.ok) return res;
      return await failureOf(res);
    } catch {
      return { error: "unavailable" };
    } finally {
      clearTimeout(timer);
    }
  };

  const json = async <T>(method: string, path: string, body?: unknown): Promise<T | ProviderError> => {
    const res = await call(method, path, body);
    if (isProviderError(res)) return res;
    try {
      return (await res.json()) as T;
    } catch {
      return { error: "unavailable", detail: "unreadable answer" };
    }
  };

  const bytes = async (path: string): Promise<Buffer | ProviderError> => {
    const res = await call("GET", path);
    if (isProviderError(res)) return res;
    try {
      return Buffer.from(await res.arrayBuffer());
    } catch {
      return { error: "unavailable", detail: "unreadable file" };
    }
  };

  return {
    async send(req) {
      const created = await json<{ id?: string }>("POST", "/signature_requests", {
        name: req.name.slice(0, 128),
        delivery_mode: "email",
        ordered_signers: true,
        timezone: "Europe/Luxembourg",
        expiration_date: req.expiresOn,
        external_id: req.externalId,
        reminder_settings: { interval_in_days: 2, max_occurrences: 3 },
      });
      if (isProviderError(created)) return created;
      const requestId = String(created.id ?? "");
      if (!requestId) return { error: "unavailable", detail: "no request id" };
      // From here a failure leaves a draft at the provider: it is deleted, best effort, and never billed.
      const abandon = async (failure: ProviderError): Promise<ProviderError> => {
        await call("DELETE", `/signature_requests/${encodeURIComponent(requestId)}`);
        return failure;
      };

      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(req.pdf)], { type: "application/pdf" }), req.fileName);
      form.append("nature", "signable_document");
      form.append("parse_anchors", "true");
      const document = await json<{ id?: string; total_anchors?: number }>("POST", `/signature_requests/${encodeURIComponent(requestId)}/documents`, form);
      if (isProviderError(document)) return abandon(document);
      // Every signer needs the anchor that places their field: a contract read without them is not sent.
      if (typeof document.total_anchors === "number" && document.total_anchors < req.signers.length) return abandon({ error: "invalid", detail: "anchors" });

      const signerIds: string[] = [];
      for (const s of req.signers) {
        const info: Record<string, string> = { first_name: s.firstName, last_name: s.lastName, email: s.email, locale: s.locale };
        if (s.phone) info.phone_number = s.phone;
        const added = await json<{ id?: string }>("POST", `/signature_requests/${encodeURIComponent(requestId)}/signers`, {
          info,
          signature_level: s.level,
          // The qualified level identifies the signer itself: no one-time code mode is sent.
          signature_authentication_mode: s.level === "qualified_electronic_signature" ? null : s.authMode,
        });
        if (isProviderError(added)) return abandon(added);
        if (!added.id) return abandon({ error: "unavailable", detail: "no signer id" });
        signerIds.push(String(added.id));
      }

      const activated = await json<{ status?: string }>("POST", `/signature_requests/${encodeURIComponent(requestId)}/activate`);
      if (isProviderError(activated)) return abandon(activated);
      return { requestId, signerIds };
    },

    async read(requestId) {
      const r = await json<{ status?: string; completed_at?: string | null; signers?: Array<{ id?: string; status?: string }> }>("GET", `/signature_requests/${encodeURIComponent(requestId)}`);
      if (isProviderError(r)) return r;
      return {
        status: requestStatusOf(r.status),
        completedAt: typeof r.completed_at === "string" && r.completed_at ? r.completed_at : null,
        signers: (r.signers ?? []).filter((s) => s.id).map((s) => ({ id: String(s.id), status: signerStatusOf(s.status) })),
      };
    },

    async signedAt(requestId, signerId) {
      const r = await json<{ signed_at?: string | null }>("GET", `/signature_requests/${encodeURIComponent(requestId)}/signers/${encodeURIComponent(signerId)}`);
      if (isProviderError(r)) return r;
      return typeof r.signed_at === "string" && r.signed_at ? r.signed_at : null;
    },

    signedDocument(requestId) {
      return bytes(`/signature_requests/${encodeURIComponent(requestId)}/documents/download?version=completed&archive=false`);
    },

    auditTrails(requestId) {
      return bytes(`/signature_requests/${encodeURIComponent(requestId)}/audit_trails/download?merge=true`);
    },

    async cancel(requestId) {
      const res = await call("POST", `/signature_requests/${encodeURIComponent(requestId)}/cancel`, { reason: "contractualization_aborted" });
      return isProviderError(res) ? res : true;
    },
  };
}

async function failureOf(res: Response): Promise<ProviderError> {
  let detail: string | undefined;
  try {
    const body = (await res.json()) as { detail?: unknown; title?: unknown; message?: unknown };
    const text = [body.title, body.detail, body.message].find((v) => typeof v === "string");
    detail = typeof text === "string" ? text.slice(0, 300) : undefined;
  } catch {
    detail = undefined;
  }
  const status = res.status;
  if (status === 401) return { error: "unauthorized", status, detail };
  if (status === 403) return { error: "forbidden", status, detail };
  if (status === 404) return { error: "not_found", status, detail };
  if (status === 429) return { error: "rate_limited", status, detail };
  if (status === 400 || status === 409 || status === 422) return { error: "invalid", status, detail };
  return { error: "unavailable", status, detail };
}
