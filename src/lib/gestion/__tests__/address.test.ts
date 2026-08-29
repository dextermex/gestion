import { describe, expect, it } from "vitest";
import { formatAddress } from "@/lib/gestion/address";

describe("formatAddress", () => {
  it("renders the house convention", () => {
    expect(
      formatAddress({ street: "rue de la Gare", number: "12", postal_code: "L-1611", city: "Luxembourg" }),
    ).toBe("12, rue de la Gare, L-1611 Luxembourg");
  });
  it("skips missing parts without leftover separators", () => {
    expect(formatAddress({ street: "rue des Champs", city: "Bertrange" })).toBe("rue des Champs, Bertrange");
    expect(formatAddress(null)).toBe("");
  });
});
