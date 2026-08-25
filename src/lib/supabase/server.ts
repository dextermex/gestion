import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL, STORAGE_KEY } from "./config";

/**
 * Server-side reading of the shared session.
 *
 * The session lives in a cookie precisely so the server can see it too. What
 * the server must NOT do is believe it: a cookie is user-controlled, so the
 * access token is always handed back to Supabase for verification before a
 * single row is read. `getUser()` validates the signature server-side;
 * decoding the token locally would trust whatever the browser sent.
 */

const CHUNK_PREFIX_LIMIT = 8;
const B64 = "b64.";

function decode(stored: string): string {
  if (!stored.startsWith(B64)) return stored;
  const b64 = stored.slice(B64.length).replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64, "base64").toString("utf8");
}

/** Reassembles the session written by `createCookieStorage`. */
async function readSessionCookie(): Promise<string | null> {
  const jar = await cookies();
  const whole = jar.get(STORAGE_KEY)?.value;
  if (whole) return whole;
  let out = "";
  for (let i = 0; i < CHUNK_PREFIX_LIMIT; i++) {
    const part = jar.get(`${STORAGE_KEY}.${i}`)?.value;
    if (part === undefined) break;
    out += part;
  }
  return out === "" ? null : out;
}

function accessTokenFrom(raw: string): string | null {
  try {
    const parsed = JSON.parse(decode(raw)) as { access_token?: unknown };
    return typeof parsed.access_token === "string" ? parsed.access_token : null;
  } catch {
    return null; // a truncated or hand-edited cookie is simply "no session"
  }
}

export interface Session {
  userId: string;
  email: string;
  accessToken: string;
}

/**
 * The signed-in user, verified against Supabase, or null. Cached per request
 * so a layout and its page share one round-trip.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const raw = await readSessionCookie();
  if (!raw) return null;
  const accessToken = accessTokenFrom(raw);
  if (!accessToken) return null;

  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  try {
    const { data, error } = await anon.auth.getUser(accessToken);
    if (error || !data.user) return null;
    return { userId: data.user.id, email: data.user.email ?? "", accessToken };
  } catch {
    // Supabase unreachable: treat as signed out rather than as authorised.
    return null;
  }
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
