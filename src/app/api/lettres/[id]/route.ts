import { NextRequest, NextResponse } from "next/server";
import { withOrg, dbError, isUuid, isoDay, refuseWithout, jsonBody } from "@/lib/gestion/api";
import { todayISO } from "@/lib/clock";

/**
 * A registered letter's fate: the AR came back on a date (from which legal
 * effect runs, through the generated legal_effect_on column), or the letter
 * came back undelivered. Nothing else about a letter changes after dispatch.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withOrg("write");
  if (ctx instanceof NextResponse) return ctx;
  const { g, org } = ctx;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const refused = await refuseWithout(ctx, "gestion.leases.edit");
  if (refused) return refused;
  const body = await jsonBody(req);
  const today = todayISO();

  const { data: letter, error: readErr } = await g.from("registered_letters").select("id,status,dispatched_on").eq("org_id", org.id).eq("id", id).maybeSingle();
  if (readErr) return dbError("registered letter lookup", readErr);
  if (!letter) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (letter.status !== "dispatched") return NextResponse.json({ error: "already" }, { status: 409 });

  let patch: Record<string, unknown>;
  if (body.status === "returned_undelivered") {
    patch = { status: "returned_undelivered" };
  } else {
    const arReceivedOn = isoDay(body.arReceivedOn);
    const dispatchedOn = letter.dispatched_on ? String(letter.dispatched_on).slice(0, 10) : null;
    if (!arReceivedOn || arReceivedOn > today || (dispatchedOn && arReceivedOn < dispatchedOn)) return NextResponse.json({ error: "invalid" }, { status: 400 });
    patch = { status: "ar_received", ar_received_on: arReceivedOn };
  }
  // Only a letter still on its way changes: the status read above is part of
  // the write, so two answers for one letter cannot both land, and "ok" is
  // said only of a row that changed.
  const { data, error } = await g.from("registered_letters").update(patch).eq("org_id", org.id).eq("id", id).eq("status", "dispatched").select("id");
  if (error) return dbError("registered letter update", error);
  if (!data?.length) return NextResponse.json({ error: "already" }, { status: 409 });
  return NextResponse.json({ ok: true });
}
