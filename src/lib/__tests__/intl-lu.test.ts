import { describe, expect, it } from "vitest";
import { NUMBER_LOCALE, dateInWords } from "@/lib/i18n/config";
import { euros, eurosWhole, formatDate, formatMonth, formatNumber, formatPct } from "@/lib/types";

/**
 * What a client component prints in Luxembourgish must not depend on the
 * browser carrying Luxembourgish locale data: the server has it, Chrome does
 * not, and the two would then disagree at hydration. Figures go through
 * German's rules for Luxembourg (identical), dates through the same rules
 * with the month's own Luxembourgish name.
 */
describe("Luxembourgish formatting without Luxembourgish locale data", () => {
  it("never asks the runtime for lb", () => {
    expect(NUMBER_LOCALE.lu).toBe("de-LU");
    expect(NUMBER_LOCALE.fr).toBe("fr-LU");
  });

  it("writes amounts, numbers and percentages as lb-LU does", () => {
    expect(euros(185000, "lu")).toBe("1.850,00 €");
    expect(eurosWhole(123456789, "lu")).toBe("1.234.568 €");
    expect(euros(-1250, "lu")).toBe("-12,50 €");
    expect(formatNumber(1234.5, "lu")).toBe("1.234,5");
    expect(formatPct(87.25, "lu")).toBe("87,3 %");
  });

  it("writes a day with the month's Luxembourgish name, short inside a date", () => {
    const days = ["2026-01-15", "2026-02-15", "2026-03-15", "2026-04-15", "2026-05-15", "2026-06-15", "2026-07-15", "2026-08-15", "2026-09-15", "2026-10-15", "2026-11-15", "2026-12-15"];
    expect(days.map((d) => formatDate(d, "lu"))).toEqual([
      "15. Jan. 2026", "15. Feb. 2026", "15. Mäe. 2026", "15. Abr. 2026", "15. Mee 2026", "15. Juni 2026",
      "15. Juli 2026", "15. Aug. 2026", "15. Sep. 2026", "15. Okt. 2026", "15. Nov. 2026", "15. Dez. 2026",
    ]);
  });

  it("writes a month in full, and on its own in short", () => {
    expect(formatMonth("2026-03", "lu")).toBe("Mäerz 2026");
    expect(formatMonth("2026-04", "lu")).toBe("Abrëll 2026");
    expect(formatMonth("2026-05", "lu")).toBe("Mee 2026");
    expect(dateInWords(new Date("2026-06-15T12:00:00Z"), "lu", { month: "short", timeZone: "UTC" })).toBe("Jun");
    expect(dateInWords(new Date("2026-03-31T23:30:00Z"), "lu", { month: "long", timeZone: "UTC" })).toBe("Mäerz");
  });

  it("leaves the other languages to their own locale", () => {
    expect(formatDate("2026-03-15", "fr")).toBe(new Date("2026-03-15T00:00:00").toLocaleDateString("fr-LU", { day: "numeric", month: "short", year: "numeric" }));
    expect(formatMonth("2026-03", "de")).toBe("März 2026");
    expect(euros(185000, "en")).toBe("€1,850.00");
  });
});
