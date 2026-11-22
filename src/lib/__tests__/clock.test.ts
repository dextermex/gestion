import { describe, expect, it } from "vitest";
import { dayOf, thisMonth, todayISO } from "@/lib/clock";

describe("the Luxembourg day", () => {
  it("is already tomorrow in Luxembourg while UTC is still on the evening before", () => {
    // 23:30 UTC on 31 January is 00:30 on 1 February in Luxembourg (winter, UTC+1).
    expect(todayISO(new Date("2026-01-31T23:30:00Z"))).toBe("2026-02-01");
    // In summer the gap is two hours: 22:30 UTC on 30 June is 00:30 on 1 July.
    expect(todayISO(new Date("2026-06-30T22:30:00Z"))).toBe("2026-07-01");
  });

  it("is the same day as UTC for the rest of the day", () => {
    expect(todayISO(new Date("2026-03-10T12:00:00Z"))).toBe("2026-03-10");
    expect(thisMonth(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01");
  });

  it("reads the day of a stored instant, and answers nothing for a broken one", () => {
    expect(dayOf("2026-08-05T22:15:00Z")).toBe("2026-08-06");
    expect(dayOf("not a date")).toBe("");
  });
});
