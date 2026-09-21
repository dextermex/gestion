import { expect, test } from "@playwright/test";
import { createHouse, daysFromNow, foldGettingStarted, inviteTenant, leaseIdOf, letLot, mail, PASSWORD, signIn, signOutFromShell, signOutFromTenantSpace, signUp, typeAndKeepFocus } from "./helpers";

/**
 * One tenancy, start to finish, on the real database: the owner creates a
 * property, lets it, invites the tenant; the tenant opens the link, creates
 * an account and sees the home; a third account sees none of it; the owner
 * comes back and records the departure. Every step reads what the previous
 * one wrote through the same policies production uses.
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

const owner = { first: "Guillaume", last: "Metzler", email: mail("owner") };
const tenant = { first: "Anna", last: "Weber", email: mail("tenant") };
const other = { first: "Claire", last: "Dubois", email: mail("other") };
const houseName = `Maison Weber ${Date.now().toString(36)}`;

let propertyId = "";
let unitId = "";
let leaseId = "";
let token = "";

test("the owner creates a house", async ({ page }) => {
  await signUp(page, owner);
  ({ propertyId, unitId } = await createHouse(page, houseName));
  await page.goto("/app/biens");
  await expect(page.getByText(houseName)).toBeVisible();
});

test("the rental dossier is filled and activated", async ({ page }) => {
  await signIn(page, owner.email);
  await letLot(page, unitId, tenant);
  leaseId = await leaseIdOf(page, propertyId);
  await expect(page.getByText("Inviter le locataire")).toBeVisible();
});

test("the tenant is invited; the link is refused to the wrong account", async ({ page }) => {
  await signIn(page, owner.email);
  ({ token } = await inviteTenant(page, propertyId));
  // The owner, still signed in, opens the tenant's link: named, not attached.
  await page.goto(`/invitation/${token}`);
  await expect(page.getByRole("alert")).toContainText(tenant.email);
  await expect(page).toHaveURL(new RegExp(`/invitation/${token}`));
  await page.goto("/locataire");
  // The owner is no tenant: the tenant space has nothing for this account.
  await expect(page.getByText(houseName)).toHaveCount(0);
});

test("the tenant creates an account from the link and sees the home", async ({ page }) => {
  await signIn(page, owner.email);
  await signOutFromShell(page);
  await page.goto(`/invitation/${token}`);
  await expect(page.getByText(houseName)).toBeVisible();
  await page.getByRole("link", { name: "Créer mon compte" }).click();
  await expect(page.locator("#signup-email")).toHaveValue(tenant.email);
  await page.locator("#signup-first-name").fill(tenant.first);
  await page.locator("#signup-last-name").fill(tenant.last);
  await page.locator("#signup-password").fill(PASSWORD);
  await page.locator("#signup-form button[type=submit]").click();
  // Back on the invitation with the right account: accepted by itself, into the space.
  await page.waitForURL(/\/locataire/, { timeout: 90_000 });
  await expect(page.getByText(houseName).first()).toBeVisible();
  // A tenant-only account is never handed a management space.
  await page.goto("/app");
  await expect(page).toHaveURL(/\/locataire/);
  // The request dialog keeps the caret while typing (real dialog, real backend).
  await page.goto("/locataire/demandes");
  await page.getByRole("button", { name: /nouvelle demande/i }).click();
  await page.locator("[role=dialog] button.tactile").first().click();
  await typeAndKeepFocus(page, "[role=dialog] form input", "Fuite sous l'évier");
  await page.keyboard.press("Escape");
  await signOutFromTenantSpace(page);
});

test("another manager sees none of it", async ({ page }) => {
  await signUp(page, other);
  const res = await page.goto(`/app/biens/${propertyId}`);
  expect(res?.status(), "a foreign property id is not found").toBe(404);
  await page.goto("/app/biens");
  await expect(page.getByText(houseName)).toHaveCount(0);
  await page.goto(`/app/biens/depart?bail=${leaseId}`);
  await expect(page.getByText(tenant.first)).toHaveCount(0);
  await signOutFromShell(page);
});

test("the owner records the departure", async ({ page }) => {
  await signIn(page, owner.email);
  await page.goto(`/app/biens/${propertyId}?onglet=location`);
  await foldGettingStarted(page);
  await page.getByRole("link", { name: "Enregistrer le départ du locataire" }).click();
  await page.waitForURL(/\/app\/biens\/depart\?bail=/);
  await page.getByLabel("Date de fin du bail").fill(daysFromNow(45));
  await page.getByRole("button", { name: "Suivant", exact: true }).click(); // date → EDL
  await page.getByRole("button", { name: "Plus tard", exact: true }).click(); // EDL later
  await page.getByRole("button", { name: "Suivant", exact: true }).click(); // meters
  await page.getByRole("button", { name: "Suivant", exact: true }).click(); // keys
  await page.getByRole("button", { name: "Suivant", exact: true }).click(); // outstanding
  await page.getByRole("button", { name: "Suivant", exact: true }).click(); // deposit
  await page.getByRole("button", { name: "Confirmer le départ" }).click();
  await expect(page.getByText("est enregistré.")).toBeVisible({ timeout: 30_000 });
  await page.goto(`/app/biens/${propertyId}?onglet=location`);
  await expect(page.getByRole("link", { name: "Ajouter un nouveau locataire" })).toBeVisible();
});
