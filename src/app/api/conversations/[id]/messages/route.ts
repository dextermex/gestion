import { NextRequest, NextResponse } from "next/server";
import { withOrg } from "@/lib/gestion/api";
import { clientMessageId } from "@/lib/gestion/threads";
import { addManagerMessage, readConversation, statusOfFailure } from "@/lib/gestion/requests";
import { threadMessageLine } from "@/lib/gestion/threads";
import { getI18n } from "@/lib/i18n";

/**
 * One conversation of the active workspace, for the Messages screen: the
 * page reads a single conversation in full and the screen asks for any
 * other one here, by its own request, when it is opened. `?avant=<moment>`
 * asks for the messages before that moment. Each line comes printed (the
 * day, the hour on Luxembourg's clock), the way the page prints its own.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const before = req.nextUrl.searchParams.get("avant");
  if (before !== null && Number.isNaN(Date.parse(before))) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const result = await readConversation(ctx, id, { before });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: statusOfFailure(result.error) });
  const { locale } = await getI18n();
  return NextResponse.json(
    { ok: true, id, messages: result.messages.map((m) => threadMessageLine(m, locale)), earlier: result.earlier },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** A message from the desk on any conversation of the active workspace. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withOrg("write");
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const result = await addManagerMessage(ctx, { conversationId: id }, body.body, clientMessageId(body.clientId));
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: statusOfFailure(result.error) });
  return NextResponse.json({ ok: true, id: result.id, conversationId: result.conversationId, mail: result.mail });
}
