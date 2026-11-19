import { NextResponse, type NextRequest } from "next/server";
import { REQUESTED_PATH_HEADER, requestedPath } from "@/lib/auth/requested-path";

/**
 * One job: tell the two spaces' layouts which address was asked for, so a
 * signed-out visitor is sent to the door with the way back (a link in an
 * e-mail, a bookmark). No session is read here and nothing is decided here.
 * The header is always overwritten, so a value sent by the caller is never
 * the one the layout reads. API routes are outside the matcher: their
 * uploads never pass through this file.
 */
export function middleware(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set(REQUESTED_PATH_HEADER, requestedPath(request.nextUrl.pathname, request.nextUrl.search));
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/app/:path*", "/locataire/:path*"],
};
