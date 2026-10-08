#!/usr/bin/env node
/**
 * The app's icons, drawn from the logo's own glyph (GestionLogo: the
 * brand-700 tile, the white house, the accent dot), so the home screen shows
 * exactly the mark the app's bar shows. Run from the repository root after
 * a logo change:
 *
 *   node scripts/app-icons.mjs
 *
 * It renders the SVGs below in Playwright's Chromium (a devDependency; set
 * PLAYWRIGHT_CHROMIUM_EXECUTABLE to use a preinstalled one) and writes:
 *
 *   src/app/icon.svg          the browser tab (Next links it from every page)
 *   src/app/favicon.ico       the same at 16, 32 and 48px, for older browsers
 *   src/app/apple-icon.png    180px, full bleed: iOS rounds the corners itself
 *   public/icons/icon-192.png, icon-512.png   the tile, for the manifest
 *   public/icons/maskable-512.png             full bleed, the house inside
 *                                             the circle Android may crop to
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const BRAND = "#10505c"; // brand-700, the logo's tile
const ACCENT = "#e8613c"; // accent-500, the logo's dot
const HOUSE = "M8 22.5V13.4c0-.5.24-.98.65-1.27l6.44-4.6a1.6 1.6 0 0 1 1.86 0l6.4 4.6c.4.3.65.77.65 1.27v9.1";
const glyph = `<path d="${HOUSE}" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="16" cy="17.4" r="2.1" fill="${ACCENT}"/>`;

/** The logo's tile as the app bar draws it: rounded, the corners transparent. */
const tile = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="1" y="1" width="30" height="30" rx="9" fill="${BRAND}"/>${glyph}</svg>`;
/** The tile's square with no rounding: the platform masks it. */
const bleed = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="1 1 30 30"><rect x="1" y="1" width="30" height="30" fill="${BRAND}"/>${glyph}</svg>`;
/** Full bleed, the house at 80% so it stays inside a launcher's circular crop. */
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="1 1 30 30"><rect x="1" y="1" width="30" height="30" fill="${BRAND}"/><g transform="translate(16 16) scale(0.8) translate(-16 -16)">${glyph}</g></svg>`;

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
// One roomy viewport, each icon clipped from its corner: a 16px window is below what a browser will draw.
const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 600, height: 600 } });

async function png(svg, size) {
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${size}" height="${size}" style="display:block" `)}</body></html>`);
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

/** An .ico holding PNG images (the format every browser since IE Vista reads). */
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, i) => {
    const at = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, at);
    header.writeUInt8(size >= 256 ? 0 : size, at + 1);
    header.writeUInt8(0, at + 2);
    header.writeUInt8(0, at + 3);
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(data.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((i) => i.data)]);
}

mkdirSync("public/icons", { recursive: true });
writeFileSync("src/app/icon.svg", `${tile}\n`);
// One page renders them all: one size after the other.
const favicons = [];
for (const size of [16, 32, 48]) favicons.push({ size, data: await png(tile, size) });
writeFileSync("src/app/favicon.ico", ico(favicons));
writeFileSync("src/app/apple-icon.png", await png(bleed, 180));
writeFileSync("public/icons/icon-192.png", await png(tile, 192));
writeFileSync("public/icons/icon-512.png", await png(tile, 512));
writeFileSync("public/icons/maskable-512.png", await png(maskable, 512));
await browser.close();
console.log("icons written: src/app/icon.svg, favicon.ico, apple-icon.png; public/icons/*.png");
