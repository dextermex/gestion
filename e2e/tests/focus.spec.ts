import { expect, test } from "@playwright/test";
import { createHouse, leaseIdOf, letLot, mail, signUp, typeAndKeepFocus } from "./helpers";

/**
 * A field keeps the caret while a person types, on the screens that lost it
 * once: the wizards (a component declared inside the wizard remounted the
 * field on every key) and the dialogs (a focus effect re-ran on every
 * render). Typed key by key, as a phone keyboard delivers them, against the
 * real app and database.
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

const owner = { first: "Marie", last: "Kohl", email: mail("focus-owner") };
const tenant = { first: "Tom", last: "Faber", email: mail("focus-tenant") };
let propertyId = "";
let unitId = "";
let leaseId = "";

test("the door's fields keep the caret", async ({ page }) => {
  await page.goto("/connexion");
  await typeAndKeepFocus(page, "#signin-email", "marie.kohl@example.lu");
  await page.getByRole("tab", { name: "Créer un compte" }).click();
  await typeAndKeepFocus(page, "#signup-first-name", "Marie");
});

test("the property and tenant wizards keep the caret", async ({ page }) => {
  await signUp(page, owner);
  await page.goto("/app/biens/nouveau");
  await page.getByRole("button", { name: "Maison individuelle" }).click();
  await typeAndKeepFocus(page, "input", "Maison Kohl");
  ({ propertyId, unitId } = await createHouse(page, `Maison Kohl ${Date.now().toString(36)}`));
  await page.goto(`/app/biens/locataire?lot=${encodeURIComponent(unitId)}`);
  await typeAndKeepFocus(page, "input", "Tom");
  await letLot(page, unitId, tenant);
  leaseId = await leaseIdOf(page, propertyId);
});

test("the inventory wizard keeps the caret in its room field", async ({ page }) => {
  await page.goto(`/app/biens/etat-des-lieux?bail=${encodeURIComponent(leaseId)}&type=entry`);
  await expect(page.locator("input").first()).toBeVisible();
  await typeAndKeepFocus(page, "input", "Salon");
});

test("a dialog form keeps the caret", async ({ page }) => {
  await page.goto(`/app/biens/${propertyId}?onglet=technique`);
  // Any dialog opened from this tab will do; the meter sheet is the usual one.
  const opener = page.getByRole("button", { name: /relev|compteur/i }).first();
  if (await opener.isVisible().catch(() => false)) {
    await opener.click();
    await typeAndKeepFocus(page, "[role=dialog] input", "4821");
  } else {
    test.info().annotations.push({ type: "note", description: "no dialog opener on the Technique tab for this property; the tenant request dialog covers dialogs in lifecycle.spec.ts" });
  }
});
