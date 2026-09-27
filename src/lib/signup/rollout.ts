/**
 * Phone signup rolls out in two steps. `phoneSignupReady` means the funnel at
 * /inscription can work (SMS and CAPTCHA are configured), so it can be tested
 * by opening that URL directly. `phoneSignupEntryEnabled` additionally opens
 * the public doors into it: the marketing site's /connexion?onglet=inscription
 * links, /connexion itself and the root redirect. The entry flag is a plain
 * server variable, read per request, and stays off until a real signup has
 * been proven end to end (docs/SIGNUP-FUNNEL.md).
 */
export function phoneSignupReady(): boolean {
  return process.env.NEXT_PUBLIC_PHONE_SIGNUP_ENABLED === "1" && !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
}

export function phoneSignupEntryEnabled(): boolean {
  return phoneSignupReady() && process.env.PHONE_SIGNUP_ENTRY_ENABLED === "1";
}
