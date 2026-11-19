import "server-only";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authedClient, getSession } from "@/lib/supabase/server";
import { getIdentity, type Workspace } from "@/lib/workspace";
import { refuseWhenLocked } from "@/lib/billing/gate";

/**
 * The shared spine of every gestion write route: a signed-in session, an
 * active workspace, and a PostgREST client bound to the caller's own JWT.
 * RLS decides — no service key exists anywhere in this codebase.
 */

export interface OrgContext {
  g: ReturnType<ReturnType<typeof authedClient>["schema"]>;
  org: Workspace;
  userId: string;
}

/**
 * What a handler does with the workspace. A "write" is refused (402
 * `subscription_required`) once the trial is over with nothing subscribed:
 * the records stay readable, nothing is deleted. An "act" changes something
 * that stays open after the trial (marking a conversation read, reading a
 * signature's status back, subscribing). A route that does not say is a
 * read, so a route added without it is never locked by mistake.
 *
 * A write and an act are accepted from this application's own pages only
 * (see `originAllowed`); a read is refused only when it names another origin.
 */
export type Access = "read" | "write" | "act";

/* ---------------------------------------------------------------------------
 * Same origin. The session is a cookie the browser attaches by itself, so a
 * request that changes something must show it was sent by one of this
 * application's own pages. A browser states the sending page's origin in the
 * `Origin` header on every request that is not a plain GET or HEAD, and on
 * every request to another origin: when the header is there it must be this
 * application's own, and it may be missing only on a GET or a HEAD (an
 * address typed, a link followed, a file opened).
 * ------------------------------------------------------------------------- */

/** The rule itself. `own` lists the origins this request was addressed to. */
export function originAllowed(method: string, origin: string | null, own: readonly string[]): boolean {
  if (origin === null || origin === "") {
    const m = method.toUpperCase();
    return m === "GET" || m === "HEAD";
  }
  return own.includes(origin);
}

/**
 * The origins the request was addressed to: the host it named, under the
 * scheme the platform says it arrived on, and its own address. The framework
 * rewrites a loopback address to "localhost" in a request's URL, so the host
 * header is what matches a browser on 127.0.0.1. Without a proxy in front
 * (a local server) nothing states the scheme, and both are the same machine.
 */
function ownOrigins(h: Headers, url?: string): string[] {
  const out = new Set<string>();
  if (url) {
    try {
      out.add(new URL(url).origin);
    } catch {
      /* a relative address names no origin */
    }
  }
  const forwardedProto = (h.get("x-forwarded-proto") ?? "").split(",")[0].trim().toLowerCase();
  const schemes = forwardedProto === "http" || forwardedProto === "https" ? [forwardedProto] : ["http", "https"];
  for (const name of ["host", "x-forwarded-host"]) {
    const host = (h.get(name) ?? "").split(",")[0].trim().toLowerCase();
    if (host === "") continue;
    for (const scheme of schemes) out.add(`${scheme}://${host}`);
  }
  return [...out];
}

const crossOrigin = (): NextResponse => NextResponse.json({ error: "forbidden", reason: "origin" }, { status: 403 });

/**
 * For a route that authenticates by itself and holds the request: the 403
 * to answer, or null when the request comes from this application.
 */
export function refuseCrossOrigin(req: Request): NextResponse | null {
  return originAllowed(req.method, req.headers.get("origin"), ownOrigins(req.headers, req.url)) ? null : crossOrigin();
}

/**
 * The same rule where the handler did not pass its request (`withOrg`,
 * `withOrgAndClient`, `withTenant`): the headers are read from the request
 * in progress, and what the handler does stands for the method, since a
 * write or an act is never a GET.
 */
export async function refuseCrossOriginHere(changes: boolean): Promise<NextResponse | null> {
  let h: Headers;
  try {
    h = await headers();
  } catch {
    // No request in progress: a unit test calling a route's spine directly.
    // A deployed handler always has one, and is refused if it ever does not.
    return process.env.NODE_ENV === "test" ? null : crossOrigin();
  }
  return originAllowed(changes ? "POST" : "GET", h.get("origin"), ownOrigins(h)) ? null : crossOrigin();
}

export async function withOrg(access: Access = "read"): Promise<OrgContext | NextResponse> {
  const refused = await refuseCrossOriginHere(access !== "read");
  if (refused) return refused;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const identity = await getIdentity();
  const org = identity?.active;
  if (!org) return NextResponse.json({ error: "no_workspace" }, { status: 403 });
  if (access === "write") {
    const locked = await refuseWhenLocked(org);
    if (locked) return locked;
  }
  return { g: authedClient(session.accessToken).schema("gestion"), org, userId: session.userId };
}

/** The same spine, with the raw client alongside for the bucket (uploads, signed links). */
export async function withOrgAndClient(access: Access = "read"): Promise<(OrgContext & { client: SupabaseClient }) | NextResponse> {
  const refused = await refuseCrossOriginHere(access !== "read");
  if (refused) return refused;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const identity = await getIdentity();
  const org = identity?.active;
  if (!org) return NextResponse.json({ error: "no_workspace" }, { status: 403 });
  if (access === "write") {
    const locked = await refuseWhenLocked(org);
    if (locked) return locked;
  }
  const client = authedClient(session.accessToken);
  return { g: client.schema("gestion"), org, userId: session.userId, client };
}

/**
 * Whether the caller holds a permission in the workspace, asked of the
 * database: `gestion.can` is the predicate behind every policy, so the
 * answer here is the one a write would get. Fails closed.
 */
export async function can(ctx: Pick<OrgContext, "g" | "org">, permission: string): Promise<boolean> {
  try {
    const { data, error } = await ctx.g.rpc("can", { p_org: ctx.org.id, p_perm: permission });
    if (error) console.error("permission check failed:", permission, error.code);
    return !error && data === true;
  } catch {
    return false;
  }
}

/** What a role may not do is refused before anything is attempted: the 403 to answer, or null. */
export async function refuseWithout(ctx: Pick<OrgContext, "g" | "org">, permission: string): Promise<NextResponse | null> {
  return (await can(ctx, permission)) ? null : NextResponse.json({ error: "forbidden", permission }, { status: 403 });
}

/** Uniform PostgREST error mapping, logging the detail server-side only. */
export function dbError(context: string, error: { code?: string; message?: string } | null): NextResponse {
  const code = error?.code;
  if (code === "PGRST106") return NextResponse.json({ error: "schema_unexposed" }, { status: 503 });
  // A table or view this build expects that the database does not have yet: the migration is pending.
  if (code === "PGRST205" || code === "42P01") return NextResponse.json({ error: "schema_outdated" }, { status: 503 });
  if (code === "42501") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  console.error(`${context} failed:`, code, error?.message);
  return NextResponse.json({ error: "storage_failed" }, { status: 502 });
}
