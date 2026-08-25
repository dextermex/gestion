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

/** Sign out here and everywhere: the shared cookie is cleared too. */
export async function signOutEverywhere(): Promise<void> {
  const db = getSupabase();
  try {
    await db.removeAllChannels();
  } catch {
    // Channel teardown is best-effort.
  }
  await db.auth.signOut();
  createCookieStorage({ mirrorToLocalStorage: true }).removeItem(STORAGE_KEY);
}
