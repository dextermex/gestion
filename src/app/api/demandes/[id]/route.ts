import { NextRequest, NextResponse } from "next/server";
import { withOrg } from "@/lib/gestion/api";
import { parseRequestStatus, setRequestFollowUp, setRequestStatus, statusOfFailure } from "@/lib/gestion/requests";

/**
 * The owner's status on a tenant request: to handle, in progress, resolved
 * or refused. The request is looked up in the active workspace under the
 * caller's own token; one from elsewhere is not found. The answer carries
 * the status the request now has, which is "in progress" whatever was
 * asked while an intervention is under way on it (`held`).
 *
 * Without a status, the desk's follow-up: `waiting` sets an open request
 * aside while the tenant is waited on (or takes it up again), `dueOn` the
 * day it is to be handled by (a day, or null to clear it). A closed request
 * is not set aside (409 `request_closed`).
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withOrg("write");
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (body.status === undefined && ("waiting" in body || "dueOn" in body)) {
    const waiting = typeof body.waiting === "boolean" ? body.waiting : undefined;
    const dueOn = body.dueOn === null ? null : typeof body.dueOn === "string" ? body.dueOn.slice(0, 10) : undefined;
    if (("waiting" in body && waiting === undefined) || ("dueOn" in body && dueOn === undefined)) return NextResponse.json({ error: "invalid" }, { status: 400 });
    const followed = await setRequestFollowUp(ctx, id, { waiting, dueOn });
    if ("error" in followed) return NextResponse.json({ error: followed.error }, { status: statusOfFailure(followed.error) });
    return NextResponse.json({ ok: true, ticketStatus: followed.status, slaDueAt: followed.slaDueAt });
  }
  const status = parseRequestStatus(body.status);
  if (!status) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const result = await setRequestStatus(ctx, id, status);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: statusOfFailure(result.error) });
  return NextResponse.json({ ok: true, status: result.status, held: result.held });
}
