import { NextRequest, NextResponse } from "next/server";
import { withOrg, dbError } from "@/lib/gestion/api";
import { parseEuroInput } from "@/lib/gestion/euros";
import { allocateFifo, allocationSummary, type OpenInvoice } from "@/domain/banking/matching";

/**
 * Records a manual payment on a lease and allocates it FIFO to the oldest
 * open periods. Paid-ness stays derived: the rent_period_status view reads
 * these allocations, nothing here flips a boolean.
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

  const { data: payment, error: payErr } = await g
    .from("payments")
    .insert({ org_id: org.id, lease_id: leaseId, received_on: receivedOn, amount_cents: amountCents, method: "transfer" })
    .select("id")
    .single();
  if (payErr || !payment) return dbError("payment insert", payErr);

  const { data: open, error: openErr } = await g
    .from("rent_period_status")
    .select("id,due_date,total_cents,allocated_cents,status")
    .eq("org_id", org.id)
    .eq("lease_id", leaseId)
    .order("period");
  if (openErr) return dbError("open periods read", openErr);

  const invoices: OpenInvoice[] = (open ?? [])
    .filter((rp) => rp.status !== "written_off" && rp.allocated_cents < rp.total_cents)
    .map((rp) => ({
      id: rp.id as string,
      leaseId,
      tenantNames: [],
      rfReference: "",
      dueDate: rp.due_date as string,
      totalAmount: rp.total_cents as number,
      openAmount: (rp.total_cents as number) - (rp.allocated_cents as number),
      previousRentAmount: null,
      unitLabel: "",
    }));
  const allocations = allocateFifo(amountCents, invoices);
  if (allocations.length > 0) {
    const { error: allocErr } = await g.from("payment_allocations").insert(
      allocations.map((a) => ({
        org_id: org.id,
        payment_id: payment.id,
        rent_period_id: a.invoiceId,
        amount_cents: a.amount,
        auto: false,
      })),
    );
    if (allocErr) return dbError("allocation insert", allocErr);
  }
  const { allocated, credit } = allocationSummary(amountCents, allocations);
  return NextResponse.json({ id: payment.id, allocated, credit });
}
