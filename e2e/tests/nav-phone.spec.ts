import { expect, test } from "@playwright/test";
import { mail } from "./helpers";
import { PREVIEW, box, enter, phone, settledHeight, swipeBack } from "./phone";

/**
 * The owner's way around on a phone: the drawer that closes on the entry
 * it is already on, menus whose entries a thumb can hit, a search that
 * takes the caret as it opens and reads its corpus on demand, a Créer menu
 * without an empty entry, and a conversation the phone's back gesture
 * closes. On the sample cabinet, as every owner may see it.
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);
test.use(phone);

const owner = { first: "Nora", last: "Weis", email: mail("owner") };

test("the drawer opens on the current section and closes on the entry already on the screen", async ({ page, context }) => {
  await enter(page, context, owner, true);
  await page.goto("/app/biens");
  await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await expect.poll(async () => (await drawer.boundingBox())?.x).toBe(0);
  const current = drawer.locator("a[aria-current='page']");
  await expect(current).toBeVisible();
  await expect(current).toHaveText("Biens");
  expect((await box(current)).height).toBeGreaterThanOrEqual(40);
  await current.click();
  await expect(drawer).toBeHidden();
  await expect(page).toHaveURL(/\/app\/biens$/);
});

test("the language, Créer and account menus list entries a thumb can hit, and Créer has no empty entry", async ({ page, context }) => {
  await enter(page, context, owner, false);
  await page.goto("/app");
  const menus = page.locator("header button[aria-haspopup='true'], button[aria-haspopup='true']");
  await expect(menus).toHaveCount(3);
  // Language.
  await menus.nth(0).click();
  for (const name of ["Français", "English", "Deutsch", "Lëtzebuergesch"]) {
    const item = page.getByRole("button", { name, exact: true });
    await expect(item).toBeVisible();
    expect(await settledHeight(item), `${name} is a thumb's size`).toBeGreaterThanOrEqual(44);
  }
  await page.keyboard.press("Escape");
  // Créer: the five things one creates; the Document entry, which opened nothing, is gone.
  await menus.nth(1).click();
  for (const name of ["Bien", "Bail", "Contact", "Paiement", "Intervention"]) {
    const item = page.getByRole("button", { name, exact: true });
    await expect(item).toBeVisible();
    expect(await settledHeight(item), `${name} is a thumb's size`).toBeGreaterThanOrEqual(44);
  }
  await expect(page.getByRole("button", { name: "Document", exact: true })).toHaveCount(0);
  // A count asks for the numeric keyboard; the contact form does not offer the manager's own identity.
  await page.getByRole("button", { name: "Bail", exact: true }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await expect(sheet.locator("input[name='depositMonths']")).toHaveAttribute("inputmode", "numeric");
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await menus.nth(1).click();
  await page.getByRole("button", { name: "Contact", exact: true }).click();
  await expect(sheet).toBeVisible();
  for (const field of ["name", "email", "phone"]) await expect(sheet.locator(`input[name='${field}']`)).toHaveAttribute("autocomplete", "off");
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  // Account.
  await menus.nth(2).click();
  const signOut = page.getByRole("button", { name: "Se déconnecter" });
  await expect(signOut).toBeVisible();
  expect(await settledHeight(signOut), "signing out is a thumb's size").toBeGreaterThanOrEqual(44);
  await page.keyboard.press("Escape");
});

test("the search takes the caret as it opens, locks the page, reads its corpus once, and closes from its own button", async ({ page, context }) => {
  await enter(page, context, owner, false);
  await page.goto("/app");
  const corpus = PREVIEW ? null : page.waitForResponse((r) => r.url().includes("/api/recherche"));
  await page.getByRole("button", { name: "Rechercher" }).click();
  const palette = page.getByRole("dialog");
  await expect(palette).toBeVisible();
  const field = palette.getByRole("combobox");
  await expect(field).toBeFocused();
  expect(parseFloat(await field.evaluate((el) => getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("hidden");
  const close = palette.getByRole("button", { name: "Fermer" });
  const cb = await box(close);
  expect(cb.width).toBeGreaterThanOrEqual(44);
  expect(cb.height).toBeGreaterThanOrEqual(44);
  if (corpus) {
    // The corpus came under the account's own token, and a word finds the sample cabinet's building.
    const res = await corpus;
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toContain("no-store");
    await field.fill("beaulieu");
    await expect(palette.getByRole("option").filter({ hasText: "Résidence Beaulieu" }).first()).toBeVisible();
  }
  for (const row of await palette.getByRole("option").all()) expect.soft((await box(row)).height).toBeGreaterThanOrEqual(44);
  await close.click();
  await expect(palette).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("");
  // Opened again within the minute: nothing is asked for again.
  let asked = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/recherche")) asked += 1;
  });
  await page.getByRole("button", { name: "Rechercher" }).click();
  await expect(palette).toBeVisible();
  await page.waitForTimeout(500);
  if (!PREVIEW) expect(asked).toBe(0);
  await page.keyboard.press("Escape");
});

test("a conversation opened on the phone is closed by the back gesture, reopened by the forward one, and by its own button", async ({ page, context }) => {
  await enter(page, context, owner, false);
  await page.goto("/app/messages");
  const rows = page.locator("#messages-panel-conversations li > button");
  await expect(rows.first()).toBeVisible();
  await rows.first().click();
  await expect(page.locator("#messages-body")).toBeVisible();
  await expect(page).toHaveURL(/fil=/);
  await expect(page.getByRole("button", { name: "Ouvrir le menu" })).toBeHidden();
  // The gesture: back to the list, the address clean, the shell's bar back.
  await swipeBack(page);
  await expect(page).not.toHaveURL(/fil=/);
  await expect(rows.first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Ouvrir le menu" })).toBeVisible();
  // Forward: the conversation again.
  await page.goForward({ waitUntil: "commit" });
  await expect(page).toHaveURL(/fil=/);
  await expect(page.locator("#messages-body")).toBeVisible();
  // Its own button pops the same entry.
  await page.getByRole("button", { name: "Retour aux conversations" }).click();
  await expect(page).not.toHaveURL(/fil=/);
  await expect(rows.first()).toBeVisible();
  // Demandes: a request opens in its conversation, and the gesture returns to Demandes.
  await page.goto("/app/messages?onglet=demandes");
  const request = page.locator("#messages-panel-requests li > button").first();
  await expect(request).toBeVisible();
  await request.click();
  await expect(page).toHaveURL(/demande=/);
  await swipeBack(page);
  await expect(page).toHaveURL(/onglet=demandes/);
  await expect(page.locator("#messages-panel-requests")).toBeVisible();
});
