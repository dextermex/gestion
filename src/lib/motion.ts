/**
 * One motion vocabulary for all of Morada.
 *
 * Every animation across the public site and Morada Pro pulls its easing,
 * duration and spring feel from here so the whole product moves with a single,
 * recognisable rhythm (the "motion-consistency" UX rule). Prefer these over
 * ad-hoc cubic-beziers scattered through components.
 */

// Premium ease-out — decelerates hard at the end, the way native/Apple UI does.
// Use for entering elements.
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/** Duration scale (seconds). Micro-interactions stay in the 150–300ms band. */
export const DUR = {
  micro: 0.18, // hover / press feedback
  fast: 0.28, // small state changes
  base: 0.5, // scroll reveals
  slow: 0.7, // hero / large surfaces
} as const;

/**
 * The house modal spring (dialogs, sheets, the drawer), named so a gesture
 * can hand its release velocity to it. Damping ratio about 0.82 and a
 * response of about 0.32s: Apple's drawer and sheet setting (0.8 / 0.3).
 */
export const springSheet = { type: "spring", stiffness: 380, damping: 32 } as const;
