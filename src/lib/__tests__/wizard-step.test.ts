import { describe, expect, it } from "vitest";
import { openingStep } from "@/lib/wizard-step";

describe("openingStep", () => {
  it("opens where the record stands when the address names nothing", () => {
    expect(openingStep(NaN, 4, true)).toBe(4);
    expect(openingStep(NaN, null, true)).toBe(1);
    expect(openingStep(0, 3, true)).toBe(3);
  });
  it("follows the address up to the step after the saved one", () => {
    // A reload on the step just reached, and the exit inventory handing back to the next.
    expect(openingStep(3, 3, true)).toBe(3);
    expect(openingStep(3, 2, true)).toBe(3);
    // Going back is always allowed.
    expect(openingStep(1, 5, true)).toBe(1);
  });
  it("does not open a later step on values nobody entered", () => {
    expect(openingStep(7, null, true)).toBe(1);
    expect(openingStep(7, 2, true)).toBe(3);
  });
  it("follows the address as written where nothing is saved between steps", () => {
    expect(openingStep(7, null, false)).toBe(7);
  });
});
