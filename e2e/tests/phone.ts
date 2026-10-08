import { devices, expect, type BrowserContext, type Page } from "@playwright/test";
import { signIn, signUp, type Person } from "./helpers";

/**
 * What the phone specs share: an iPhone 14's screen on the project's
 * browser, the way into the sample cabinet, a photograph to upload, and the
 * readings a phone is judged by (the smallest text on the screen, a page no
 * wider than the screen).
 *
 * `E2E_PREVIEW=1` runs the same specs against a preview server that has no
 * sign-in (`MORADA_PREVIEW_EMPTY=1 next start`): the door is skipped and the
 * sample cabinet is chosen by its cookie alone. The checks that need an
 * account (the search corpus) say so and step aside there.
 */
export const PREVIEW = process.env.E2E_PREVIEW === "1";

const iphone = devices["iPhone 14"];
export const phone = { viewport: iphone.viewport, deviceScaleFactor: iphone.deviceScaleFactor, isMobile: iphone.isMobile, hasTouch: iphone.hasTouch, userAgent: iphone.userAgent };

/** Into the sample cabinet, as an owner: signed up on the first call, signed in after. */
export async function enter(page: Page, context: BrowserContext, owner: Person, first: boolean): Promise<void> {
  if (PREVIEW) {
    await page.goto("/app");
  } else if (first) {
    await signUp(page, owner);
  } else {
    await signIn(page, owner.email);
  }
  await context.addCookies([
    { name: "morada_dataset", value: "fr", url: new URL(page.url()).origin },
    { name: "morada_locale", value: "fr", url: new URL(page.url()).origin },
  ]);
}

/** A JPEG the size a phone's camera hands over, drawn in the page so the file is a real image. */
export async function photo(page: Page, hue: number): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
  const dataUrl = await page.evaluate((h) => {
    const c = document.createElement("canvas");
    c.width = 1600;
    c.height = 1200;
    const g = c.getContext("2d")!;
    g.fillStyle = `hsl(${h} 30% 80%)`;
    g.fillRect(0, 0, 1600, 1200);
    for (let i = 0; i < 300; i++) {
      g.fillStyle = `hsl(${(h + i * 7) % 360} 60% ${40 + (i % 30)}%)`;
      g.fillRect((i * 37) % 1600, (i * 53) % 1200, 40, 40);
    }
    return c.toDataURL("image/jpeg", 0.95);
  }, hue);
  return { name: `photo-${hue}.jpg`, mimeType: "image/jpeg", buffer: Buffer.from(dataUrl.split(",")[1], "base64") };
}

/** The smallest text drawn inside the page's main region, in px, with where it sits. */
export async function smallestText(page: Page): Promise<{ px: number; where: string }> {
  return page.evaluate(() => {
    const main = document.querySelector("main") ?? document.body;
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    let px = 99;
    let where = "";
    while (walker.nextNode()) {
      const t = walker.currentNode;
      if (!t.textContent?.trim()) continue;
      const el = t.parentElement;
      if (!el || el.closest("[hidden], .sr-only, thead, script, style")) continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const fs = parseFloat(cs.fontSize);
      if (fs < px) {
        px = fs;
        where = `${el.tagName.toLowerCase()} "${t.textContent.trim().slice(0, 30)}"`;
      }
    }
    return { px, where };
  });
}

/** How far the page runs past the screen's right edge (0 when it fits). */
export async function overflow(page: Page): Promise<number> {
  return page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
}

/** The box of a control, which must exist, in whole CSS pixels (a phone's scale leaves fractions). */
export async function box(locator: ReturnType<Page["locator"]>): Promise<{ x: number; y: number; width: number; height: number }> {
  const b = await locator.boundingBox();
  expect(b, "the control is on the screen").not.toBeNull();
  return { x: Math.round(b!.x), y: Math.round(b!.y), width: Math.round(b!.width), height: Math.round(b!.height) };
}

/** A control's height once its entrance has settled (menus and sheets rise on a spring). */
export async function settledHeight(locator: ReturnType<Page["locator"]>): Promise<number> {
  let height = 0;
  await expect
    .poll(async () => {
      height = (await box(locator)).height;
      return height;
    }, { timeout: 3_000 })
    .toBeGreaterThanOrEqual(44)
    .catch(() => null);
  return height;
}

/** One history entry back, the way a phone's edge swipe does it, and the page settled. */
export async function swipeBack(page: Page): Promise<void> {
  await page.goBack({ waitUntil: "commit" });
  await page.waitForTimeout(400);
}
