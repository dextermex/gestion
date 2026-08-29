import { NextRequest, NextResponse } from "next/server";
import { withOrg, dbError } from "@/lib/gestion/api";

const KINDS = ["electricity", "gas", "water_cold", "water_hot", "heat"] as const;

/**
 * Registers a meter on a unit, or on a property's common areas when the
 * target is `common-<propertyId>` (the option shape the sheet already uses).
 */
export async function POST(req: NextRequest) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const { g, org } = ctx;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const kind = (KINDS as readonly string[]).includes(String(body.kind)) ? String(body.kind) : "electricity";
  const serial = String(body.serial ?? "").trim().slice(0, 60);
  const supplier = String(body.supplier ?? "").trim().slice(0, 120);
  const target = String(body.target ?? "");
  if (!serial || !target) return NextResponse.json({ error: "invalid" }, { status: 400 });

  let propertyId: string;
  let unitId: string | null;
  if (target.startsWith("common-")) {
    propertyId = target.slice("common-".length);
    unitId = null;
    const { data: property, error } = await g
      .from("properties")
      .select("id")
      .eq("org_id", org.id)
      .eq("id", propertyId)
      .maybeSingle();
    if (error) return dbError("meter property lookup", error);
    if (!property) return NextResponse.json({ error: "invalid" }, { status: 400 });
  } else {
    const { data: unit, error } = await g
      .from("units")
      .select("id,property_id")
      .eq("org_id", org.id)
      .eq("id", target)
      .maybeSingle();
    if (error) return dbError("meter unit lookup", error);
    if (!unit) return NextResponse.json({ error: "invalid" }, { status: 400 });
    propertyId = unit.property_id as string;
    unitId = unit.id as string;
  }

  const { data: meter, error } = await g
    .from("meters")
    .insert({ org_id: org.id, property_id: propertyId, unit_id: unitId, kind, serial_number: serial, supplier })
    .select("id")
    .single();
  if (error || !meter) return dbError("meter insert", error);
  return NextResponse.json({ id: meter.id });
}
