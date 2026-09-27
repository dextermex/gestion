import "server-only";
import type { UserAttributes } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/config";
import { AUTH_APP_URL } from "@/lib/auth/redirects";

/**
 * Update Auth as the cookie's verified user, without a refresh token.
 * A server Supabase client has no persisted session; auth.updateUser would
 * fail with AuthSessionMissingError even with an Authorization header.
 */
export async function updateSignupUser(accessToken: string, attributes: UserAttributes) {
  const url = new URL(SUPABASE_URL + "/auth/v1/user");
  if (attributes.email) url.searchParams.set("redirect_to", AUTH_APP_URL + "/inscription");
  const response = await fetch(url.toString(), {
    method: "PUT",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: "Bearer " + accessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(attributes),
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (response.ok) return { error: null };
  const payload = await response.json().catch(() => ({}));
  return { error: { code: String(payload.error_code ?? payload.code ?? "save_failed") } };
}
