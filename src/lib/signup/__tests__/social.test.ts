import type { User } from "@supabase/supabase-js";
import { afterEach, expect, it, vi } from "vitest";
import { confirmedEmail, oauthReturnUrl, socialProviders } from "../social";

afterEach(() => vi.unstubAllEnvs());
it("provider buttons stay hidden until both phone rollout and provider configuration are enabled", () => {
  vi.stubEnv("NEXT_PUBLIC_GOOGLE_SIGNIN_ENABLED", "0");
  vi.stubEnv("NEXT_PUBLIC_APPLE_SIGNIN_ENABLED", "0");
  expect(socialProviders(true)).toEqual([]);
  vi.stubEnv("NEXT_PUBLIC_GOOGLE_SIGNIN_ENABLED", "1");
  expect(socialProviders(false)).toEqual([]);
  expect(socialProviders(true)).toEqual(["google"]);
  expect(socialProviders(true, true)).toEqual(["google", "apple"]);
});
it("OAuth return keeps language and safe invitation destination without allowing external redirects", () => {
  const link = new URL(oauthReturnUrl("https://app.morada.lu", "de", "link", "/invitation/abc"));
  expect(link.origin + link.pathname).toBe("https://app.morada.lu/inscription");
  expect(link.searchParams.get("next")).toBe("/invitation/abc");
  expect(link.searchParams.get("lang")).toBe("de");
  expect(link.searchParams.has("mode")).toBe(false);
  const login = new URL(oauthReturnUrl("https://app.morada.lu", "fr", "login", "//evil.test"));
  expect(login.searchParams.get("next")).toBe("/app");
  expect(login.searchParams.get("mode")).toBe("login");
});
it("email verification cannot be claimed through editable metadata or a pending address", () => {
  const user = { email: "verified@example.test", user_metadata: { email_verified: true } } as unknown as User;
  expect(confirmedEmail(user)).toBe(false);
  user.email_confirmed_at = "2026-09-27";
  expect(confirmedEmail(user)).toBe(true);
  user.new_email = "pending@example.test";
  expect(confirmedEmail(user)).toBe(false);
});
