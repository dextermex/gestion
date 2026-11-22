import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SESSION_MAX_AGE, decodeSession, sessionCookieNames, sessionCookieParts, sharedCookieDomain } from "@/lib/sessionCookie";
import { SUPABASE_ANON_KEY, SUPABASE_URL, STORAGE_KEY } from "./config";

/**
 * Server-side reading of the shared session.
 *
 * The session lives in a cookie precisely so the server can see it too. What
 * the server must NOT do is believe it: a cookie is user-controlled, so the
 * access token is always handed back to Supabase for verification before a
 * single row is read. `getUser()` validates the signature server-side;
 * decoding the token locally would trust whatever the browser sent.
 *
 * An access token lives about an hour. A request that arrives with one at
 * its end, and the refresh token beside it, is not turned away: the server
 * renews the session with the account system, serves the request under the
 * new token and, where a response can carry cookies (route handlers), writes
 * the renewed session back exactly as the browser would. A page render
 * cannot write cookies; the browser then stores the same renewal itself
 * (`keepSessionFresh`), which the account system answers with the session
 * it already issued.
 */

/** Reassembles the session written by `createCookieStorage`. */
async function readSessionCookie(): Promise<string | null> {
  const jar = await cookies();
  const whole = jar.get(STORAGE_KEY)?.value;
  if (whole) return whole;
  let out = "";
  for (const name of sessionCookieNames(STORAGE_KEY).slice(1)) {
    const part = jar.get(name)?.value;
    if (part === undefined) break;
    out += part;
  }
  return out === "" ? null : out;
}

export interface StoredSession {
  accessToken: string;
  refreshToken: string | null;
}

/** What the cookie holds, or null: a truncated or hand-edited cookie is simply "no session". */
export function parseStoredSession(raw: string): StoredSession | null {
  try {
    const parsed = JSON.parse(decodeSession(raw)) as { access_token?: unknown; refresh_token?: unknown };
    if (typeof parsed.access_token !== "string" || parsed.access_token === "") return null;
    return { accessToken: parsed.access_token, refreshToken: typeof parsed.refresh_token === "string" && parsed.refresh_token !== "" ? parsed.refresh_token : null };
  } catch {
    return null;
  }
}

/** Seconds of margin: a token this close to its end is renewed rather than used for a request that may outlast it. */
const RENEW_MARGIN_S = 30;

/**
 * When the token says it ends, read without verifying anything: it only
 * decides whether to ask for a renewal first. Whether the token is good is
 * the account system's answer, never this one.
 */
export function tokenExpiry(accessToken: string): number | null {
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString("utf8")) as { exp?: unknown };
    return typeof payload.exp === "number" && Number.isFinite(payload.exp) ? payload.exp : null;
  } catch {
    return null;
  }
}

export function needsRenewal(accessToken: string, nowMs: number): boolean {
  const exp = tokenExpiry(accessToken);
  return exp !== null && exp - RENEW_MARGIN_S <= Math.floor(nowMs / 1000);
}

export interface Session {
  userId: string;
  email: string;
  accessToken: string;
  /** Auth's user metadata as verified: personalisation only, never a permission. */
  metadata?: Record<string, unknown>;
}

/** The account system's answer to a renewal: the session as supabase-js stores it. */
interface RenewedSession {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  expires_at?: number;
  user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> | null };
  [key: string]: unknown;
}

const RENEW_TIMEOUT_MS = 8000;

async function requestRenewal(refreshToken: string): Promise<RenewedSession | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
      cache: "no-store",
      signal: AbortSignal.timeout(RENEW_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as Partial<RenewedSession> | null;
    if (!data || typeof data.access_token !== "string" || typeof data.refresh_token !== "string" || typeof data.user?.id !== "string") return null;
    // The shape supabase-js stores: the answer itself, with the end as a date.
    const expiresAt = typeof data.expires_at === "number" ? data.expires_at : Math.round(Date.now() / 1000) + (typeof data.expires_in === "number" ? data.expires_in : 3600);
    return { ...(data as RenewedSession), expires_at: expiresAt };
  } catch {
    // Unreachable or too slow: signed out for this request, nothing is erased.
    return null;
  }
}

/**
 * One renewal per refresh token at a time, remembered for a few seconds: the
 * requests a page sends together arrive with the same expired token, and a
 * route asks for the session more than once. A failed renewal is not
 * remembered.
 */
const RENEWAL_MEMORY_MS = 20_000;
const renewals = new Map<string, { at: number; result: Promise<RenewedSession | null> }>();

function renew(refreshToken: string): Promise<RenewedSession | null> {
  const now = Date.now();
  for (const [token, entry] of renewals) if (now - entry.at > RENEWAL_MEMORY_MS) renewals.delete(token);
  const known = renewals.get(refreshToken);
  if (known) return known.result;
  const result = requestRenewal(refreshToken);
  renewals.set(refreshToken, { at: now, result });
  void result.then((session) => {
    if (!session) renewals.delete(refreshToken);
  });
  return result;
}

/** For tests: forget every remembered renewal. */
export function forgetRenewals(): void {
  renewals.clear();
}

/**
 * The renewed session, written the way the browser writes it: same names,
 * same encoding, same scope, readable by the browser client (which is why it
 * is not HttpOnly: morada.lu and this application's own door read it from
 * script). False where the response cannot carry cookies.
 */
async function storeRenewedSession(session: RenewedSession): Promise<boolean> {
  try {
    const [jar, h] = await Promise.all([cookies(), headers()]);
    const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0].trim();
    const hostname = host.replace(/:\d+$/, "");
    const proto = (h.get("x-forwarded-proto") ?? "").split(",")[0].trim() || (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(hostname) ? "http" : "https");
    const domain = sharedCookieDomain(hostname);
    const base = { path: "/", sameSite: "lax" as const, secure: proto === "https", ...(domain ? { domain } : {}) };
    const parts = sessionCookieParts(STORAGE_KEY, JSON.stringify(session));
    const written = new Set(parts.map((p) => p.name));
    for (const part of parts) jar.set(part.name, part.value, { ...base, maxAge: SESSION_MAX_AGE });
    // A piece of the previous session under a name the new one does not use would be read back with it.
    for (const name of sessionCookieNames(STORAGE_KEY)) if (!written.has(name) && jar.has(name)) jar.set(name, "", { ...base, maxAge: 0 });
    return true;
  } catch {
    return false;
  }
}

function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

type Verified = { kind: "ok"; session: Session } | { kind: "refused" } | { kind: "unreachable" };

async function verify(accessToken: string): Promise<Verified> {
  try {
    const { data, error } = await anonClient().auth.getUser(accessToken);
    if (error || !data.user) {
      // The account system answered and said no (expired, revoked, signed out elsewhere): a renewal may still stand.
      const status = (error as { status?: number } | null)?.status;
      return typeof status === "number" && status >= 400 && status < 500 ? { kind: "refused" } : { kind: "unreachable" };
    }
    return { kind: "ok", session: { userId: data.user.id, email: data.user.email ?? "", accessToken, metadata: data.user.user_metadata ?? {} } };
  } catch {
    return { kind: "unreachable" };
  }
}

/**
 * The signed-in user, verified against Supabase, or null. Cached per request
 * so a layout and its page share one round-trip.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const raw = await readSessionCookie();
  if (!raw) return null;
  const stored = parseStoredSession(raw);
  if (!stored) return null;

  if (!needsRenewal(stored.accessToken, Date.now())) {
    const verified = await verify(stored.accessToken);
    if (verified.kind === "ok") return verified.session;
    // Supabase unreachable: treat as signed out rather than as authorised.
    if (verified.kind === "unreachable") return null;
  }

  // At its end, or refused: the refresh token decides. Without one, or with
  // one the account system no longer honours, the person is signed out.
  if (!stored.refreshToken) return null;
  const renewed = await renew(stored.refreshToken);
  if (!renewed) return null;
  await storeRenewedSession(renewed);
  return { userId: renewed.user.id, email: renewed.user.email ?? "", accessToken: renewed.access_token, metadata: renewed.user.user_metadata ?? {} };
});

/**
 * A Supabase client that queries AS the signed-in user, so every RLS policy
 * applies exactly as it would from the browser. The publishable key plus the
 * user's own token, never a service role.
 */
export function authedClient(accessToken: string): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
