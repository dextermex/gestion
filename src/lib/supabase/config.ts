/**
 * The Morada Supabase project. Exactly the same project, URL and publishable
 * key as morada.lu and Morada Pro: one `auth.users`, one identity, three
 * spaces. Nothing here is secret — the publishable key is designed to sit in
 * the browser, and every table it can reach is protected by RLS.
 *
 * There is no service-role key anywhere in this application, by design.
 *
 * The environment wins when it is set, so a preview can be pointed at another
 * Supabase project without touching the code (see `.env.example`). The
 * literals below are the production defaults, kept so that a fresh deployment
 * works before anything has been configured.
 */
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://lgmoocvumiuqjcqnrlej.supabase.co";

export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "sb_publishable_op56tIbcBkl6dOI7ZHdO7w_YzW4TAm3";

/** The session key Morada already uses, so the cookie is literally the same. */
export const STORAGE_KEY = "morada_auth";
