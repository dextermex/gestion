import { expect, test } from "@playwright/test";
import { accountEmailInShell, autofill, leaveSignedInAccountIfAny, mail, PASSWORD, signIn, signOutFromShell, signUp } from "./helpers";

/**
 * The door, against the real account system: creating an account, signing
 * in and out, what the browser remembers between two accounts, the messages
 * a person actually reads, and Safari-style autofill.
 */
test.describe.configure({ mode: "serial" });

const alice = { first: "Alice", last: "Weber", email: mail("alice") };
const bruno = { first: "Bruno", last: "Muller", email: mail("bruno") };

test("the management space is not public", async ({ page }) => {
  await page.goto("/app");
  await expect(page).toHaveURL(/\/connexion\?next=(%2F|\/)app/);
  await expect(page.locator("#signin-form")).toBeVisible();
  // Asked as a request, not a navigation: a bare 4xx with no body is a
  // navigation error to Chromium, and the status is what matters here.
  const res = await page.request.get("/api/biens/create");
  expect(res.status(), "an API route answers a stranger with 401 or 405, never data").toBeGreaterThanOrEqual(401);
});

test("a new account is created on the door and lands in its own space", async ({ page }) => {
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
  await expect(page.getByTestId("signed-in-card")).toHaveCount(0);
});

test("a wrong password says so, in words", async ({ page }) => {
  await page.goto("/connexion");
  await page.locator("#signin-email").fill(alice.email);
  await page.locator("#signin-password").fill("not-her-password");
  await page.locator("#signin-form button[type=submit]").click();
  await expect(page.getByTestId("signin-message")).toContainText("incorrect");
  await expect(page).toHaveURL(/\/connexion/);
});

test("an address that already has an account is named, not sent to a mailbox", async ({ page }) => {
  await page.goto("/connexion?onglet=inscription");
  await page.locator("#signup-first-name").fill("Alice");
  await page.locator("#signup-last-name").fill("Weber");
  await page.locator("#signup-email").fill(alice.email);
  await page.locator("#signup-password").fill("another-pass-9");
  await page.locator("#signup-form button[type=submit]").click();
  await expect(page.getByTestId("signup-message")).toContainText("existe déjà");
  await expect(page.getByTestId("signup-confirm")).toHaveCount(0);
  await page.getByTestId("signup-exists-signin").click();
  await expect(page.locator("#signin-email")).toHaveValue(alice.email);
});

test("Safari-style autofill (values without input events) still signs in", async ({ page }) => {
  await page.goto("/connexion");
  await autofill(page, { "#signin-email": alice.email, "#signin-password": PASSWORD });
  await page.locator("#signin-form button[type=submit]").click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 60_000 });
  await signOutFromShell(page);
});

test("two accounts on one browser: the door names the first and lets the second in cleanly", async ({ page }) => {
  await signIn(page, alice.email);
  // Back at the door while signed in: a choice, not a bounce.
  await page.goto("/connexion");
  await expect(page.getByTestId("signed-in-email")).toContainText(alice.email);
  await expect(page.locator("#signin-form")).toHaveCount(0);
  // The other account is created from here, with nothing of Alice's in the form.
  await leaveSignedInAccountIfAny(page);
  await page.getByRole("tab", { name: "Créer un compte" }).click();
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
