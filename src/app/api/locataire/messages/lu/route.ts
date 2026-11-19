import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/portal/session";
import { markTenantRead } from "@/lib/portal/thread";

/**
 * The tenant has a conversation on their screen: it is read up to the last
 * message shown. The mark is the account's own row in the database, set by
 * `gestion.mark_conversation_read`, which checks that the conversation is
 * one of the caller's tenancies and never lets the mark pass the last
 * message written. The same on every device the tenant signs in on.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const ctx = await withTenant();
  if (ctx instanceof NextResponse) return ctx;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const conversationId = typeof body.conversationId === "string" ? body.conversationId : "";
  const until = typeof body.until === "string" && !Number.isNaN(Date.parse(body.until)) ? body.until : null;
  if (!UUID.test(conversationId)) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const result = await markTenantRead(ctx.g, conversationId, until);
  if ("error" in result) {
    const status = result.error === "forbidden" ? 403 : result.error === "schema_outdated" ? 503 : 502;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true, readUntil: result.readUntil });
}
