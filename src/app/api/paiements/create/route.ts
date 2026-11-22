import { NextRequest, NextResponse } from "next/server";
import { withOrg, dbError } from "@/lib/gestion/api";
import { parseEuroInput } from "@/lib/gestion/euros";
import { isCalendarDay, isPaymentError, paymentErrorStatus, recordPaymentFifo } from "@/lib/banking/allocate";
import { todayISO } from "@/lib/clock";

/**
 * Records a manual payment on a lease and allocates it to the oldest open
 * periods, through the same writer a matched bank operation uses: one
 * transaction, nothing left behind when it fails. The request may carry its
 * own key (`requestKey`): a double click or a retry after a lost answer then
 * writes once and reads the first answer back. Money above what is due is
 * answered as `credit` and kept on the tenancy.
 */
const KEY = /^[A-Za-z0-9_-]{8,80}$/;

export async function POST(req: NextRequest) {
  const ctx = await withOrg("write");
  if (ctx instanceof NextResponse) return ctx;
  const { g, org } = ctx;
  const today = todayISO();

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const leaseId = String(body.leaseId ?? "");
  const amountCents = parseEuroInput(String(body.amount ?? ""));
  if (!leaseId || !amountCents) return NextResponse.json({ error: "invalid" }, { status: 400 });
  // The day the money arrived: a real calendar day, today at the latest. Left out, it is today.
  const asked = typeof body.receivedOn === "string" ? body.receivedOn.trim() : "";
  const receivedOn = asked === "" ? today : asked;
  if (!isCalendarDay(receivedOn)) return NextResponse.json({ error: "invalid_date" }, { status: 400 });
  if (receivedOn > today) return NextResponse.json({ error: "future_date" }, { status: 400 });
  const requestKey = typeof body.requestKey === "string" && KEY.test(body.requestKey) ? body.requestKey : null;

  const { data: lease, error: leaseErr } = await g
    .from("leases")
    .select("id,status")
    .eq("org_id", org.id)
    .eq("id", leaseId)
    .maybeSingle();
  if (leaseErr) return dbError("payment lease lookup", leaseErr);
  if (!lease) return NextResponse.json({ error: "invalid" }, { status: 400 });
  // A dossier in preparation has no ledger: money on it would sit on nothing.
  if (lease.status === "draft") return NextResponse.json({ error: "lease_not_started" }, { status: 409 });

  const outcome = await recordPaymentFifo(g, org.id, { leaseId, amountCents, receivedOn, auto: false, requestKey });
  if (isPaymentError(outcome)) {
    const answer = paymentErrorStatus(outcome);
    if (answer.status >= 500) console.error("payment failed:", outcome.step, outcome.code, outcome.message);
    return NextResponse.json({ error: answer.error }, { status: answer.status });
  }
  return NextResponse.json({ id: outcome.paymentId, allocated: outcome.allocated, credit: outcome.credit, replayed: outcome.replayed });
}
