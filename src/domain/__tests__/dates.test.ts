import { describe, expect, it } from "vitest";
import {
  addMonths,
  commencedMonthsBetween,
  diffDays,
  fullMonthsBetween,
  fullYearsBetween,
} from "@/domain/dates";

describe("legal date arithmetic", () => {
  it("clamps month-end when adding months (31 Jan + 1 month = 28 Feb)", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29"); // leap year
    expect(addMonths("2026-03-31", 1)).toBe("2026-04-30");
  });

  it("computes full months between dates", () => {
    expect(fullMonthsBetween("2026-01-15", "2026-03-15")).toBe(2);
    expect(fullMonthsBetween("2026-01-15", "2026-03-14")).toBe(1);
    expect(fullMonthsBetween("2024-06-01", "2026-06-01")).toBe(24);
  });

  it("commenced months: one day late = 1 commenced month (the penalty clock)", () => {
    expect(commencedMonthsBetween("2026-05-01", "2026-05-01")).toBe(0);
    expect(commencedMonthsBetween("2026-05-01", "2026-05-02")).toBe(1);
    expect(commencedMonthsBetween("2026-05-01", "2026-06-01")).toBe(1);
    expect(commencedMonthsBetween("2026-05-01", "2026-06-02")).toBe(2);
    expect(commencedMonthsBetween("2026-05-01", "2026-08-15")).toBe(4);
  });

  it("diffDays and fullYearsBetween", () => {
    expect(diffDays("2026-08-01", "2026-08-23")).toBe(22);
    expect(fullYearsBetween("2008-09-01", "2026-08-31")).toBe(17);
    expect(fullYearsBetween("2008-09-01", "2026-09-01")).toBe(18);
  });
});
