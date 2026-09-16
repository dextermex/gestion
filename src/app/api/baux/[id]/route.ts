import { NextRequest, NextResponse } from "next/server";
import { withOrg, dbError } from "@/lib/gestion/api";
import { parseEuroInput } from "@/lib/gestion/euros";
import { effectiveMonth, normalizePaymentDay, repriceOpenPeriods } from "@/lib/gestion/lease";

/**
 * Editing a running tenancy: its terms, and what it costs.
 *
 * Money is the delicate part. Changing the rent changes what is owed from a
 * date forward, so the ledger is re-priced from that month — but only for
 * periods nothing has been allocated to. A month the tenant has already paid,
 * or part-paid, is a record of what happened and is never rewritten. The
 * response says how many periods moved, so the owner is told rather than
 * having to trust it.
 */

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const has = (b: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(b, k);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const { g, org } = ctx;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const { data: lease, error: findErr } = await g
    .from("leases")
    .select("id,status,rent_cents,charges_cents,payment_day,start_date")
    .eq("org_id", org.id)
    .eq("id", id)
    .maybeSingle();
  if (findErr) return dbError("lease lookup", findErr);
  if (!lease) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (lease.status === "ended") return NextResponse.json({ error: "lease_ended" }, { status: 409 });

  const patch: Record<string, unknown> = {};
  let rentCents = lease.rent_cents as number;
  let chargesCents = lease.charges_cents as number;
  let moneyChanged = false;

  if (has(body, "rent")) {
    const parsed = parseEuroInput(str(body.rent, 20));
    if (!parsed) return NextResponse.json({ error: "invalid" }, { status: 400 });
    if (parsed !== rentCents) {
      // The previous rent is what an indexation lag is detected against, so
      // it is kept whenever the rent actually moves.
      patch.previous_rent_cents = rentCents;
      rentCents = parsed;
      patch.rent_cents = parsed;
      moneyChanged = true;
    }
  }
  if (has(body, "charges")) {
    const raw = str(body.charges, 20);
    const parsed = raw === "" ? 0 : parseEuroInput(raw);
    if (parsed === null) return NextResponse.json({ error: "invalid" }, { status: 400 });
    if (parsed !== chargesCents) {
      chargesCents = parsed;
      patch.charges_cents = parsed;
      moneyChanged = true;
    }
  }
  if (has(body, "paymentDay")) patch.payment_day = normalizePaymentDay(body.paymentDay);
  if (has(body, "type")) patch.lease_type = body.type === "commercial" ? "commercial" : "residential";
  if (has(body, "startDate") && ISO.test(str(body.startDate, 10))) patch.start_date = str(body.startDate, 10);
  if (has(body, "endDate")) patch.end_date = ISO.test(str(body.endDate, 10)) ? str(body.endDate, 10) : null;
  if (has(body, "chargesRegime")) {
    patch.charges_regime = body.chargesRegime === "forfait" ? "forfait" : "advances";
  }
  if (has(body, "furnished")) patch.furnished = body.furnished === true;

  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });

  const { data, error } = await g.from("leases").update(patch).eq("org_id", org.id).eq("id", id).select("id");
  if (error) return dbError("lease update", error);
  if (!data?.length) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let repriced = 0;
  if (moneyChanged) {
    repriced = await repriceOpenPeriods(ctx, id, rentCents, chargesCents, effectiveMonth(str(body.effectiveFrom, 10)));
  }
  return NextResponse.json({ ok: true, repriced });
}
