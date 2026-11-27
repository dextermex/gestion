import { RENT_BANDS, TRIAL_DAYS } from "@/domain/billing/pricing";
import { offerQuote, unitsFromAnswer, WINBACK_PCT, type Offer, type UnitsAnswer } from "./offer";
import type { Kind } from "./quiz";

/**
 * The parts of the sign-up after the account that decide where the person
 * goes next, kept pure so each rule is tested on its own.
 */

/** `GET /api/abonnement/etat`, as the billing side answers it. */
export interface BillingState {
  configured: boolean;
  access: "open" | "locked";
  reason: "no_trial" | "ended" | "payment" | null;
  trialOffered: boolean;
}

/** Reads the answer of `/api/abonnement/etat`; anything else is no answer. */
export function billingState(raw: unknown): BillingState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.configured !== "boolean" || (r.access !== "open" && r.access !== "locked")) return null;
  const reason = r.reason === "no_trial" || r.reason === "ended" || r.reason === "payment" ? r.reason : null;
  return { configured: r.configured, access: r.access, reason, trialOffered: r.trialOffered === true };
}

/**
 * The step after "Votre plan est prêt": the three trial screens only when
 * the deployment takes payments and this workspace is locked. Without a
 * Stripe key (`configured: false`, CI), with a subscription already running
 * (`open`), with no answer at all, or for an account that joins someone
 * else's workspace by invitation, straight to "Bienvenue" (the space itself
 * decides who may enter).
 */
export function afterPlan(state: BillingState | null, invited: boolean): "try" | "welcome" {
  if (invited || !state) return "welcome";
  return state.configured && state.access === "locked" ? "try" : "welcome";
}

/** Closing the offer opens the one-time offer, once; after that, the space (which shows the locked screen). */
export const afterOfferClosed = (winbackShown: boolean): "winback" | "leave" => (winbackShown ? "leave" : "winback");

/** Where "Ouvrir mon espace" leads a landlord: the first property's form, its type from the first question, or the home screen when there is no lot yet. */
export function spaceAddress(quiz: { kind?: Kind | null; units?: UnitsAnswer | null } | null | undefined): string {
  if (!quiz?.units || quiz.units === "0") return "/app?tour=1";
  const type = quiz.kind === "flats" ? "apartment" : quiz.kind === "houses" ? "house" : quiz.kind === "building" ? "building" : null;
  return type ? `/app/biens/nouveau?type=${type}&tour=1` : "/app/biens/nouveau?tour=1";
}

/** The offer the funnel quotes from the answers: lots from the bracket, the band, the rhythm. */
export function offerFrom(units: UnitsAnswer | null, band: number | null, billing: Offer["billing"]): Offer {
  const b = band === null || !Number.isInteger(band) ? 0 : Math.min(Math.max(0, band), RENT_BANDS.length - 1);
  return { units: unitsFromAnswer(units), band: b, billing };
}

/** The figures of one price line: one charge for the period and the month it amounts to, in cents. */
export function priceLine(offer: Offer): { perPeriod: number; monthly: number } {
  const q = offerQuote(offer);
  return { perPeriod: q.charged, monthly: q.shownMonthly };
}

/** The one-time offer on the yearly plan: a quarter off the first year, then the full year, in cents. */
export function winbackLine(offer: Offer): { firstYear: number; monthly: number; fullYear: number; fullMonthly: number } {
  const q = offerQuote({ ...offer, billing: "year" });
  const firstYear = Math.round((q.charged * (100 - WINBACK_PCT)) / 100);
  return { firstYear, monthly: Math.round(firstYear / 12), fullYear: q.charged, fullMonthly: q.shownMonthly };
}

/** Days before the trial's end the reminder e-mail goes out ("in 28 days"). */
export const TRIAL_REMINDER_BEFORE_DAYS = 2;
export const REMINDER_DAY = TRIAL_DAYS - TRIAL_REMINDER_BEFORE_DAYS;

/** Where Checkout may send the browser: our own pages or an https page (Stripe's), nothing else. */
export function checkoutTarget(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 4096) return null;
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  try {
    return new URL(raw).protocol === "https:" ? raw : null;
  } catch {
    return null;
  }
}
