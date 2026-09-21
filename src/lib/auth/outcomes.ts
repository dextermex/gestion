/**
 * What the account system answered, read into a handful of outcomes the door
 * can put one sentence on. Supabase names its errors with a `code` since
 * auth-js 2.6x and with a message before that: the code is read first, the
 * message second, so the same answer comes out of either generation.
 *
 * Pure: no client, no window. The forms call it with what `signInWithPassword`
 * and `signUp` returned.
 */

export interface AuthErrorLike {
  name?: string;
  status?: number;
  code?: string;
  message?: string;
}

export type SignInOutcome = "ok" | "invalid" | "unconfirmed" | "rate_limited" | "down" | "failed";
export type SignUpOutcome = "session" | "confirm" | "exists" | "weak_password" | "rate_limited" | "down" | "failed";

/** No status at all is a request that never reached the account system. */
const unreachable = (e: AuthErrorLike): boolean => e.name === "AuthRetryableFetchError" || !e.status;

const rateLimited = (e: AuthErrorLike): boolean =>
  e.code === "over_request_rate_limit" || e.code === "over_email_send_rate_limit" || e.status === 429 || /rate limit|too many/i.test(e.message ?? "");

export function signInOutcome(error: AuthErrorLike | null | undefined): SignInOutcome {
  if (!error) return "ok";
  const m = error.message ?? "";
  if (error.code === "invalid_credentials" || /invalid login credentials/i.test(m)) return "invalid";
  if (error.code === "email_not_confirmed" || /email not confirmed/i.test(m)) return "unconfirmed";
  if (rateLimited(error)) return "rate_limited";
  if (unreachable(error)) return "down";
  return "failed";
}

export interface SignUpAnswer {
  user?: { identities?: unknown[] | null } | null;
  session?: unknown;
}

export function signUpOutcome(data: SignUpAnswer | null | undefined, error: AuthErrorLike | null | undefined): SignUpOutcome {
  if (error) {
    const m = error.message ?? "";
    if (error.code === "user_already_exists" || error.code === "email_exists" || /already (been )?registered|already exists/i.test(m)) return "exists";
    if (error.code === "weak_password" || /password should be|weak password/i.test(m)) return "weak_password";
    if (rateLimited(error)) return "rate_limited";
    if (unreachable(error)) return "down";
    return "failed";
  }
  if (data?.session) return "session";
  // With e-mail enumeration protection on, an address that already has an
  // account gets a look-alike answer: a user with no identity and no
  // session, and no e-mail goes out. Telling the visitor "check your inbox"
  // would leave them waiting for a mail that never comes.
  if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) return "exists";
  return "confirm";
}

/**
 * A field's value as the browser holds it when the form is submitted. A
 * password manager that fills a field without firing an input event (Safari
 * does, on page load and from its key menu) leaves a controlled input's state
 * behind; the form's own data never lies about what is in the field.
 */
export function readField(source: { get(name: string): unknown }, name: string, opts: { trim?: boolean } = {}): string {
  const raw = source.get(name);
  const value = typeof raw === "string" ? raw : "";
  return opts.trim === false ? value : value.trim();
}
