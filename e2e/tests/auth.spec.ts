import { expect, test } from "@playwright/test";
import { accountEmailInShell, autofill, leaveSignedInAccountIfAny, mail, PASSWORD, signIn, signOutFromShell, signUp } from "./helpers";

/**
 * The door, against the real account system: signing
 * in and out, what the browser remembers between two accounts, the messages
 * a person actually reads, and Safari-style autofill.
 */
test.describe.configure({ mode: "serial" });

const alice = { first: "Alice", last: "Weber", email: mail("alice") };
const bruno = { first: "Bruno", last: "Muller", email: mail("bruno") };

test("the management space is not public", async ({ page }) => {
  await page.goto("/app");
  await expect(page).toHaveURL(/\/connexion\?next=(%2F|\/)app/);
  await expect(page.locator("#signup-email")).toBeVisible();
  // Asked as a request, not a navigation: a bare 4xx with no body is a
  // navigation error to Chromium, and the status is what matters here.
  const res = await page.request.get("/api/biens/create");
  expect(res.status(), "an API route answers a stranger with 401 or 405, never data").toBeGreaterThanOrEqual(401);
});

test("a new account signs in on the door and lands in its own space", async ({ page }) => {
  await signUp(page, alice);
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("button", { name: "Mon compte" })).toBeVisible();
  expect(await accountEmailInShell(page)).toBe(alice.email);
});

test("signing out really signs out", async ({ page }) => {
  await signIn(page, alice.email);
  await signOutFromShell(page);
  await page.goto("/app");
  await expect(page).toHaveURL(/\/connexion/);
  await expect(page.getByRole("button", { name: "Utiliser un autre compte" })).toHaveCount(0);
});

test("a wrong password says so, in words", async ({ page }) => {
  await page.goto("/connexion");
  await page.locator("#signup-email").fill(alice.email);
  await page.locator("form button[type=submit]").click();
  await page.locator("#login-password").fill("not-her-password");
  await page.locator("form button[type=submit]").click();
  await expect(page.locator("#signup-error")).toContainText("incorrect");
  await expect(page).toHaveURL(/\/connexion/);
});

test("every older signup link opens the phone-first funnel, never the retired form", async ({ page }) => {
  await page.goto("/connexion?onglet=inscription&ref=hero&next=%2Fapp");
  await expect(page).toHaveURL(/\/inscription\?/);
  const url = new URL(page.url());
  expect(url.searchParams.get("ref")).toBe("hero");
  expect(url.searchParams.get("next")).toBe("/app");
  await expect(page.locator("#signup-phone")).toBeVisible();
  await expect(page.locator("#signup-first-name, #signup-password, #signup-form, [role=tab]")).toHaveCount(0);
  await page.goto("/connexion?legacy=1");
  await expect(page.locator("#signup-email")).toBeVisible();
  await expect(page.locator("#signup-form, [role=tab]")).toHaveCount(0);
});

test("Safari-style autofill (values without input events) still signs in", async ({ page }) => {
  await page.goto("/connexion");
  await autofill(page, { "#signup-email": alice.email });
  await page.locator("form button[type=submit]").click();
  await page.locator("#login-password").waitFor();
  await autofill(page, { "#login-password": PASSWORD });
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 60_000 });
  await signOutFromShell(page);
});

test("two accounts on one browser: the door names the first and lets the second in cleanly", async ({ page }) => {
  await signIn(page, alice.email);
  // Back at the door while signed in: a choice, not a bounce.
  await page.goto("/connexion");
  await expect(page.locator(".signup-intro")).toContainText(alice.email);
  await expect(page.locator("#signup-email")).toHaveCount(0);
  // The other account signs in from here, with nothing of Alice's in the form.
  await leaveSignedInAccountIfAny(page);
  await expect(page.locator("#signup-email")).toHaveValue("");
  await signUp(page, bruno);
  expect(await accountEmailInShell(page)).toBe(bruno.email);
  // Bruno's fresh space holds nothing of Alice's.
  await page.goto("/app/biens");
  await expect(page.getByText(alice.email)).toHaveCount(0);
  // And Alice comes back the same way.
  await signIn(page, alice.email);
  expect(await accountEmailInShell(page)).toBe(alice.email);
});
