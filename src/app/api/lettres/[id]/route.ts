import { NextRequest, NextResponse } from "next/server";
import { withOrg, dbError } from "@/lib/gestion/api";

/**
 * A registered letter's fate: the AR came back on a date (from which legal
 * effect runs, through the generated legal_effect_on column), or the letter
 * came back undelivered. Nothing else about a letter changes after dispatch.
 */
const isoDay = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const { g, org } = ctx;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const today = new Date().toISOString().slice(0, 10);

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
  const { error } = await g.from("registered_letters").update(patch).eq("org_id", org.id).eq("id", id);
  if (error) return dbError("registered letter update", error);
  return NextResponse.json({ ok: true });
}
