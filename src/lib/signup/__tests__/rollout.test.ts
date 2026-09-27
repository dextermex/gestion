import { afterEach, expect, it, vi } from "vitest";
import { phoneSignupEntryEnabled, phoneSignupReady } from "../rollout";

afterEach(() => vi.unstubAllEnvs());
it("the funnel is ready only with both the phone flag and the Turnstile site key", () => {
  vi.stubEnv("NEXT_PUBLIC_PHONE_SIGNUP_ENABLED", "1");
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
  expect(phoneSignupReady()).toBe(false);
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "0x4AAA-public");
  expect(phoneSignupReady()).toBe(true);
});
it("a ready funnel keeps the public entry closed until the entry flag is 1", () => {
  vi.stubEnv("NEXT_PUBLIC_PHONE_SIGNUP_ENABLED", "1");
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "0x4AAA-public");
  vi.stubEnv("PHONE_SIGNUP_ENTRY_ENABLED", "0");
  expect(phoneSignupEntryEnabled()).toBe(false);
  vi.stubEnv("PHONE_SIGNUP_ENTRY_ENABLED", "");
  expect(phoneSignupEntryEnabled()).toBe(false);
  vi.stubEnv("PHONE_SIGNUP_ENTRY_ENABLED", "1");
  expect(phoneSignupEntryEnabled()).toBe(true);
});
it("the entry flag alone cannot open an unconfigured funnel", () => {
  vi.stubEnv("PHONE_SIGNUP_ENTRY_ENABLED", "1");
  vi.stubEnv("NEXT_PUBLIC_PHONE_SIGNUP_ENABLED", "0");
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "0x4AAA-public");
  expect(phoneSignupEntryEnabled()).toBe(false);
});
