import { NextRequest, NextResponse } from "next/server";
import { withOrg, dbError } from "@/lib/gestion/api";

/**
 * A meter reading.
 *
 * There is no meter API in Luxembourg, so a reading is an assertion by
 * somebody. The manager taking it here acknowledges it on the spot; the
 * tenant's acknowledgement is a separate act and stays empty until they give
 * it, which is what makes the pair meaningful at all.
 */
const SOURCES = ["manual", "edl", "photo_ocr", "import"] as const;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const { g, org } = ctx;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const raw = String(body.value ?? "").replace(/\s/g, "").replace(",", ".");
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return NextResponse.json({ error: "invalid_value" }, { status: 400 });
  const readOn = ISO.test(String(body.readOn ?? "")) ? String(body.readOn) : new Date().toISOString().slice(0, 10);
  const source = (SOURCES as readonly string[]).includes(String(body.source)) ? String(body.source) : "manual";

  const { data: meter, error: meterErr } = await g
    .from("meters")
    .select("id")
    .eq("org_id", org.id)
    .eq("id", id)
    .maybeSingle();
  if (meterErr) return dbError("meter lookup", meterErr);
  if (!meter) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { error } = await g
    .from("meter_readings")
    .insert({
      org_id: org.id,
      meter_id: id,
      read_on: readOn,
      value,
      source,
      manager_ack_at: new Date().toISOString(),
    })
    .select("id");
  if (error) return dbError("meter reading insert", error);
  return NextResponse.json({ ok: true });
}
