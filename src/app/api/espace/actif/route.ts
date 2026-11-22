import { NextResponse, type NextRequest } from "next/server";
import { refuseCrossOrigin } from "@/lib/gestion/api";
import { getSession } from "@/lib/supabase/server";
import { WORKSPACE_COOKIE, getIdentity } from "@/lib/workspace";

/**
 * A person who belongs to several management spaces chooses the one to work
 * in. The choice is a cookie this route alone writes, out of reach of
 * scripts, and only for a workspace the account may manage; it is checked
 * again against the memberships on every request, so it never grants
 * anything by itself. It holds on this browser until changed.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ONE_YEAR = 60 * 60 * 24 * 365;

export async function POST(req: NextRequest) {
  const refused = refuseCrossOrigin(req);
  if (refused) return refused;
  const body = (await req.json().catch(() => null)) as { workspaceId?: unknown } | null;
  const id = typeof body?.workspaceId === "string" ? body.workspaceId.trim().toLowerCase() : "";
  if (!UUID.test(id)) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const identity = await getIdentity();
  const workspace = identity?.workspaces.find((w) => w.id.toLowerCase() === id);
  // Not one of the person's own: the same answer as a workspace that does not exist.
  if (!workspace) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const res = NextResponse.json({ ok: true, workspaceId: workspace.id });
  res.cookies.set(WORKSPACE_COOKIE, workspace.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.nextUrl.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https",
    path: "/",
    maxAge: ONE_YEAR,
  });
  return res;
}
