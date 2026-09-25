import { NextRequest, NextResponse } from "next/server";
import { withOrg, dbError } from "@/lib/gestion/api";

/**
 * An état des lieux: the room-by-room record that decides, months later,
 * what a deposit may lawfully be reduced by.
 *
 * It is written as one session plus its items, and the meter readings taken
 * during the walk-through go in at the same time, so nobody has to key the
 * same numbers twice. Keys are recorded on the session rather than assumed:
 * handing keys over before a contradictory EDL exists is the failure mode
 * that makes a deposit unusable, so the moment is stored explicitly.
 */

const KINDS = ["entry", "intermediate", "exit"] as const;
const CATEGORIES = [
  "paint",
  "floors",
  "interior_joinery",
  "exterior_joinery",
  "tiling",
  "plumbing",
  "electrics",
  "heating",
  "gas",
  "appliances",
  "keys",
  "meters",
  "other",
] as const;
const CONDITIONS = ["new", "good", "fair", "poor", "damaged"] as const;

type ItemInput = { room?: string; category?: string; condition?: string; notes?: string };
type ReadingInput = { meterId?: string; value?: string | number };

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: NextRequest) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const { g, org } = ctx;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const leaseId = str(body.leaseId, 64);
  const kind = (KINDS as readonly string[]).includes(String(body.kind)) ? String(body.kind) : "entry";
  if (!leaseId) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const { data: lease, error: leaseErr } = await g
    .from("leases")
    .select("id")
    .eq("org_id", org.id)
    .eq("id", leaseId)
    .maybeSingle();
  if (leaseErr) return dbError("edl lease lookup", leaseErr);
  if (!lease) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const items = (Array.isArray(body.items) ? (body.items as ItemInput[]) : [])
    .filter((i) => str(i.room, 80) !== "")
    .slice(0, 400);
  const completed = str(body.completedAt, 10);
  const completedAt = ISO.test(completed) ? `${completed}T12:00:00.000Z` : new Date().toISOString();
  // A walk-through with nothing recorded is a plan, not an inventory.
  const status = items.length === 0 ? "draft" : body.signed === true ? "signed" : "in_progress";

  const { data: session, error: sErr } = await g
    .from("edl_sessions")
    .insert({
      org_id: org.id,
      lease_id: leaseId,
      kind,
      status,
      scheduled_at: completedAt,
      completed_at: items.length === 0 ? null : completedAt,
      key_handover_at: body.keysHandedOver === true ? completedAt : null,
    })
    .select("id")
    .single();
  if (sErr || !session) return dbError("edl session insert", sErr);

  // The items come back with their ids: the photos taken during the walk
  // are attached to them next, one upload each.
  let written: Array<{ id: string; room: string; category: string }> = [];
  if (items.length > 0) {
    const rows = items.map((i) => ({
      org_id: org.id,
      session_id: session.id as string,
      room: str(i.room, 80),
      category: (CATEGORIES as readonly string[]).includes(String(i.category)) ? String(i.category) : "other",
      condition: (CONDITIONS as readonly string[]).includes(String(i.condition)) ? String(i.condition) : "good",
      notes: str(i.notes, 1000) || null,
    }));
    const { data: inserted, error: iErr } = await g.from("edl_items").insert(rows).select("id,room,category");
    // The session is real even if an item failed; losing the whole walk-through
    // over one row would be worse than an incomplete one the owner can fix.
    if (iErr) console.error("edl items insert failed:", iErr.code, iErr.message);
    written = ((inserted ?? []) as Array<{ id: string; room: string; category: string }>).map((r) => ({ id: String(r.id), room: String(r.room), category: String(r.category) }));
  }

  // Readings taken during the walk-through, sourced as `edl` so the meter
  // history says where the number came from.
  const readings = (Array.isArray(body.readings) ? (body.readings as ReadingInput[]) : []).slice(0, 50);
  let readingsWritten = 0;
  if (readings.length > 0) {
    const { data: meters } = await g.from("meters").select("id").eq("org_id", org.id);
    const known = new Set(((meters as Array<{ id: string }> | null) ?? []).map((m) => m.id));
    const rows = readings
      .map((r) => {
        const value = Number(String(r.value ?? "").replace(/\s/g, "").replace(",", "."));
        return { meterId: str(r.meterId, 64), value };
      })
      .filter((r) => known.has(r.meterId) && Number.isFinite(r.value) && r.value >= 0)
      .map((r) => ({
        org_id: org.id,
        meter_id: r.meterId,
        read_on: completedAt.slice(0, 10),
        value: r.value,
        source: "edl",
        manager_ack_at: new Date().toISOString(),
      }));
    if (rows.length > 0) {
      const { error: rErr } = await g.from("meter_readings").insert(rows);
      if (rErr) console.error("edl readings insert failed:", rErr.code, rErr.message);
      else readingsWritten = rows.length;
    }
  }

  return NextResponse.json({ id: session.id, status, items: written.length, itemRows: written, readings: readingsWritten });
}
