import { NextRequest, NextResponse } from "next/server";
import { withOrg, dbError } from "@/lib/gestion/api";

/** A bill is paid on a date, or that is taken back. Nothing else about a bill changes after entry. */
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const { g, org } = ctx;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const today = new Date().toISOString().slice(0, 10);
  if (!Object.prototype.hasOwnProperty.call(body, "paidOn")) return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });
  let paidOn: string | null = null;
  if (body.paidOn !== null) {
    const raw = typeof body.paidOn === "string" ? body.paidOn.trim().slice(0, 10) : "";
    if (!ISO.test(raw) || Number.isNaN(Date.parse(raw)) || raw > today) return NextResponse.json({ error: "invalid" }, { status: 400 });
    paidOn = raw;
  }
  const { data, error } = await g.from("bills").update({ paid_on: paidOn }).eq("org_id", org.id).eq("id", id).select("id");
  if (error) return dbError("bill update", error);
  if (!data?.length) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, paidOn });
}
