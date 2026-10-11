/**
 * Whether a request may act on the session cookie, judged by its Origin
 * header. The session lives on the parent domain (`.morada.lu`), so any
 * page on a sibling subdomain is "same site" for the browser and its forms
 * and fetches would carry the cookie: SameSite=Lax alone does not stop
 * them. A browser always names the page that sent a cross-origin request
 * (and every POST, PUT, PATCH or DELETE), so an Origin that is not this
 * application's own is refused, whatever the method.
 *
 * No Origin at all is left alone: a same-origin GET or a top-level
 * navigation carries none, and neither does a server-to-server caller,
 * which has no cookie to ride on anyway. "null" (a sandboxed frame, a
 * file, a redirect chain across sites) is refused. Pure, so it is tested
 * without a request.
 */
export function originAllowed(origin: string | null | undefined, allowed: readonly (string | null | undefined)[]): boolean {
  if (origin === null || origin === undefined || origin === "") return true;
  const asked = originOf(origin);
  if (!asked) return false;
  return allowed.some((a) => a !== null && a !== undefined && originOf(a) === asked);
}

/** The scheme, host and port of a URL, lower-cased; null for anything that is not one. */
export function originOf(raw: string): string | null {
  if (raw === "null") return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * The origin a request was addressed to, as the platform's proxy reports it
 * (Vercel sets x-forwarded-host and x-forwarded-proto), else the Host header.
 * The same reading Next gives `req.nextUrl.origin`.
 */
export function requestOrigin(get: (name: string) => string | null): string | null {
  const host = (get("x-forwarded-host") ?? get("host") ?? "").split(",")[0].trim();
  if (!host) return null;
  const forwarded = (get("x-forwarded-proto") ?? "").split(",")[0].trim();
  const proto = forwarded === "http" || forwarded === "https" ? forwarded : /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? "http" : "https";
  return `${proto}://${host}`;
}
