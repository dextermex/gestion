/**
 * The invitation link's token, kept out of addresses. The e-mail's link
 * names it once (`/invitation/<token>`); the middleware then puts it in a
 * cookie only the server reads, scoped to the invitation page, and sends the
 * browser to `/invitation`. From there on the token travels in no address:
 * not in the history, not in the way back through sign-in, sign-up, a
 * password reset or a provider's return, not in a log line. Nothing else is
 * imported here: this file is carried by the middleware.
 */
export const INVITATION_COOKIE = "morada_invitation";
export const INVITATION_PATH = "/invitation";
/** As long as an invitation lives (14 days): the person may come back to finish. */
export const INVITATION_COOKIE_MAX_AGE = 14 * 24 * 3600;

/** A token as the database mints it (256 bits, URL-safe); anything else is not looked up. */
export const isInvitationToken = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(v);

/** The token an `/invitation/<token>` address names, or null. */
export function tokenOfPath(pathname: string): string | null {
  const m = /^\/invitation\/([^/]+)\/?$/.exec(pathname);
  if (!m) return null;
  let token: string;
  try {
    token = decodeURIComponent(m[1]);
  } catch {
    return null;
  }
  return isInvitationToken(token) ? token : null;
}

/** The cookie's options: the server alone reads it, only on the invitation page, over HTTPS where the site is. */
export function invitationCookieOptions(secure: boolean) {
  return { httpOnly: true, sameSite: "lax" as const, secure, path: INVITATION_PATH, maxAge: INVITATION_COOKIE_MAX_AGE };
}
