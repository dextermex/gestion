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

const secondTitle = "Ampoule du couloir";
let secondRequestId = "";
/** The six things said, in the order both sides must read them. */
const chronology = () => ["Bonjour, j'ai une question sur mon bail.", requestTitle, "Un plombier passe jeudi matin.", "Jeudi matin me convient.", secondTitle, "C'est noté pour l'ampoule."];

/** Every marker appears in the chat body, each after the one before. */
async function expectChronology(page: import("@playwright/test").Page, bodySelector: string): Promise<void> {
  const text = await page.locator(bodySelector).innerText();
  let at = -1;
  for (const marker of chronology()) {
    const index = text.indexOf(marker, at + 1);
    expect(index, `"${marker}" comes after what was said before it`).toBeGreaterThan(at);
    at = index;
  }
}

test("the tenant writes to the owner, then sends a request with a photo", async ({ page }) => {
  await signIn(page, tenant.email, "/locataire");
  // A normal message first: the conversation opens with it.
  await page.goto("/locataire/messages");
  await page.locator("#tenant-message-body").fill("Bonjour, j'ai une question sur mon bail.");
  await page.getByRole("button", { name: "Envoyer", exact: true }).click();
  await expect(page.getByText("Bonjour, j'ai une question sur mon bail.")).toBeVisible();
  // Then a request, from Demandes, with a photo.
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
  await expect(page.getByText("Photos jointes")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("img[alt='evier.png']")).toHaveCount(1);
  // The request sits in the same conversation, after the first message.
  await page.getByRole("link", { name: "Ouvrir la conversation" }).click();
  await page.waitForURL(new RegExp(`/locataire/messages\\?demande=${requestId}`));
  await expect(page.getByText("Bonjour, j'ai une question sur mon bail.")).toBeVisible();
  await expect(page.locator(`[data-request="${requestId}"]`)).toContainText(requestTitle);
  await expect(page.locator(`[data-request="${requestId}"]`).getByRole("link", { name: "Voir la demande" })).toBeVisible();
  await signOutFromTenantSpace(page);
});

test("the owner reads the chat, answers, tracks the request and opens an intervention", async ({ page }) => {
  await signIn(page, owner.email);
  await page.goto("/app/messages");
  await foldGettingStarted(page);
  // The inbox lists the tenant; the conversation holds the message and the request card.
  await page.locator("#messages-panel-conversations").getByRole("button", { name: new RegExp(`${tenant.first} ${tenant.last}`) }).first().click();
  await expect(page.getByRole("heading", { level: 2, name: `${tenant.first} ${tenant.last}` })).toBeVisible();
  await expect(page.locator("#messages-body").getByText("Bonjour, j'ai une question sur mon bail.")).toBeVisible();
  const card = page.locator(`[data-request="${requestId}"]`);
  await expect(card).toContainText(requestTitle);
  await expect(card).toContainText("À traiter");
  await expect(card.locator("img[alt='evier.png']")).toHaveCount(1);
  // Demandes tracks it; opening it lands back in the conversation, at the card.
  await page.getByRole("tab", { name: /Demandes/ }).click();
  const row = page.getByRole("row").filter({ hasText: requestTitle });
  await expect(row).toContainText(`${tenant.first} ${tenant.last}`);
  await expect(row).toContainText("À traiter");
  await row.getByRole("button").click();
  await expect(page).toHaveURL(new RegExp(`demande=${requestId}`));
  await expect(card).toBeVisible();
  // A reply, in the same conversation.
  await page.locator("#messages-reply").fill("Un plombier passe jeudi matin.");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Message envoyé" })).toBeVisible();
  await expect(page.locator("#messages-body").getByText("Un plombier passe jeudi matin.")).toBeVisible();
  // "Voir la demande": the status moves to "En cours", and physical work is needed.
  await card.getByRole("button", { name: "Voir la demande" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const patched = page.waitForResponse((r) => r.url().includes(`/api/demandes/${requestId}`) && r.request().method() === "PATCH");
  await dialog.locator("#request-status").selectOption("in_progress");
  expect((await patched).ok(), "the status change is accepted").toBe(true);
  const opened = page.waitForResponse((r) => r.url().includes(`/api/demandes/${requestId}/intervention`));
  await dialog.getByRole("button", { name: "Créer une intervention" }).click();
  expect((await opened).ok(), "the intervention is created").toBe(true);
  await expect(dialog.getByText("Intervention créée")).toBeVisible();
  await page.keyboard.press("Escape");
  // A fresh load reads it all back from the database.
  await page.goto(`/app/messages?demande=${requestId}`);
  await expect(page.locator(`[data-request="${requestId}"]`)).toContainText("En cours");
  await page.locator(`[data-request="${requestId}"]`).getByRole("button", { name: "Voir la demande" }).click();
  await expect(page.getByRole("dialog").locator("#request-status")).toHaveValue("in_progress");
  await expect(page.getByRole("dialog").getByText("Intervention créée")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto("/app/interventions");
  await expect(page.getByText(requestTitle)).toBeVisible();
  await signOutFromShell(page);
});

test("the tenant answers, sends a second request, and holds no key to the desk's side", async ({ page }) => {
  await signIn(page, tenant.email, "/locataire");
  await page.goto("/locataire/messages");
  await expect(page.getByText("Un plombier passe jeudi matin.")).toBeVisible();
  await expect(page.locator(`[data-request="${requestId}"]`)).toContainText("En cours");
  await page.locator("#tenant-message-body").fill("Jeudi matin me convient.");
  await page.keyboard.press("Enter");
  await expect(page.locator("#tenant-messages-body").getByText("Jeudi matin me convient.")).toBeVisible();
  // A second request, a question this time, joins the same conversation.
  await page.goto("/locataire/demandes");
  await page.getByRole("button", { name: /nouvelle demande/i }).click();
  const dialog = page.locator("[role=dialog]");
  await dialog.locator("button.tactile").nth(2).click(); // a question
  await dialog.locator("form input").first().fill(secondTitle);
  await dialog.locator("form textarea").fill("L'ampoule du palier ne s'allume plus.");
  await dialog.locator("form button[type=submit]").click();
  await page.waitForURL(/\/locataire\/demandes\/[0-9a-f-]{36}/, { timeout: 60_000 });
  secondRequestId = page.url().match(/\/locataire\/demandes\/([0-9a-f-]{36})/)?.[1] ?? "";
  expect(secondRequestId, "the second request id").not.toBe("");
  await page.goto("/locataire/messages");
  await expect(page.locator(`[data-request="${requestId}"]`)).toBeVisible();
  await expect(page.locator(`[data-request="${secondRequestId}"]`)).toContainText(secondTitle);
  // The tenant's account holds no key to the desk's side, nor to a request that is not theirs.
  const foreign = await page.request.post("/api/locataire/demandes/00000000-0000-4000-8000-000000000000/messages", { data: { body: "Bonjour" } });
  expect(foreign.status(), "a request that is not the tenant's is not found").toBe(404);
  const desk = await page.request.patch(`/api/demandes/${requestId}`, { data: { status: "resolved" } });
  expect(desk.status(), "a tenant cannot set the status of their own request").toBe(403);
  await signOutFromTenantSpace(page);
});

test("the owner chats on and resolves the first request; both sides read one conversation", async ({ page }) => {
  await signIn(page, owner.email);
  await page.goto(`/app/messages?demande=${secondRequestId}`);
  await foldGettingStarted(page);
  await expect(page.locator(`[data-request="${secondRequestId}"]`)).toContainText(secondTitle);
  await page.locator("#messages-reply").fill("C'est noté pour l'ampoule.");
  await page.keyboard.press("Enter");
  await expect(page.locator("#messages-body").getByText("C'est noté pour l'ampoule.")).toBeVisible();
  // The first request is resolved from its card; the second still waits.
  await page.locator(`[data-request="${requestId}"]`).getByRole("button", { name: "Voir la demande" }).click();
  const patched = page.waitForResponse((r) => r.url().includes(`/api/demandes/${requestId}`) && r.request().method() === "PATCH");
  await page.getByRole("dialog").locator("#request-status").selectOption("resolved");
  expect((await patched).ok(), "the resolution is accepted").toBe(true);
  await page.keyboard.press("Escape");
  await page.goto("/app/messages?onglet=demandes");
  await expect(page.getByRole("row").filter({ hasText: requestTitle })).toContainText("Résolue");
  await expect(page.getByRole("row").filter({ hasText: secondTitle })).toContainText("À traiter");
  // The whole conversation, in order, as the desk reads it.
  await page.goto(`/app/messages?demande=${requestId}`);
  await expectChronology(page, "#messages-body");
  await expect(page.locator(`[data-request="${requestId}"]`)).toContainText("Résolue");
  await signOutFromShell(page);
});

test("the tenant reads the same conversation, in the same order, after signing in again", async ({ page }) => {
  await signIn(page, tenant.email, "/locataire");
  await page.goto("/locataire/messages");
  await expectChronology(page, "#tenant-messages-body");
  await expect(page.locator(`[data-request="${requestId}"]`)).toContainText("Résolue");
  await expect(page.locator(`[data-request="${secondRequestId}"]`)).toContainText("Envoyée");
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
  expect((await page.request.post(`/api/baux/${leaseId}/messages`, { data: { body: "Bonjour" } })).status()).toBe(404);
  await page.goto("/app/messages");
  await expect(page.getByText(requestTitle)).toHaveCount(0);
  await expect(page.getByText(`${tenant.first} ${tenant.last}`)).toHaveCount(0);
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
  await page.goto("/locataire/messages");
  await expectChronology(page, "#tenant-messages-body");
  await page.goto(`/locataire/demandes/${requestId}`);
  await expect(page.getByRole("heading", { level: 1, name: requestTitle })).toBeVisible();
  await page.goto("/locataire/demandes");
  await expect(page.getByText(requestTitle)).toBeVisible();
  await expect(page.getByRole("button", { name: /nouvelle demande/i })).toHaveCount(0);
  const refused = await page.request.post("/api/locataire/demandes", { data: { kind: "other", title: "Encore une", description: "" } });
  expect(refused.status(), "no new request on an ended tenancy").toBe(409);
  await signOutFromTenantSpace(page);
});
