import { devices, expect, test, type Page } from "@playwright/test";
import { createHouse, inviteTenant, letLot, mail, PASSWORD, signIn, signOutFromShell, signOutFromTenantSpace, signUp } from "./helpers";

/**
 * Messages on a phone. The desk's inbox behaves like a messaging app
 * there: the list alone, most recent conversation on top, one conversation
 * filling the screen once tapped, a way back to the list; Demandes the
 * same way. The rows are real: an owner with two tenancies, one tenant who
 * wrote and asked, on the database the laptop flows use. The tenancies are
 * set up at a laptop's size (the wizards are the lifecycle's business); the
 * phone tests then run in an iPhone 14 viewport on the project's browser,
 * WebKit in CI and Chromium's emulation elsewhere.
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

const owner = { first: "Sophie", last: "Kohl", email: mail("owner") };
const tenant = { first: "Marc", last: "Thill", email: mail("tenant") };
const second = { first: "Lena", last: "Bauer", email: mail("second") };
const stamp = Date.now().toString(36);
const houseA = `Maison Thill ${stamp}`;
const houseB = `Maison Bauer ${stamp}`;
const requestTitle = "Volet roulant bloqué";
const firstWord = "Bonjour, le volet de la chambre est bloqué.";
const welcome = "Bonjour, bienvenue dans votre logement.";
const answer = "Un technicien passe mardi matin.";

let propertyA = "";
let token = "";
let requestId = "";
let threadId = "";

// The device's browser is the project's; everything else about an iPhone 14 is emulated.
const iphone = devices["iPhone 14"];
const phone = { viewport: iphone.viewport, deviceScaleFactor: iphone.deviceScaleFactor, isMobile: iphone.isMobile, hasTouch: iphone.hasTouch, userAgent: iphone.userAgent };
const laptop = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false };

const rows = (page: Page) => page.locator("#messages-panel-conversations li > button");
const chatHeading = (page: Page, name: string) => page.getByRole("heading", { level: 2, name });
const backToThreads = (page: Page) => page.getByRole("button", { name: "Retour aux conversations" });

/** The conversation's header under the shell's bar, its composer at the foot of the screen, and the page itself not scrolling. */
async function expectChatFillsScreen(page: Page, name: string): Promise<void> {
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  const header = await chatHeading(page, name).boundingBox();
  const composer = await page.locator("#messages-reply").boundingBox();
  expect(header, "the conversation's header is on the screen").not.toBeNull();
  expect(composer, "the composer is on the screen").not.toBeNull();
  expect(header!.y).toBeGreaterThanOrEqual(0);
  expect(header!.y, "the header sits right under the shell's bar").toBeLessThan(120);
  expect(composer!.y + composer!.height, "the composer ends within the screen").toBeLessThanOrEqual(viewport!.height);
  expect(composer!.y + composer!.height, "the composer sits at the foot of the screen").toBeGreaterThan(viewport!.height - 72);
  const overflow = await page.evaluate(() => ({
    down: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    across: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(overflow.down, "nothing scrolls but the messages").toBeLessThanOrEqual(2);
  expect(overflow.across, "nothing spills out sideways").toBeLessThanOrEqual(0);
}

const atBottom = (page: Page) => page.locator("#messages-body").evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 2);

test.describe("set up at a laptop's size", () => {
  test.use(laptop);

  test("the owner lets two houses and invites the first tenant", async ({ page }) => {
    await signUp(page, owner);
    const a = await createHouse(page, houseA);
    propertyA = a.propertyId;
    await letLot(page, a.unitId, tenant);
    ({ token } = await inviteTenant(page, propertyA));
    const b = await createHouse(page, houseB);
    await letLot(page, b.unitId, second, "980");
    await signOutFromShell(page);
  });

  test("the tenant creates the account from the link, writes, then asks", async ({ page }) => {
    await page.goto(`/invitation/${token}`);
    await expect(page.getByText(houseA).first()).toBeVisible();
    await page.getByRole("link", { name: "Créer mon compte" }).click();
    await expect(page.locator("#signup-email")).toHaveValue(tenant.email);
    await page.locator("#signup-first-name").fill(tenant.first);
    await page.locator("#signup-last-name").fill(tenant.last);
    await page.locator("#signup-password").fill(PASSWORD);
    await page.locator("#signup-form button[type=submit]").click();
    await page.waitForURL(/\/locataire/, { timeout: 90_000 });
    await page.goto("/locataire/messages");
    await page.locator("#tenant-message-body").fill(firstWord);
    // The word is written before the flow moves on: the row, not the composer's echo of it.
    const written = page.waitForResponse((r) => r.url().includes("/api/locataire/messages") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Envoyer", exact: true }).click();
    expect((await written).ok(), "the tenant's message is accepted").toBe(true);
    await expect(page.locator("#tenant-messages-body").getByText(firstWord)).toBeVisible();
    await page.goto("/locataire/demandes");
    await page.getByRole("button", { name: /nouvelle demande/i }).click();
    const dialog = page.locator("[role=dialog]");
    await dialog.locator("button.tactile").first().click();
    await dialog.locator("form input").first().fill(requestTitle);
    await dialog.locator("form textarea").fill("Le volet de la chambre ne remonte plus depuis hier.");
    await dialog.locator("form button[type=submit]").click();
    await page.waitForURL(/\/locataire\/demandes\/[0-9a-f-]{36}/, { timeout: 60_000 });
    requestId = page.url().match(/\/locataire\/demandes\/([0-9a-f-]{36})/)?.[1] ?? "";
    expect(requestId, "the request id from the page the tenant lands on").not.toBe("");
    await signOutFromTenantSpace(page);
  });
});

test.describe("on the phone", () => {
  test.use(phone);

  test("the inbox shows the list alone, most recent conversation first, nothing opened by itself", async ({ page }) => {
    await signIn(page, owner.email);
    await page.goto("/app/messages");
    await expect(rows(page)).toHaveCount(2);
    // The tenant who wrote is on top: who, where, the request as the last word, unread.
    const first = rows(page).nth(0);
    await expect(first).toContainText(`${tenant.first} ${tenant.last}`);
    await expect(first).toContainText(houseA);
    await expect(first).toContainText("Demande");
    await expect(first).toContainText(requestTitle);
    await expect(first.getByRole("img", { name: /non lus/ })).toBeVisible();
    // The tenancy nobody has written to yet is listed after, ready for a first word.
    await expect(rows(page).nth(1)).toContainText(`${second.first} ${second.last}`);
    // No conversation is open: neither its body nor its composer is on the screen, the title is.
    await expect(page.locator("#messages-body")).toBeHidden();
    await expect(page.locator("#messages-reply")).toBeHidden();
    await expect(page.getByRole("heading", { level: 1, name: "Messages" })).toBeVisible();
    const across = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(across, "the list fits the phone").toBeLessThanOrEqual(0);
  });

  test("a tap opens the conversation over the whole screen, on its newest message, and reads it", async ({ page }) => {
    await signIn(page, owner.email);
    await page.goto("/app/messages");
    await rows(page).filter({ hasText: tenant.last }).click();
    const name = `${tenant.first} ${tenant.last}`;
    await expect(chatHeading(page, name)).toBeVisible();
    // The list, the title and the tabs have stepped aside.
    await expect(rows(page).first()).toBeHidden();
    await expect(page.getByRole("heading", { level: 1, name: "Messages" })).toBeHidden();
    await expect(page.getByRole("tab", { name: /Demandes/ })).toBeHidden();
    await expect(page.locator("#messages-body").getByText(firstWord)).toBeVisible();
    const card = page.locator(`[data-request="${requestId}"]`);
    await expect(card).toContainText(requestTitle);
    await expect(card).toContainText("À traiter");
    await expect(page).toHaveURL(/fil=/);
    threadId = new URL(page.url()).searchParams.get("fil") ?? "";
    expect(threadId, "the conversation's id in the address").not.toBe("");
    await expectChatFillsScreen(page, name);
    expect(await atBottom(page), "opens on the newest message").toBe(true);
    // Back: the list again, the conversation read, the address clean.
    await backToThreads(page).click();
    await expect(rows(page).first()).toBeVisible();
    await expect(page.locator("#messages-body")).toBeHidden();
    await expect(page).not.toHaveURL(/fil=/);
    await expect(rows(page).filter({ hasText: tenant.last }).getByRole("img", { name: /non lus/ })).toHaveCount(0);
    // Read in the database, not only on this screen.
    await page.reload();
    await expect(rows(page)).toHaveCount(2);
    await expect(rows(page).filter({ hasText: tenant.last }).getByRole("img", { name: /non lus/ })).toHaveCount(0);
  });

  test("a new message moves its conversation to the top of the list", async ({ page }) => {
    await signIn(page, owner.email);
    await page.goto("/app/messages");
    // The second tenancy has no conversation yet: the desk's first word opens it, on the phone too.
    await rows(page).filter({ hasText: second.last }).click();
    const name = `${second.first} ${second.last}`;
    await expect(chatHeading(page, name)).toBeVisible();
    await expect(page.locator("#messages-body")).toContainText("Pas encore de message");
    await page.locator("#messages-reply").fill(welcome);
    await page.getByRole("button", { name: "Envoyer", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Message envoyé" })).toBeVisible();
    await expect(page.locator("#messages-body").getByText(welcome)).toBeVisible();
    await expect(chatHeading(page, name), "the screen stays on the conversation it opened").toBeVisible();
    await backToThreads(page).click();
    await expect(rows(page).nth(0)).toContainText(second.last);
    await expect(rows(page).nth(0)).toContainText(welcome);
    await expect(rows(page).nth(1)).toContainText(tenant.last);
    // A word to the first tenant brings that conversation back on top.
    await rows(page).nth(1).click();
    await expect(chatHeading(page, `${tenant.first} ${tenant.last}`)).toBeVisible();
    await page.locator("#messages-reply").fill(answer);
    await page.keyboard.press("Enter");
    await expect(page.locator("#messages-body").getByText(answer)).toBeVisible();
    await backToThreads(page).click();
    await expect(rows(page).nth(0)).toContainText(tenant.last);
    await expect(rows(page).nth(0)).toContainText(answer);
    await expect(rows(page).nth(1)).toContainText(second.last);
    // The order is the database's: a fresh load agrees.
    await page.reload();
    await expect(rows(page).nth(0)).toContainText(tenant.last);
    await expect(rows(page).nth(1)).toContainText(second.last);
  });

  test("Demandes on the phone: the list first, a tap opens the conversation at the request, back returns to Demandes", async ({ page }) => {
    await signIn(page, owner.email);
    await page.goto("/app/messages?onglet=demandes");
    // A list of requests, not a table, and no conversation until one is tapped.
    await expect(page.getByRole("table")).toBeHidden();
    await expect(page.locator("#messages-body")).toHaveCount(0);
    const row = page.locator("#messages-panel-requests li > button").filter({ hasText: requestTitle });
    await expect(row).toBeVisible();
    await expect(row).toContainText(`${tenant.first} ${tenant.last}`);
    await expect(row).toContainText("À traiter");
    await row.click();
    await expect(page).toHaveURL(new RegExp(`demande=${requestId}`));
    const name = `${tenant.first} ${tenant.last}`;
    await expect(chatHeading(page, name)).toBeVisible();
    const card = page.locator(`[data-request="${requestId}"]`);
    await expect(card).toBeVisible();
    await expectChatFillsScreen(page, name);
    // "Voir la demande" opens the details as a sheet; the status changes from there.
    await card.getByRole("button", { name: "Voir la demande" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const patched = page.waitForResponse((r) => r.url().includes(`/api/demandes/${requestId}`) && r.request().method() === "PATCH");
    await dialog.locator("#request-status").selectOption("in_progress");
    expect((await patched).ok(), "the status change is accepted").toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(card).toContainText("En cours");
    // Back leads to Demandes, where the request now reads "En cours".
    await page.getByRole("button", { name: "Retour aux demandes" }).click();
    await expect(page).toHaveURL(/onglet=demandes/);
    await expect(page.locator("#messages-panel-requests li > button").filter({ hasText: requestTitle })).toContainText("En cours");
    await expect(page.locator("#messages-body")).toHaveCount(0);
  });

  test("a long conversation opens on its newest message, the composer in reach, and scrolls on its own", async ({ page }) => {
    await signIn(page, owner.email);
    // The address names the conversation: the phone opens straight on it.
    await page.goto(`/app/messages?fil=${threadId}`);
    const name = `${tenant.first} ${tenant.last}`;
    await expect(chatHeading(page, name)).toBeVisible();
    await expect(rows(page).first()).toBeHidden();
    for (let i = 1; i <= 12; i++) {
      const line = `Point d'étape ${i} : le volet est commandé.`;
      await page.locator("#messages-reply").fill(line);
      await page.keyboard.press("Enter");
      await expect(page.locator("#messages-body").getByText(line)).toBeVisible();
    }
    await page.reload();
    const body = page.locator("#messages-body");
    await expect(body.getByText("Point d'étape 12 : le volet est commandé.")).toBeVisible();
    expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight), "the conversation is longer than the screen").toBe(true);
    expect(await atBottom(page), "opens on the newest message").toBe(true);
    await expectChatFillsScreen(page, name);
    // The first message is up the conversation, reached by scrolling it, not the page.
    await body.evaluate((el) => {
      el.scrollTop = 0;
    });
    await expect(body.getByText(firstWord)).toBeInViewport();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await expect(page.locator("#messages-reply")).toBeInViewport();
    // Back, from a conversation the address opened, still leads to the list.
    await backToThreads(page).click();
    await expect(rows(page).first()).toBeVisible();
    await expect(page).not.toHaveURL(/fil=/);
  });
});
