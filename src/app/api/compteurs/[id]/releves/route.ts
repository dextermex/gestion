import { NextRequest, NextResponse } from "next/server";
import { withOrg, dbError, isUuid, isoDay, refuseWithout, jsonBody } from "@/lib/gestion/api";
import { todayISO } from "@/lib/clock";

/**
 * A meter reading.
 *
 * There is no meter API in Luxembourg, so a reading is an assertion by
 * somebody. The manager taking it here acknowledges it on the spot; the
 * tenant's acknowledgement is a separate act and stays empty until they give
 * it, which is what makes the pair meaningful at all.
 */
const SOURCES = ["manual", "edl", "photo_ocr", "import"] as const;
/** No meter of a home counts past this: a larger figure is a typing error (the column holds twelve digits). */
const MAX_READING = 999_999_999;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withOrg("write");
  if (ctx instanceof NextResponse) return ctx;
  const { g, org } = ctx;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const refused = await refuseWithout(ctx, "gestion.properties.edit");
  if (refused) return refused;
  const body = await jsonBody(req);

  const raw = String(body.value ?? "").replace(/\s/g, "").replace(",", ".");
  const value = raw === "" ? Number.NaN : Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > MAX_READING) return NextResponse.json({ error: "invalid_value" }, { status: 400 });
  // Today when no day is given. A departure recorded ahead dates its readings
  // on the planned last day, so a day to come is accepted within a year; a
  // day that does not exist, or further away, is a typing error.
  const today = todayISO();
  const givenDay = body.readOn === undefined || body.readOn === null || body.readOn === "" ? today : isoDay(body.readOn);
  const horizon = `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`;
  if (!givenDay || givenDay > horizon) return NextResponse.json({ error: "invalid_date" }, { status: 400 });
  const readOn = givenDay;
  const givenSource = String(body.source ?? "");
  if (givenSource !== "" && !(SOURCES as readonly string[]).includes(givenSource)) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const source = givenSource || "manual";

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
