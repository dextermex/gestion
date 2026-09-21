import { NextRequest, NextResponse } from "next/server";
import { withOrg, dbError } from "@/lib/gestion/api";

/** A lot's own characteristics. Its property never changes here: a unit that
 *  moved building would be a different unit, and its lease history would have
 *  to move with it. */
const KINDS = ["dwelling", "commercial", "office", "parking", "cellar", "other"] as const;

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown, max: number): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.replace(",", ".")) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
};
const has = (b: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(b, k);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const { g, org } = ctx;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  if (body.action === "archive") {
    // A lot still under a live lease cannot be retired: the tenancy would
    // have nowhere to live.
    const { data: live, error: liveErr } = await g
      .from("leases")
      .select("id")
      .eq("org_id", org.id)
      .eq("unit_id", id)
      .in("status", ["active", "notice"])
      .limit(1);
    if (liveErr) return dbError("lot occupancy lookup", liveErr);
    if ((live ?? []).length > 0) return NextResponse.json({ error: "still_let" }, { status: 409 });
    const { data, error } = await g
      .from("units")
      .update({ archived_at: new Date().toISOString() })
      .eq("org_id", org.id)
      .eq("id", id)
      .select("id");
    if (error) return dbError("lot archive", error);
    if (!data?.length) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  }

  const patch: Record<string, unknown> = {};
  if (has(body, "label")) {
    const label = str(body.label, 60);
    if (!label) return NextResponse.json({ error: "invalid" }, { status: 400 });
    patch.label = label;
  }
  if (has(body, "kind") && (KINDS as readonly string[]).includes(String(body.kind))) patch.kind = String(body.kind);
  if (has(body, "floor")) patch.floor = str(body.floor, 20) || null;
  if (has(body, "areaSqm")) patch.area_sqm = num(body.areaSqm, 100000);
  if (has(body, "rooms")) patch.rooms = num(body.rooms, 100);
  if (has(body, "bedrooms")) {
    const b = num(body.bedrooms, 100);
    patch.bedrooms = b === null ? null : Math.round(b);
  }
  if (has(body, "furnished")) patch.furnished = body.furnished === true;
  if (has(body, "photoUrl") && body.photoUrl === null) patch.photo_url = null;

  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });
  const { data, error } = await g.from("units").update(patch).eq("org_id", org.id).eq("id", id).select("id");
  if (error) return dbError("lot update", error);
  if (!data?.length) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
