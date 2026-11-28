import type { Locale } from "@/lib/i18n/config";

/**
 * Landlords' own words for the reviews step, with their consent. Real
 * quotes only, confirmed by the owner before launch: the list is empty and
 * the step is skipped while it is (the iPhone app's rule). Nothing here may
 * be written by hand without a named landlord behind it.
 */
export interface Testimonial {
  /** First name only. */
  name: string;
  /** Where they let, a town or a district. */
  place: string;
  stars: 1 | 2 | 3 | 4 | 5;
  /** The opening words, set in bold. */
  lead: Record<Locale, string>;
  quote: Record<Locale, string>;
}

export const TESTIMONIALS: readonly Testimonial[] = [];

export const reviewsAvailable = (list: readonly Testimonial[] = TESTIMONIALS) => list.length > 0;

/** The figure in the laurel: the average of the quotes shown, and nothing else. */
export function averageStars(list: readonly Testimonial[]): number {
  return list.length === 0 ? 0 : Math.round((list.reduce((sum, r) => sum + r.stars, 0) / list.length) * 10) / 10;
}
