/**
 * The subscription's price: the launch pricing the public site publishes
 * (dextermex/morada-gestion-web, src/lib/pricing.ts: the owner's direction
 * of 27 September 2026, a hypothesis until the commercial launch). The site
 * and the app must say the same thing: a figure changed here is changed
 * there, and the parity test pins the site's own examples.
 *
 *  - A lot is billed by its own rent, excluding charges: five bands, from
 *    €10 to €32 per lot and per month (roughly 1 % of the rent).
 *  - Volume is graduated, like tax brackets: lots 6 to 15 cost 10 % less
 *    than the first five, lots 16 to 30 20 % less, lots 31 to 50 30 % less.
 *    When rents fall in several bands, the dearest lots fill the first
 *    brackets, so a reduction always lands on the cheaper lots. Adding a lot
 *    never raises the price of the others.
 *  - Charged by the quarter, or by the year at ten months (two months off).
 *    Every screen leads with the price per month.
 *  - Each renewal year lowers the price: 5 % off in the second year of a
 *    subscription, 10 % from the third.
 *  - A 30-day trial without a card replaces the former free tier.
 *  - Up to 50 lots on these terms; beyond, the price is built with the team.
 *
 * A lot counts when it is let under a lease of its own: a dwelling, a shop
 * or an office with a running lease, by that lease's rent. A vacant lot, a
 * parking space or a cellar is not billed. A subscription bills at least
 * one lot, so it never falls below the first band's price.
 *
 * Integer cents throughout, so what a page shows is exactly what is charged.
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
/** The most lots the published terms take; beyond, the price is built with the team. */
export const MAX_LOTS = 50;

export const RHYTHMS = ["quarter", "year"] as const;
export type Rhythm = (typeof RHYTHMS)[number];
export const DEFAULT_RHYTHM: Rhythm = "quarter";
/** Months one charge covers. */
export const RHYTHM_MONTHS: Record<Rhythm, number> = { quarter: 3, year: 12 };
/** Months one charge costs: a year costs ten. */
export const PAID_MONTHS: Record<Rhythm, number> = { quarter: 3, year: 10 };

export interface RentBand {
  /** Monthly rent excluding charges, exclusive upper bound; null for the last band. */
  below: Cents | null;
  /** Per lot and per month, at full price. */
  perLot: Cents;
}

export const RENT_BANDS: readonly RentBand[] = [
  { below: 100_000, perLot: 1000 },
  { below: 150_000, perLot: 1400 },
  { below: 200_000, perLot: 1900 },
  { below: 300_000, perLot: 2500 },
  { below: null, perLot: 3200 },
];

export interface VolumeBracket {
  from: number;
  to: number;
  /** The reduction every lot in the bracket gets, in whole percent. */
  offPct: number;
}

export const VOLUME: readonly VolumeBracket[] = [
  { from: 1, to: 5, offPct: 0 },
  { from: 6, to: 15, offPct: 10 },
  { from: 16, to: 30, offPct: 20 },
  { from: 31, to: 50, offPct: 30 },
];

/** The loyalty reduction by year of subscription, in whole percent: the first, the second, the third and after. */
export const LOYALTY_PCT: readonly number[] = [0, 5, 10];

/** The lot kinds a subscription counts: those that carry a lease of their own. */
export const BILLED_UNIT_KINDS: readonly string[] = ["dwelling", "commercial", "office"];
/** The lease statuses under which a lot is let. */
const LET = ["active", "notice"];

export const isRhythm = (value: unknown): value is Rhythm => typeof value === "string" && (RHYTHMS as readonly string[]).includes(value);

/** The band a monthly rent (excluding charges) falls in, as an index into RENT_BANDS. */
export function bandOf(rent: Cents): number {
  const value = Number.isFinite(rent) ? Math.max(0, rent) : 0;
  const index = RENT_BANDS.findIndex((band) => band.below !== null && value < band.below);
  return index === -1 ? RENT_BANDS.length - 1 : index;
}

/** The volume bracket of the lot at a position (1 for the first); past the last, the last bracket's reduction holds. */
export function bracketOf(position: number): VolumeBracket {
  return VOLUME.find((bracket) => position <= bracket.to) ?? VOLUME[VOLUME.length - 1];
}

/** The lots a portfolio holds, as the screens count them for their sentences: every dwelling, shop and office. */
export function portfolioLots(units: readonly { kind: string }[]): number {
  return units.filter((unit) => BILLED_UNIT_KINDS.includes(unit.kind)).length;
}

/** The rents of the lots a subscription bills: each dwelling, shop or office let under a running lease, by that lease's rent. */
export function billedRents(units: readonly { id: string; kind: string }[], leases: readonly { unitId: string; status: string; rentCents: number }[]): Cents[] {
  const counted = new Set(units.filter((unit) => BILLED_UNIT_KINDS.includes(unit.kind)).map((unit) => unit.id));
  const rentByLot = new Map<string, Cents>();
  for (const lease of leases) {
    if (!counted.has(lease.unitId) || !LET.includes(lease.status)) continue;
    const rent = Number.isFinite(lease.rentCents) ? Math.max(0, Math.round(lease.rentCents)) : 0;
    rentByLot.set(lease.unitId, (rentByLot.get(lease.unitId) ?? 0) + rent);
  }
  return [...rentByLot.values()];
}

export interface QuoteLine {
  /** Index into RENT_BANDS. */
  band: number;
  /** The volume bracket's reduction, in whole percent. */
  offPct: number;
  /** Per lot and per month, after the bracket's reduction. */
  perLot: Cents;
  count: number;
}

export interface Quote {
  rhythm: Rhythm;
  /** Lots let, as counted. */
  lots: number;
  /** Lots billed: at least one. */
  billed: number;
  /** The lots by band and bracket, dearest first. */
  lines: QuoteLine[];
  /** The whole portfolio per month at full rate, before loyalty. */
  monthly: Cents;
  /** One charge before loyalty: the monthly figure times the months the rhythm costs. */
  base: Cents;
  /** The year of subscription the figures are for (1 for a new subscription). */
  year: number;
  loyaltyPct: number;
  /** One charge, loyalty included: what Stripe charges. */
  charged: Cents;
  /** What the screens lead with: one charge spread over the months it covers. */
  shownMonthly: Cents;
  /** The month at full rate, loyalty included: struck through beside a yearly price. */
  fullMonthly: Cents;
  /** The same as shownMonthly, per lot billed (an average). */
  shownPerLot: Cents;
  /** What the yearly rhythm saves over a year against four quarters: two months. */
  yearlySaving: Cents;
  /** Whether the published terms take the portfolio (MAX_LOTS at most). */
  fits: boolean;
}

const less = (amount: Cents, pct: number): Cents => Math.round((amount * (100 - pct)) / 100);

/** The loyalty reduction in a year of subscription, in whole percent. */
export function loyaltyPct(year: number): number {
  const whole = Math.max(1, Math.floor(Number.isFinite(year) ? year : 1));
  return LOYALTY_PCT[Math.min(whole, LOYALTY_PCT.length) - 1];
}

/** One charge in a year of subscription, from the charge before loyalty. */
export function withLoyalty(base: Cents, year: number): Cents {
  return less(base, loyaltyPct(year));
}

/**
 * What a portfolio pays, from the rents of the lots it bills (billedRents),
 * for a rhythm and a year of subscription.
 */
export function quote(rents: readonly Cents[], rhythm: Rhythm, year = 1): Quote {
  const bands = (rents.length > 0 ? rents : [0]).map(bandOf).sort((a, b) => b - a);
  const lines: QuoteLine[] = [];
  bands.forEach((band, index) => {
    const { offPct } = bracketOf(index + 1);
    const last = lines[lines.length - 1];
    if (last && last.band === band && last.offPct === offPct) last.count += 1;
    else lines.push({ band, offPct, perLot: less(RENT_BANDS[band].perLot, offPct), count: 1 });
  });
  const monthly = lines.reduce((sum, line) => sum + line.perLot * line.count, 0);
  const forYear = Math.max(1, Math.floor(Number.isFinite(year) ? year : 1));
  const pct = loyaltyPct(forYear);
  const base = monthly * PAID_MONTHS[rhythm];
  const charged = withLoyalty(base, forYear);
  return {
    rhythm,
    lots: rents.length,
    billed: bands.length,
    lines,
    monthly,
    base,
    year: forYear,
    loyaltyPct: pct,
    charged,
    shownMonthly: Math.round(charged / RHYTHM_MONTHS[rhythm]),
    fullMonthly: less(monthly, pct),
    shownPerLot: Math.round(charged / RHYTHM_MONTHS[rhythm] / bands.length),
    yearlySaving: less(monthly * (RHYTHM_MONTHS.year - PAID_MONTHS.year), pct),
    fits: rents.length <= MAX_LOTS,
  };
}

/** The lowest price per lot and per month the terms publish, for a rhythm ("from €10"). */
export function fromPerLot(rhythm: Rhythm): Cents {
  return Math.round((RENT_BANDS[0].perLot * PAID_MONTHS[rhythm]) / RHYTHM_MONTHS[rhythm]);
}

const DAY_SECONDS = 86_400;

/** The anniversary `years` after a unix time, the 29th of February falling on the 28th. */
function anniversary(from: number, years: number): number {
  const start = new Date(from * 1000);
  const year = start.getUTCFullYear() + years;
  const month = start.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Date.UTC(year, month, Math.min(start.getUTCDate(), lastDay), start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds()) / 1000;
}

/**
 * The year of a subscription a charge falls in: 1 from its first paid day,
 * 2 from the first anniversary, and so on. A renewal falls on the
 * anniversary to the second; a day's tolerance absorbs the clocks.
 */
export function subscriptionYear(paidFrom: number, at: number): number {
  let year = 1;
  while (year < 100 && anniversary(paidFrom, year) <= at + DAY_SECONDS) year += 1;
  return year;
}
