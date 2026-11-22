import { NextRequest, NextResponse } from "next/server";
import { withOrg } from "@/lib/gestion/api";
import { moveOutParty } from "@/lib/gestion/lease";

/**
 * Someone leaves a tenancy that goes on: `movedOutOn` (YYYY-MM-DD) is the
 * day they are out. The last tenant of a tenancy in force is refused (409
 * `last_tenant`): that is a departure, and the lease closes through it.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; partyId: string }> }) {
  const ctx = await withOrg("write");
  if (ctx instanceof NextResponse) return ctx;
  const { id, partyId } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const movedOutOn = typeof body.movedOutOn === "string" ? body.movedOutOn.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(movedOutOn)) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const result = await moveOutParty(ctx, id, partyId, movedOutOn);
  if ("error" in result) {
    const status = result.error === "not_found" ? 404 : result.error === "invalid" ? 400 : result.error === "storage_failed" ? 502 : 409;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true });
}
