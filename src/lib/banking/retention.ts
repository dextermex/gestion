import "server-only";
import type { OrgContext } from "@/lib/gestion/api";
import { cancelPayment } from "@/lib/banking/cancel";
import { isPaymentError, recordPaymentFifo } from "@/lib/banking/allocate";

/**
 * Arrears kept from the guarantee are money the owner already holds: the
 * retention settles the tenancy's open months, oldest first, as a payment of
 * its own (method `other`, its note saying where it came from), never more
 * than what is still owed. The payment carries the retention line's id as its
 * request key, so it is written once, and withdrawing the line cancels it.
 */
const keyOf = (deductionId: string) => `retention-${deductionId}`;

export async function settleArrearsFromDeposit(
  ctx: OrgContext,
  input: { leaseId: string; deductionId: string; amountCents: number; today: string; note: string },
): Promise<{ settledCents: number } | { error: "storage_failed" | "schema_outdated" }> {
  const { g, org } = ctx;
  const { data: open, error } = await g
    .from("rent_period_status")
    .select("total_cents,allocated_cents,status")
    .eq("org_id", org.id)
    .eq("lease_id", input.leaseId);
  if (error) {
    console.error("retention ledger read failed:", error.code, error.message);
    return { error: "storage_failed" };
  }
  const owed = ((open as Array<{ total_cents: number; allocated_cents: number; status: string }> | null) ?? [])
    .filter((p) => p.status !== "written_off")
    .reduce((sum, p) => sum + Math.max(0, (Number(p.total_cents) || 0) - (Number(p.allocated_cents) || 0)), 0);
  const amount = Math.min(input.amountCents, owed);
  if (amount <= 0) return { settledCents: 0 };
  const outcome = await recordPaymentFifo(g, org.id, {
    leaseId: input.leaseId,
    amountCents: amount,
    receivedOn: input.today,
    auto: false,
    method: "other",
    note: input.note,
    requestKey: keyOf(input.deductionId),
  });
  if (isPaymentError(outcome)) {
    if (outcome.step === "outdated") return { error: "schema_outdated" };
    console.error("retention payment failed:", outcome.step, outcome.code, outcome.message);
    return { error: "storage_failed" };
  }
  return { settledCents: outcome.allocated };
}

/** A withdrawn arrears line takes its settlement back: the months are owed again. */
export async function undoArrearsSettlement(ctx: OrgContext, deductionId: string): Promise<boolean> {
  const { g, org } = ctx;
  const { data, error } = await g.from("payments").select("id").eq("org_id", org.id).eq("request_key", keyOf(deductionId)).is("cancelled_at", null);
  if (error) {
    // A base without the key column (0032) never wrote one.
    if (error.code === "42703" || error.code === "PGRST204") return true;
    console.error("retention payment lookup failed:", error.code, error.message);
    return false;
  }
  for (const p of (data as Array<{ id: string }> | null) ?? []) {
    const undone = await cancelPayment(g, p.id, "retention withdrawn");
    if ("error" in undone) return false;
  }
  return true;
}
