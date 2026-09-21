import { NextRequest, NextResponse } from "next/server";
import { withOrg, dbError } from "@/lib/gestion/api";

/**
 * A new lot in an existing property: the building grows one card. The lot
 * belongs to the property it is created under, under the caller's own JWT,
 * so a property of another workspace is simply not found.
 */
const KINDS = ["dwelling", "commercial", "office", "parking", "cellar", "other"] as const;

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown, max: number): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.replace(",", ".")) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
};

export async function POST(req: NextRequest) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const { g, org } = ctx;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const propertyId = str(body.propertyId, 64);
  const label = str(body.label, 60);
  const kind = (KINDS as readonly string[]).includes(String(body.kind)) ? String(body.kind) : "dwelling";
  if (!propertyId || !label) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const { data: property, error: findErr } = await g.from("properties").select("id").eq("org_id", org.id).eq("id", propertyId).is("archived_at", null).maybeSingle();
  if (findErr) return dbError("property lookup", findErr);
  if (!property) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const bedrooms = num(body.bedrooms, 100);
  const { data, error } = await g
    .from("units")
    .insert({
      org_id: org.id,
      property_id: propertyId,
      label,
      kind,
      floor: str(body.floor, 20) || null,
      area_sqm: num(body.areaSqm, 100000),
      rooms: num(body.rooms, 100),
      bedrooms: bedrooms === null ? null : Math.round(bedrooms),
      furnished: body.furnished === true,
    })
    .select("id")
    .single();
  if (error || !data) return dbError("lot insert", error);
  return NextResponse.json({ ok: true, id: String(data.id) });
}
