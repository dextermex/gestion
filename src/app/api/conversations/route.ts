import { NextResponse } from "next/server";
import { withOrg } from "@/lib/gestion/api";
import { deskUnread } from "@/lib/gestion/requests";
import { unreadSignature } from "@/lib/gestion/threads";

/**
 * Whether anything changed in the workspace's conversations since the
 * screen was drawn: the count of unread messages and the moment of the
 * last one, as one signature the shell compares with its own. One light
 * read of the heads view, asked now and then while the application is open.
 */
export async function GET() {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const state = await deskUnread(ctx);
  return NextResponse.json(
    { ok: true, signature: state ? unreadSignature(state.unread, state.latest) : null, unread: state?.unread ?? null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
