import { expect, test } from "@playwright/test";
import { mail } from "./helpers";
import { box, enter, overflow, phone } from "./phone";

/**
 * The property on a phone: the name and the facts before the photograph
 * (and no empty frame without one), one full-width Modifier button that
 * opens a sheet of entries a thumb can hit, each opening its editor; the
 * lots as rows that say who lives there and what they pay; an e-mail
 * address and a phone number that a tap writes to or calls.
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);
test.use(phone);

const owner = { first: "Pit", last: "Reuland", email: mail("owner") };

for (const [name, route] of [
  ["the building", "/app/biens/p-beaulieu"],
  ["the house", "/app/biens/p-bertrange"],
  ["the lot", "/app/biens/p-beaulieu/lots/u-b-3b"],
] as const) {
  test(`${name}: the name first, no empty frame, a full-width Modifier that opens a sheet of entries`, async ({ page, context }) => {
    await enter(page, context, owner, name === "the building");
    await page.goto(route);
    const title = page.getByRole("heading", { level: 1 });
    await expect(title).toBeVisible();
    const modify = page.getByRole("button", { name: "Modifier" }).first();
    await expect(modify).toBeVisible();
    const tb = await box(title);
    const mb = await box(modify);
    expect(mb.y, "the name comes before the button").toBeGreaterThan(tb.y);
    expect(mb.width, "the button runs the width of the screen").toBeGreaterThanOrEqual(300);
    expect(mb.height).toBeGreaterThanOrEqual(44);
    // The sample cabinet has no photograph: no frame stands in for one.
    const frame = page.locator("div[class*='aspect-[4/3]']").first();
    if (await frame.count()) await expect(frame).toBeHidden();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await test.info().attach(`${name.replace(/\s+/g, "-")}-hero`, { body: await page.screenshot(), contentType: "image/png" });
    // The sheet: every entry a thumb's size, within the screen.
    await modify.click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    const rows = sheet.locator("[data-modify-sheet] a, [data-modify-sheet] button");
    expect(await rows.count()).toBeGreaterThan(3);
    for (const row of await rows.all()) {
      const b = await box(row);
      expect.soft(b.height, "an entry is a thumb's size").toBeGreaterThanOrEqual(44);
      expect.soft(b.x + b.width).toBeLessThanOrEqual(phone.viewport.width);
    }
    await test.info().attach(`${name.replace(/\s+/g, "-")}-modify-sheet`, { body: await page.screenshot(), contentType: "image/png" });
    // An entry opens its editor, a dialog with a field in it.
    const firstLabel = (await rows.first().textContent())?.trim() ?? "";
    await rows.first().click();
    const editor = page.getByRole("dialog", { name: firstLabel });
    await expect(editor).toBeVisible();
    await expect(editor.locator("input, select, textarea").first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(editor).toBeHidden();
  });
}

test("the lots are rows that say who lives there and what they pay, with a chevron centred on the row", async ({ page, context }) => {
  await enter(page, context, owner, false);
  await page.goto("/app/biens/p-beaulieu?onglet=lots");
  await page.getByRole("button", { name: "Liste", exact: true }).click();
  const rows = page.locator("ul a[href*='/lots/']");
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(2);
  const first = rows.first();
  await expect(first).toContainText("€/mois");
  const b = await box(first);
  expect(b.height).toBeGreaterThanOrEqual(80);
  expect(b.x + b.width).toBeLessThanOrEqual(phone.viewport.width);
  // The second line (who, how much, the state) is the phone's; the chevron sits mid-row.
  const second = first.locator("span").filter({ hasText: "€/mois" }).first();
  await expect(second).toBeVisible();
  const chevron = first.locator("[class*='row-span-2']").first();
  const cb = await box(chevron);
  expect(Math.abs(cb.y + cb.height / 2 - (b.y + b.height / 2))).toBeLessThan(12);
  await test.info().attach("lot-rows", { body: await page.screenshot(), contentType: "image/png" });
});

test("an e-mail address and a phone number are links a tap writes to or calls", async ({ page, context }) => {
  await enter(page, context, owner, false);
  await page.goto("/app/baux/l-3b?onglet=contrat");
  const mailto = page.locator("a[href^='mailto:']").first();
  await expect(mailto).toBeVisible();
  expect((await box(mailto)).height).toBeGreaterThanOrEqual(40);
  await page.goto("/app/contacts/c-muller");
  await expect(page.locator("a[href^='mailto:']").first()).toBeVisible();
  const tel = page.locator("a[href^='tel:']").first();
  await expect(tel).toBeVisible();
  expect(await tel.getAttribute("href")).toMatch(/^tel:\+?\d+$/);
  // The breadcrumb of a lot: links a thumb can hit.
  await page.goto("/app/biens/p-beaulieu/lots/u-b-3b");
  const crumb = page.getByRole("link", { name: "Biens", exact: true }).first();
  expect((await box(crumb)).height).toBeGreaterThanOrEqual(44);
});
