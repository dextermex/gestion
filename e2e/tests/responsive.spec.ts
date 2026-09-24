import { devices, expect, test, type Page } from "@playwright/test";
import { mail, signIn, signUp } from "./helpers";

/**
 * Every critical screen at an iPhone's width, on the real backend: an owner
 * signed up here, looking at the sample cabinet (the cookie every account
 * may set), so each screen carries real records. What a phone must never
 * show: something wider than the screen, a field small enough for Safari to
 * zoom into, a control too small for a thumb, a bar covering the title. Each
 * screen's screenshot goes to the report, a regression record a person can
 * read. WebKit in CI (iphone-webkit), Chromium's emulation elsewhere; the
 * same sweep at the narrowest width still in use (320px).
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

const iphone = devices["iPhone 14"];
test.use({ viewport: iphone.viewport, deviceScaleFactor: iphone.deviceScaleFactor, isMobile: iphone.isMobile, hasTouch: iphone.hasTouch, userAgent: iphone.userAgent });

const owner = { first: "Nadia", last: "Kremer", email: mail("owner") };

const DESK = [
  "/app", "/app/biens", "/app/biens/p-beaulieu", "/app/biens/p-beaulieu?onglet=lots", "/app/biens/p-beaulieu?onglet=location", "/app/biens/nouveau",
  "/app/baux", "/app/baux/l-3b", "/app/loyers", "/app/banque", "/app/finance", "/app/charges", "/app/compteurs", "/app/contacts", "/app/contacts/c-muller",
  "/app/documents", "/app/contrats", "/app/conformite", "/app/fiscalite", "/app/garanties", "/app/indexation", "/app/interventions", "/app/edl",
  "/app/assurances", "/app/workflows", "/app/aml", "/app/reglages", "/app/utilisateurs", "/app/integrations", "/app/messages", "/app/messages?onglet=demandes",
];
const TENANT = ["/locataire", "/locataire/bail", "/locataire/paiements", "/locataire/demandes", "/locataire/demandes/t-1", "/locataire/messages"];

interface Reading {
  overflow: number;
  spills: string[];
  zooming: string[];
  lowFields: string[];
  smallButtons: string[];
  titleUnderBar: boolean;
}

/** What the screen shows, measured the way a phone would be judged. */
async function read(page: Page): Promise<Reading> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== "hidden" && cs.display !== "none";
    };
    const describe = (el: Element) => `<${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}> "${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40)}"`;
    const scrolls = (el: Element) => /(auto|scroll)/.test(getComputedStyle(el).overflowX);
    const spills: string[] = [];
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      if (!visible(el) || el.closest("svg")) continue;
      const r = el.getBoundingClientRect();
      if (r.right <= vw + 1 && r.left >= -1) continue;
      // Inside a strip or a table that scrolls sideways on purpose: held, not spilled.
      let a = el.parentElement, held = false;
      while (a && a !== document.body) {
        if (scrolls(a)) { const ar = a.getBoundingClientRect(); if (ar.right <= vw + 1 && ar.left >= -1) { held = true; break; } }
        a = a.parentElement;
      }
      if (held) continue;
      if (getComputedStyle(el).position === "fixed" && (r.left >= vw || r.right <= 0)) continue;
      spills.push(describe(el));
      if (spills.length >= 6) break;
    }
    const fields = Array.from(document.querySelectorAll<HTMLElement>("input, select, textarea")).filter((f) => visible(f) && !["checkbox", "radio", "file", "hidden", "range"].includes((f as HTMLInputElement).type));
    const zooming = fields.filter((f) => parseFloat(getComputedStyle(f).fontSize) < 16).map(describe);
    const lowFields = fields.filter((f) => f.getBoundingClientRect().height < 40).map(describe);
    // The kit's buttons: at least 40px tall, the thumb's size, however short their label.
    const smallButtons = Array.from(document.querySelectorAll<HTMLElement>("button.rounded-xl.inline-flex")).filter((b) => visible(b) && b.getBoundingClientRect().height < 40).map(describe);
    const bar = document.querySelector("header");
    const title = document.querySelector("h1");
    const titleUnderBar = Boolean(bar && title && visible(title) && title.getBoundingClientRect().top < bar.getBoundingClientRect().bottom - 1);
    return { overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - vw, spills, zooming, lowFields, smallButtons, titleUnderBar };
  });
}

async function expectFits(page: Page, route: string, width: number): Promise<void> {
  await test.step(`${route} at ${width}px`, async () => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(route);
    await expect(page.locator("main, form").first()).toBeVisible();
    await page.waitForTimeout(150);
    const r = await read(page);
    expect.soft(r.overflow, `${route} @${width}: the page is no wider than the screen`).toBeLessThanOrEqual(0);
    expect.soft(r.spills, `${route} @${width}: nothing spills past the screen's edge`).toEqual([]);
    expect.soft(r.zooming, `${route} @${width}: every field is 16px or more (no Safari zoom)`).toEqual([]);
    expect.soft(r.lowFields, `${route} @${width}: every field is at least 40px tall`).toEqual([]);
    expect.soft(r.smallButtons, `${route} @${width}: every button is at least 40px tall`).toEqual([]);
    expect.soft(r.titleUnderBar, `${route} @${width}: the bar does not cover the title`).toBe(false);
    if (width === 390) await test.info().attach(route.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "_") || "root", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  });
}

test("the owner's screens fit an iPhone, on the sample cabinet", async ({ page, context }) => {
  await signUp(page, owner);
  await context.addCookies([{ name: "morada_dataset", value: "fr", url: new URL(page.url()).origin }]);
  for (const width of [390, 320]) for (const route of DESK) await expectFits(page, route, width);
});

test("the tenant's screens fit an iPhone", async ({ page, context }) => {
  await signIn(page, owner.email);
  await context.addCookies([{ name: "morada_dataset", value: "fr", url: new URL(page.url()).origin }]);
  for (const width of [390, 320]) for (const route of TENANT) await expectFits(page, route, width);
});

test("the tenant's navigation is a bar at the foot of the phone, Plus holding the rest", async ({ page, context }) => {
  await signIn(page, owner.email);
  await context.addCookies([{ name: "morada_dataset", value: "fr", url: new URL(page.url()).origin }]);
  for (const [width, height] of [[390, 844], [844, 390]] as const) {
    await test.step(`${width}x${height}`, async () => {
      await page.setViewportSize({ width, height });
      await page.goto("/locataire/bail");
      // The bar: fixed at the foot, the whole width, every entry a thumb's size, the open one lit.
      const bar = page.getByRole("navigation", { name: "Espace locataire" });
      await expect(bar).toBeVisible();
      const box = (await bar.boundingBox())!;
      expect(box.x).toBe(0);
      expect(box.width).toBe(width);
      expect(box.y + box.height).toBe(height);
      const entries = bar.locator("a, button");
      await expect(entries).toHaveText(["Accueil", "Bail", "Paiements", "Messages", "Plus"]);
      for (const e of await entries.all()) expect((await e.boundingBox())!.height).toBeGreaterThanOrEqual(40);
      await expect(bar.getByRole("link", { name: "Bail" })).toHaveAttribute("aria-current", "page");
      // The tabs under the logo are gone: the page has the width to itself, and the sign-out sits behind Plus.
      await expect(page.getByRole("link", { name: "Mon bail" })).toBeHidden();
      await expect(page.getByRole("button", { name: "Se déconnecter" })).toBeHidden();
      // The page's foot stays clear of the bar: scrolled to the very end (instantly, the
      // page scrolls smoothly by default), the footer's line still sits above it.
      await page.evaluate(() => {
        document.documentElement.style.scrollBehavior = "auto";
        window.scrollTo(0, document.documentElement.scrollHeight);
      });
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      const footerLine = (await page.locator("footer p").first().boundingBox())!;
      expect(footerLine.y + footerLine.height).toBeLessThanOrEqual(height - box.height + 1);
      // Plus: the requests, the owner's space, signing out, as a sheet within the screen.
      await bar.getByRole("button", { name: "Plus", exact: true }).click();
      const sheet = page.getByRole("dialog");
      await expect(sheet).toBeVisible();
      await expect(sheet.getByRole("link", { name: "Demandes" })).toBeVisible();
      await expect(sheet.getByRole("link", { name: "Espace propriétaire" })).toBeVisible();
      await expect(sheet.getByRole("button", { name: "Se déconnecter" })).toBeVisible();
      // It rises on a spring: measured once it has settled within the screen.
      await expect.poll(async () => {
        const b = await sheet.boundingBox();
        return b ? Math.round(b.y + b.height) : Infinity;
      }).toBeLessThanOrEqual(height);
      const sbox = (await sheet.boundingBox())!;
      expect(sbox.x).toBeGreaterThanOrEqual(0);
      expect(sbox.x + sbox.width).toBeLessThanOrEqual(width);
      if (width === 390) await test.info().attach("tenant-plus-sheet", { body: await page.screenshot(), contentType: "image/png" });
      await sheet.getByRole("link", { name: "Demandes" }).click();
      await expect(page).toHaveURL(/\/locataire\/demandes/);
      await expect(sheet).toBeHidden();
      await expect(bar.getByRole("button", { name: "Plus", exact: true })).toHaveClass(/text-brand-700/);
    });
  }
});

test("the tenant's Messages on the phone: the list first, a conversation over the whole screen, the way back", async ({ page, context }) => {
  await signIn(page, owner.email);
  await context.addCookies([{ name: "morada_dataset", value: "fr", url: new URL(page.url()).origin }]);
  for (const [width, height] of [[390, 844], [844, 390]] as const) {
    await test.step(`${width}x${height}`, async () => {
      await page.setViewportSize({ width, height });
      await page.goto("/locataire/messages");
      const bar = page.getByRole("navigation", { name: "Espace locataire" });
      const rows = page.locator("#tenant-conversations li > button");
      // The list alone, under the space's bar, above the bottom bar: no conversation until one is tapped.
      await expect(rows.first()).toBeVisible();
      await expect(page.locator("#tenant-message-body")).toBeHidden();
      await expect(bar).toBeVisible();
      await expect(page.getByRole("heading", { level: 1, name: "Messages" })).toBeVisible();
      for (const r of await rows.all()) expect((await r.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      // A tap: the conversation is the whole screen. Both bars are gone, the way back
      // and the manager's name at the top, the composer at the foot, nothing scrolling but the messages.
      await rows.first().click();
      await expect(page.locator("#tenant-message-body")).toBeVisible();
      await expect(bar).toBeHidden();
      await expect(page.getByRole("link", { name: "Morada" })).toBeHidden();
      await expect(page).toHaveURL(/bail=/);
      const back = page.getByRole("button", { name: "Retour aux conversations" });
      const backBox = (await back.boundingBox())!;
      expect(backBox.y).toBeGreaterThanOrEqual(0);
      expect(backBox.y).toBeLessThan(60);
      expect(backBox.height).toBeGreaterThanOrEqual(44);
      const composer = (await page.locator("#tenant-message-body").boundingBox())!;
      expect(composer.y + composer.height).toBeLessThanOrEqual(height);
      expect(composer.y + composer.height).toBeGreaterThan(height - 72);
      const overflow = await page.evaluate(() => ({
        down: document.documentElement.scrollHeight - document.documentElement.clientHeight,
        across: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }));
      expect(overflow.down, "nothing scrolls but the messages").toBeLessThanOrEqual(2);
      expect(overflow.across, "nothing spills out sideways").toBeLessThanOrEqual(0);
      await test.info().attach(`tenant-messages-chat-${width}x${height}`, { body: await page.screenshot(), contentType: "image/png" });
      // Back: the list, the bars, the address clean.
      await back.click();
      await expect(rows.first()).toBeVisible();
      await expect(bar).toBeVisible();
      await expect(page.locator("#tenant-message-body")).toBeHidden();
      await expect(page).not.toHaveURL(/bail=/);
    });
  }
});

test("the drawer, the search and a sheet fit the phone's screen", async ({ page, context }) => {
  await signIn(page, owner.email);
  await context.addCookies([{ name: "morada_dataset", value: "fr", url: new URL(page.url()).origin }]);
  await page.goto("/app");
  // The sidebar is a drawer: it opens from the bar's menu button, fits the screen, and every entry is a thumb's size.
  await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  // It slides in on a spring: measured once it has settled.
  await expect.poll(async () => (await drawer.boundingBox())?.x).toBe(0);
  expect((await drawer.boundingBox())!.width).toBeLessThanOrEqual(390 - 32);
  for (const row of await drawer.getByRole("navigation", { name: "Morada Gestion" }).getByRole("link").all()) {
    const b = await row.boundingBox();
    if (b && b.height > 0) expect.soft(b.height, "a drawer entry is at least 40px tall").toBeGreaterThanOrEqual(40);
  }
  // The role switch the bar carries on a laptop is in the drawer here: the tenant space is a thumb away.
  const toTenant = drawer.getByRole("navigation", { name: "Changer de rôle" }).getByRole("link", { name: "Locataire" });
  await expect(toTenant).toBeVisible();
  expect((await toTenant.boundingBox())!.height).toBeGreaterThanOrEqual(40);
  await test.info().attach("drawer", { body: await page.screenshot(), contentType: "image/png" });
  await drawer.getByRole("button").first().click();
  await expect(drawer).toBeHidden();
  // The search opens on a phone from its own button and its field is 16px.
  await page.getByRole("button", { name: "Rechercher" }).click();
  const palette = page.getByRole("dialog");
  await expect(palette).toBeVisible();
  const search = palette.getByRole("combobox");
  expect(parseFloat(await search.evaluate((el) => getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  const pbox = (await palette.boundingBox())!;
  expect(pbox.x).toBeGreaterThanOrEqual(0);
  expect(pbox.x + pbox.width).toBeLessThanOrEqual(390);
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
  // A dialog is a sheet from the bottom: within the screen, its fields 16px and 44px tall.
  await page.goto("/locataire/demandes");
  await page.getByRole("button", { name: /nouvelle demande/i }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await sheet.locator("button.tactile").first().click();
  const sbox = (await sheet.boundingBox())!;
  expect(sbox.x).toBeGreaterThanOrEqual(0);
  expect(sbox.x + sbox.width).toBeLessThanOrEqual(390);
  expect(sbox.y + sbox.height).toBeLessThanOrEqual(844);
  const field = sheet.locator("form input").first();
  expect(parseFloat(await field.evaluate((el) => getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  expect((await field.boundingBox())!.height).toBeGreaterThanOrEqual(40);
  await test.info().attach("request-sheet", { body: await page.screenshot(), contentType: "image/png" });
});
