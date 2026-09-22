import { NextRequest, NextResponse } from "next/server";
import { withOrg } from "@/lib/gestion/api";
import { addManagerMessage, statusOfFailure } from "@/lib/gestion/requests";

/**
 * The desk's reply on a tenant request: a message on the request's own
 * thread, opened here if the tenant never wrote a follow-up. The request
 * must belong to the active workspace.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const result = await addManagerMessage(ctx, { ticketId: id }, body.body);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: statusOfFailure(result.error) });
  return NextResponse.json({ ok: true, id: result.id, conversationId: result.conversationId });
}
