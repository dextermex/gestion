import { NextRequest, NextResponse } from "next/server";
import { withOrg, dbError } from "@/lib/gestion/api";
import { parseEuroInput } from "@/lib/gestion/euros";
import { isPaymentError, recordPaymentFifo } from "@/lib/banking/allocate";

/**
 * Records a manual payment on a lease and allocates it FIFO to the oldest
 * open periods, through the same writer a matched bank operation uses.
 * Paid-ness stays derived: the rent_period_status view reads these
 * allocations, nothing here flips a boolean.
 */
export async function POST(req: NextRequest) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const { g, org } = ctx;
  const today = new Date().toISOString().slice(0, 10);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const leaseId = String(body.leaseId ?? "");
  const amountCents = parseEuroInput(String(body.amount ?? ""));
  const receivedOn = /^\d{4}-\d{2}-\d{2}$/.test(String(body.receivedOn)) ? String(body.receivedOn) : today;
  if (!leaseId || !amountCents) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const { data: lease, error: leaseErr } = await g
    .from("leases")
    .select("id")
    .eq("org_id", org.id)
    .eq("id", leaseId)
    .maybeSingle();
  if (leaseErr) return dbError("payment lease lookup", leaseErr);
  if (!lease) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const outcome = await recordPaymentFifo(g, org.id, { leaseId, amountCents, receivedOn, auto: false, allocatedBy: ctx.userId });
  if (isPaymentError(outcome)) return dbError(`payment ${outcome.step}`, { code: outcome.code, message: outcome.message });
  return NextResponse.json({ id: outcome.paymentId, allocated: outcome.allocated, credit: outcome.credit });
}
