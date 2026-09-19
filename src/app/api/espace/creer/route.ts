import { NextResponse } from "next/server";
import { getSession } from "@/lib/supabase/server";
import { getIdentity, provisionDefaultWorkspace } from "@/lib/workspace";

/**
 * A signed-in account asking for a management space of its own. Every
 * other account gets one silently on its first visit to /app; a tenant
 * account is sent to its tenant space instead, and asks here when it also
 * has property to manage. Idempotent: an account that already has a space
 * simply gets it back.
 */
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const existing = await getIdentity();
  if (existing?.active) return NextResponse.json({ ok: true, workspaceId: existing.active.id });
  const identity = await provisionDefaultWorkspace();
  if (!identity?.active) return NextResponse.json({ error: "provision_failed" }, { status: 502 });
  return NextResponse.json({ ok: true, workspaceId: identity.active.id });
}
