import { describe, expect, it } from "vitest";
import { countriesFor, normalizePhone } from "../phone";
import { EMPTY_PREFERENCES, profileInput, safeSignupNext } from "../model";

describe("phone entry", () => {
  it("pins neighbouring countries first, without duplicates", () => {
    for (const locale of ["fr", "en", "de", "lu"] as const) {
      const countries = countriesFor(locale);
      expect(countries.slice(0, 5).map((country) => country.code)).toEqual(["LU", "BE", "FR", "DE", "NL"]);
      expect(countries[0].dial).toBe("+352");
      expect(new Set(countries.map((country) => country.code)).size).toBe(countries.length);
      expect(countries.length).toBeGreaterThan(200);
    }
  });
  it.each([
    ["621 123 456", "LU", "+352621123456"],
    ["06 12 34 56 78", "FR", "+33612345678"],
    ["0470 12 34 56", "BE", "+32470123456"],
    ["0033 6 12 34 56 78", "LU", "+33612345678"],
    ["+49 1512 3456789", "LU", "+4915123456789"],
  ] as const)("normalizes %s independently of formatting", (value, country, expected) => {
    expect(normalizePhone(value, country)).toBe(expected);
  });
  it.each(["", "12", "hello +352621123456", "+352621123456 ext 12", "+999123456789"])("rejects invalid input: %s", (value) => {
    expect(normalizePhone(value, "LU")).toBeNull();
  });
});

describe("signup navigation and input", () => {
  it.each(["https://evil.test", "//evil.test", "/\\evil.test", "/app/../../connexion", "/app/%2e%2e/connexion", "/app/%2f%2fevil.test", "/connexion", "/app\n"])("rejects unsafe or looping destinations: %s", (value) => {
    expect(safeSignupNext(value)).toBe("/app");
  });
  it("preserves invitation paths, and keeps tenant entry out of owner provisioning", () => {
    expect(safeSignupNext("/invitation/test?source=mail", "tenant")).toBe("/invitation/test?source=mail");
    expect(safeSignupNext("/app?x=1", "tenant")).toBe("/locataire");
    expect(safeSignupNext(null, "tenant")).toBe("/locataire");
    expect(safeSignupNext("/locataire/messages")).toBe("/locataire/messages");
  });
  it("allows unanswered tailoring but rejects invented roles and malformed emails", () => {
    expect(profileInput.safeParse({ action: "complete", preferences: EMPTY_PREFERENCES }).success).toBe(true);
    expect(profileInput.safeParse({ action: "details", role: "admin", firstName: "A", lastName: "B", locale: "en" }).success).toBe(false);
    expect(profileInput.safeParse({ action: "email", email: "broken" }).success).toBe(false);
  });
});
