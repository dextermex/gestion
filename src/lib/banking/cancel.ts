import "server-only";

/**
 * A payment recorded by mistake is cancelled, never deleted: the row stays
 * with who cancelled it, when and why, its allocations are reversed (the
 * periods it covered are open again), and the bank operation it recognised,
 * if any, goes back to the review queue to be matched properly. One database
 * transaction (`gestion.cancel_payment`, 0032) under the caller's own token.
 *
 * A payment that a produced receipt (quittance) attests is refused here:
 * the paper says the month was paid, and it cannot be unsaid by a click.
 */

type Rpc = {
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
};

export type CancelOutcome =
  | { ok: true; already: boolean; leaseId: string | null; bankTransactionId: string | null }
  | { error: "not_found" | "receipt_issued" | "schema_outdated" | "storage_failed" };

export async function cancelPayment(g: Rpc, paymentId: string, reason: string | null): Promise<CancelOutcome> {
  const { data, error } = await g.rpc("cancel_payment", { p_payment: paymentId, p_reason: reason });
  if (error) {
    const message = error.message ?? "";
    // A malformed id is "no such payment" to the caller, as an unknown one is.
    if (message.includes("payment not found") || error.code === "22P02") return { error: "not_found" };
    if (message.includes("receipt issued")) return { error: "receipt_issued" };
    if (error.code === "PGRST202" || error.code === "42883") return { error: "schema_outdated" };
    console.error("payment cancellation failed:", error.code, message);
    return { error: "storage_failed" };
  }
  const out = (data ?? {}) as { already?: boolean; lease_id?: string | null; bank_transaction_id?: string | null };
  return { ok: true, already: out.already === true, leaseId: out.lease_id ?? null, bankTransactionId: out.bank_transaction_id ?? null };
}
