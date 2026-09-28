import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acquisitionActualDateFields, acquisitionSchema, emptyAcquisition, parseAcquisitionEuro, sortAcquisitions,
  type AcquisitionDraft, type AcquisitionRecord,
} from "../acquisition";

const base = (): AcquisitionDraft => ({ ...emptyAcquisition(), name: "Appartement à étudier", address: "Luxembourg" });
const record = (id: string, overrides: Partial<AcquisitionRecord> = {}): AcquisitionRecord => ({
  ...base(), id, createdAt: "2026-01-01T12:00:00Z", updatedAt: "2026-09-01T12:00:00Z", ...overrides,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-27T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("acquisition drafts", () => {
  it("starts with the essentials without inventing money, dates or counterparties", () => {
    expect(acquisitionSchema.parse({ name: "  Appartement  ", address: "  Luxembourg  ", stage: "research" })).toEqual({
      ...emptyAcquisition(), name: "Appartement", address: "Luxembourg",
    });
    const first = emptyAcquisition();
    first.name = "Changed";
    expect(emptyAcquisition().name).toBe("");
  });

  it("requires a meaningful name and address and rejects unknown workflow states", () => {
    for (const override of [{ name: "   " }, { address: "" }, { stage: "bought" }, { financingStatus: "approved_by_morada" }]) {
      expect(acquisitionSchema.safeParse({ ...base(), ...override }).success).toBe(false);
    }
  });

  it("keeps scheduled work distinct from completed milestones", () => {
    const planned = acquisitionSchema.parse({
      ...base(), nextActionDate: "2027-01-12", viewingDate: "2027-01-13",
      financeDeadline: "2027-03-01", notaryAppointmentDate: "2027-03-12", transferDate: "2027-03-15",
    });
    expect(planned.stage).toBe("research");
    expect(planned.compromisDate).toBeNull();
    expect(planned.deedSignedDate).toBeNull();
    expect(planned.handoverDate).toBeNull();
    expect(planned.notaryAppointmentDate).toBe("2027-03-12");
    expect(planned.transferDate).toBe("2027-03-15");
  });

  it.each([
    ["compromis", "compromisDate"], ["deed_signed", "deedSignedDate"], ["handover", "handoverDate"],
  ] as const)("requires the actual date for %s without assuming earlier milestones", (stage, field) => {
    const missing = acquisitionSchema.safeParse({ ...base(), stage });
    expect(missing.success).toBe(false);
    if (!missing.success) expect(missing.error.issues).toContainEqual(expect.objectContaining({ path: [field], message: "signed_date_required" }));
    const supplied = acquisitionSchema.parse({ ...base(), stage, [field]: "2026-09-27" });
    expect(supplied[field]).toBe("2026-09-27");
    for (const other of acquisitionActualDateFields.filter((key) => key !== field)) expect(supplied[other]).toBeNull();
    expect(supplied.transferDate).toBeNull();
  });

  it.each(acquisitionActualDateFields)("rejects a future completed date even outside its workflow stage: %s", (field) => {
    const result = acquisitionSchema.safeParse({ ...base(), [field]: "2026-09-28" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toContainEqual(expect.objectContaining({ path: [field], message: "future_actual_date" }));
    expect(acquisitionSchema.safeParse({ ...base(), [field]: "2026-09-27" }).success).toBe(true);
    expect(acquisitionSchema.safeParse({ ...base(), [field]: "2024-02-29" }).success).toBe(true);
  });

  it("evaluates today at validation time, including after the day changes", () => {
    const tomorrow = { ...base(), stage: "deed_signed", deedSignedDate: "2026-09-28" };
    expect(acquisitionSchema.safeParse(tomorrow).success).toBe(false);
    vi.setSystemTime(new Date("2026-09-28T00:00:00Z"));
    expect(acquisitionSchema.safeParse(tomorrow).success).toBe(true);
  });

  it.each(["", "2025-02-29", "2026-04-31", "2026-00-10", "2026-13-01", "2026-01-00", "2026-9-1", "2026-09-27T12:00:00Z", "0000-01-01"])("rejects invalid or ambiguous calendar dates: %s", (date) => {
    const result = acquisitionSchema.safeParse({ ...base(), viewingDate: date });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toContainEqual(expect.objectContaining({ path: ["viewingDate"], message: "invalid_date" }));
  });

  it("reports an impossible actual date as invalid rather than calling it a future event", () => {
    const result = acquisitionSchema.safeParse({ ...base(), deedSignedDate: "2026-13-01" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(expect.objectContaining({ message: "invalid_date" }));
      expect(result.error.issues.some((issue) => issue.message === "future_actual_date")).toBe(false);
    }
  });

  it("accepts valid leap dates, null dates and known zero amounts", () => {
    const parsed = acquisitionSchema.parse({ ...base(), viewingDate: "2024-02-29", nextActionDate: null, askingPriceCents: 0, expectedRentCents: 0 });
    expect(parsed.viewingDate).toBe("2024-02-29");
    expect(parsed.nextActionDate).toBeNull();
    expect(parsed.askingPriceCents).toBe(0);
    expect(parsed.expectedRentCents).toBe(0);
  });

  it("accepts only safe non-negative integer cents", () => {
    for (const amount of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(acquisitionSchema.safeParse({ ...base(), askingPriceCents: amount }).success).toBe(false);
      expect(acquisitionSchema.safeParse({ ...base(), expectedRentCents: amount }).success).toBe(false);
    }
    expect(acquisitionSchema.safeParse({ ...base(), askingPriceCents: Number.MAX_SAFE_INTEGER }).success).toBe(true);
  });

  it("rejects record metadata and unsupported payload fields at the draft boundary", () => {
    expect(acquisitionSchema.safeParse({ ...base(), id: "provided-id" }).success).toBe(false);
    expect(acquisitionSchema.safeParse({ ...base(), paid: true }).success).toBe(false);
  });
});

describe("acquisition euro parsing", () => {
  it.each([
    ["", null], ["  ", null], ["0", 0], ["0,01", 1], ["0.1", 10], ["1,05", 105], [" 1250.50 ", 125_050],
    ["90071992547409.90", 9_007_199_254_740_990], ["90071992547409.91", Number.MAX_SAFE_INTEGER],
  ])("preserves exact cents and distinguishes blank from zero: %s", (raw, expected) => {
    expect(parseAcquisitionEuro(String(raw))).toBe(expected);
  });

  it.each(["-1", "+1", "1e3", "Infinity", "NaN", "1.234", "1,000", "1 000", "1,234.56", "1.234,56", "1\t000", "€100", "90071992547409.92", "9".repeat(100)])("rejects malformed, grouped or unsafe amounts without silently rounding: %s", (raw) => {
    expect(() => parseAcquisitionEuro(raw)).toThrow(new RangeError("invalid_money"));
  });
});

describe("acquisition ordering", () => {
  it("sorts overdue work before future work, then undated records by recent changes, without mutation", () => {
    const input = Object.freeze([
      Object.freeze(record("undated-old", { updatedAt: "2026-07-01T12:00:00Z" })),
      Object.freeze(record("future", { nextActionDate: "2026-10-01" })),
      Object.freeze(record("overdue", { nextActionDate: "2026-09-01" })),
      Object.freeze(record("undated-new", { updatedAt: "2026-09-27T12:00:00Z" })),
    ]);
    const before = JSON.stringify(input);
    const sorted = sortAcquisitions(input);
    expect(sorted.map((row) => row.id)).toEqual(["overdue", "future", "undated-new", "undated-old"]);
    expect(JSON.stringify(input)).toBe(before);
    expect(sorted).not.toBe(input);
  });

  it("handles equal dates deterministically and never ranks an undated record ahead of a dated one", () => {
    const input = [record("z"), record("b", { nextActionDate: "9999-12-31" }), record("a", { nextActionDate: "9999-12-31" })];
    expect(sortAcquisitions(input).map((row) => row.id)).toEqual(["a", "b", "z"]);
    expect(sortAcquisitions([])).toEqual([]);
  });
});
