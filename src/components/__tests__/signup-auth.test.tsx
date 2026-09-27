// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import SignupFunnel from "@/components/signup/SignupFunnel";

const auth = vi.hoisted(() => ({
  getUser: vi.fn(), signInWithOtp: vi.fn(), verifyOtp: vi.fn(), signOut: vi.fn(), linkIdentity: vi.fn(), signInWithOAuth: vi.fn(), signInWithPassword: vi.fn(),
}));
vi.mock("@/lib/supabase/browser", () => ({ getSupabase: () => ({ auth }) }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/components/signup/Turnstile", () => ({
  default: ({ onToken }: { onToken: (token: string) => void }) => <button type="button" onClick={() => onToken("one-use-captcha")}>Solve test challenge</button>,
}));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom does not implement the native dialog methods; browser checks cover
// the actual modal, focus trap, country search and selection.
HTMLDialogElement.prototype.showModal = function () { this.open = true; };
HTMLDialogElement.prototype.close = function () { this.open = false; };
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/inscription");
  vi.stubEnv("NEXT_PUBLIC_PHONE_SIGNUP_ENABLED", "1");
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "test-site-key");
  auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllEnvs();
});
async function click(text: string) {
  const button = [...host.querySelectorAll("button")].find((node) => node.textContent === text)!;
  await act(async () => button.click());
}
async function phone() {
  await act(async () => {
    const field = host.querySelector<HTMLInputElement>("#signup-phone")!;
    // No input event: this also exercises password-manager/browser autofill.
    field.value = "621 123 456";
  });
}
async function submit() {
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}

it("fails closed without a security token, including programmatic submission", async () => {
  await act(async () => root.render(<SignupFunnel locale="en" />));
  await phone(); await submit();
  expect(auth.signInWithOtp).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("security check");
});
it("normalizes autofilled input, submits one OTP request, and cannot verify on a rejected code", async () => {
  let resolve!: (result: { error: null }) => void;
  auth.signInWithOtp.mockImplementation(() => new Promise((done) => { resolve = done; }));
  await act(async () => root.render(<SignupFunnel locale="en" />));
  await phone(); await click("Solve test challenge");
  await submit();
  expect(auth.signInWithOtp).not.toHaveBeenCalled();
  const confirm = host.querySelector<HTMLButtonElement>(".signup-confirm-dialog .signup-primary")!;
  await act(async () => { confirm.click(); confirm.click(); });
  expect(auth.signInWithOtp).toHaveBeenCalledTimes(1);
  expect(auth.signInWithOtp).toHaveBeenCalledWith({
    phone: "+352621123456",
    options: { captchaToken: "one-use-captcha", shouldCreateUser: true, data: { preferred_language: "en", morada_signup: { version: 1, stage: "role" } } },
  });
  await act(async () => resolve({ error: null }));
  expect(host.querySelector("h1")?.textContent).toBe("Check your messages");
  expect([...host.querySelectorAll("button")].find((button) => button.textContent?.startsWith("Resend in"))?.disabled).toBe(true);
  auth.verifyOtp.mockResolvedValue({ data: { user: null }, error: { code: "otp_expired" } });
  const field = host.querySelector<HTMLInputElement>("#signup-code")!;
  field.value = "123456";
  await submit();
  expect(auth.verifyOtp).toHaveBeenCalledWith({ phone: "+352621123456", token: "123456", type: "sms" });
  expect(host.querySelector("h1")?.textContent).toBe("Check your messages");
  expect(document.activeElement).toBe(field);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("expired");
});
it("returning-phone login cannot silently create an account", async () => {
  auth.signInWithOtp.mockResolvedValue({ error: null });
  await act(async () => root.render(<SignupFunnel locale="en" loginMode phoneLogin />));
  await phone(); await click("Solve test challenge"); await submit(); await click("Confirm and send code");
  expect(auth.signInWithOtp).toHaveBeenCalledWith({ phone: "+352621123456", options: { captchaToken: "one-use-captcha", shouldCreateUser: false } });
});
it("the design preview never reads or creates a real auth session", async () => {
  await act(async () => root.render(<SignupFunnel locale="en" preview />));
  await phone(); await submit(); await click("Confirm and send code");
  expect(host.querySelector("h1")?.textContent).toBe("Check your messages");
  expect(auth.getUser).not.toHaveBeenCalled();
  expect(auth.signInWithOtp).not.toHaveBeenCalled();
});

const phoneUser = () => ({
  id: "phone-account", phone: "352621123456", phone_confirmed_at: "2026-09-27",
  email: "", email_confirmed_at: "", identities: [{ provider: "phone" }],
  user_metadata: { first_name: "Alex", last_name: "Example", morada_signup: { stage: "email", role: "landlord" } },
});
function enableSocial() {
  vi.stubEnv("NEXT_PUBLIC_GOOGLE_SIGNIN_ENABLED", "1");
  vi.stubEnv("NEXT_PUBLIC_APPLE_SIGNIN_ENABLED", "1");
  vi.stubEnv("NEXT_PUBLIC_SOCIAL_LINKING_ENABLED", "1");
  vi.stubEnv("NEXT_PUBLIC_SOCIAL_LOGIN_ENABLED", "1");
}
it("phone-first signup has no social entry and lets the visitor correct a number without sending an SMS", async () => {
  enableSocial();
  await act(async () => root.render(<SignupFunnel locale="en" />));
  expect(host.textContent).not.toContain("Continue with Google");
  expect(host.textContent).not.toContain("Continue with Apple");
  await phone(); await click("Solve test challenge"); await submit();
  expect(host.querySelector("dialog.signup-confirm-dialog")?.hasAttribute("open")).toBe(true);
  await click("Change number");
  expect(host.querySelector("dialog.signup-confirm-dialog")?.hasAttribute("open")).toBe(false);
  expect(host.querySelector<HTMLInputElement>("#signup-phone")?.value).toBe("621 123 456");
  expect(auth.signInWithOtp).not.toHaveBeenCalled();
});
it("at email collection Google links to the verified phone account instead of signing in to a new account", async () => {
  enableSocial();
  auth.getUser.mockResolvedValue({ data: { user: phoneUser() }, error: null });
  auth.linkIdentity.mockResolvedValue({ error: null });
  await act(async () => root.render(<SignupFunnel locale="en" signedIn next="https://evil.test" />));
  expect(host.querySelector("h1")?.textContent).toBe("Add your email");
  await click("Continue with Google");
  expect(auth.linkIdentity).toHaveBeenCalledWith({ provider: "google", options: { redirectTo: expect.stringContaining("/inscription?oauth=link&lang=en&next=%2Fapp") } });
  expect(auth.signInWithOAuth).not.toHaveBeenCalled();
  expect(JSON.parse(sessionStorage.getItem("morada_signup_link")!)).toMatchObject({ userId: "phone-account", provider: "google" });
});
it("cannot link a social account after the phone session is lost", async () => {
  enableSocial();
  auth.getUser.mockResolvedValueOnce({ data: { user: phoneUser() }, error: null }).mockResolvedValue({ data: { user: null }, error: null });
  await act(async () => root.render(<SignupFunnel locale="en" signedIn />));
  await click("Continue with Apple");
  expect(auth.linkIdentity).not.toHaveBeenCalled();
  expect(host.querySelector("h1")?.textContent).toBe("Secure your account");
});
it("a provider conflict leaves the phone account and email fallback intact", async () => {
  enableSocial();
  auth.getUser.mockResolvedValue({ data: { user: phoneUser() }, error: null });
  auth.linkIdentity.mockResolvedValue({ error: { code: "identity_already_exists" } });
  await act(async () => root.render(<SignupFunnel locale="en" signedIn />));
  await click("Continue with Google");
  expect(host.querySelector("#signup-email")).not.toBeNull();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("couldn’t connect");
  expect(sessionStorage.getItem("morada_signup_link")).toBeNull();
  expect(auth.signOut).not.toHaveBeenCalled();
});
it("a cancelled linking callback returns to email and never marks it confirmed", async () => {
  window.history.replaceState(null, "", "/inscription?oauth=link#error=access_denied");
  auth.getUser.mockResolvedValue({ data: { user: phoneUser() }, error: null });
  sessionStorage.setItem("morada_signup_link", JSON.stringify({ userId: "phone-account", provider: "apple", at: Date.now() }));
  await act(async () => root.render(<SignupFunnel locale="en" oauthIntent="link" />));
  expect(host.querySelector("h1")?.textContent).toBe("Add your email");
  expect(host.textContent).not.toContain("Email confirmed");
  expect(host.querySelector('[role="alert"]')?.textContent).toBeTruthy();
  expect(window.location.hash).toBe("");
});
it("rejects an OAuth callback that unexpectedly switched accounts", async () => {
  const user = { ...phoneUser(), id: "different-user" };
  auth.getUser.mockResolvedValue({ data: { user }, error: null });
  auth.signOut.mockResolvedValue({ error: null });
  sessionStorage.setItem("morada_signup_link", JSON.stringify({ userId: "phone-account", provider: "google", at: Date.now() }));
  await act(async () => root.render(<SignupFunnel locale="en" oauthIntent="link" />));
  expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  expect(host.querySelector("h1")?.textContent).toBe("Secure your account");
});
it("only trusts the Auth email confirmation after linking, including Apple's private relay address", async () => {
  const user = { ...phoneUser(), email: "example@privaterelay.appleid.com", email_confirmed_at: "2026-09-27", identities: [{ provider: "phone" }, { provider: "apple" }] };
  auth.getUser.mockResolvedValue({ data: { user }, error: null });
  sessionStorage.setItem("morada_signup_link", JSON.stringify({ userId: user.id, provider: "apple", at: Date.now() }));
  await act(async () => root.render(<SignupFunnel locale="en" oauthIntent="link" />));
  expect(host.querySelector<HTMLInputElement>("#signup-email")?.value).toBe(user.email);
  expect(host.textContent).toContain("Email confirmed");
  expect(host.querySelector('[role="alert"]')).toBeNull();
});
it("returning-user login offers email, Google, Apple and a separate create-account link", async () => {
  enableSocial();
  auth.signInWithOAuth.mockResolvedValue({ error: null });
  await act(async () => root.render(<SignupFunnel locale="en" loginMode />));
  expect(host.querySelector("h1")?.textContent).toBe("Welcome back");
  expect(host.textContent).toContain("Don’t have an account?");
  await click("Continue with Apple");
  expect(auth.signInWithOAuth).toHaveBeenCalledWith({ provider: "apple", options: { redirectTo: expect.stringContaining("oauth=login&lang=en&mode=login") } });
  expect(auth.linkIdentity).not.toHaveBeenCalled();
});
it("email login reads autofilled credentials and does not advance after an incorrect password", async () => {
  await act(async () => root.render(<SignupFunnel locale="en" loginMode />));
  host.querySelector<HTMLInputElement>("#signup-email")!.value = "alex@example.test";
  await submit();
  host.querySelector<HTMLInputElement>("#login-password")!.value = "test-only-password";
  auth.signInWithPassword.mockResolvedValue({ data: { user: null }, error: { code: "invalid_credentials" } });
  await click("Solve test challenge"); await submit();
  expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: "alex@example.test", password: "test-only-password", options: { captchaToken: "one-use-captcha" } });
  expect(host.querySelector("h1")?.textContent).toBe("Your password");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Incorrect email or password");
});
it("a lost SMS response closes confirmation and requires a fresh security challenge", async () => {
  auth.signInWithOtp.mockRejectedValue(new Error("network interrupted"));
  await act(async () => root.render(<SignupFunnel locale="en" />));
  await phone(); await click("Solve test challenge"); await submit(); await click("Confirm and send code");
  expect(host.querySelector("dialog.signup-confirm-dialog")?.hasAttribute("open")).toBe(false);
  expect(host.querySelector("h1")?.textContent).toBe("Secure your account");
  expect(host.querySelector('[role="alert"]')?.textContent).toBeTruthy();
  expect(host.querySelector<HTMLButtonElement>('form .signup-primary')?.disabled).toBe(true);
  await submit();
  expect(auth.signInWithOtp).toHaveBeenCalledTimes(1);
});
