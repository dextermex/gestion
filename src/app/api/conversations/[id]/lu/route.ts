import { NextResponse } from "next/server";
import { withOrg } from "@/lib/gestion/api";
import { markConversationRead, statusOfFailure } from "@/lib/gestion/requests";

/**
 * This conversation is on the desk's screen: what the other side wrote, up
 * to the last message shown, is now read. Read state lives on the messages
 * (the same for every member and device) and says nothing about a
 * request's status.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withOrg("act");
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  // The moment of the last message on the screen: what arrived after it is not read yet.
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const until = typeof body.until === "string" && !Number.isNaN(Date.parse(body.until)) ? body.until : null;

  const result = await markConversationRead(ctx, id, until);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: statusOfFailure(result.error) });
  return NextResponse.json({ ok: true, marked: result.marked });
}
