import { NextResponse } from "next/server";
import { withOrg } from "@/lib/gestion/api";
import { markConversationRead, statusOfFailure } from "@/lib/gestion/requests";

/**
 * The desk opened this thread: what the other side wrote is now read.
 * Read state lives on the messages and says nothing about a request's
 * status.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;

  const result = await markConversationRead(ctx, id);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: statusOfFailure(result.error) });
  return NextResponse.json({ ok: true, marked: result.marked });
}
