import { describe, expect, it } from "vitest";
import { RENT_BANDS, bandOf } from "@/domain/billing/pricing";
import { answerForUnits, offerQuote, offerSchema, rentInBand, unitsFromAnswer, webProperties } from "../offer";

describe("the price the sign-up quotes", () => {
  it("quotes a bracket by its typical case, and at least one lot", () => {
    expect(["1", "2-5", "6-10", "11-20", "21-50", "0", "11+", null].map((a) => unitsFromAnswer(a))).toEqual([1, 3, 8, 15, 30, 1, 15, 1]);
    expect([1, 4, 9, 20, 44].map(answerForUnits)).toEqual(["1", "2-5", "6-10", "11-20", "21-50"]);
    expect(webProperties("21-50")).toBe("11+");
    expect(webProperties("0")).toBe("0");
  });
  it("puts a rent in each band it names", () => {
    for (let band = 0; band < RENT_BANDS.length; band++) expect(bandOf(rentInBand(band))).toBe(band);
  });
  it("prices three lots between 1 000 and 1 499 euros at 14 euros a lot: 420 euros a year, 35 euros a month", () => {
    const year = offerQuote({ units: 3, band: 1, billing: "year" });
    expect(year.charged).toBe(42_000);
    expect(year.shownMonthly).toBe(3_500);
    expect(offerQuote({ units: 3, band: 1, billing: "quarter" }).charged).toBe(12_600);
  });
  it("refuses an offer outside the grid", () => {
    expect(offerSchema.safeParse({ units: 0, band: 0, billing: "year" }).success).toBe(false);
    expect(offerSchema.safeParse({ units: 3, band: 5, billing: "year" }).success).toBe(false);
    expect(offerSchema.safeParse({ units: 3, band: 1, billing: "month" }).success).toBe(false);
  });
});
