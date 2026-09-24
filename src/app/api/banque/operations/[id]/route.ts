import { NextRequest, NextResponse } from "next/server";
import { withOrg, dbError } from "@/lib/gestion/api";
import { isPaymentError, recordPaymentFifo } from "@/lib/banking/allocate";

/**
 * The review queue's decisions, made permanent. "match": the operation
 * becomes a payment on the chosen lease, allocated FIFO to its oldest open
 * periods, and, when asked, the payer's IBAN is bound to that lease so the
 * next transfer from the same payer matches on its own. "ignore" and
 * "reopen" move the operation out of and back into the queue. Paid-ness
 * stays derived from the allocations; RLS decides every write.
 */
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const { g, org, userId } = ctx;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = str(body.action, 16);
  if (!["match", "ignore", "reopen"].includes(action)) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const { data: tx, error: txErr } = await g
    .from("bank_transactions")
    .select("id,booked_on,amount_cents,counterparty_iban,match_status")
    .eq("org_id", org.id)
    .eq("id", id)
    .maybeSingle();
  if (txErr) return dbError("bank transaction lookup", txErr);
  if (!tx) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (action === "ignore" || action === "reopen") {
    if (tx.match_status === "auto" || tx.match_status === "manual") return NextResponse.json({ error: "already_matched" }, { status: 409 });
    const { error } = await g
      .from("bank_transactions")
      .update({ match_status: action === "ignore" ? "ignored" : "review", match_explain: action === "ignore" ? "manual" : null })
      .eq("org_id", org.id)
      .eq("id", id);
    if (error) return dbError("bank transaction update", error);
    return NextResponse.json({ ok: true });
  }

  // match
  if (tx.match_status === "auto" || tx.match_status === "manual") return NextResponse.json({ error: "already_matched" }, { status: 409 });
  if (Number(tx.amount_cents) <= 0) return NextResponse.json({ error: "not_a_receipt" }, { status: 400 });
  const leaseId = str(body.leaseId, 64);
  if (!leaseId) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const { data: lease, error: leaseErr } = await g
    .from("leases")
    .select("id,unit_id")
    .eq("org_id", org.id)
    .eq("id", leaseId)
    .maybeSingle();
  if (leaseErr) return dbError("lease lookup", leaseErr);
  if (!lease) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const outcome = await recordPaymentFifo(g, org.id, {
    leaseId,
    amountCents: Number(tx.amount_cents),
    receivedOn: String(tx.booked_on),
    bankTransactionId: String(tx.id),
    auto: false,
    allocatedBy: userId,
  });
  if (isPaymentError(outcome)) return dbError(`manual match ${outcome.step}`, { code: outcome.code, message: outcome.message });

  const { data: unit } = await g.from("units").select("label").eq("org_id", org.id).eq("id", String(lease.unit_id)).maybeSingle();
  const { error: markErr } = await g
    .from("bank_transactions")
    .update({ match_status: "manual", match_tier: "manual", match_confidence: null, match_explain: unit?.label ? `→ ${String(unit.label)}` : "manual" })
    .eq("org_id", org.id)
    .eq("id", id);
  if (markErr) return dbError("bank transaction mark", markErr);

  // The learning loop: this correction becomes tomorrow's automatic match.
  let bound = false;
  const payerIban = tx.counterparty_iban ? String(tx.counterparty_iban).replace(/\s/g, "").toUpperCase() : "";
  if (body.learnIban === true && payerIban) {
    const { error: bindErr } = await g
      .from("iban_bindings")
      .upsert({ org_id: org.id, payer_iban: payerIban, lease_id: leaseId, learned_from_tx_id: String(tx.id), created_by: userId }, { onConflict: "org_id,payer_iban,lease_id", ignoreDuplicates: true });
    if (bindErr) return dbError("iban binding upsert", bindErr);
    bound = true;
  }
  return NextResponse.json({ ok: true, paymentId: outcome.paymentId, allocated: outcome.allocated, credit: outcome.credit, bound });
}
