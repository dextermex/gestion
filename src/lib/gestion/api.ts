import "server-only";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { APP_URL } from "@/lib/constants";
import { originAllowed, requestOrigin } from "@/lib/origin";
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
 * the records stay readable, nothing is deleted. A route that does not say
 * is a read, so a route added without it is never locked by mistake.
 */
export type Access = "read" | "write";

/**
 * The session cookie sits on the parent domain, so a page on any morada.lu
 * subdomain could make the browser send it here. A request whose Origin is
 * not this application's own is refused before the session is read (403
 * `forbidden`, as the billing and sign-up routes answer). No Origin is let
 * through: navigations, same-origin GETs and server-to-server calls carry
 * none. Webhooks and the cron do not use these wrappers; they keep their
 * own signature or bearer checks.
 */
export async function refuseForeignOrigin(): Promise<NextResponse | null> {
  const h = await headers();
  if (originAllowed(h.get("origin"), [APP_URL, requestOrigin((name) => h.get(name))])) return null;
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}

export async function withOrg(access: Access = "read"): Promise<OrgContext | NextResponse> {
  const foreign = await refuseForeignOrigin();
  if (foreign) return foreign;
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
  const foreign = await refuseForeignOrigin();
  if (foreign) return foreign;
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

type PermReader = Pick<OrgContext["g"], "rpc">;

/**
 * Whether the caller holds a permission on the workspace, asked of
 * `gestion.can`, the very predicate the RLS policies evaluate, under the
 * caller's own token. For a route that acts outside the database first (a
 * provider call, an e-mail) and so cannot wait for a policy to say no.
 * Fails closed: an unreachable answer is a no.
 */
export async function hasPerm(g: PermReader, orgId: string, perm: string): Promise<boolean> {
  const { data, error } = await g.rpc("can", { p_org: orgId, p_perm: perm });
  if (error) {
    console.error("permission check failed:", error.code, error.message);
    return false;
  }
  return data === true;
}

/** 403 `forbidden` unless the caller holds the permission on the active workspace. */
export async function requirePerm(ctx: OrgContext, perm: string): Promise<NextResponse | null> {
  return (await hasPerm(ctx.g, ctx.org.id, perm)) ? null : NextResponse.json({ error: "forbidden" }, { status: 403 });
}

/** 429 `rate_limited`, with the wait a client should respect. */
export function rateLimited(retryAfterSec: number): NextResponse {
  return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(retryAfterSec) } });
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
