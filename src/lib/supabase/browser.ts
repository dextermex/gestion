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
        storage: createCookieStorage({ mirrorToLocalStorage: true }),
      },
    });
  }
  return client;
}

/**
 * Sign out here and everywhere: every session of this account is revoked
 * (this browser, morada.lu, other devices), and the shared cookie and its
 * localStorage mirror are cleared whatever the account system answered. The
 * next account to sign in on this browser starts from nothing of the
 * previous one.
 */
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
  createCookieStorage({ mirrorToLocalStorage: true }).removeItem(STORAGE_KEY);
}
