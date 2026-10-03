/**
 * The subscription catalogue. A workspace pays per lot and per month: every
 * screen SHOWS the monthly figure, and Stripe CHARGES it per quarter or per
 * year (the monthly figure times the months of the rhythm), once the free
 * trial is over.
 *
 * The figures follow the pricing hypothesis of docs/STRATEGY.md §5.2: the
 * landlord plan at €5 per lot and per month up to 50 lots, the professional
 * plan at €4 per lot plus €29 per user for larger portfolios and agencies.
 * The free tier of that hypothesis gives way to the trial, and the yearly
 * rhythm sits 20 % below the quarterly one. Only lots that can carry a lease
 * of their own are counted (a dwelling, a shop, an office): parking spaces
 * and cellars come free.
 *
 * Integer cents throughout, so what a page shows is exactly what is charged.
 * Changing a figure here creates new Stripe prices at the next checkout (the
 * price's lookup key carries its amount); running subscriptions keep theirs.
 */
import type { Cents } from "@/domain/money";

/** Days of free use from the workspace's first visit, with or without a card. */
export const TRIAL_DAYS = 30;
/** The one extension a workspace may take when its trial is over or nearly. */
export const TRIAL_EXTENSION_DAYS = 7;
/** From this many days before the end, every screen reminds. */
export const REMINDER_DAYS = 7;
/** Prices include VAT: the figure shown is the total paid. */
export const PRICES_INCLUDE_VAT = true;

export const PLAN_IDS = ["landlord", "professional"] as const;
export type PlanId = (typeof PLAN_IDS)[number];
export const RHYTHMS = ["quarter", "year"] as const;
export type Rhythm = (typeof RHYTHMS)[number];
export const RHYTHM_MONTHS: Record<Rhythm, number> = { quarter: 3, year: 12 };

export const DEFAULT_PLAN: PlanId = "landlord";
export const DEFAULT_RHYTHM: Rhythm = "quarter";

/** The lot kinds a subscription counts: those that carry a lease of their own. */
export const BILLED_UNIT_KINDS: readonly string[] = ["dwelling", "commercial", "office"];

export interface Plan {
  id: PlanId;
  /** Per counted lot and per month, by rhythm. */
  lot: Record<Rhythm, Cents>;
  /** Per user and per month, by rhythm; null when users are included. */
  seat: Record<Rhythm, Cents> | null;
  /** The most lots the plan takes; null when it takes any number. */
  maxLots: number | null;
}

export const PLANS: Record<PlanId, Plan> = {
  landlord: { id: "landlord", lot: { quarter: 500, year: 400 }, seat: null, maxLots: 50 },
  professional: { id: "professional", lot: { quarter: 400, year: 320 }, seat: { quarter: 2900, year: 2320 }, maxLots: null },
};

export const isPlanId = (value: unknown): value is PlanId => typeof value === "string" && (PLAN_IDS as readonly string[]).includes(value);
export const isRhythm = (value: unknown): value is Rhythm => typeof value === "string" && (RHYTHMS as readonly string[]).includes(value);

/** The lots a subscription counts, out of a portfolio's live lots. */
export function billedLots(units: readonly { kind: string }[]): number {
  return units.filter((unit) => BILLED_UNIT_KINDS.includes(unit.kind)).length;
}

export interface Quote {
  plan: PlanId;
  rhythm: Rhythm;
  /** Months one charge covers. */
  months: number;
  /** Lots billed: at least one. */
  lots: number;
  /** Users billed: at least one on a plan that counts them, none otherwise. */
  seats: number;
  lotMonthly: Cents;
  /** Per user and per month; 0 when users are included. */
  seatMonthly: Cents;
  /** The whole portfolio, per month: the figure every screen leads with. */
  monthly: Cents;
  /** One charge: the monthly figure times the months of the rhythm. */
  charged: Cents;
  /** Over a year, what the yearly rhythm saves against the quarterly one; 0 on the quarterly rhythm. */
  yearlySaving: Cents;
  /** False when the portfolio holds more lots than the plan takes. */
  fits: boolean;
}

export function quote(planId: PlanId, rhythm: Rhythm, lots: number, seats: number): Quote {
  const plan = PLANS[planId];
  const billed = Math.max(1, Math.floor(Number.isFinite(lots) ? lots : 0));
  const users = plan.seat ? Math.max(1, Math.floor(Number.isFinite(seats) ? seats : 0)) : 0;
  const lotMonthly = plan.lot[rhythm];
  const seatMonthly = plan.seat ? plan.seat[rhythm] : 0;
  const monthly = billed * lotMonthly + users * seatMonthly;
  const quarterly = billed * plan.lot.quarter + users * (plan.seat ? plan.seat.quarter : 0);
  const months = RHYTHM_MONTHS[rhythm];
  return {
    plan: planId, rhythm, months, lots: billed, seats: users, lotMonthly, seatMonthly, monthly,
    charged: monthly * months,
    yearlySaving: rhythm === "year" ? (quarterly - monthly) * 12 : 0,
    fits: plan.maxLots === null || billed <= plan.maxLots,
  };
}

/** The plan that takes the portfolio and costs it least per month; the landlord plan on a tie. */
export function bestPlan(lots: number, seats: number, rhythm: Rhythm): PlanId {
  const fitting = PLAN_IDS.map((id) => quote(id, rhythm, lots, seats)).filter((q) => q.fits);
  if (fitting.length === 0) return "professional";
  return fitting.reduce((best, q) => (q.monthly < best.monthly ? q : best)).plan;
}

/** The yearly rhythm's discount against the quarterly one, in whole percent (20 for the catalogue above). */
export function yearlyDiscountPct(planId: PlanId): number {
  const plan = PLANS[planId];
  return Math.round((1 - plan.lot.year / plan.lot.quarter) * 100);
}
