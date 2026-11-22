import { describe, expect, it } from "vitest";
import { parseEuroInput } from "@/lib/gestion/euros";

describe("parseEuroInput", () => {
  it("reads the common European writings as integer cents", () => {
    expect(parseEuroInput("1850")).toBe(185000);
    expect(parseEuroInput("1 850,00")).toBe(185000);
    expect(parseEuroInput("1.850,50")).toBe(185050);
    expect(parseEuroInput("1,850.50")).toBe(185050);
    expect(parseEuroInput("1.850")).toBe(185000);
    expect(parseEuroInput("1850.5")).toBe(185050);
    expect(parseEuroInput("220,00 €")).toBe(22000);
  });
  it("rejects what is not a positive amount", () => {
    expect(parseEuroInput("")).toBeNull();
    expect(parseEuroInput("0")).toBeNull();
    expect(parseEuroInput("-12")).toBeNull();
    expect(parseEuroInput("abc")).toBeNull();
    expect(parseEuroInput("12,345")).toBeNull();
  });
  it("reads every thousands group, and never misreads a leading zero as thousands", () => {
    expect(parseEuroInput("1.250.000")).toBe(125000000);
    expect(parseEuroInput("1.250.000,50")).toBe(125000050);
    expect(parseEuroInput("1,250,000")).toBe(125000000);
    expect(parseEuroInput("1,250,000.50")).toBe(125000050);
    expect(parseEuroInput("0.50")).toBe(50);
    expect(parseEuroInput("0,5")).toBe(50);
    // Three decimals after a zero is not an amount: refused, never 500,00 €.
    expect(parseEuroInput("0.500")).toBeNull();
    expect(parseEuroInput("1,250")).toBeNull();
    // Groups that are not of three, around a decimal mark, are refused.
    expect(parseEuroInput("1.25.000,00")).toBeNull();
    expect(parseEuroInput("12.50,00")).toBeNull();
  });
});
