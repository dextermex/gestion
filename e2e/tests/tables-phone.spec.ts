import { expect, test, type Page } from "@playwright/test";
import { mail } from "./helpers";
import { box, enter, overflow, phone, smallestText } from "./phone";

/**
 * The tables on a phone. The ones whose rows carry actions or a handful of
 * facts are stacks of cards: the heading row read by assistive technology
 * only, each cell captioned with its column, the row's action a full-width
 * button a thumb can hit, nothing to scroll sideways for. The ledgers keep
 * their columns, fewer of them, and fit the screen. Nothing on the manager's
 * screens is drawn under 12px.
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);
test.use(phone);

const owner = { first: "Lily", last: "Schmit", email: mail("owner") };

const STACKED: Array<[string, string, string | null]> = [
  ["loyers", "/app/loyers", "Avis d'échéance"],
  ["indexation", "/app/indexation", null],
  ["interventions", "/app/interventions", "Ouvrir"],
  ["baux", "/app/baux", null],
  ["edl", "/app/edl", null],
  ["compteurs", "/app/compteurs", null],
  ["workflows", "/app/workflows", null],
  ["finance", "/app/finance", "Marquer payée"],
];
const FOLDED: Array<[string, string]> = [
  ["charges", "/app/charges"],
  ["assurances", "/app/assurances"],
  ["reglages", "/app/reglages"],
  ["paiements", "/locataire/paiements"],
];

async function stackReading(page: Page) {
  return page.evaluate(() => {
    const wrap = document.querySelector(".table-stack");
    if (!wrap) return null;
    const thead = wrap.querySelector("thead")!;
    const row = wrap.querySelector("tbody tr")!;
    const cells = [...row.querySelectorAll("td")];
    const captions = cells.map((td) => {
      const content = getComputedStyle(td, "::before").content;
      return { label: td.getAttribute("data-label"), caption: content && content !== "none" && content !== "normal" ? content.replace(/^"|"$/g, "") : null };
    });
    return {
      theadOut: getComputedStyle(thead).position === "absolute" && thead.getBoundingClientRect().width <= 1,
      rowDisplay: getComputedStyle(row).display,
      captions,
      rowWidth: Math.round(row.getBoundingClientRect().width),
      wrapScrolls: wrap.scrollWidth > wrap.clientWidth + 1,
    };
  });
}

test("every table of facts and actions is a stack of captioned cards", async ({ page, context }) => {
  await enter(page, context, owner, true);
  for (const [name, route, action] of STACKED) {
    await test.step(name, async () => {
      await page.goto(route);
      await expect(page.locator(".table-stack tbody tr").first()).toBeVisible();
      const r = (await stackReading(page))!;
      expect(r, `${name}: the table stacks`).not.toBeNull();
      expect.soft(r.theadOut, `${name}: the heading row is read by assistive technology only`).toBe(true);
      expect.soft(r.rowDisplay, `${name}: a row is a card`).toBe("flex");
      expect.soft(r.wrapScrolls, `${name}: nothing scrolls sideways`).toBe(false);
      expect.soft(await overflow(page), `${name}: the page fits the screen`).toBeLessThanOrEqual(0);
      for (const c of r.captions) if (c.label) expect.soft(c.caption, `${name}: a cell carries its column as a caption`).toBe(c.label);
      if (action) {
        const button = page.locator(".table-stack tbody tr").first().getByRole("button", { name: action }).or(page.locator(".table-stack tbody tr").first().getByRole("link", { name: action })).first();
        await expect(button, `${name}: the row's action is on the screen`).toBeVisible();
        const b = await box(button);
        expect.soft(b.height, `${name}: the action is a thumb's size`).toBeGreaterThanOrEqual(44);
        expect.soft(b.x + b.width, `${name}: the action is within the screen`).toBeLessThanOrEqual(phone.viewport.width);
      }
      const small = await smallestText(page);
      expect.soft(small.px, `${name}: nothing under 12px (${small.where})`).toBeGreaterThanOrEqual(12);
      await test.info().attach(`stack-${name}`, { body: await page.screenshot(), contentType: "image/png" });
    });
  }
});

test("the ledgers keep their columns, fewer of them, and fit the screen", async ({ page, context }) => {
  await enter(page, context, owner, false);
  for (const [name, route] of FOLDED) {
    await test.step(name, async () => {
      await page.goto(route);
      const wrap = page.locator(".table-fold").first();
      await expect(wrap).toBeVisible();
      const r = await wrap.evaluate((w) => {
        const t = w.querySelector("table")!;
        return {
          scrolls: w.scrollWidth > w.clientWidth + 1,
          hidden: [...t.querySelectorAll("thead th")].filter((th) => getComputedStyle(th).display === "none").length,
          shown: [...t.querySelectorAll("thead th")].filter((th) => getComputedStyle(th).display !== "none").length,
          folded: [...(t.querySelector("tbody tr")?.querySelectorAll("[class*='sm:hidden']") ?? [])].filter((e) => !/max-sm/.test(e.className) && getComputedStyle(e).display !== "none").length,
        };
      });
      expect.soft(r.scrolls, `${name}: nothing scrolls sideways`).toBe(false);
      expect.soft(r.hidden, `${name}: a secondary column is folded away`).toBeGreaterThanOrEqual(1);
      expect.soft(r.shown, `${name}: the key columns stay`).toBeGreaterThanOrEqual(2);
      expect.soft(r.folded, `${name}: the folded value shows in the first cell`).toBeGreaterThanOrEqual(1);
      expect.soft(await overflow(page), `${name}: the page fits the screen`).toBeLessThanOrEqual(0);
      await test.info().attach(`fold-${name}`, { body: await page.screenshot(), contentType: "image/png" });
    });
  }
});
