import { describe, expect, it } from "vitest";
import { monthWindow } from "@/lib/months";

describe("monthWindow", () => {
  it("runs from four months back to the next month, across a year's end", () => {
    expect(monthWindow("2026-11")).toEqual(["2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"]);
    expect(monthWindow("2026-02")).toEqual(["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03"]);
  });
});
