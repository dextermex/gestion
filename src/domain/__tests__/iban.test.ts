import { describe, expect, it } from "vitest";
import { ibanChecks } from "@/domain/banking/iban";

/** A payer's account is checked when it is typed: shape and check digits. */
describe("an IBAN's check digits", () => {
  it("accepts real accounts, spaced or not", () => {
    expect(ibanChecks("LU28 0019 4006 4475 0000")).toBe(true);
    expect(ibanChecks("LU280019400644750000")).toBe(true);
    expect(ibanChecks("DE89370400440532013000")).toBe(true);
    expect(ibanChecks("FR1420041010050500013M02606")).toBe(true);
  });
  it("refuses a typo and what is not an IBAN", () => {
    expect(ibanChecks("LU28 0019 4006 4475 0001")).toBe(false);
    expect(ibanChecks("DE89370400440532013001")).toBe(false);
    expect(ibanChecks("LU28")).toBe(false);
    expect(ibanChecks("")).toBe(false);
  });
});
