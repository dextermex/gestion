// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import SignupFunnel, { SETUP_MS } from "@/components/signup/SignupFunnel";
import { getDict } from "@/lib/i18n";
import { LOCALES, type Locale } from "@/lib/i18n/config";
import type { ApiErrorCopy } from "@/lib/api-errors";

/**
 * The sign-up after the account, the iPhone app's order: the eleven
 * questions, the interests, the first month, the count while the space is
 * created, the plan, then the three trial screens and the offer only when
 * the subscription state says so. The billing routes are the other branch's:
 * mocked here in the contract's shapes.
 */
const auth = vi.hoisted(() => ({ getUser: vi.fn(), refreshSession: vi.fn(), signOut: vi.fn() }));
vi.mock("@/lib/supabase/browser", () => ({ getSupabase: () => ({ auth }) }));
vi.mock("next/image", () => ({ default: (props: { alt?: string }) => <span data-image={props.alt ?? ""} /> }));
vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));
vi.mock("@/components/signup/Turnstile", () => ({ default: () => null }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLDialogElement.prototype.showModal = function () { this.open = true; };
HTMLDialogElement.prototype.close = function () { this.open = false; };

const apiErrors = Object.fromEntries(LOCALES.map((l) => [l, getDict(l).apiErrors])) as Record<Locale, ApiErrorCopy>;
let root: Root;
let host: HTMLDivElement;
let assign: ReturnType<typeof vi.fn>;
let calls: { url: string; body: Record<string, unknown> | null }[];
let etat: unknown;
let checkout: { status: number; body: unknown };

const landlord = (stage = "tailor", mobile: Record<string, unknown> = {}) => ({
  id: "u1", phone: "352621123456", phone_confirmed_at: "2026-11-27", email: "", new_email: "alex@example.test", email_confirmed_at: undefined,
  app_metadata: { provider: "phone", providers: ["phone"] },
  user_metadata: { first_name: "Alex", last_name: "Example", morada_signup: { version: 1, role: "landlord", stage, password_set_at: "2026-11-27T10:00:00Z" }, morada_mobile: mobile },
});

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/inscription");
  vi.stubEnv("NEXT_PUBLIC_PHONE_SIGNUP_ENABLED", "1");
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "test-site-key");
  auth.getUser.mockResolvedValue({ data: { user: landlord() }, error: null });
  assign = vi.fn();
  calls = [];
  etat = { configured: false, access: "open", reason: null, trialOffered: true };
  checkout = { status: 200, body: { url: "https://checkout.stripe.com/c/pay/cs_test_1" } };
  vi.stubGlobal("location", { ...window.location, assign, protocol: "http:" });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { body?: string }) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ url, body });
    const answer = (status: number, payload: unknown) => ({ ok: status < 300, status, json: async () => payload });
    if (url === "/api/abonnement/etat") return answer(200, etat);
    if (url === "/api/abonnement/checkout") return answer(checkout.status, checkout.body);
    return answer(200, { ok: true });
  }));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const h1 = () => host.querySelector("h1")?.textContent;
async function submit() {
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}
async function click(text: string) {
  const button = [...host.querySelectorAll("button")].find((node) => node.textContent === text || node.getAttribute("aria-label") === text);
  if (!button) throw new Error(`no button "${text}" on "${h1()}"`);
  await act(async () => button.click());
}
async function pick(value: string) {
  await act(async () => host.querySelector<HTMLInputElement>(`input[type="radio"][value="${value}"]`)!.click());
}

/** Flats, 2 to 5 lots, rents of 1 000 to 1 499 euros, and the first answer everywhere else. */
const ANSWERS = ["flats", "self", "2-5", "1", "lu", "spreadsheet", "rent", "5", "days", "rent", "word"];
async function answerAll() {
  const titles: string[] = [];
  for (const value of ANSWERS) {
    titles.push(h1() ?? "");
    await pick(value);
    await submit();
  }
  return titles;
}
async function throughSetup() {
  vi.useFakeTimers();
  await click("Continue");
  expect(h1()).toBe("Building your space");
  await act(async () => { await vi.advanceTimersByTimeAsync(SETUP_MS + 200); });
  vi.useRealTimers();
}

it("asks the eleven questions in the app's order, one per step, with the address naming the question", async () => {
  await act(async () => root.render(<SignupFunnel locale="en" signedIn />));
  expect(host.querySelectorAll('input[type="radio"]')).toHaveLength(4);
  expect(host.textContent).toContain("🏢");
  // Nothing chosen: the step says so and stays.
  await submit();
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("Choose an answer to continue.");
  const bar = () => Number(host.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow"));
  const first = bar();
  expect(first).toBeGreaterThan(50);
  const titles = await answerAll();
  expect(titles).toEqual([
    "What do you let?", "You manage for…", "How many units, roughly?", "And your rents, on average?", "Where are your properties?", "How do you manage today?",
    "What weighs on you most?", "How much time does it take you?", "When rent is late, you find out…", "Your goal this year?", "Where did you hear about Morada?",
  ]);
  expect(bar()).toBeGreaterThan(first);
  expect(h1()).toBe("What matters to you?");
  // Pre-filled from the pain named (rents) and the lateness: unpaid rent, to do, cash flow, the month, late payments.
  expect(host.querySelector("form .signup-primary")?.textContent).toBe("Continue · 5 chosen");
  await click("Back");
  expect(h1()).toBe("Where did you hear about Morada?");
  expect(host.querySelector<HTMLInputElement>('input[value="word"]')?.checked).toBe(true);
});

it("reopens the question a reload names, with the answers this tab already gave", async () => {
  window.history.replaceState(null, "", "/inscription?q=4");
  sessionStorage.setItem("morada.signup.answers", JSON.stringify({ answers: { kind: "houses", manage: "self", units: "6-10" } }));
  await act(async () => root.render(<SignupFunnel locale="en" signedIn question={4} />));
  expect(h1()).toBe("And your rents, on average?");
  await click("Back");
  expect(h1()).toBe("How many units, roughly?");
  expect(host.querySelector<HTMLInputElement>('input[value="6-10"]')?.checked).toBe(true);
});

it("without payments on the deployment, saves the answers, opens the space and goes from the plan straight to the welcome", async () => {
  await act(async () => root.render(<SignupFunnel locale="en" signedIn />));
  await answerAll();
  await submit();
  expect(h1()).toBe("You have what it takes.");
  // The reviews step is skipped while there is no real quote.
  await throughSetup();
  const complete = calls.find((call) => call.body?.action === "complete")!.body!;
  expect(complete).toMatchObject({
    preferences: { properties: "2-5", challenge: "rent", involvement: "5" },
    quiz: { kind: "flats", manageFor: "self", units: "2-5", where: "lu", today: "spreadsheet", late: "days", goal: "rent", source: "word" },
    dashboard: { order: ["arrears", "cashflow", "actions", "costs", "requests", "activity"], interests: ["arrears", "cashflow", "actions"], horizon: "month", watch: ["arrears"] },
  });
  expect(calls.map((call) => call.url)).toEqual(["/api/signup/profile", "/api/espace/creer", "/api/abonnement/etat"]);
  expect(h1()).toBe("Your plan is ready.");
  expect(host.textContent).toContain("Every transfer matched to the right rent");
  // No word about money before the offer, and no trial when the deployment takes no payment.
  expect(host.textContent).not.toMatch(/€/);
  await click("Continue");
  expect(h1()).toBe("You’re all set, Alex.");
  await click("Open my space");
  expect(assign).toHaveBeenCalledWith("/app/biens/nouveau?type=apartment&tour=1");
});

it("goes to the welcome when the workspace is already open, and asks again when the answers could not be saved", async () => {
  etat = { configured: true, access: "open", reason: null, trialOffered: false };
  await act(async () => root.render(<SignupFunnel locale="en" signedIn />));
  await answerAll(); await submit();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    calls.push({ url, body: null });
    return url === "/api/signup/profile" ? { ok: false, status: 502, json: async () => ({ error: "save_failed" }) } : { ok: true, status: 200, json: async () => etat };
  }));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await throughSetup();
  expect(h1()).toBe("Building your space");
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("We couldn’t save your details. Please try again.");
  expect(calls.some((call) => call.url === "/api/espace/creer")).toBe(false);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => (url === "/api/abonnement/etat" ? etat : { ok: true }) })));
  vi.useFakeTimers();
  await click("Try again");
  await act(async () => { await vi.advanceTimersByTimeAsync(SETUP_MS + 200); });
  vi.useRealTimers();
  expect(h1()).toBe("Your plan is ready.");
  await click("Continue");
  expect(h1()).toBe("You’re all set, Alex.");
});

it("for a locked workspace, shows the three trial screens and the offer, priced from the answers, then opens Checkout", async () => {
  etat = { configured: true, access: "locked", reason: "no_trial", trialOffered: true };
  await act(async () => root.render(<SignupFunnel locale="en" signedIn apiErrors={apiErrors} />));
  await answerAll(); await submit();
  await throughSetup();
  expect(host.textContent).toContain("Your free 30-day trial starts right after.");
  await click("Continue");
  expect(h1()).toBe("We want you to try Morada for free.");
  expect(host.querySelector("[data-image]")?.getAttribute("data-image")).toContain("sample figures");
  expect(host.textContent).toContain("No payment due now");
  await click("Try for free");
  expect(h1()).toBe("We will remind you before your trial ends.");
  expect(host.textContent).toContain("By email, two days before it ends.");
  await click("Continue for free");
  expect(h1()).toBe("Your first 30 days are on us.");
  expect(host.querySelector(".signup-trial-rows")?.textContent).toContain("In 28 days");
  expect(host.querySelector(".signup-trial-rows")?.textContent).toContain("In 30 days");
  expect(host.querySelector("[data-price-line]")?.textContent).toBe("Try 30 days free, then €420 per year (€35 per month)");
  expect(host.querySelector(".signup-understand")?.textContent).toBe("Price for 3 units · Understand my price");
  expect(host.textContent).toContain("No payment today. Cancel anytime.");
  // The panel: the year preselected with its two months, the quarter changes the price at once.
  await click("Understand my price");
  expect(host.querySelector<HTMLDialogElement>(".signup-price-panel")?.open).toBe(true);
  expect(host.querySelector('[data-rhythm="year"]')?.getAttribute("data-on")).toBe("true");
  expect(host.querySelector('[data-rhythm="year"]')?.textContent).toBe("Yearly · 2 months free");
  await act(async () => host.querySelector<HTMLInputElement>('[data-rhythm="quarter"] input')!.click());
  expect(host.querySelector("[data-price-line]")?.textContent).toBe("Try 30 days free, then €126 per quarter (€42 per month)");
  await act(async () => host.querySelector<HTMLInputElement>('input[name="panel-units"]')!.click());
  expect(host.querySelector("[data-panel-result]")?.textContent).toBe("€42 per quarter (€14 per month)");
  await click("Done");
  expect(host.querySelector<HTMLDialogElement>(".signup-price-panel")?.open).toBe(false);
  await click("Start my 30 free days");
  expect(calls.find((call) => call.body?.action === "offer")?.body).toEqual({ action: "offer", outcome: "paywall", offer: { units: 1, band: 1, billing: "quarter" } });
  expect(calls.find((call) => call.url === "/api/abonnement/checkout")?.body).toEqual({ source: "signup", units: 1, band: 1, billing: "quarter" });
  expect(assign).toHaveBeenCalledWith("https://checkout.stripe.com/c/pay/cs_test_1");
});

it("says a failed Checkout on the screen with a retry, and welcomes a space that already has its subscription", async () => {
  auth.getUser.mockResolvedValue({ data: { user: landlord("complete", { quiz: { kind: "houses", units: "1" }, offer: { units: 1, band: 2, billing: "year", addon: false } }) }, error: null });
  etat = { configured: true, access: "locked", reason: "no_trial", trialOffered: true };
  checkout = { status: 503, body: { error: "billing_unavailable" } };
  await act(async () => root.render(<SignupFunnel locale="en" signedIn entry="offer" apiErrors={apiErrors} />));
  expect(h1()).toBe("Your first 30 days are on us.");
  expect(host.querySelector("[data-price-line]")?.textContent).toBe("Try 30 days free, then €190 per year (€15.83 per month)");
  await click("Start my 30 free days");
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("Online payment is unavailable for now. Try again later.");
  expect(assign).not.toHaveBeenCalled();
  checkout = { status: 409, body: { error: "already_subscribed" } };
  await click("Start my 30 free days");
  expect(h1()).toBe("You’re all set, Alex.");
  await click("Open my space");
  expect(assign).toHaveBeenCalledWith("/app/biens/nouveau?type=house&tour=1");
});

it("closing the offer opens the one-time offer once; declining it leads to the space, and the next close does not show it again", async () => {
  auth.getUser.mockResolvedValue({ data: { user: landlord("complete", { quiz: { kind: "flats", units: "2-5" }, offer: { units: 3, band: 1, billing: "year", addon: false } }) }, error: null });
  etat = { configured: true, access: "locked", reason: "no_trial", trialOffered: true };
  await act(async () => root.render(<SignupFunnel locale="en" signedIn entry="offer" />));
  await click("Not now");
  expect(h1()).toBe("25% off\nyour first year");
  expect(host.querySelector(".signup-badge")?.textContent).toBe("25% off");
  expect(host.querySelector(".signup-winback-price")?.textContent).toBe("€26.25per month€35");
  expect(host.querySelector(".signup-winback-under")?.textContent).toBe("€315 the first year, then €420 per year");
  expect(host.querySelector(".signup-understand")).not.toBeNull();
  await click("No thanks");
  expect(calls.find((call) => call.body?.action === "offer")?.body).toEqual({ action: "offer", outcome: "declined", offer: { units: 3, band: 1, billing: "year" } });
  expect(assign).toHaveBeenCalledWith("/app");
  // From the locked screen again (`?etape=offre`): closing the offer now leads to the space.
  await act(async () => root.unmount());
  root = createRoot(host);
  assign.mockClear();
  await act(async () => root.render(<SignupFunnel locale="en" signedIn entry="offer" />));
  await click("Not now");
  expect(assign).toHaveBeenCalledWith("/app");
});

it("back from a cancelled Checkout opens the one-time offer, whose button asks for it", async () => {
  auth.getUser.mockResolvedValue({ data: { user: landlord("complete", { quiz: { kind: "flats", units: "2-5" } }) }, error: null });
  etat = { configured: true, access: "locked", reason: "no_trial", trialOffered: true };
  await act(async () => root.render(<SignupFunnel locale="en" signedIn entry="offer" cancelled />));
  expect(h1()).toBe("25% off\nyour first year");
  await click("Start my 30 free days");
  expect(calls.find((call) => call.url === "/api/abonnement/checkout")?.body).toEqual({ source: "signup", units: 3, band: 0, billing: "year", winback: true });
  expect(calls.find((call) => call.body?.action === "offer")?.body).toMatchObject({ outcome: "winback" });
});

it("promises no free days to a workspace that already had them: the subscription starts today", async () => {
  auth.getUser.mockResolvedValue({ data: { user: landlord("complete", { quiz: { units: "2-5" }, offer: { units: 3, band: 1, billing: "year", addon: false } }) }, error: null });
  etat = { configured: true, access: "locked", reason: "ended", trialOffered: false };
  await act(async () => root.render(<SignupFunnel locale="en" signedIn entry="offer" />));
  expect(h1()).toBe("Your subscription starts today.");
  expect(host.querySelector(".signup-trial-rows")).toBeNull();
  expect(host.querySelector("[data-price-line]")?.textContent).toBe("€420 per year (€35 per month)");
  expect(host.textContent).toContain("€420 per year, charged today and renewed automatically. Cancel anytime.");
  expect(host.querySelector(".signup-step .signup-primary")?.textContent).toBe("Start my subscription");
});

it("sends a complete landlord arriving at the sign-up to the space, and opens the welcome it is sent to", async () => {
  auth.getUser.mockResolvedValue({ data: { user: landlord("complete", { quiz: { kind: "flats", units: "0" } }) }, error: null });
  await act(async () => root.render(<SignupFunnel locale="en" signedIn />));
  expect(assign).toHaveBeenCalledWith("/app");
  await act(async () => root.unmount());
  root = createRoot(host);
  assign.mockClear();
  await act(async () => root.render(<SignupFunnel locale="en" signedIn entry="welcome" />));
  expect(h1()).toBe("You’re all set, Alex.");
  await click("Open my space");
  expect(assign).toHaveBeenCalledWith("/app?tour=1");
});

it("an invited landlord answers the questions but opens no space of its own and sees no payment", async () => {
  auth.getUser.mockResolvedValue({ data: { user: { ...landlord(), email: "staff@example.test", new_email: "", email_confirmed_at: "2026-11-27" } }, error: null });
  await act(async () => root.render(<SignupFunnel locale="en" signedIn next="/invitation" />));
  await answerAll(); await submit();
  await throughSetup();
  expect(calls.map((call) => call.url)).toEqual(["/api/signup/profile"]);
  await click("Continue");
  expect(h1()).toBe("You’re all set, Alex.");
  await click("Open my space");
  expect(assign).toHaveBeenCalledWith("/invitation");
});
