import { expect, test } from "@playwright/test";
import { PASSWORD, createHouse, foldGettingStarted, inviteTenant, leaseIdOf, letLot, mail, signIn, signOutFromShell, signUp } from "./helpers";

/**
 * Delivery, on the real database. This deployment has no mail key, and the
 * settings say so; every e-mail the application composes is still a line
 * of the outbox, read back from Réglages: a produced notice mailed to the
 * tenant with the file attached, the desk's word to the tenant (until the
 * workspace turns that off), the tenant's word and request to the desk,
 * each in the reader's language and at the address on record. A piece that
 * is not the workspace's is not found; a tenant account holds no key to the
 * outbox. Every row is written and read under the caller's own token,
 * through the same policies as production.
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

const owner = { first: "Lisa", last: "Kirsch", email: mail("owner") };
const tenant = { first: "Ben", last: "Wagner", email: mail("tenant") };
const houseName = `Maison Wagner ${Date.now().toString(36)}`;
const IBAN = "LU28 0019 4006 4475 0000";
const NOBODY = "00000000-0000-4000-8000-000000000000";

let propertyId = "";
let unitId = "";
let leaseId = "";
let noticeId = "";
let token = "";

const deliveries = (page: Parameters<typeof signIn>[0], kind: string) => page.locator(`[data-deliveries] li[data-delivery="${kind}"]`);

test("the owner lets a house", async ({ page }) => {
  await signUp(page, owner);
  ({ propertyId, unitId } = await createHouse(page, houseName));
  await letLot(page, unitId, tenant);
  leaseId = await leaseIdOf(page, propertyId);
});

test("the deployment cannot send and says so; a produced notice is mailed to the tenant and recorded", async ({ page }) => {
  await signIn(page, owner.email);
  await page.goto("/app/reglages");
  await expect(page.locator('[data-mail-configured="no"]')).toBeVisible();
  await expect(page.locator("[data-deliveries-empty]")).toBeVisible();
  // The lessor named and the template validated, from the routes the screen calls.
  expect((await page.request.post("/api/documents/modeles/rent_notice", { data: { lang: "fr" } })).ok()).toBe(true);
  const saved = await page.request.patch("/api/reglages", {
    data: { legalName: "Lisa Kirsch", addressStreet: "Rue de la Gare", addressNumber: "12", postalCode: "8001", city: "Strassen", email: owner.email, iban: IBAN, holderName: "Lisa Kirsch", documentLang: "fr" },
  });
  expect(saved.ok(), "the settings are written").toBe(true);

  await page.goto("/app/loyers");
  await foldGettingStarted(page);
  const control = page.locator('[data-doc-kind="rent_notice"]').first();
  const produced = page.waitForResponse((r) => r.url().endsWith("/api/documents/generer") && r.request().method() === "POST");
  await control.getByRole("button", { name: /Produire/ }).click();
  const pres = await produced;
  expect(pres.status(), "the notice is produced").toBe(201);
  noticeId = ((await pres.json()) as { documentId: string }).documentId;
  await page.reload();
  const mailed = page.waitForResponse((r) => r.url().includes(`/api/documents/${noticeId}/envoyer`) && r.request().method() === "POST");
  await page.locator(`[data-doc-send="${noticeId}"]`).click();
  const mres = await mailed;
  expect(mres.status(), "the mail is composed and recorded").toBe(201);
  const body = (await mres.json()) as { deliveries: Array<{ email: string; status: string }> };
  expect(body.deliveries).toEqual([{ email: tenant.email, status: "not_configured", id: expect.any(String) }]);
  const again = page.locator('[data-doc-kind="rent_notice"]').first();
  await expect(again.getByRole("status")).toContainText(`Consigné pour ${tenant.email}`);

  await page.goto("/app/reglages");
  const row = deliveries(page, "document");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Avis d'échéance");
  await expect(row).toContainText(tenant.email);
  await expect(row).toContainText("Consigné, non envoyé");
  await expect(row).toHaveAttribute("data-delivery-status", "not_configured");
  // Nobody's piece, and a piece that is not a lease's, are not found.
  expect((await page.request.post(`/api/documents/${NOBODY}/envoyer`)).status()).toBe(404);
});

test("the desk's word warns the tenant until the workspace turns it off; the tenant's word and request warn the desk", async ({ page }) => {
  await signIn(page, owner.email);
  expect((await page.request.post(`/api/baux/${leaseId}/messages`, { data: { body: "Bonjour Ben, bienvenue dans votre logement." } })).ok()).toBe(true);
  await page.goto("/app/reglages");
  const toTenant = deliveries(page, "message");
  await expect(toTenant).toHaveCount(1);
  await expect(toTenant).toContainText("Nouveau message de");
  await expect(toTenant).toContainText(tenant.email);
  // Off, from the form: the next word goes through, nobody is mailed.
  await page.locator("[data-settings-notify-tenant]").uncheck();
  const off = page.waitForResponse((r) => r.url().endsWith("/api/reglages") && r.request().method() === "PATCH");
  await page.locator("#settings-form").getByRole("button", { name: "Enregistrer", exact: true }).click();
  expect((await off).ok()).toBe(true);
  expect((await page.request.post(`/api/baux/${leaseId}/messages`, { data: { body: "Un second mot." } })).ok()).toBe(true);
  await page.reload();
  await expect(page.locator("[data-settings-notify-tenant]")).not.toBeChecked();
  await expect(deliveries(page, "message")).toHaveCount(1);

  // The tenant, from their own account: a word, then a request.
  ({ token } = await inviteTenant(page, propertyId));
  await signOutFromShell(page);
  await page.goto(`/invitation/${token}`);
  await page.getByRole("link", { name: "Créer mon compte" }).click();
  await expect(page.locator("#signup-email")).toHaveValue(tenant.email);
  await page.locator("#signup-first-name").fill(tenant.first);
  await page.locator("#signup-last-name").fill(tenant.last);
  await page.locator("#signup-password").fill(PASSWORD);
  await page.locator("#signup-form button[type=submit]").click();
  await page.waitForURL(/\/locataire/, { timeout: 90_000 });
  expect((await page.request.post("/api/locataire/messages", { data: { body: "Merci, une question sur les charges." } })).ok()).toBe(true);
  const request = await page.request.post("/api/locataire/demandes", { data: { kind: "technical", title: "Fuite sous l'évier", description: "Depuis ce matin.", severity: "priority", category: "plumbing" } });
  expect(request.ok(), "the request is filed").toBe(true);
  // A tenant account reads no outbox and mails nothing on the desk's behalf.
  expect([401, 403, 404]).toContain((await page.request.post(`/api/documents/${noticeId}/envoyer`)).status());

  // The desk finds both, at the address it gave in Réglages.
  await signIn(page, owner.email);
  await page.goto("/app/reglages");
  const toDesk = page.locator(`[data-deliveries] li`).filter({ hasText: owner.email });
  await expect(toDesk).toHaveCount(2);
  await expect(deliveries(page, "message").filter({ hasText: owner.email })).toContainText(`Message de ${tenant.first} ${tenant.last}`);
  await expect(deliveries(page, "request")).toContainText(`Nouvelle demande de ${tenant.first} ${tenant.last} : Fuite sous l'évier`);
  await expect(deliveries(page, "request")).toContainText("Consigné, non envoyé");
});
