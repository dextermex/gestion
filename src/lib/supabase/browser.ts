"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createCookieStorage } from "@/lib/sessionCookie";
import { SUPABASE_ANON_KEY, SUPABASE_URL, STORAGE_KEY } from "./config";

/**
 * The browser client. Its session lives in a cookie on `.morada.lu`, which is
 * what lets morada.lu and app.morada.lu share one sign-in; on any other host
 * the cookie stays host-scoped and the app simply works on its own.
 *
 * `flowType` is left at the library default, matching Morada exactly, so
 * password-recovery links keep behaving the way they do today.
 */
let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: STORAGE_KEY,
        // The cookie alone: no second copy of the session in localStorage.
        storage: createCookieStorage({ mirrorToLocalStorage: false }),
      },
    });
  }
  return client;
}

/**
 * Sign out here and everywhere: every session of this account is revoked
 * (this browser, morada.lu, other devices), and the shared cookie and any
 * localStorage copy an earlier build left are cleared whatever the account
 * system answered. The next account to sign in on this browser starts from
 * nothing of the previous one.
 */
/**
 * Keeps the session alive while a space is open. Creating the client starts
 * its own clock: the access token is renewed shortly before it expires and
 * again whenever the tab comes back to the front, and each renewal is
 * written to the shared cookie, which is what the server reads. Returns the
 * function that stops listening.
 */
export function keepSessionFresh(): () => void {
  const db = getSupabase();
  // Reading the session renews it when it is at, or close to, its end.
  const renew = () => {
    if (document.visibilityState === "visible") void db.auth.getSession().catch(() => undefined);
  };
  renew();
  window.addEventListener("online", renew);
  window.addEventListener("pageshow", renew);
  document.addEventListener("visibilitychange", renew);
  return () => {
    window.removeEventListener("online", renew);
    window.removeEventListener("pageshow", renew);
    document.removeEventListener("visibilitychange", renew);
  };
}

/**
 * One renewal, asked for on purpose: a call was answered "signed out" and is
 * about to be tried once more. True when a session is in hand afterwards.
 */
export async function renewSessionNow(): Promise<boolean> {
  try {
    const { data, error } = await getSupabase().auth.refreshSession();
    return !error && Boolean(data.session);
  } catch {
    return false;
  }
}

export async function signOutEverywhere(): Promise<void> {
  const db = getSupabase();
  try {
    await db.removeAllChannels();
  } catch {
    // Channel teardown is best-effort.
  }
  try {
    await db.auth.signOut({ scope: "global" });
  } catch {
    // Unreachable account system: the local session still goes, below.
  }
  createCookieStorage({ mirrorToLocalStorage: false }).removeItem(STORAGE_KEY);
}
