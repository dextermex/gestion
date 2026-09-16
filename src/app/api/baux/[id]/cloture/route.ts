import { NextRequest, NextResponse } from "next/server";
import { withOrg, dbError } from "@/lib/gestion/api";
import { parseEuroInput } from "@/lib/gestion/euros";

/**
 * A tenant leaves.
 *
 * This is the one operation that must not destroy anything. The lease is
 * closed, not deleted: it keeps its tenant, its rent, its payments, its
 * inventory and its documents, and it becomes the property's history. What
 * ends is the future — the months that would have been owed and never will
 * be, and only those that nothing has been allocated to. A period somebody
 * actually paid stays, because it happened.
 *
 * After this the lot is free, the tenant is a former tenant of this property,
 * and "Ajouter un locataire" is available again. The next tenancy is a new
 * lease with its own ledger; the two are never mixed.
 */

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const OUTCOMES = ["release_pending", "released", "partially_released", "forfeited", "disputed"] as const;
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** The first day of the month after `date`. Periods from here on are future. */
function monthAfter(date: string): string {
  const [y, m] = date.slice(0, 7).split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const { g, org } = ctx;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const { data: lease, error: findErr } = await g
    .from("leases")
    .select("id,status,start_date,unit_id")
    .eq("org_id", org.id)
    .eq("id", id)
    .maybeSingle();
  if (findErr) return dbError("closure lease lookup", findErr);
  if (!lease) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (lease.status === "ended") return NextResponse.json({ error: "already_ended" }, { status: 409 });

  const endDate = ISO.test(str(body.endDate, 10)) ? str(body.endDate, 10) : new Date().toISOString().slice(0, 10);
  if (endDate <= (lease.start_date as string)) {
    return NextResponse.json({ error: "end_before_start" }, { status: 400 });
  }

  // 1. The lease closes. Its rows stay exactly where they are.
  const { data: closed, error: closeErr } = await g
    .from("leases")
    .update({ status: "ended", end_date: endDate })
    .eq("org_id", org.id)
    .eq("id", id)
    .select("id");
  if (closeErr) return dbError("lease closure", closeErr);
  if (!closed?.length) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // 2. The parties moved out on that date, so the lot reads as free.
  const { error: partyErr } = await g
    .from("lease_parties")
    .update({ moved_out_on: endDate })
    .eq("org_id", org.id)
    .eq("lease_id", id)
    .is("moved_out_on", null);
  if (partyErr) console.error("lease party move-out failed:", partyErr.code, partyErr.message);

  // 3. Months after the departure that nobody paid are dropped: they would
  //    otherwise show as arrears against a tenant who had already left.
  //    Anything with money against it is history and survives.
  let droppedPeriods = 0;
  const from = monthAfter(endDate);
  const [{ data: future }, { data: statuses }] = await Promise.all([
    g.from("rent_periods").select("id").eq("org_id", org.id).eq("lease_id", id).gte("period", from),
    g.from("rent_period_status").select("id,allocated_cents").eq("lease_id", id),
  ]);
  const allocated = new Map<string, number>();
  for (const row of (statuses as Array<{ id: string; allocated_cents: number }> | null) ?? []) {
    allocated.set(row.id, row.allocated_cents ?? 0);
  }
  const removable = ((future as Array<{ id: string }> | null) ?? []).filter((p) => (allocated.get(p.id) ?? 0) === 0);
  if (removable.length > 0) {
    const { error: delErr } = await g
      .from("rent_periods")
      .delete()
      .eq("org_id", org.id)
      .in("id", removable.map((p) => p.id));
    if (delErr) console.error("future period cleanup failed:", delErr.code, delErr.message);
    else droppedPeriods = removable.length;
  }

  // 4. The guarantee moves to wherever the owner says it stands. The
  //    settlement engine still governs what may be deducted; this only
  //    records the outcome the owner reached.
  const outcome = (OUTCOMES as readonly string[]).includes(String(body.depositOutcome))
    ? String(body.depositOutcome)
    : "release_pending";
  const releasedCents = parseEuroInput(str(body.releasedAmount, 20)) ?? 0;
  const { data: deposit } = await g
    .from("deposits")
    .select("id")
    .eq("org_id", org.id)
    .eq("lease_id", id)
    .maybeSingle();
  if (deposit) {
    const patch: Record<string, unknown> = { status: outcome };
    if (body.keysReturned === true) patch.key_handover_on = endDate;
    if (releasedCents > 0) patch.released_balance_cents = releasedCents;
    if (ISO.test(str(body.decompteIssuedOn, 10))) patch.decompte_issued_on = str(body.decompteIssuedOn, 10);
    const { error: depErr } = await g.from("deposits").update(patch).eq("org_id", org.id).eq("id", deposit.id);
    if (depErr) console.error("deposit closure failed:", depErr.code, depErr.message);
  }

  return NextResponse.json({
    ok: true,
    endDate,
    droppedPeriods,
    unitId: lease.unit_id,
    depositOutcome: outcome,
  });
}
