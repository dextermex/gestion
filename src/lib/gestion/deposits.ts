import type { DepositStatus } from "@/lib/types";
import type { SettlementResult } from "@/domain/deposits/settlement";

/**
 * What the desk may do with a guarantee, and how much it may release: the
 * settlement engine says what is due, this says which move is open from
 * where the guarantee stands. Money never leaves through any other path.
 */

/** The status moves a person may record directly; everything else is a consequence of a release. */
const DIRECT_TRANSITIONS: Record<DepositStatus, readonly DepositStatus[]> = {
  pending: ["held"],
  held: ["release_pending", "disputed"],
  release_pending: ["disputed"],
  partially_released: ["disputed"],
  disputed: ["release_pending", "partially_released"],
  released: [],
  forfeited: [],
};

export function depositTransitionAllowed(from: DepositStatus, to: DepositStatus): boolean {
  return DIRECT_TRANSITIONS[from].includes(to);
}

/** A settlement is in progress once the keys are back and the guarantee is neither released nor forfeited. */
export function settlementOpen(status: DepositStatus, keyHandoverOn: string | null): boolean {
  return keyHandoverOn !== null && (status === "release_pending" || status === "partially_released" || status === "disputed");
}

export type Tranche = "first" | "balance";

export interface ReleaseDecision {
  amountCents: number;
  /** The status the guarantee takes once this tranche has left. */
  nextStatus: DepositStatus;
}

/**
 * The amount a tranche may release now, or the reason it may not: the first
 * tranche once, up to the engine's half; the balance once the décompte is
 * out, for whatever is still owed.
 */
export function releaseDecision(
  tranche: Tranche,
  settlement: SettlementResult,
  deposit: { releasedFirstTrancheCents: number; releasedBalanceCents: number; decompteIssuedOn: string | null },
): ReleaseDecision | { refused: "already" | "needs_decompte" | "nothing" } {
  if (tranche === "first") {
    if (deposit.releasedFirstTrancheCents > 0) return { refused: "already" };
    const amountCents = Math.min(settlement.firstTrancheAmount, settlement.outstandingToTenant);
    if (amountCents <= 0) return { refused: "nothing" };
    const remaining = settlement.outstandingToTenant - amountCents;
    return { amountCents, nextStatus: remaining > 0 ? "partially_released" : "released" };
  }
  if (!deposit.decompteIssuedOn) return { refused: "needs_decompte" };
  if (deposit.releasedBalanceCents > 0) return { refused: "already" };
  const amountCents = settlement.outstandingToTenant;
  if (amountCents <= 0) return { refused: "nothing" };
  return { amountCents, nextStatus: "released" };
}
