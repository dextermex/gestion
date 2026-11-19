import type { NextRequest } from "next/server";

/**
 * A GET handler that a plain link points at: a document's file, a download,
 * a template's preview. When it has nothing to hand over, a script still
 * gets the JSON error it reads. A person who followed the link would be left
 * on that JSON, with no way back but the browser's: a browser navigation is
 * sent somewhere instead. To sign in when the session has run out, coming
 * back to the screen the link was on; otherwise to the app's own "this
 * could not be opened" screen, inside the shell, which says why and leads
 * back.
 */

/** A top-level navigation by a browser, as against a script's request. */
export function isNavigation(req: NextRequest): boolean {
  const mode = req.headers.get("sec-fetch-mode");
  if (mode) return mode === "navigate";
  return (req.headers.get("accept") ?? "").includes("text/html");
}

/** The screen of this application the link was on, when the request says so: an internal manager address, never another site's. */
export function cameFrom(req: NextRequest): string | null {
  const referer = req.headers.get("referer");
  if (!referer) return null;
  try {
    const from = new URL(referer);
    if (from.host !== (req.headers.get("host") ?? req.nextUrl.host)) return null;
    if (from.pathname !== "/app" && !from.pathname.startsWith("/app/")) return null;
    return from.pathname + from.search;
  } catch {
    return null;
  }
}

/** What the unavailable screen is told: the three things a person can understand and act on. */
const REASON: Record<number, "absent" | "refuse"> = { 404: "absent", 403: "refuse" };

/** The handler's answer, or, for a person whose link led to an error, the way on. */
export function answerNavigation(req: NextRequest, res: Response): Response {
  if (res.status < 400 || !isNavigation(req)) return res;
  const back = cameFrom(req);
  let to: string;
  if (res.status === 401) {
    to = `/connexion?next=${encodeURIComponent(back ?? "/app")}`;
  } else {
    const q = new URLSearchParams({ raison: REASON[res.status] ?? "echec" });
    if (back) q.set("retour", back);
    to = `/app/documents/indisponible?${q}`;
  }
  // A relative address: the browser resolves it against the one it asked, whatever sits in front of the server.
  return new Response(null, { status: 303, headers: { Location: to, "Cache-Control": "private, no-store" } });
}
