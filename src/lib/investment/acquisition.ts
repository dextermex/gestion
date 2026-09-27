import { z } from "zod";

/** Workflow milestones, not a determination of contractual ownership. */
export const acquisitionStages = [
  "research", "viewing", "offer", "compromis", "deed_pending", "deed_signed", "handover", "paused", "archived",
] as const;
export type AcquisitionStage = (typeof acquisitionStages)[number];

export const financingStatuses = [
  "research", "submitted", "pending", "offer_received", "accepted", "refused", "cash",
] as const;
export type AcquisitionFinancingStatus = (typeof financingStatuses)[number];

export const acquisitionDateFields = [
  "nextActionDate", "viewingDate", "compromisDate", "financeDeadline", "notaryAppointmentDate", "deedSignedDate", "transferDate", "handoverDate",
] as const;
export type AcquisitionDateField = (typeof acquisitionDateFields)[number];
export const acquisitionActualDateFields = ["compromisDate", "deedSignedDate", "handoverDate"] as const;

/** Empty strings are invalid dates: the form explicitly converts an empty field to null. */
const calendarDate = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "1000-01-01") return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "invalid_date").nullable().default(null);

const optionalMoney = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable().default(null);
const optionalName = z.string().trim().max(200).default("");

export const acquisitionSchema = z.object({
  name: z.string().trim().min(1, "required").max(200),
  address: z.string().trim().min(1, "required").max(500),
  stage: z.enum(acquisitionStages),
  askingPriceCents: optionalMoney,
  expectedRentCents: optionalMoney,
  bankName: optionalName,
  financingStatus: z.enum(financingStatuses).default("research"),
  notaryName: optionalName,
  nextAction: z.string().trim().max(500).default(""),
  nextActionDate: calendarDate,
  viewingDate: calendarDate,
  compromisDate: calendarDate,
  financeDeadline: calendarDate,
  notaryAppointmentDate: calendarDate,
  deedSignedDate: calendarDate,
  transferDate: calendarDate,
  handoverDate: calendarDate,
  notes: z.string().trim().max(10000).default(""),
}).strict().superRefine((record, ctx) => {
  // Actual events cannot be scheduled. Their corresponding planned dates remain independent.
  const today = new Date().toISOString().slice(0, 10);
  for (const field of acquisitionActualDateFields) {
    const value = record[field];
    if (value && calendarDate.safeParse(value).success && value > today) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: "future_actual_date" });
    }
  }
  // Direct notarial purchases are possible, so later stages do not require a compromis.
  if (record.stage === "compromis" && !record.compromisDate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["compromisDate"], message: "signed_date_required" });
  }
  if (record.stage === "deed_signed" && !record.deedSignedDate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["deedSignedDate"], message: "signed_date_required" });
  }
  if (record.stage === "handover" && !record.handoverDate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["handoverDate"], message: "signed_date_required" });
  }
});

export type AcquisitionDraft = z.infer<typeof acquisitionSchema>;
export type AcquisitionRecord = AcquisitionDraft & { id: string; createdAt: string; updatedAt: string };

export function emptyAcquisition(): AcquisitionDraft {
  return {
    name: "", address: "", stage: "research", askingPriceCents: null, expectedRentCents: null,
    bankName: "", financingStatus: "research", notaryName: "", nextAction: "", nextActionDate: null,
    viewingDate: null, compromisDate: null, financeDeadline: null, notaryAppointmentDate: null,
    deedSignedDate: null, transferDate: null, handoverDate: null, notes: "",
  };
}

/** Plain euros with either decimal separator. No grouping, signs, exponents or silent rounding. */
export function parseAcquisitionEuro(raw: string): number | null {
  const value = raw.trim();
  if (!value) return null;
  if (value.length > 32 || !/^\d+(?:[.,]\d{1,2})?$/.test(value)) throw new RangeError("invalid_money");
  const [whole, fraction = ""] = value.replace(",", ".").split(".");
  const cents = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("invalid_money");
  return Number(cents);
}

/** Dated work first, then the most recently changed undated project. Does not mutate records. */
export function sortAcquisitions(records: readonly AcquisitionRecord[]): AcquisitionRecord[] {
  return [...records].sort((a, b) => {
    if (!a.nextActionDate && b.nextActionDate) return 1;
    if (a.nextActionDate && !b.nextActionDate) return -1;
    const byDate = (a.nextActionDate || "").localeCompare(b.nextActionDate || "");
    return byDate || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id);
  });
}
