import { describe, expect, it } from "vitest";
import { countriesFor, normalizePhone } from "../phone";
import { EMPTY_PREFERENCES, emailGiven, funnelStep, profileInput, providerAccount, resumeStep, safeSignupNext } from "../model";
import { dashboardFromQuiz } from "../dashboard";

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

describe("resumeStep (the iPhone app's, with its two departures from the web's former rules)", () => {
  const user = (over: Record<string, unknown>) => ({ user_metadata: {}, app_metadata: {}, phone_confirmed_at: null, email: null, email_confirmed_at: null, new_email: null, ...over }) as never;
  it("sends an account without funnel metadata to existing", () => {
    expect(resumeStep(user({}))).toBe("existing");
  });
  it("walks the stages in order", () => {
    const meta = { morada_signup: { version: 1, role: "landlord", stage: "email" } };
    expect(resumeStep(user({ user_metadata: meta }))).toBe("phone");
    expect(resumeStep(user({ user_metadata: { morada_signup: { version: 1, stage: "role" } }, phone_confirmed_at: "x" }))).toBe("role");
    expect(resumeStep(user({ user_metadata: meta, phone_confirmed_at: "x" }))).toBe("email");
    // The e-mail is asked, never verified in the funnel: a pending address moves on to the password.
    expect(resumeStep(user({ user_metadata: { morada_signup: { ...meta.morada_signup, stage: "password" } }, phone_confirmed_at: "x", new_email: "a@b.lu" }))).toBe("create-password");
    expect(resumeStep(user({ user_metadata: { morada_signup: { ...meta.morada_signup, stage: "password" } }, phone_confirmed_at: "x", email: "a@b.lu", email_confirmed_at: "x" }))).toBe("create-password");
    expect(resumeStep(user({ user_metadata: { morada_signup: { ...meta.morada_signup, stage: "tailor", password_set_at: "x" } }, phone_confirmed_at: "x", email: "a@b.lu", email_confirmed_at: "x" }))).toBe("properties");
    expect(resumeStep(user({ user_metadata: { morada_signup: { ...meta.morada_signup, stage: "tailor", password_set_at: "x" } }, phone_confirmed_at: "x", new_email: "a@b.lu" }))).toBe("properties");
    expect(resumeStep(user({ user_metadata: { morada_signup: { ...meta.morada_signup, stage: "complete", password_set_at: "x" } }, phone_confirmed_at: "x", new_email: "a@b.lu" }))).toBe("existing");
  });
  it("lets an Apple or Google account skip the phone and the password", () => {
    const apple = { app_metadata: { provider: "apple", providers: ["apple"] } };
    const meta = { morada_signup: { version: 1, role: "landlord", stage: "role" } };
    expect(resumeStep(user({ ...apple, user_metadata: meta }))).toBe("role");
    expect(resumeStep(user({ ...apple, user_metadata: { morada_signup: { ...meta.morada_signup, stage: "email" } } }))).toBe("email");
    expect(resumeStep(user({ ...apple, user_metadata: { morada_signup: { ...meta.morada_signup, stage: "password" } }, email: "a@b.lu", email_confirmed_at: "x" }))).toBe("properties");
    expect(resumeStep(user({ ...apple, user_metadata: { morada_signup: { ...meta.morada_signup, stage: "complete" } }, email: "a@b.lu", email_confirmed_at: "x" }))).toBe("existing");
    expect(resumeStep(user({ app_metadata: { provider: "phone", providers: ["phone", "google"] }, user_metadata: { morada_signup: { ...meta.morada_signup, stage: "password" } }, email: "a@b.lu", email_confirmed_at: "x" }))).toBe("properties");
  });
  it("sends an account finished before October 2026 without an address or a password back to them", () => {
    const done = { morada_signup: { version: 1, role: "landlord", stage: "complete" } };
    expect(resumeStep(user({ user_metadata: done, phone_confirmed_at: "x" }))).toBe("email");
    expect(resumeStep(user({ user_metadata: done, phone_confirmed_at: "x", new_email: "a@b.lu" }))).toBe("create-password");
    expect(resumeStep(user({ user_metadata: { morada_signup: { version: 1, role: "landlord", stage: "email_code" } }, phone_confirmed_at: "x", new_email: "a@b.lu" }))).toBe("create-password");
  });
  it("keeps an invitation's sign-up at the e-mail code until the address is confirmed, and nobody else", () => {
    const pending = user({ user_metadata: { morada_signup: { version: 1, role: "tenant", stage: "password" } }, phone_confirmed_at: "x", new_email: "a@b.lu" });
    expect(funnelStep(pending, true)).toBe("email-code");
    expect(funnelStep(pending, false)).toBe("create-password");
    expect(funnelStep(user({ user_metadata: { morada_signup: { version: 1, role: "tenant", stage: "email" } }, phone_confirmed_at: "x", new_email: "a@b.lu" }), true)).toBe("email");
    expect(funnelStep(user({ user_metadata: { morada_signup: { version: 1, role: "tenant", stage: "password" } }, phone_confirmed_at: "x", email: "a@b.lu", email_confirmed_at: "x" }), true)).toBe("create-password");
  });
  it("tells an Apple or Google account from a phone one by Auth's own metadata", () => {
    expect(providerAccount({ app_metadata: { provider: "google" } } as never)).toBe(true);
    expect(providerAccount({ app_metadata: { provider: "phone", providers: ["phone"] } } as never)).toBe(false);
    expect(emailGiven({ email: "", email_confirmed_at: undefined, new_email: "a@b.lu" } as never)).toBe(true);
    expect(emailGiven({ email: "", email_confirmed_at: undefined, new_email: "" } as never)).toBe(false);
  });
});

describe("the questions' answers the profile route accepts", () => {
  const quiz = { kind: "flats", manageFor: "self", units: "2-5", where: "lu", today: "spreadsheet", late: "days", goal: "rent", source: "word" };
  const preferences = { properties: "2-5", challenge: "rent", involvement: "5" };
  it("takes the app's keys, and leaves them out when there are none", () => {
    expect(profileInput.safeParse({ action: "complete", preferences, quiz, dashboard: dashboardFromQuiz("rent", "days") }).success).toBe(true);
    expect(profileInput.safeParse({ action: "complete", preferences, quiz: { ...quiz, kind: null, units: "0" } }).success).toBe(true);
    expect(profileInput.safeParse({ action: "complete", preferences: EMPTY_PREFERENCES }).success).toBe(true);
  });
  it("refuses any other key or value, and anything free-form", () => {
    expect(profileInput.safeParse({ action: "complete", preferences, quiz: { ...quiz, kind: "castle" } }).success).toBe(false);
    expect(profileInput.safeParse({ action: "complete", preferences, quiz: { ...quiz, note: "call me" } }).success).toBe(false);
    expect(profileInput.safeParse({ action: "complete", preferences, quiz: { ...quiz, units: "11+" } }).success).toBe(false);
    expect(profileInput.safeParse({ action: "complete", preferences: { ...preferences, properties: "11-20" } }).success).toBe(false);
    const dashboard = dashboardFromQuiz("rent", null);
    expect(profileInput.safeParse({ action: "complete", preferences, dashboard: { ...dashboard, order: [...dashboard.order, "arrears"] } }).success).toBe(false);
    expect(profileInput.safeParse({ action: "complete", preferences, dashboard: { ...dashboard, horizon: "week" } }).success).toBe(false);
    expect(profileInput.safeParse({ action: "complete", preferences, dashboard: { ...dashboard, theme: "dark" } }).success).toBe(false);
  });
  it("takes an offer's outcome in the app's words, with a price on the grid", () => {
    expect(profileInput.safeParse({ action: "offer", outcome: "declined", offer: { units: 3, band: 1, billing: "year" } }).success).toBe(true);
    expect(profileInput.safeParse({ action: "offer", outcome: "maybe", offer: { units: 3, band: 1, billing: "year" } }).success).toBe(false);
    expect(profileInput.safeParse({ action: "offer", outcome: "paywall", offer: { units: 3, band: 1, billing: "month" } }).success).toBe(false);
    // The plan choice of the former funnel is gone: the offer screen replaces it.
    expect(profileInput.safeParse({ action: "plan", rhythm: "year" }).success).toBe(false);
  });
});
