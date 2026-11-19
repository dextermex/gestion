/**
 * The step a saved wizard opens on. The address may name one (a reload, or
 * another journey handing back), but never further than the step after the
 * one the record stands at: beyond it, the screens would show values nobody
 * entered. Where nothing is saved between steps (a sample cabinet), the
 * address is all there is and is followed as written.
 */
export function openingStep(requested: number, saved: number | null, enforce: boolean): number {
  const asked = Number.isFinite(requested) && requested >= 1 ? Math.round(requested) : null;
  if (asked === null) return saved ?? 1;
  return enforce ? Math.min(asked, (saved ?? 0) + 1) : asked;
}
