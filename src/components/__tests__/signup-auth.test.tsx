// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import SignupFunnel from "@/components/signup/SignupFunnel";

const auth = vi.hoisted(() => ({
  getUser: vi.fn(), signInWithOtp: vi.fn(), verifyOtp: vi.fn(), signOut: vi.fn(), linkIdentity: vi.fn(), signInWithOAuth: vi.fn(), signInWithPassword: vi.fn(),
  resetPasswordForEmail: vi.fn(), updateUser: vi.fn(), resend: vi.fn(),
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
it("an SMS the provider refuses is named, logged by code only, and keeps the visitor on the number", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  auth.signInWithOtp.mockResolvedValue({ data: {}, error: { code: "sms_send_failed", status: 422, name: "AuthApiError", message: "Invalid From Number (caller ID): VA0" } });
  await act(async () => root.render(<SignupFunnel locale="en" />));
  await phone(); await click("Solve test challenge"); await submit(); await click("Confirm and send code");
  expect(host.querySelector("h1")?.textContent).toBe("Secure your account");
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("We couldn’t send a text to this number. Check it, or try again in a few minutes.");
  const logged = JSON.stringify(warn.mock.calls);
  expect(logged).toContain("sms_send_failed");
  expect(logged).not.toContain("352");
  warn.mockRestore();
});
it("a completed account signs in straight to its space", async () => {
  const assign = vi.fn();
  vi.stubGlobal("location", { ...window.location, assign, protocol: "http:" });
  await act(async () => root.render(<SignupFunnel locale="en" loginMode next="/app/loyers" />));
  host.querySelector<HTMLInputElement>("#signup-email")!.value = "alex@example.test";
  await submit();
  host.querySelector<HTMLInputElement>("#login-password")!.value = "test-only-password";
  auth.signInWithPassword.mockResolvedValue({ data: { user: { id: "u1", email: "alex@example.test", user_metadata: {} } }, error: null });
  await click("Solve test challenge"); await submit();
  expect(assign).toHaveBeenCalledWith("/app/loyers");
  vi.unstubAllGlobals();
});
it("forgot password sends a recovery link back to this app and answers the same for any address", async () => {
  auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
  await act(async () => root.render(<SignupFunnel locale="en" loginMode next="/app" />));
  host.querySelector<HTMLInputElement>("#signup-email")!.value = "alex@example.test";
  await submit();
  await click("Solve test challenge"); await click("Forgot password?");
  expect(auth.resetPasswordForEmail).toHaveBeenCalledWith("alex@example.test", { redirectTo: "https://app.morada.lu/connexion?mode=reset&next=%2Fapp", captchaToken: "one-use-captcha" });
  expect(host.querySelector('[role="status"]')?.textContent).toBe("If an account uses this address, a reset link is on its way.");
  expect(host.innerHTML).not.toContain("legacy=1");
});
it("the recovery link opens a new-password step, and an expired link says so", async () => {
  auth.getUser.mockResolvedValue({ data: { user: { id: "u1", email: "alex@example.test", user_metadata: {} } }, error: null });
  auth.updateUser.mockResolvedValue({ data: { user: null }, error: { code: "weak_password", status: 422 } });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await act(async () => root.render(<SignupFunnel locale="en" loginMode recovery />));
  expect(host.querySelector("h1")?.textContent).toBe("Choose a new password");
  host.querySelector<HTMLInputElement>("#reset-password")!.value = "short";
  await submit();
  expect(auth.updateUser).not.toHaveBeenCalled();
  host.querySelector<HTMLInputElement>("#reset-password")!.value = "long-enough-1";
  await submit();
  expect(auth.updateUser).toHaveBeenCalledWith({ password: "long-enough-1" });
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("too weak");
  await act(async () => root.unmount());
  root = createRoot(host);
  auth.getUser.mockResolvedValue({ data: { user: null }, error: { code: "session_not_found" } });
  await act(async () => root.render(<SignupFunnel locale="en" loginMode recovery />));
  expect(host.querySelector("h1")?.textContent).toBe("Welcome back");
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("This reset link has expired. Request a new one.");
});
it("an invitation's address is prefilled and survives the phone verification", async () => {
  auth.getUser.mockResolvedValue({ data: { user: { id: "u1", phone: "352621123456", phone_confirmed_at: "2026-09-27", email: "", user_metadata: { morada_signup: { version: 1, stage: "email", role: "tenant" } } } }, error: null });
  await act(async () => root.render(<SignupFunnel locale="en" signedIn initialEmail="tenant@example.test" next="/invitation/abc" />));
  expect(host.querySelector<HTMLInputElement>("#signup-email")?.value).toBe("tenant@example.test");
});
it("after the email the funnel asks for the emailed code, then a password, then the landlord questions", async () => {
  const phoneUser = { id: "u1", phone: "352621123456", phone_confirmed_at: "2026-09-27", email: "", new_email: "", email_confirmed_at: undefined,
    user_metadata: { first_name: "Alex", last_name: "Example", morada_signup: { version: 1, role: "landlord", stage: "email" } } };
  auth.getUser.mockResolvedValue({ data: { user: phoneUser }, error: null });
  const calls: Record<string, unknown>[] = [];
  const answers: Record<string, unknown> = { email: { ok: true, emailPending: true }, email_confirmed: { ok: true }, password: { ok: true, stage: "tailor" } };
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body); calls.push(body);
    return { ok: true, status: 200, json: async () => answers[body.action] };
  }));
  await act(async () => root.render(<SignupFunnel locale="en" signedIn />));
  expect(host.querySelector("h1")?.textContent).toBe("Add your email");
  host.querySelector<HTMLInputElement>("#signup-email")!.value = "alex@example.test";
  await act(async () => { host.querySelector<HTMLInputElement>("#signup-email")!.dispatchEvent(new Event("input", { bubbles: true })); });
  await submit();
  expect(host.querySelector("h1")?.textContent).toBe("Check your inbox");
  expect(host.querySelector(".signup-intro")?.textContent).toContain("alex@example.test");
  auth.verifyOtp.mockResolvedValueOnce({ data: { user: null }, error: { code: "otp_expired", status: 403 } });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  host.querySelector<HTMLInputElement>("#email-code")!.value = "111111";
  await submit();
  expect(auth.verifyOtp).toHaveBeenCalledWith({ email: "alex@example.test", token: "111111", type: "email_change" });
  expect(host.querySelector("h1")?.textContent).toBe("Check your inbox");
  auth.verifyOtp.mockResolvedValueOnce({ data: { user: {} }, error: null });
  host.querySelector<HTMLInputElement>("#email-code")!.value = "123456";
  await submit();
  expect(host.querySelector("h1")?.textContent).toBe("Create your password");
  expect(host.querySelector(".signup-intro")?.textContent).toContain("alex@example.test");
  host.querySelector<HTMLInputElement>("#create-password")!.value = "long-enough-1";
  host.querySelector<HTMLInputElement>("#confirm-password")!.value = "long-enough-2";
  await submit();
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("The two passwords don’t match.");
  host.querySelector<HTMLInputElement>("#confirm-password")!.value = "long-enough-1";
  await submit();
  expect(calls.map((call) => call.action)).toEqual(["email", "email_confirmed", "password"]);
  expect(calls[2]).toEqual({ action: "password", password: "long-enough-1" });
  expect(host.querySelector("h1")?.textContent).toBe("How many properties\ndo you manage?");
  vi.unstubAllGlobals();
});
it("an account finished before this change resumes at the email code, and a phone login does not skip it", async () => {
  const assign = vi.fn();
  vi.stubGlobal("location", { ...window.location, assign, protocol: "http:" });
  auth.getUser.mockResolvedValue({ data: { user: { id: "u1", phone: "352621123456", phone_confirmed_at: "2026-09-27", email: "", new_email: "alex@example.test",
    user_metadata: { morada_signup: { version: 1, role: "landlord", stage: "complete" } } } }, error: null });
  await act(async () => root.render(<SignupFunnel locale="en" signedIn loginMode />));
  expect(host.querySelector("h1")?.textContent).toBe("Check your inbox");
  expect(assign).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
it("after the landlord questions the funnel asks how to be billed after the trial, from the published price per lot, and notes it before the welcome", async () => {
  const landlord = { id: "u1", phone: "352621123456", phone_confirmed_at: "2026-09-27", email: "alex@example.test", new_email: "", email_confirmed_at: "2026-09-27",
    user_metadata: { first_name: "Alex", last_name: "Example", morada_signup: { version: 1, role: "landlord", stage: "tailor", password_set_at: "2026-09-27T10:00:00Z" } } };
  auth.getUser.mockResolvedValue({ data: { user: landlord }, error: null });
  const calls: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => {
    calls.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  }));
  await act(async () => root.render(<SignupFunnel locale="en" signedIn />));
  expect(host.querySelector("h1")?.textContent).toBe("How many properties\ndo you manage?");
  await act(async () => host.querySelector<HTMLButtonElement>(".signup-nav-skip")!.click());
  expect(calls).toEqual([{ action: "complete", preferences: { properties: null, challenge: null, involvement: null } }]);
  expect(host.querySelector("h1")?.textContent).toBe("Choose your plan");
  // The site's prices: from €10 a lot a month by the quarter, a year at ten months.
  const priceOf = (rhythm: string) => host.querySelector(`[data-rhythm="${rhythm}"] .signup-plan-price strong`)?.textContent;
  expect(priceOf("quarter")).toBe("€10");
  expect(priceOf("year")).toBe("€8.33");
  expect(host.querySelector('[data-rhythm="year"]')?.textContent).toContain("2 months free");
  expect(host.querySelector(".signup-plan-note")?.textContent).toContain("from €10 to €32 a month");
  expect(host.querySelector('[data-rhythm="quarter"]')?.getAttribute("data-selected")).toBe("true");
  await act(async () => host.querySelector<HTMLInputElement>('input[name="rhythm"][value="year"]')!.click());
  expect(host.querySelector('[data-rhythm="year"]')?.getAttribute("data-selected")).toBe("true");
  // Nothing is charged or asked for here: the promise says so under the button.
  expect(host.querySelector(".signup-free")?.textContent).toBe("No card needed today. Change plan whenever you like.");
  await submit();
  expect(calls[1]).toEqual({ action: "plan", rhythm: "year" });
  expect(host.querySelector('[data-step="welcome"]')).not.toBeNull();
  expect(host.querySelector("[data-welcome-trial]")?.textContent).toContain("then annual billing");
  vi.unstubAllGlobals();
});
it("an invited landlord joins a workspace that already has a plan: no plan step", async () => {
  const invited = { id: "u2", phone: "352621123457", phone_confirmed_at: "2026-09-27", email: "staff@example.test", new_email: "", email_confirmed_at: "2026-09-27",
    user_metadata: { morada_signup: { version: 1, role: "landlord", stage: "tailor", password_set_at: "2026-09-27T10:00:00Z" } } };
  auth.getUser.mockResolvedValue({ data: { user: invited }, error: null });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) })));
  await act(async () => root.render(<SignupFunnel locale="en" signedIn next="/invitation/abc" />));
  await act(async () => host.querySelector<HTMLButtonElement>(".signup-nav-skip")!.click());
  expect(host.querySelector('[data-step="welcome"]')).not.toBeNull();
  vi.unstubAllGlobals();
});
