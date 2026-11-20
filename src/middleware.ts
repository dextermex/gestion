import { NextResponse, type NextRequest } from "next/server";
import { REQUESTED_PATH_HEADER, requestedPath } from "@/lib/auth/requested-path";
import { INVITATION_COOKIE, INVITATION_PATH, invitationCookieOptions, tokenOfPath } from "@/lib/auth/invitation-token";

/**
 * Two jobs, nothing decided about a session here.
 *
 * The two spaces' layouts are told which address was asked for, so a
 * signed-out visitor is sent to the door with the way back (a link in an
 * e-mail, a bookmark). The header is always overwritten, so a value sent by
 * the caller is never the one the layout reads.
 *
 * An invitation link (`/invitation/<token>`) leaves its token in a cookie
 * only the server reads, and the browser is sent to `/invitation`: the
 * token is then in no address the person keeps, shares or carries through
 * signing in.
 *
 * API routes are outside the matcher: their uploads never pass through this file.
 */
export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (pathname.startsWith(`${INVITATION_PATH}/`)) {
    const token = tokenOfPath(pathname);
    // An address that names no token of the right shape is left to the page, which says the link is not valid.
    if (!token) return NextResponse.next();
    const target = request.nextUrl.clone();
    target.pathname = INVITATION_PATH;
    target.search = search;
    const response = NextResponse.redirect(target, 303);
    response.cookies.set(INVITATION_COOKIE, token, invitationCookieOptions(request.nextUrl.protocol === "https:"));
    // The address that named the token is not sent on as a referrer.
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  }
  const headers = new Headers(request.headers);
  headers.set(REQUESTED_PATH_HEADER, requestedPath(pathname, search));
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/app/:path*", "/locataire/:path*", "/invitation/:token"],
};
