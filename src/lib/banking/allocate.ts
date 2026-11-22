import "server-only";

/**
 * One payment on a lease, allocated to its oldest open periods: the single
 * write path a manual payment, a matched bank operation and the matcher's own
 * auto-posts all go through.
 *
 * The write is one database transaction (`gestion.record_payment`, 0032),
 * under the caller's own token: the bank operation is claimed first (so the
 * same operation never becomes two payments), the tenancy's ledger is locked
 * while the payment and its allocations are written (so two payments never
 * land on the same open amount), and nothing is left behind when a step
 * fails. Money above what is due stays on the payment as the tenancy's
 * credit, and is applied to the next periods as they open. Paid-ness stays
 * derived: the rent_period_status view reads the allocations, nothing here
 * flips a boolean.
 */

type Rpc = {
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
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
  /** Not read: the base records who allocated from the caller's own token. */
  allocatedBy?: string | null;
  /** The periods the matcher named: they are paid first, the rest goes oldest first. */
  periodIds?: string[];
  /** What the bank operation is marked with once it is claimed. */
  match?: { tier: "rf" | "iban_binding" | "subset_sum" | "fuzzy" | "manual"; confidence?: number | null; explain?: string | null };
  /** The request's own key: the same request sent twice writes once. */
  requestKey?: string | null;
  /**
   * A bank operation that is the same money as a payment already typed by
   * hand (same lease, same amount, received within this many days) is
   * attached to that payment instead of becoming a second one. 0 never looks.
   */
  twinDays?: number;
}

export interface PaymentOutcome {
  paymentId: string;
  allocated: number;
  /** What no period carries yet: the tenancy's credit from this payment. */
  credit: number;
  /** The bank operation was recognised as a payment already recorded by hand. */
  linked: boolean;
  /** The request had already been written: nothing new was. */
  replayed: boolean;
}

/**
 * Why a payment was not written. `claimed`: the bank operation is already a
 * payment. `lease`: no such tenancy for this caller. `invalid`: the amount or
 * the date. `outdated`: the database does not carry the function yet.
 */
export type PaymentError = { step: "claimed" | "lease" | "invalid" | "outdated" | "storage"; code?: string; message?: string };

export async function recordPaymentFifo(g: Rpc, _orgId: string, input: PaymentInput): Promise<PaymentOutcome | PaymentError> {
  const { data, error } = await g.rpc("record_payment", {
    p_lease: input.leaseId,
    p_amount_cents: input.amountCents,
    p_received_on: input.receivedOn,
    p_bank_transaction: input.bankTransactionId ?? null,
    p_method: input.method ?? "transfer",
    p_note: input.note ?? null,
    p_auto: input.auto,
    p_periods: input.periodIds && input.periodIds.length > 0 ? input.periodIds : null,
    p_match: input.match ? { tier: input.match.tier, confidence: input.match.confidence ?? null, explain: input.match.explain ?? null } : null,
    p_request_key: input.requestKey ?? null,
    p_twin_days: input.twinDays ?? 0,
  });
  if (error) {
    const message = error.message ?? "";
    if (message.includes("operation already matched")) return { step: "claimed", code: error.code, message };
    if (message.includes("lease not found")) return { step: "lease", code: error.code, message };
    if (message.includes("invalid payment") || error.code === "22008" || error.code === "22007") return { step: "invalid", code: error.code, message };
    if (error.code === "PGRST202" || error.code === "42883") return { step: "outdated", code: error.code, message };
    return { step: "storage", code: error.code, message };
  }
  const out = (data ?? {}) as { payment_id?: string; allocated?: number; credit?: number; linked?: boolean; replayed?: boolean };
  return {
    paymentId: String(out.payment_id ?? ""),
    allocated: Number(out.allocated) || 0,
    credit: Number(out.credit) || 0,
    linked: out.linked === true,
    replayed: out.replayed === true,
  };
}

export const isPaymentError = (x: PaymentOutcome | PaymentError): x is PaymentError => "step" in x;

/** The HTTP answer a route gives for a payment that was not written. */
export function paymentErrorStatus(e: PaymentError): { status: number; error: string } {
  if (e.step === "claimed") return { status: 409, error: "already_matched" };
  if (e.step === "lease" || e.step === "invalid") return { status: 400, error: "invalid" };
  if (e.step === "outdated") return { status: 503, error: "schema_outdated" };
  return { status: 502, error: "storage_failed" };
}

/** A calendar day that exists ("2026-02-31" does not), as YYYY-MM-DD. */
export function isCalendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
