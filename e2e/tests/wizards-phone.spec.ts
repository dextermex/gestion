import { expect, test, type Page } from "@playwright/test";
import { mail } from "./helpers";
import { box, enter, phone, photo, swipeBack } from "./phone";

/**
 * The wizards on a phone: an état des lieux whose condition chips a thumb
 * can hit, whose photographs show as thumbnails that can be taken away,
 * whose walk-through is kept on the device and offered back after a
 * reload, and whose back gesture steps back a room instead of out; a
 * property wizard with the same safety net and controls; the lease and
 * departure wizards saying where they are. On the sample cabinet, where
 * nothing is written at the end.
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);
test.use(phone);

const owner = { first: "Jil", last: "Thinnes", email: mail("owner") };

const next = (page: Page) => page.getByRole("button", { name: /^(Suivant|Commencer|Continuer|Démarrer)/ }).last();
const counter = (page: Page) => page.locator(".journey-topbar").getByText(/Étape \d+\/\d+/);

/** The draft the device holds under `key`, read the way the wizard reads it (null when there is none). */
async function storedDraft(page: Page, key: string): Promise<{ step: number; condition: string | null; photos: number } | null> {
  return page.evaluate(
    (k) =>
      new Promise((resolve) => {
        const req = indexedDB.open("morada-brouillons", 1);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("drafts")) return resolve(null);
          const get = db.transaction("drafts", "readonly").objectStore("drafts").get(k);
          get.onsuccess = () => {
            const d = get.result as { data?: { step?: number; rooms?: Array<{ key?: string; items?: Record<string, { condition?: string }> }>; photos?: Record<string, unknown[]> } } | undefined;
            if (!d?.data) return resolve(null);
            // The photographs of the first room's paint, keyed as the wizard keys them (`<room>:<category>`).
            const room = d.data.rooms?.[0];
            resolve({ step: d.data.step ?? -1, condition: room?.items?.paint?.condition ?? null, photos: d.data.photos?.[`${room?.key ?? ""}:paint`]?.length ?? 0 });
          };
          get.onerror = () => resolve(null);
        };
        req.onerror = () => resolve(null);
      }),
    key,
  );
}

async function clearDrafts(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const req = indexedDB.open("morada-brouillons", 1);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("drafts")) return resolve();
          const t = db.transaction("drafts", "readwrite");
          t.objectStore("drafts").clear();
          t.oncomplete = () => resolve();
          t.onerror = () => resolve();
        };
        req.onerror = () => resolve();
      }),
  );
}

test("the état des lieux: thumb-sized chips, thumbnails that can be taken away, a draft after a reload, a back gesture that steps back a room", async ({ page, context }) => {
  await enter(page, context, owner, true);
  await page.goto("/app/biens/etat-des-lieux?bail=l-3b&type=exit");
  await clearDrafts(page);
  await expect(counter(page)).toBeVisible();
  await expect(counter(page)).toHaveText(/Étape 1\//);
  await next(page).click();
  await expect(counter(page)).toHaveText(/Étape 2\//);
  const chips = page.locator("[data-conditions='paint'] button");
  await expect(chips.first()).toBeVisible();
  for (const chip of await chips.all()) {
    const b = await box(chip);
    expect.soft(b.height, "a condition chip is a thumb's size").toBeGreaterThanOrEqual(44);
    expect.soft(b.x + b.width).toBeLessThanOrEqual(phone.viewport.width);
  }
  await chips.nth(1).click();
  await expect(chips.nth(1)).toHaveAttribute("aria-pressed", "true");
  // Two photographs: thumbnails, a count, and a remove control a thumb can hit.
  await page.locator("input[data-photo-input='paint']").setInputFiles([await photo(page, 30), await photo(page, 200)]);
  const thumbs = page.locator("[data-photo-list='paint'] img");
  await expect(thumbs).toHaveCount(2);
  await expect(page.locator("[data-photo-count='paint']")).toContainText(/2 photo/);
  const remove = page.locator("[data-photo-list='paint'] button").first();
  expect((await box(remove)).height).toBeGreaterThanOrEqual(44);
  await test.info().attach("edl-room", { body: await page.screenshot(), contentType: "image/png" });
  await remove.click();
  await expect(thumbs).toHaveCount(1);
  // The walk is kept on the device, a moment after the last change: the room's
  // condition and its remaining photograph are in the store before the reload.
  await expect.poll(() => storedDraft(page, "edl:l-3b:exit"), { timeout: 10_000 }).toEqual({ step: 1, condition: "good", photos: 1 });
  await page.reload();
  const prompt = page.locator("[data-draft-prompt]");
  await expect(prompt).toBeVisible();
  await test.info().attach("edl-draft-prompt", { body: await page.screenshot(), contentType: "image/png" });
  await prompt.getByRole("button", { name: "Reprendre" }).click();
  await expect(counter(page)).toHaveText(/Étape 2\//);
  await expect(page.locator("[data-conditions='paint'] button[aria-pressed='true']")).toHaveCount(1);
  await expect(page.locator("[data-photo-list='paint'] img")).toHaveCount(1);
  // The back gesture steps back a room and stays in the wizard.
  await next(page).click();
  await expect(counter(page)).toHaveText(/Étape 3\//);
  await swipeBack(page);
  await expect(counter(page)).toHaveText(/Étape 2\//);
  await expect(page.locator(".journey-topbar")).toBeVisible();
  await clearDrafts(page);
});

test("the property wizard: photograph controls a thumb can hit, a draft after a reload that can be set aside", async ({ page, context }) => {
  await enter(page, context, owner, false);
  await page.goto("/app/biens/nouveau");
  await clearDrafts(page);
  // The property wizard's bar carries its title on a phone; the step shows in the heading.
  await expect(page.locator(".journey-topbar")).toBeVisible();
  const firstHeading = (await page.getByRole("heading", { level: 1 }).first().textContent())?.trim() ?? "";
  await page.getByRole("radio", { name: /immeuble/i }).first().check({ force: true }).catch(async () => {
    await page.locator("label").filter({ hasText: /immeuble/i }).first().click();
  });
  // The address, field by field as the form names them.
  for (const field of await page.locator("input:visible").all()) {
    const type = await field.getAttribute("type");
    if (!(type === null || type === "text") || (await field.inputValue())) continue;
    const hint = (((await field.getAttribute("placeholder")) ?? "") + " " + (await field.evaluate((el) => el.closest(".ui-field-group, label")?.textContent ?? ""))).toLowerCase();
    await field.fill(/nom du bien|^nom|nom\s/.test(hint) ? "Résidence des Tilleuls" : /rue/.test(hint) ? "Rue des Tilleuls" : /num|n°/.test(hint) ? "8" : /postal|code/.test(hint) ? "1234" : /localit|ville|commune/.test(hint) ? "Luxembourg" : "Test");
  }
  await next(page).click();
  await expect(page.getByRole("heading", { level: 1 }).first()).not.toHaveText(firstHeading);
  await page.locator("details input[type=file]").first().setInputFiles([await photo(page, 110), await photo(page, 300)]);
  await page.evaluate(() => {
    for (const d of document.querySelectorAll("details")) d.open = /photo/i.test(d.querySelector("summary")?.textContent ?? "");
  });
  const grid = page.locator("details[open] ul.grid");
  await expect(grid.locator("img")).toHaveCount(2);
  for (const control of await grid.locator("button").all()) expect.soft((await box(control)).height, "a photograph control is a thumb's size").toBeGreaterThanOrEqual(40);
  await test.info().attach("property-photos", { body: await page.screenshot(), contentType: "image/png" });
  await expect.poll(async () => (await storedDraft(page, "bien:nouveau")) !== null, { timeout: 10_000 }).toBe(true);
  await page.reload();
  const prompt = page.locator("[data-draft-prompt]");
  await expect(prompt).toBeVisible();
  await prompt.getByRole("button", { name: "Recommencer" }).click();
  await expect(prompt).toBeHidden();
  await expect(page.getByRole("heading", { level: 1 }).first()).toHaveText(firstHeading);
  await clearDrafts(page);
});

test("the lease and departure wizards say where they are on the phone", async ({ page, context }) => {
  await enter(page, context, owner, false);
  await page.goto("/app/biens/locataire?lot=u-gare");
  await expect(counter(page)).toBeVisible();
  await expect(counter(page)).toHaveText(/Étape 1\/9/);
  await page.goto("/app/biens/depart?bail=l-3b");
  await expect(counter(page)).toBeVisible();
  await expect(counter(page)).toHaveText(/Étape 1\/7/);
});
