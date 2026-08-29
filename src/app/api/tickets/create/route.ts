import { NextRequest, NextResponse } from "next/server";
import { withOrg, dbError } from "@/lib/gestion/api";

/** Creates an intervention on a unit; linked to its running lease if any. */
export async function POST(req: NextRequest) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const { g, org } = ctx;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const unitId = String(body.unitId ?? "");
  const title = String(body.title ?? "").trim().slice(0, 200);
  if (!unitId || !title) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const { data: unit, error: unitErr } = await g
    .from("units")
    .select("id,property_id")
    .eq("org_id", org.id)
    .eq("id", unitId)
    .maybeSingle();
  if (unitErr) return dbError("ticket unit lookup", unitErr);
  if (!unit) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const { data: lease } = await g
    .from("leases")
    .select("id")
    .eq("org_id", org.id)
    .eq("unit_id", unitId)
    .in("status", ["active", "notice"])
    .limit(1)
    .maybeSingle();

  const { data: ticket, error } = await g
    .from("tickets")
    .insert({
      org_id: org.id,
      unit_id: unitId,
      property_id: unit.property_id,
      lease_id: lease?.id ?? null,
      source: "manager",
      category: "other",
      severity: "routine",
      status: "new",
      title,
    })
    .select("id")
    .single();
  if (error || !ticket) return dbError("ticket insert", error);
  return NextResponse.json({ id: ticket.id });
}
