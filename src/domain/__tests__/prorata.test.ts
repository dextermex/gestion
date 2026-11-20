import { describe, expect, it } from "vitest";
import { monthShare, prorate } from "@/domain/lease/prorata";

/** The first and last month of a tenancy, cut to the days it covers, rounded once. */
describe("a month the tenancy covers in part", () => {
  it("is the days from the start, or up to the end, over the days of the month", () => {
    expect(monthShare("2026-09", "2026-09-17", null)).toEqual({ from: "2026-09-17", to: "2026-09-30", days: 14, daysInMonth: 30 });
    expect(monthShare("2026-02-01", "2025-01-01", "2026-02-10")).toEqual({ from: "2026-02-01", to: "2026-02-10", days: 10, daysInMonth: 28 });
    expect(monthShare("2026-03", "2026-03-10", "2026-03-20")?.days).toBe(11);
  });
  it("is nothing for a month covered whole, or not at all", () => {
    expect(monthShare("2026-09", "2026-09-01", null)).toBeNull();
    expect(monthShare("2026-10", "2026-09-17", null)).toBeNull();
    expect(monthShare("2026-08", "2026-09-17", null)).toBeNull();
    expect(monthShare("2026-09", "2026-01-01", "2026-09-30")).toBeNull();
  });
  it("cuts an amount once, to the cent", () => {
    expect(prorate(125000, { days: 14, daysInMonth: 30 })).toBe(58333);
    expect(prorate(15000, { days: 10, daysInMonth: 28 })).toBe(5357);
    expect(prorate(0, { days: 3, daysInMonth: 31 })).toBe(0);
  });
});
