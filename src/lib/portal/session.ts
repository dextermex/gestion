import "server-only";
import { NextResponse } from "next/server";
import type { GestionReader } from "@/lib/demo/data-real";
import { authedClient, getSession, type Session } from "@/lib/supabase/server";

/**
 * The spine of every tenant route: a verified session and a PostgREST
 * client bound to that session's own token. There is no workspace here and
 * no role check in code: the portal policies decide, row by row, what this
 * account may read or write. No service key exists anywhere in this codebase.
 */
export interface TenantContext {
  g: GestionReader;
  session: Session;
}

export async function withTenant(): Promise<TenantContext | NextResponse> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  return { g: authedClient(session.accessToken).schema("gestion"), session };
}
