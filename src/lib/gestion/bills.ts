import { parseEuroInput } from "@/lib/gestion/euros";

/**
 * A bill as the desk enters it: a supplier's invoice or a receipt, dated,
 * numbered, sitting on a lot, in the fiscal bucket the tax pack will read
 * it from, with Luxembourg's VAT rates. Money is integer cents; the total
 * is what the invoice says and the VAT is derived from it once, here.
 */
export const BILL_CATEGORIES = [
  "maintenance_repairs",
  "permanent_charges",
  "insurance",
  "management_fees",
  "impot_foncier",
  "debt_interest",
  "other_frais",
] as const;
export type BillCategory = (typeof BILL_CATEGORIES)[number];

export const VAT_RATES = [17, 14, 8, 3, 0] as const;
export type VatRate = (typeof VAT_RATES)[number];

export type BillDirection = "expense" | "income";

export interface BillInput {
  direction: BillDirection;
  supplierContactId: string | null;
  unitId: string | null;
  category: BillCategory;
  subject: string;
  docNo: string;
  docDate: string | null;
  dueOn: string | null;
  paid: boolean;
  cashflow: boolean;
  vatRatePct: VatRate;
  amountCents: number;
  vatCents: number;
}

export type BillProblem = "subject" | "category" | "vat" | "amount" | "date";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const day = (v: unknown): string | null | undefined => {
  const raw = str(v, 10);
  if (raw === "") return null;
  return ISO.test(raw) && !Number.isNaN(Date.parse(raw)) ? raw : undefined;
};
const flag = (v: unknown): boolean => v === true || v === "true" || v === "1" || v === "on";

/** The VAT inside a total, at a Luxembourg rate: total minus the net, rounded once. */
export function splitVat(totalCents: number, ratePct: number): { netCents: number; vatCents: number } {
  const netCents = Math.round(totalCents / (1 + ratePct / 100));
  return { netCents, vatCents: totalCents - netCents };
}

/** What a form said, read once and not believed: the bill, or the field that is missing. */
export function parseBillInput(form: Record<string, unknown>): BillInput | { problem: BillProblem } {
  const subject = str(form.subject, 140);
  if (!subject) return { problem: "subject" };
  const category = str(form.category, 40) as BillCategory;
  if (!BILL_CATEGORIES.includes(category)) return { problem: "category" };
  const rate = Number(str(form.vatRate, 5));
  if (!(VAT_RATES as readonly number[]).includes(rate)) return { problem: "vat" };
  const amountCents = parseEuroInput(str(form.amount, 20));
  if (amountCents === null) return { problem: "amount" };
  const docDate = day(form.docDate);
  const dueOn = day(form.dueOn);
  if (docDate === undefined || dueOn === undefined) return { problem: "date" };
  return {
    direction: form.direction === "income" ? "income" : "expense",
    supplierContactId: str(form.supplierContactId, 64) || null,
    unitId: str(form.unitId, 64) || null,
    category,
    subject,
    docNo: str(form.docNo, 40),
    docDate,
    dueOn,
    paid: flag(form.paid),
    cashflow: form.cashflow === undefined ? true : flag(form.cashflow),
    vatRatePct: rate as VatRate,
    amountCents,
    vatCents: splitVat(amountCents, rate).vatCents,
  };
}

export type BillState = "paid" | "due" | "overdue";

/** Where a bill stands today: paid, due, or past its due date. */
export function billState(bill: { paidOn: string | null; dueOn: string | null }, today: string): BillState {
  if (bill.paidOn) return "paid";
  return bill.dueOn && bill.dueOn < today ? "overdue" : "due";
}
