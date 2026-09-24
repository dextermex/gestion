/**
 * The adjustment letter's place in a rent adjustment: sent, its AR back, or
 * spent by an adjustment already applied. Legal effect runs from the AR
 * date (rule 3), so the month the new rent applies from is derived here
 * and nowhere else.
 */
export interface AdjustmentLetter {
  id: string;
  status: "draft" | "dispatched" | "ar_received" | "returned_undelivered";
  dispatchedOn: string | null;
  arReceivedOn: string | null;
}

export type AdjustmentLetterState =
  | { kind: "none" }
  | { kind: "awaiting_ar"; letter: AdjustmentLetter }
  | { kind: "ar_received"; letter: AdjustmentLetter; effectiveFrom: string };

/** The first day of the month after `iso`. */
export function monthAfter(iso: string): string {
  const [y, m] = iso.slice(0, 7).split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

/** A letter is spent once an adjustment was applied on or after its AR date. */
function consumed(letter: AdjustmentLetter, lastAdjustmentOn: string | null): boolean {
  return Boolean(letter.arReceivedOn && lastAdjustmentOn && letter.arReceivedOn <= lastAdjustmentOn);
}

/**
 * Where the lease stands with its adjustment letter: none in flight, one
 * out and waiting for its AR, or one whose AR is back and not yet applied
 * (then the new rent applies from the month after the AR).
 */
export function adjustmentLetterState(letters: AdjustmentLetter[], lastAdjustmentOn: string | null): AdjustmentLetterState {
  const live = letters.filter((l) => l.status !== "returned_undelivered" && l.status !== "draft" && !consumed(l, lastAdjustmentOn));
  const received = live.filter((l) => l.arReceivedOn).sort((a, b) => (a.arReceivedOn! < b.arReceivedOn! ? 1 : -1))[0];
  if (received) return { kind: "ar_received", letter: received, effectiveFrom: monthAfter(received.arReceivedOn!) };
  const dispatched = live.filter((l) => l.status === "dispatched").sort((a, b) => ((a.dispatchedOn ?? "") < (b.dispatchedOn ?? "") ? 1 : -1))[0];
  if (dispatched) return { kind: "awaiting_ar", letter: dispatched };
  return { kind: "none" };
}
