import { describe, expect, it } from "vitest";
import { dayToText, maskDay, parseDay } from "@/lib/day-input";

describe("a day as it is typed", () => {
  it("prints day, month, year whatever the browser", () => {
    expect(dayToText("2026-08-23")).toBe("23/08/2026");
    expect(dayToText("")).toBe("");
    expect(dayToText("23/08/2026")).toBe("");
  });
  it("reads the usual separators and refuses a day that does not exist", () => {
    expect(parseDay("23/08/2026")).toBe("2026-08-23");
    expect(parseDay("3.8.2026")).toBe("2026-08-03");
    expect(parseDay("23 08 2026")).toBe("2026-08-23");
    expect(parseDay("31/02/2026")).toBeNull();
    expect(parseDay("08/23/2026")).toBeNull();
    expect(parseDay("23/08/26")).toBeNull();
  });
  it("places the slashes while digits are typed", () => {
    expect(maskDay("2")).toBe("2");
    expect(maskDay("230")).toBe("23/0");
    expect(maskDay("23082026")).toBe("23/08/2026");
    expect(maskDay("23/08/")).toBe("23/08/");
    expect(maskDay("3.8.2026")).toBe("3.8.2026");
  });
});
