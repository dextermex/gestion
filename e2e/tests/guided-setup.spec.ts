import { expect, test, type Page } from "@playwright/test";
import { createAccount, mail, signIn } from "./helpers";

/**
 * The guided first entry into a new landlord's space, as the iPhone app has
 * it: the tour on arrival (one stop on the first open step, then the setup
 * card lit), the card that keeps naming the next step, the property form
 * opened with the kind the sign-up chose. On the account's own data: the
 * tour never plays on a sample cabinet.
 *
 * Every other spec starts with the tour silenced on its browser
 * (`localStorage["morada.tour.seen"] = "off"`, see SetupTour.tsx); this one
 * takes that away again, so it meets the tour as a new landlord does.
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

const owner = { first: "Lena", last: "Hoffmann", email: mail("guided") };
const second = { first: "Tom", last: "Weber", email: mail("guided-type") };

/** The tour as a new browser meets it, whatever the shared setup did before. */
async function tourUnseen(page: Page): Promise<void> {
  // Once for the tab, not on every page: the tour's own memory (seen, the last count) must then
  // live on from page to page, or the card could never be pointed out again after a step.
  await page.addInitScript(() => {
    try {
      if (sessionStorage.getItem("e2e.tour") === "on") return;
      sessionStorage.setItem("e2e.tour", "on");
      localStorage.removeItem("morada.tour.seen");
      localStorage.removeItem("morada.tour.count");
    } catch {
      /* storage blocked: nothing to take away */
    }
  });
}

/** A further account on the same tab: this browser forgets the tour the account before it saw. */
async function tourForgotten(page: Page): Promise<void> {
  await page.evaluate(() => {
    localStorage.removeItem("morada.tour.seen");
    localStorage.removeItem("morada.tour.count");
  });
}

const card = (page: Page) => page.getByRole("region", { name: "Terminez votre installation" });
const tour = (page: Page) => page.getByRole("dialog");

async function fillHouse(page: Page, name: string): Promise<void> {
  await page.getByLabel("Nom du bien", { exact: true }).fill(name);
  await page.getByLabel("Rue").fill("Rue de la Gare");
  await page.getByLabel("N°").fill("12");
  await page.getByLabel("Code postal").fill("L-8001");
  await page.getByLabel("Localité").fill("Strassen");
  await page.getByRole("button", { name: "Suivant", exact: true }).click();
  await page.getByRole("button", { name: "Passer à la vérification", exact: true }).click();
  await page.getByRole("button", { name: "Créer le bien" }).first().click();
  await expect(page.getByText(`${name} a été créé.`)).toBeVisible({ timeout: 30_000 });
}

test("a new landlord is led from the first property to the lease, and the tour plays once", async ({ page }) => {
  await createAccount(owner);
  await signIn(page, owner.email, "/app/biens");
  await tourUnseen(page);
  await page.goto("/app?tour=1");

  // One stop: the first property, named for what it is for.
  await expect(tour(page)).toBeVisible({ timeout: 10_000 });
  await expect(tour(page)).toContainText("Ajoutez un bien, tout part de là");
  await expect(page).toHaveURL(/\/app$/);
  // Followed: the property form opens.
  await tour(page).getByRole("button", { name: "Ajoutez votre premier bien" }).click();
  await page.waitForURL(/\/app\/biens\/nouveau/);
  await page.getByRole("radio", { name: "Maison individuelle", exact: true }).check();
  await fillHouse(page, "Maison Hoffmann");

  // Back on Accueil: two of five, the lease named as the next step, the invitation waiting for it.
  await page.goto("/app");
  await expect(tour(page)).toBeVisible({ timeout: 10_000 });
  await expect(tour(page)).toContainText("Créez un bail avec son locataire");
  await page.keyboard.press("Escape");
  await expect(tour(page)).toBeHidden();
  await expect(card(page).getByRole("img", { name: "2 sur 5" })).toBeVisible();
  const next = card(page).getByRole("link", { name: /^Continuer.+Créez un bail avec son locataire$/ });
  await expect(next).toBeVisible();
  // One house, one lot: the lease starts in that lot's own rental flow.
  await expect(next).toHaveAttribute("href", /\/app\/biens\/locataire\?lot=/);
  const invite = card(page).locator('[data-setup-step="invite"]');
  await expect(invite).toHaveAttribute("data-state", "waiting");
  await expect(invite).toContainText("Une fois un bail créé");
  await expect(card(page).locator('[data-setup-step="property"]')).toHaveAttribute("data-state", "done");

  // Neither the tour nor the reminder shows a second time.
  await page.reload();
  await expect(card(page)).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(tour(page)).toBeHidden();
});

test("the sign-up's kind is preselected, and leaving the form returns to Accueil for the tour", async ({ page }) => {
  await createAccount(second);
  await signIn(page, second.email, "/app/biens");
  await tourUnseen(page);
  await page.goto("/app/biens/nouveau?type=house&tour=1");
  await expect(page.getByRole("radio", { name: "Maison individuelle", exact: true })).toBeChecked();
  const back = page.locator(".journey-topbar").getByRole("link", { name: "Accueil", exact: true });
  await expect(back).toHaveAttribute("href", "/app?tour=1");
  await back.click();
  await expect(tour(page)).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Passer", exact: true }).click();
  await expect(tour(page)).toBeHidden();
  await page.goto("/app");
  await page.waitForTimeout(1500);
  await expect(tour(page)).toBeHidden();
});

test("the card and the tour fit a phone at 390 and 320 pixels", async ({ page }) => {
  await signIn(page, second.email, "/app/biens");
  await tourUnseen(page);
  for (const width of [390, 320]) {
    await test.step(`${width}px`, async () => {
      await page.setViewportSize({ width, height: 844 });
      // A browser that has not seen it yet, on an account that has: only the card, never the overlay.
      await page.goto("/app");
      await expect(card(page)).toBeVisible();
      await page.waitForTimeout(1000);
      await expect(tour(page)).toBeHidden();
      const fit = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
      expect.soft(fit, `the page is no wider than ${width}px`).toBeLessThanOrEqual(0);
      const box = (await card(page).boundingBox())!;
      expect.soft(box.x).toBeGreaterThanOrEqual(0);
      expect.soft(box.x + box.width).toBeLessThanOrEqual(width);
      const next = (await card(page).getByRole("link", { name: /^Continuer/ }).boundingBox())!;
      expect.soft(next.height).toBeGreaterThanOrEqual(40);
      for (const row of await card(page).locator("[data-setup-step] a").all()) expect.soft((await row.boundingBox())!.height).toBeGreaterThanOrEqual(40);
      await test.info().attach(`setup-card-${width}`, { body: await page.screenshot(), contentType: "image/png" });
    });
  }
  // The overlay on a phone: a new account, its tour, the headline within the screen.
  const third = { first: "Mia", last: "Schmit", email: mail("guided-phone") };
  await createAccount(third);
  await signIn(page, third.email, "/app/biens");
  await tourUnseen(page);
  await tourForgotten(page);
  for (const width of [390, 320]) {
    await test.step(`overlay ${width}px`, async () => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/app");
      await expect(tour(page)).toBeVisible({ timeout: 10_000 });
      const bubble = (await tour(page).locator(".setup-tour-bubble").boundingBox())!;
      expect.soft(bubble.x).toBeGreaterThanOrEqual(0);
      expect.soft(bubble.x + bubble.width).toBeLessThanOrEqual(width);
      expect.soft(bubble.y + bubble.height).toBeLessThanOrEqual(844);
      expect.soft((await tour(page).getByRole("button", { name: "Passer", exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(40);
      const fit = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
      expect.soft(fit).toBeLessThanOrEqual(0);
      await test.info().attach(`setup-tour-${width}`, { body: await page.screenshot(), contentType: "image/png" });
      // Taken away for the next width: this browser has not seen it, the account has not either.
      await page.evaluate(() => localStorage.removeItem("morada.tour.seen"));
    });
  }
});
