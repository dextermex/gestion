const PRODUCTION_APP_URL = "https://app.morada.lu";

/** Email links must work away from the device that requested them. Local
 * callbacks are opt-in for development, never a production fallback. */
export function authAppUrl(configured: string | undefined, development: boolean): string {
  if (!configured?.trim()) return PRODUCTION_APP_URL;
  try {
    const url = new URL(configured);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return PRODUCTION_APP_URL;
    if (loopback && !development) return PRODUCTION_APP_URL;
    if (url.protocol !== "https:" && !(development && loopback && url.protocol === "http:")) return PRODUCTION_APP_URL;
    return url.origin;
  } catch { return PRODUCTION_APP_URL; }
}

export const AUTH_APP_URL = authAppUrl(process.env.NEXT_PUBLIC_APP_URL, process.env.NODE_ENV === "development");
