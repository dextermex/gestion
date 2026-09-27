import { describe, expect, it } from "vitest";
import { countriesFor, normalizePhone } from "../phone";
import { EMPTY_PREFERENCES, profileInput, resumeStep, safeSignupNext } from "../model";

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

describe("resumeStep", () => {
  const phone = { phone_confirmed_at: "2026-09-27", email: "", email_confirmed_at: undefined as string | undefined, new_email: undefined as string | undefined };
  const at = (stage: string, extra: Record<string, unknown> = {}, user: Partial<typeof phone> = {}) =>
    resumeStep({ ...phone, ...user, user_metadata: { morada_signup: { version: 1, role: "landlord", stage, ...extra } } });
  it("follows the order phone, role, email, email code, password, tailoring", () => {
    expect(resumeStep({ ...phone, phone_confirmed_at: undefined, user_metadata: { morada_signup: { version: 1, stage: "role" } } })).toBe("phone");
    expect(at("role")).toBe("role");
    expect(at("email")).toBe("email");
    expect(at("email_code", {}, { new_email: "a@b.lu" })).toBe("email-code");
    expect(at("email_code")).toBe("email");
    expect(at("password", {}, { email: "a@b.lu", email_confirmed_at: "x" })).toBe("create-password");
    expect(at("tailor", { password_set_at: "x" }, { email: "a@b.lu", email_confirmed_at: "x" })).toBe("properties");
    expect(at("complete", { password_set_at: "x" }, { email: "a@b.lu", email_confirmed_at: "x" })).toBe("existing");
  });
  it("sends an account finished without a confirmed email or a password back to them", () => {
    expect(at("complete", {}, { new_email: "a@b.lu" })).toBe("email-code");
    expect(at("complete", {}, { email: "a@b.lu", email_confirmed_at: "x" })).toBe("create-password");
  });
  it("leaves accounts from the email registration alone", () => {
    expect(resumeStep({ ...phone, user_metadata: {} })).toBe("existing");
  });
});
