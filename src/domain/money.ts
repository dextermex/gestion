/**
 * Money is always integer euro-cents. Floating point never touches a ledger:
 * derived amounts round half-up at the last step, and allocation splits must
 * sum exactly back to their source amount.
 */

export type Cents = number;

export function cents(euros: number): Cents {
  return Math.round(euros * 100);
}

export function euros(amount: Cents): number {
  return amount / 100;
}

/** Round half-up to whole cents after a fractional computation. */
export function roundCents(value: number): Cents {
  return Math.round(value);
}

/** Percentage of an amount, rounded half-up to whole cents. */
export function pct(amount: Cents, percentage: number): Cents {
  return Math.round((amount * percentage) / 100);
}

/**
 * Split an amount by ratios so the parts sum exactly to the whole
 * (largest-remainder method). Used for co-owner allocation, tantièmes,
 * and fee splits — a ledger must never leak a cent to rounding.
 */
export function splitExact(amount: Cents, ratios: number[]): Cents[] {
  const total = ratios.reduce((a, b) => a + b, 0);
  if (total <= 0) throw new Error("splitExact: ratios must sum to a positive number");
  const raw = ratios.map((r) => (amount * r) / total);
  const floored = raw.map((v) => Math.floor(v));
  let remainder = amount - floored.reduce((a, b) => a + b, 0);
  const order = raw
    .map((v, i) => ({ frac: v - Math.floor(v), i }))
    .sort((a, b) => b.frac - a.frac);
  const out = [...floored];
  for (const { i } of order) {
    if (remainder <= 0) break;
    out[i] += 1;
    remainder -= 1;
  }
  return out;
}

const EUR_FORMAT = new Intl.NumberFormat("fr-LU", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
});

const EUR_FORMAT_WHOLE = new Intl.NumberFormat("fr-LU", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function formatEUR(amount: Cents): string {
  return EUR_FORMAT.format(amount / 100);
}

export function formatEURWhole(amount: Cents): string {
  return EUR_FORMAT_WHOLE.format(amount / 100);
}
