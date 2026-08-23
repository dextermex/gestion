import type { Transition, Variants } from "motion/react";

/**
 * One motion vocabulary for all of Morada.
 *
 * Every animation across the public site and Morada Pro pulls its easing,
 * duration and spring feel from here so the whole product moves with a single,
 * recognisable rhythm (the "motion-consistency" UX rule). Prefer these over
 * ad-hoc cubic-beziers scattered through components.
 */

// Premium ease-out — decelerates hard at the end, the way native/Apple UI does.
// Use for entering elements. (Exits should feel quicker — see EASE_IN.)
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;
export const EASE_IN = [0.4, 0, 1, 1] as const;
export const EASE_IN_OUT = [0.65, 0, 0.35, 1] as const;

/** Duration scale (seconds). Micro-interactions stay in the 150–300ms band. */
export const DUR = {
  micro: 0.18, // hover / press feedback
  fast: 0.28, // small state changes
  base: 0.5, // scroll reveals
  slow: 0.7, // hero / large surfaces
} as const;

/** Spring presets — natural physics beats fixed curves for interactive motion. */
export const springSoft: Transition = { type: "spring", stiffness: 240, damping: 26 };
export const springSnappy: Transition = { type: "spring", stiffness: 420, damping: 30 };
export const springGentle: Transition = { type: "spring", stiffness: 150, damping: 24 };

/** Fade-and-rise, the house reveal. Enter is unhurried, tuned to EASE_OUT. */
export const revealUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: DUR.base, ease: EASE_OUT } },
};

/** Same feel, coming from the side — for split/asymmetric sections. */
export const revealLeft: Variants = {
  hidden: { opacity: 0, x: 28 },
  show: { opacity: 1, x: 0, transition: { duration: DUR.base, ease: EASE_OUT } },
};

/**
 * Stagger container: children reveal one after another (40–60ms apart is the
 * sweet spot — enough to read as a sequence, quick enough not to feel slow).
 */
export const staggerContainer = (stagger = 0.06, delayChildren = 0): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: stagger, delayChildren } },
});

/** Standard viewport trigger for scroll reveals: play once, a touch early. */
export const inViewOnce = { once: true, amount: 0.2 } as const;
