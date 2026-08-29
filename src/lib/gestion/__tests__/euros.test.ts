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
});
