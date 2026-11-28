import { z } from "zod";
import { RENT_BANDS, quote, type Quote, type Rhythm } from "@/domain/billing/pricing";
import type { Cents } from "@/domain/money";

/**
 * The price the sign-up quotes, before the workspace holds a single lot: the
 * lots and the average rent the person answered, priced on the one grid
 * (src/domain/billing/pricing.ts). The iPhone app quotes the same way
 * (its src/lib/addons.ts), so the figure is the same on both. Once lots are
 * let, the subscription follows the real portfolio (src/lib/billing/service.ts).
 */
export const UNITS_ANSWERS = ["1", "2-5", "6-10", "11-20", "21-50", "0"] as const;
export type UnitsAnswer = (typeof UNITS_ANSWERS)[number];

/** A lot count to quote from a bracket answer: the bracket's typical case ("2-5" quotes as 3). "0" (no lot yet) quotes one lot, the least a subscription bills. */
export function unitsFromAnswer(answer: string | null | undefined): number {
  switch (answer) {
    case "2-5":
      return 3;
    case "6-10":
      return 8;
    case "11+":
    case "11-20":
      return 15;
    case "21-50":
      return 30;
    default:
      return 1;
  }
}

/** The bracket a lot count falls in. */
export function answerForUnits(units: number): Exclude<UnitsAnswer, "0"> {
  if (units <= 1) return "1";
  if (units <= 5) return "2-5";
  if (units <= 10) return "6-10";
  if (units <= 20) return "11-20";
  return "21-50";
}

/** The web's own five brackets (`morada_signup.preferences.properties`) from the funnel's six. */
export const webProperties = (answer: UnitsAnswer | null): "0" | "1" | "2-5" | "6-10" | "11+" | null =>
  answer === null ? null : answer === "11-20" || answer === "21-50" ? "11+" : answer;

/** What the person accepted on the offer screen; saved as `morada_mobile.offer`, the shape the iPhone app writes. */
export const offerSchema = z.object({
  units: z.number().int().min(1).max(50),
  band: z.number().int().min(0).max(RENT_BANDS.length - 1),
  billing: z.enum(["year", "quarter"]),
});
export type Offer = z.infer<typeof offerSchema>;

/** A rent that falls in a band, for pricing: the band's lower bound (its price does not depend on where in the band the rent sits). */
export function rentInBand(band: number): Cents {
  const index = Math.min(Math.max(0, Math.round(band)), RENT_BANDS.length - 1);
  return index === 0 ? 0 : (RENT_BANDS[index - 1].below as Cents);
}

/** The offer priced on the grid, first year. */
export function offerQuote(offer: Offer): Quote {
  return quote(Array.from({ length: offer.units }, () => rentInBand(offer.band)), offer.billing as Rhythm, 1);
}

/** The one-time offer, shown once when the offer screen is closed: a quarter off the first year (the iPhone app's WINBACK). */
export const WINBACK_PCT = 25;
