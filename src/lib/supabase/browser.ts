"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createCookieStorage } from "@/lib/sessionCookie";
import { SUPABASE_ANON_KEY, SUPABASE_URL, STORAGE_KEY } from "./config";

/**
 * The browser client. Its session lives in a cookie on `.morada.lu`, which is
 * what lets morada.lu and app.morada.lu share one sign-in; on any other host
 * the cookie stays host-scoped and the app simply works on its own.
 *
 * `flowType` is PKCE: a session delivered through the URL is bound to the
 * code-verifier held by the browser that started the flow, so an attacker's
 * `#access_token` planted in a `/connexion` URL cannot install a session
 * (login CSRF / session fixation). Recovery and magic links keep working on
 * the device that requested them; a link opened on another device must be
 * re-requested, and any link in flight at this change must be reissued.
 */
let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
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
  // Wizard drafts (property, EDL) live in IndexedDB and are not keyed by
  // account: clear them here so the next account on a shared device never
  // resumes the previous one's draft (addresses, cadastre, photos).
  try {
    indexedDB?.deleteDatabase("morada-brouillons");
  } catch {
    // Best-effort: a private window or a blocked store leaves nothing to clear.
  }
}
