import { afterEach, expect, it, vi } from "vitest";
import { logSignupFailure, signupErrorKey, unknownNumberAtLogin } from "../errors";
import { arrivedFromRecoveryLink } from "../model";

afterEach(() => vi.restoreAllMocks());

it("names the SMS provider failure instead of a generic connection error", () => {
  // Supabase answered 422 sms_send_failed when Twilio rejected the sender (error 21212).
  expect(signupErrorKey("send", { code: "sms_send_failed", status: 422 })).toBe("smsFailed");
  expect(signupErrorKey("send", { code: "phone_provider_disabled", status: 400 })).toBe("phoneUnavailable");
  expect(signupErrorKey("send", { code: "captcha_failed", status: 400 })).toBe("captchaError");
  expect(signupErrorKey("send", { code: "over_sms_send_rate_limit", status: 429 })).toBe("rateLimited");
  expect(signupErrorKey("send", { code: "validation_failed", status: 400 })).toBe("invalidPhone");
});

it("reads the same code by stage", () => {
  expect(signupErrorKey("send", { code: "otp_disabled" })).toBe("noPhoneAccount");
  expect(signupErrorKey("verify", { code: "otp_disabled" })).toBe("expiredCode");
  expect(signupErrorKey("verify", { code: "otp_expired" })).toBe("expiredCode");
  expect(signupErrorKey("login", { code: "invalid_credentials" })).toBe("wrongPassword");
  expect(signupErrorKey("login", { code: "email_not_confirmed" })).toBe("emailNotConfirmed");
  expect(signupErrorKey("reset", { code: "weak_password" })).toBe("weakPassword");
  expect(signupErrorKey("reset", { code: "same_password" })).toBe("samePassword");
  expect(signupErrorKey("save", { code: "save_failed" })).toBe("saveFailed");
});

it("tells a dropped connection apart from an unknown server error", () => {
  expect(signupErrorKey("send", { name: "AuthRetryableFetchError", status: 0 })).toBe("networkError");
  expect(signupErrorKey("send", { name: "TypeError" })).toBe("networkError");
  expect(signupErrorKey("send", { code: "unexpected_failure", status: 500 })).toBe("unavailable");
  expect(signupErrorKey("send", { name: "AuthRetryableFetchError", status: 500 })).toBe("unavailable");
  expect(signupErrorKey("send", { name: "AuthRetryableFetchError", status: 503 })).toBe("unavailable");
  expect(signupErrorKey("send", undefined)).toBe("unavailable");
});

it("logs the code and status only, never the number, address or provider message", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const failure = { code: "sms_send_failed", status: 422, name: "AuthApiError", message: "Invalid From Number (caller ID): VA123 for +352621000000" };
  logSignupFailure("send", failure);
  const logged = JSON.stringify(warn.mock.calls);
  expect(logged).toContain("sms_send_failed");
  expect(logged).toContain("422");
  expect(logged).not.toContain("+352");
  expect(logged).not.toContain("VA123");
});

it("names a second password as one to change through the reset link", () => {
  expect(signupErrorKey("save", { code: "password_set", status: 409 })).toBe("passwordAlreadySet");
});

it("recognises a number without an account at login, and nothing else, as a code to await", () => {
  expect(unknownNumberAtLogin({ code: "otp_disabled", status: 422 })).toBe(true);
  for (const code of ["sms_send_failed", "captcha_failed", "over_sms_send_rate_limit"]) expect(unknownNumberAtLogin({ code })).toBe(false);
  expect(unknownNumberAtLogin(null)).toBe(false);
});

it("knows the recovery link's own arrival from a session that merely exists", () => {
  expect(arrivedFromRecoveryLink(new URL("https://app.morada.lu/connexion?mode=reset#access_token=a&refresh_token=b&type=recovery"))).toBe(true);
  expect(arrivedFromRecoveryLink(new URL("https://app.morada.lu/connexion?mode=reset&code=abc"))).toBe(true);
  expect(arrivedFromRecoveryLink(new URL("https://app.morada.lu/connexion?mode=reset&token_hash=abc&type=recovery"))).toBe(true);
  expect(arrivedFromRecoveryLink(new URL("https://app.morada.lu/connexion?mode=reset"))).toBe(false);
  expect(arrivedFromRecoveryLink(new URL("https://app.morada.lu/connexion?mode=reset#access_token=a&type=signup"))).toBe(false);
});
