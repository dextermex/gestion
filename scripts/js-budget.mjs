#!/usr/bin/env node
/**
 * The JavaScript a phone downloads before the first screen of the app can
 * be used, measured on the build that just ran: the chunks the root layout
 * and the management layout load, compressed as the CDN serves them. The
 * build fails when the figure grows past the budget, so a dependency that
 * lands in the shared bundle is noticed on the pull request, not on a phone.
 *
 *   node scripts/js-budget.mjs            (after `next build`)
 *   JS_BUDGET_KB=280 node scripts/js-budget.mjs
 */
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const BUDGET_KB = Number(process.env.JS_BUDGET_KB || 240);
const manifest = JSON.parse(readFileSync(".next/app-build-manifest.json", "utf8"));
const layouts = ["/layout", "/app/layout"];
const files = new Set();
for (const key of layouts) for (const f of manifest.pages[key] ?? []) if (f.endsWith(".js")) files.add(f);
if (files.size === 0) {
  console.error("js-budget: no layout chunks in .next/app-build-manifest.json; run `next build` first");
  process.exit(2);
}
let gz = 0;
const rows = [];
for (const f of files) {
  const buf = readFileSync(`.next/${f}`);
  const g = gzipSync(buf).length;
  gz += g;
  rows.push([f, buf.length, g]);
}
rows.sort((a, b) => b[2] - a[2]);
for (const [f, r, g] of rows) console.log(`${String(Math.round(g / 1024)).padStart(5)} KB gz  ${String(Math.round(r / 1024)).padStart(5)} KB  ${f}`);
const kb = Math.round(gz / 1024);
console.log(`shared first-load JavaScript (${layouts.join(" + ")}): ${kb} KB gzipped, budget ${BUDGET_KB} KB`);
if (kb > BUDGET_KB) {
  console.error(`js-budget: ${kb} KB is over the ${BUDGET_KB} KB budget`);
  process.exit(1);
}
