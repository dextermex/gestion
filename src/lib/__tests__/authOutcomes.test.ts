import { describe, expect, it } from "vitest";
import { readField, signInOutcome, signUpOutcome } from "@/lib/auth/outcomes";

/**
 * The door's reading of the account system's answers. Supabase names errors
 * by code today and by message before auth-js 2.6x: both spellings land on
 * the same outcome, and the look-alike answer that hides an existing address
 * is read for what it is.
 */
describe("signing in", () => {
  it("is fine without an error", () => {
    expect(signInOutcome(null)).toBe("ok");
    expect(signInOutcome(undefined)).toBe("ok");
  });

  it("names wrong credentials, by code or by message", () => {
    expect(signInOutcome({ status: 400, code: "invalid_credentials", message: "Invalid login credentials" })).toBe("invalid");
    expect(signInOutcome({ status: 400, message: "Invalid login credentials" })).toBe("invalid");
  });

  it("names an address that never opened its confirmation link", () => {
    expect(signInOutcome({ status: 400, code: "email_not_confirmed", message: "Email not confirmed" })).toBe("unconfirmed");
    expect(signInOutcome({ status: 400, message: "Email not confirmed" })).toBe("unconfirmed");
  });

  it("tells too many attempts from an unreachable account system from anything else", () => {
    expect(signInOutcome({ status: 429, code: "over_request_rate_limit", message: "Request rate limit reached" })).toBe("rate_limited");
    expect(signInOutcome({ name: "AuthRetryableFetchError", message: "Failed to fetch" })).toBe("down");
    expect(signInOutcome({ status: 0, message: "Load failed" })).toBe("down");
    expect(signInOutcome({ status: 500, message: "Database error querying schema" })).toBe("failed");
  });
});

describe("creating an account", () => {
  const user = (identities: unknown[]) => ({ user: { identities }, session: null });

  it("opens the space when the answer carries a session", () => {
    expect(signUpOutcome({ user: { identities: [{}] }, session: { access_token: "x" } }, null)).toBe("session");
  });

  it("asks for the confirmation link when the account is new and waits for it", () => {
    expect(signUpOutcome(user([{ provider: "email" }]), null)).toBe("confirm");
    expect(signUpOutcome({ user: { identities: null }, session: null }, null)).toBe("confirm");
  });

  it("recognises an address that already has an account, however the system says it", () => {
    // Enumeration protection off: an error.
    expect(signUpOutcome(null, { status: 422, code: "user_already_exists", message: "User already registered" })).toBe("exists");
    expect(signUpOutcome(null, { status: 400, message: "A user with this email address has already been registered" })).toBe("exists");
    // Enumeration protection on: a look-alike user with no identity, and no mail on its way.
    expect(signUpOutcome(user([]), null)).toBe("exists");
  });

  it("names a short password, too many attempts, an unreachable system, and the rest", () => {
    expect(signUpOutcome(null, { status: 422, code: "weak_password", message: "Password should be at least 6 characters." })).toBe("weak_password");
    expect(signUpOutcome(null, { status: 429, code: "over_email_send_rate_limit", message: "email rate limit exceeded" })).toBe("rate_limited");
    expect(signUpOutcome(null, { name: "AuthRetryableFetchError", message: "Failed to fetch" })).toBe("down");
    expect(signUpOutcome(null, { status: 500, message: "unexpected" })).toBe("failed");
  });
});

describe("reading a field as the browser holds it", () => {
  const form = new Map<string, unknown>([
    ["email", "  Anna.Weber@example.lu "],
    ["password", "  secret with spaces  "],
    ["file", new Blob([])],
  ]);

  it("trims an address and keeps a password exactly", () => {
    expect(readField(form, "email")).toBe("Anna.Weber@example.lu");
    expect(readField(form, "password", { trim: false })).toBe("  secret with spaces  ");
  });

  it("reads a missing or non-text field as empty", () => {
    expect(readField(form, "nothing")).toBe("");
    expect(readField(form, "file")).toBe("");
  });
});
