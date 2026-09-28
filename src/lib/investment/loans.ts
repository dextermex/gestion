import { z } from "zod";

// Technical input ceiling in cents, not a regulatory or lending limit.
export const money = z.number().finite().int().nonnegative().max(100_000_000_000);
export const calendarDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => {
  if (v < "1000-01-01") return false;
  const date = new Date(`${v}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === v;
});
export const loanSchema = z.object({
  propertyId: z.string().trim().min(1).max(100),
  unitId: z.string().trim().min(1).max(100).nullable(),
  name: z.string().trim().min(1).max(160),
  bankName: z.string().trim().min(1).max(160),
  originalCents: money.refine((n) => n > 0),
  balanceCents: money,
  balanceDate: calendarDay,
  annualRatePct: z.number().finite().min(0).max(30),
  // A mixed mortgage has separate fixed/variable tranches. One blended rate
  // cannot represent their different remaining terms or rate-review dates.
  rateType: z.enum(["fixed", "variable"]),
  remainingMonths: z.number().int().min(0).max(600),
  insuranceCents: money,
  nextPaymentDate: calendarDay.nullable(),
  fixedUntil: calendarDay.nullable(),
  notes: z.string().trim().max(4000),
}).strict().superRefine((v, ctx) => {
  if ((v.balanceCents > 0 && v.remainingMonths === 0) || (v.balanceCents === 0 && v.remainingMonths !== 0)) {
    ctx.addIssue({code: "custom", path: ["remainingMonths"], message: "balance_term"});
  }
  if (v.balanceDate > new Date().toISOString().slice(0, 10)) {
    ctx.addIssue({code: "custom", path: ["balanceDate"], message: "future_balance"});
  }
});
export type LoanDraft = z.infer<typeof loanSchema>;
export type LoanRecord = LoanDraft & { id: string; createdAt: string; updatedAt: string };
export type FinanceProperty = {
  id: string; name: string; monthlyRentCents: number;
  units: { id: string; name: string; monthlyRentCents: number }[];
};

/** Official product pages. Directory only: no ranking, rate quote or bank integration. */
export const LUXEMBOURG_LENDERS = [
  {name: "Banque de Luxembourg", url: "https://www.banquedeluxembourg.com/en/bank/bl/personal-banking/finance-your-projects?country=LU"},
  {name: "BGL BNP Paribas", url: "https://www.bgl.lu/fr/particuliers/projet-immo/pret-immobilier.html"},
  {name: "BIL", url: "https://www.bil.com/fr/particuliers/produits-et-services/emprunter/Pages/pret-logement.aspx"},
  {name: "Raiffeisen", url: "https://www.raiffeisen.lu/en/private/finance/r-logement-housing-loan"},
  {name: "Spuerkeess", url: "https://www.spuerkeess.lu/en/private-customers/loans/housing-loan/"},
] as const;

/**
 * Euros with a decimal comma or point and optional groups of three separated by
 * spaces. Reject ambiguous punctuation grouping, exponents and extra decimals;
 * never silently round or turn a misplaced space ("12 34") into another amount.
 */
export function moneyInput(raw: string): number | null {
  let clean = raw.trim().replace(/[\u00a0\u202f]/g, " ");
  if (clean.startsWith("€")) clean = clean.slice(1).trim();
  else if (clean.endsWith("€")) clean = clean.slice(0, -1).trim();
  if (clean.length > 32 || !/^(?:\d+|\d{1,3}(?: \d{3})+)(?:[.,]\d{1,2})?$/.test(clean)) return null;
  const [whole, fraction = ""] = clean.replace(/ /g, "").replace(",", ".").split(".");
  const exact = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
  if (exact > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  const cents = Number(exact);
  return money.safeParse(cents).success ? cents : null;
}
