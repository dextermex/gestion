import { expect, test } from "@playwright/test";
import { createHouse, daysFromNow, foldGettingStarted, inviteTenant, leaseIdOf, letLot, mail, nextStep, nextUntil, PASSWORD, signIn, signOutFromShell, signOutFromTenantSpace, signUp, typeAndKeepFocus } from "./helpers";

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
let requestId = "";
const requestTitle = "Fuite sous l'évier";
/** A one-pixel PNG: enough for the storage policy and the document row, which is what the flow checks. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

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
  // The page's own notice (the framework's route announcer is an alert too).
  await expect(page.getByRole("alert").filter({ hasText: tenant.email })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/invitation/${token}`));
  await page.goto("/locataire");
  // The owner is no tenant: the tenant space has nothing for this account.
  await expect(page.getByText(houseName)).toHaveCount(0);
});

test("the tenant creates an account from the link and sees the home", async ({ page }) => {
  await signIn(page, owner.email);
  await signOutFromShell(page);
  await page.goto(`/invitation/${token}`);
  await expect(page.getByText(houseName).first()).toBeVisible();
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

test("the tenant sends a request with a photo", async ({ page }) => {
  await signIn(page, tenant.email, "/locataire");
  await page.goto("/locataire/demandes");
  await page.getByRole("button", { name: /nouvelle demande/i }).click();
  const dialog = page.locator("[role=dialog]");
  await dialog.locator("button.tactile").first().click(); // a technical problem
  await dialog.locator("form input").first().fill(requestTitle);
  await dialog.locator("form textarea").fill("De l'eau coule sous l'évier depuis ce matin.");
  await dialog.locator("input[type=file]").setInputFiles({ name: "evier.png", mimeType: "image/png", buffer: PNG });
  await dialog.locator("form button[type=submit]").click();
  // The request is written, then its photo, then the tenant lands on it: the id is the database's.
  await page.waitForURL(/\/locataire\/demandes\/[0-9a-f-]{36}/, { timeout: 60_000 });
  requestId = page.url().match(/\/locataire\/demandes\/([0-9a-f-]{36})/)?.[1] ?? "";
  expect(requestId, "the request id from the page the tenant lands on").not.toBe("");
  await expect(page.getByRole("heading", { level: 1, name: requestTitle })).toBeVisible();
  await expect(page.getByText("Envoyée", { exact: true })).toBeVisible();
  // The photo went through the storage policy and is recorded on the request.
  await expect(page.getByText("Photos jointes")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("img[alt='evier.png']")).toHaveCount(1);
  await signOutFromTenantSpace(page);
});

test("the owner finds the request under Messages, answers, tracks it and opens an intervention", async ({ page }) => {
  await signIn(page, owner.email);
  await page.goto("/app/messages?onglet=demandes");
  const row = page.getByRole("row").filter({ hasText: requestTitle });
  await expect(row).toBeVisible();
  await expect(row).toContainText(`${tenant.first} ${tenant.last}`);
  await expect(row).toContainText("À traiter");
  await row.getByRole("button").click();
  // The linked conversation opens: the tenant's words and photo, the request's details beside them.
  await expect(page.getByRole("heading", { level: 2, name: requestTitle })).toBeVisible();
  await expect(page.getByText("Demande", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Détails de la demande")).toBeVisible();
  await expect(page.locator("img[alt='evier.png']").first()).toBeVisible();
  // A reply, written on the same thread the tenant reads.
  await page.locator("#messages-reply").fill("Un plombier passe jeudi matin.");
  await page.getByRole("button", { name: "Envoyer", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Message envoyé" })).toBeVisible();
  await expect(page.getByText("Un plombier passe jeudi matin.").first()).toBeVisible();
  // The status moves to "En cours": the write is the database's, a fresh load shows it.
  const patched = page.waitForResponse((r) => r.url().includes(`/api/demandes/${requestId}`) && r.request().method() === "PATCH");
  await page.locator("#request-status").selectOption("in_progress");
  expect((await patched).ok(), "the status change is accepted").toBe(true);
  // Physical work is needed: an intervention on the same request, its thread untouched.
  const opened = page.waitForResponse((r) => r.url().includes(`/api/demandes/${requestId}/intervention`));
  await page.getByRole("button", { name: "Créer une intervention" }).click();
  expect((await opened).ok(), "the intervention is created").toBe(true);
  await expect(page.getByText("Intervention créée").first()).toBeVisible();
  await page.goto(`/app/messages?demande=${requestId}`);
  await expect(page.locator("#request-status")).toHaveValue("in_progress");
  await expect(page.getByText("Un plombier passe jeudi matin.").first()).toBeVisible();
  await expect(page.getByText("Intervention créée").first()).toBeVisible();
  await page.goto("/app/interventions");
  await expect(page.getByText(requestTitle)).toBeVisible();
  await signOutFromShell(page);
});

test("the tenant reads the answer and the status, and answers back", async ({ page }) => {
  await signIn(page, tenant.email, "/locataire");
  await page.goto(`/locataire/demandes/${requestId}`);
  await expect(page.getByText("Un plombier passe jeudi matin.")).toBeVisible();
  await expect(page.getByText("En cours", { exact: true })).toBeVisible();
  await page.locator("#tenant-thread-body").fill("Jeudi matin me convient.");
  await page.getByRole("button", { name: "Envoyer", exact: true }).click();
  await expect(page.getByText("Jeudi matin me convient.")).toBeVisible();
  // The tenant's account holds no key to the desk's side, nor to a request that is not theirs.
  const foreign = await page.request.post("/api/locataire/demandes/00000000-0000-4000-8000-000000000000/messages", { data: { body: "Bonjour" } });
  expect(foreign.status(), "a request that is not the tenant's is not found").toBe(404);
  const desk = await page.request.patch(`/api/demandes/${requestId}`, { data: { status: "resolved" } });
  expect(desk.status(), "a tenant cannot set the status of their own request").toBe(403);
  await signOutFromTenantSpace(page);
});

test("the owner resolves the request; both sides read it resolved", async ({ page }) => {
  await signIn(page, owner.email);
  await page.goto(`/app/messages?demande=${requestId}`);
  await expect(page.getByText("Jeudi matin me convient.").first()).toBeVisible();
  const patched = page.waitForResponse((r) => r.url().includes(`/api/demandes/${requestId}`) && r.request().method() === "PATCH");
  await page.locator("#request-status").selectOption("resolved");
  expect((await patched).ok(), "the resolution is accepted").toBe(true);
  await page.goto("/app/messages?onglet=demandes");
  await expect(page.getByRole("row").filter({ hasText: requestTitle })).toContainText("Résolue");
  await signOutFromShell(page);
  await signIn(page, tenant.email, "/locataire");
  await page.goto(`/locataire/demandes/${requestId}`);
  await expect(page.getByText(/^Résolue le /)).toBeVisible();
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
  // Nor can this workspace touch the request by its id: not found, whatever the verb.
  expect((await page.request.patch(`/api/demandes/${requestId}`, { data: { status: "resolved" } })).status()).toBe(404);
  expect((await page.request.post(`/api/demandes/${requestId}/messages`, { data: { body: "Bonjour" } })).status()).toBe(404);
  expect((await page.request.post(`/api/demandes/${requestId}/intervention`)).status()).toBe(404);
  await page.goto("/app/messages");
  await expect(page.getByText(requestTitle)).toHaveCount(0);
  await signOutFromShell(page);
});

test("the owner records the departure", async ({ page }) => {
  await signIn(page, owner.email);
  await page.goto(`/app/biens/${propertyId}?onglet=location`);
  await foldGettingStarted(page);
  await page.getByRole("link", { name: "Enregistrer le départ du locataire" }).click();
  await page.waitForURL(/\/app\/biens\/depart\?bail=/);
  await page.getByLabel("Date de fin du bail").fill(daysFromNow(45));
  await nextStep(page, "Suivant"); // date → inventory
  await nextStep(page, "Plus tard"); // the exit inventory, later
  await nextUntil(page, page.getByRole("button", { name: "Confirmer le départ" }), 6); // meters, keys, outstanding, deposit
  await page.getByRole("button", { name: "Confirmer le départ" }).click();
  // The done screen's own heading: the shell's dataset note also says
  // "rien n'est enregistré", so a looser match would pass before the closure.
  await expect(page.getByRole("heading", { level: 1, name: /Le départ de .+ est enregistré\./ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Ajouter un nouveau locataire" })).toBeVisible();
  // The lot is free again: no departure to record, and the tenancy is history.
  await page.goto(`/app/biens/${propertyId}?onglet=location`);
  await expect(page.getByRole("link", { name: "Enregistrer le départ du locataire" })).toHaveCount(0);
  await page.goto(`/app/biens/${propertyId}?onglet=historique`);
  await expect(page.getByText(`${tenant.first} ${tenant.last}`).first()).toBeVisible();
});

test("the former tenant keeps the history and can no longer ask", async ({ page }) => {
  await signIn(page, tenant.email, "/locataire");
  await page.goto(`/locataire/demandes/${requestId}`);
  await expect(page.getByRole("heading", { level: 1, name: requestTitle })).toBeVisible();
  await expect(page.getByText("Un plombier passe jeudi matin.")).toBeVisible();
  await expect(page.getByText("Jeudi matin me convient.")).toBeVisible();
  await page.goto("/locataire/demandes");
  await expect(page.getByText(requestTitle)).toBeVisible();
  await expect(page.getByRole("button", { name: /nouvelle demande/i })).toHaveCount(0);
  const refused = await page.request.post("/api/locataire/demandes", { data: { kind: "other", title: "Encore une", description: "" } });
  expect(refused.status(), "no new request on an ended tenancy").toBe(409);
  await signOutFromTenantSpace(page);
});
