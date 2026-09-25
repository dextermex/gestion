import "server-only";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authedClient, getSession } from "@/lib/supabase/server";
import { getIdentity, type Workspace } from "@/lib/workspace";

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

export async function withOrg(): Promise<OrgContext | NextResponse> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const identity = await getIdentity();
  const org = identity?.active;
  if (!org) return NextResponse.json({ error: "no_workspace" }, { status: 403 });
  return { g: authedClient(session.accessToken).schema("gestion"), org, userId: session.userId };
}

/** The same spine, with the raw client alongside for the bucket (uploads, signed links). */
export async function withOrgAndClient(): Promise<(OrgContext & { client: SupabaseClient }) | NextResponse> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const identity = await getIdentity();
  const org = identity?.active;
  if (!org) return NextResponse.json({ error: "no_workspace" }, { status: 403 });
  const client = authedClient(session.accessToken);
  return { g: client.schema("gestion"), org, userId: session.userId, client };
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
