import { describe, expect, it } from "vitest";
import { monthName, monthPhrase } from "@/lib/portal/format";

/**
 * A month inside a sentence of the tenant space. French joins it with "de"
 * and elides before a vowel; the other languages take the month as written.
 */
describe("the month, as a sentence takes it", () => {
  it("elides before a vowel in French, and lowers the capital", () => {
    expect(monthPhrase("Août 2026", "fr")).toBe("d'août 2026");
    expect(monthPhrase("Octobre 2026", "fr")).toBe("d'octobre 2026");
    expect(monthPhrase("Mai 2026", "fr")).toBe("de mai 2026");
  });

  it("leaves the other languages alone", () => {
    expect(monthPhrase("August 2026", "en")).toBe("August 2026");
    expect(monthPhrase("August 2026", "de")).toBe("August 2026");
  });

  it("names the month alone from a date", () => {
    expect(monthName("2026-09-01", "fr")).toBe("septembre");
    expect(monthName("2026-09-01", "en")).toBe("September");
    expect(monthName("pas une date", "fr")).toBe("");
  });
});
