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
    expect(maskDay("23/")).toBe("23/");
    expect(maskDay("23/082")).toBe("23/08/2");
    expect(maskDay("23/08/202")).toBe("23/08/202");
  });
  it("leaves a date typed with one-digit days or months as the person wrote it", () => {
    // Each step of typing 1/2/2026 by hand.
    for (const typed of ["1", "1/", "1/2", "1/2/", "1/2/2", "1/2/2026"]) expect(maskDay(typed)).toBe(typed);
    expect(parseDay(maskDay("1/2/2026"))).toBe("2026-02-01");
    // Pasted whole.
    expect(maskDay("5/11/2026")).toBe("5/11/2026");
    expect(parseDay(maskDay("5/11/2026"))).toBe("2026-11-05");
    expect(maskDay("12/3/2026")).toBe("12/3/2026");
  });
  it("does not move the digits when one is removed from the middle", () => {
    // 23/08/2026 with its first digit deleted, then with the month's zero deleted.
    expect(maskDay("3/08/2026")).toBe("3/08/2026");
    expect(parseDay(maskDay("3/08/2026"))).toBe("2026-08-03");
    expect(maskDay("23/8/2026")).toBe("23/8/2026");
    // A digit added in front of a date half typed stays where it was put.
    expect(maskDay("123/08")).toBe("123/08");
  });
  it("never keeps more than a full date", () => {
    expect(maskDay("230820261")).toBe("23/08/2026");
    expect(maskDay("1/2/2026/77")).toBe("1/2/2026/7");
  });
});
