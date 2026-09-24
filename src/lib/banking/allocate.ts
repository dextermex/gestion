import "server-only";
import { allocateFifo, allocationSummary, type Allocation, type OpenInvoice } from "@/domain/banking/matching";

/**
 * One payment on a lease, allocated FIFO to its oldest open periods: the
 * single write path a manual payment, a matched bank operation and the
 * matcher's own auto-posts all go through. Paid-ness stays derived: the
 * rent_period_status view reads these allocations, nothing here flips a
 * boolean. The client is the caller's own JWT-bound handle; RLS decides.
 */

type Db = {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

export interface PaymentInput {
  leaseId: string;
  amountCents: number;
  receivedOn: string;
  /** The bank operation this payment recognises, when it came from the bank. */
  bankTransactionId?: string | null;
  method?: "transfer" | "cash" | "card" | "other";
  note?: string | null;
  /** True for the matcher's own posts, false for a person's decision. */
  auto: boolean;
  allocatedBy?: string | null;
}

export interface PaymentOutcome {
  paymentId: string;
  allocations: Allocation[];
  allocated: number;
  credit: number;
}

export type PaymentError = { step: "payment" | "periods" | "allocations"; code?: string; message?: string };

export async function recordPaymentFifo(g: Db, orgId: string, input: PaymentInput): Promise<PaymentOutcome | PaymentError> {
  const { data: payment, error: payErr } = await g
    .from("payments")
    .insert({
      org_id: orgId,
      lease_id: input.leaseId,
      bank_transaction_id: input.bankTransactionId ?? null,
      received_on: input.receivedOn,
      amount_cents: input.amountCents,
      method: input.method ?? "transfer",
      note: input.note ?? null,
    })
    .select("id")
    .single();
  if (payErr || !payment) return { step: "payment", code: payErr?.code, message: payErr?.message };

  const { data: open, error: openErr } = await g
    .from("rent_period_status")
    .select("id,due_date,total_cents,allocated_cents,status")
    .eq("org_id", orgId)
    .eq("lease_id", input.leaseId)
    .order("period");
  if (openErr) return { step: "periods", code: openErr.code, message: openErr.message };

  const invoices: OpenInvoice[] = ((open ?? []) as Array<Record<string, unknown>>)
    .filter((rp) => rp.status !== "written_off" && Number(rp.allocated_cents) < Number(rp.total_cents))
    .map((rp) => ({
      id: String(rp.id),
      leaseId: input.leaseId,
      tenantNames: [],
      rfReference: "",
      dueDate: String(rp.due_date),
      totalAmount: Number(rp.total_cents),
      openAmount: Number(rp.total_cents) - Number(rp.allocated_cents),
      previousRentAmount: null,
      unitLabel: "",
    }));
  const allocations = allocateFifo(input.amountCents, invoices);
  if (allocations.length > 0) {
    const { error: allocErr } = await g.from("payment_allocations").insert(
      allocations.map((a) => ({
        org_id: orgId,
        payment_id: payment.id,
        rent_period_id: a.invoiceId,
        amount_cents: a.amount,
        auto: input.auto,
        allocated_by: input.allocatedBy ?? null,
      })),
    );
    if (allocErr) return { step: "allocations", code: allocErr.code, message: allocErr.message };
  }
  const { allocated, credit } = allocationSummary(input.amountCents, allocations);
  return { paymentId: String(payment.id), allocations, allocated, credit };
}

export const isPaymentError = (x: PaymentOutcome | PaymentError): x is PaymentError => "step" in x;
