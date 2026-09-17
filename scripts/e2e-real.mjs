#!/usr/bin/env node
/**
 * The rental lifecycle on the real path, end to end.
 *
 * Nothing here is faked: a real Supabase session, the app's own API routes
 * (`/api/biens/create`, `/api/locations/create`), and the app's own pages
 * (`/app/biens`, `/app/biens/[id]`) rendered by the server through
 * `getDemo()` → `buildRealData()` → PostgREST under the account's RLS. What
 * the assertions read is the HTML an owner's browser receives, and the last
 * step reloads the page in a real browser.
 *
 * Point it at a disposable Supabase project (a branch), never at production:
 *
 *   E2E_SUPABASE_URL=https://<ref>.supabase.co \
 *   E2E_SUPABASE_ANON_KEY=... \
 *   E2E_EMAIL=owner@example.test E2E_PASSWORD=... \
 *   E2E_BASE=http://127.0.0.1:4321 \
 *   node scripts/e2e-real.mjs
 *
 * The app must have been built and started against the same project
 * (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY at build time).
 * The browser step needs `playwright` installed; it is skipped otherwise.
 */
import { createClient } from "@supabase/supabase-js";

const need = (k) => {
  const v = process.env[k];
  if (!v) {
    console.error(`missing ${k}`);
    process.exit(2);
  }
  return v;
};
const SUPABASE_URL = need("E2E_SUPABASE_URL");
const ANON = need("E2E_SUPABASE_ANON_KEY");
const EMAIL = need("E2E_EMAIL");
const PASSWORD = need("E2E_PASSWORD");
const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:4321";
const STORAGE_KEY = "morada_auth";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures++;
};

// ── 1. A real session, stored exactly as the browser stores it ──
const supabase = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const signIn = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
if (signIn.error || !signIn.data.session) {
  console.error("sign-in failed:", signIn.error?.message);
  process.exit(2);
}
const session = signIn.data.session;
const encoded = "b64." + Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
// The cookie storage splits a session over `<key>.0`, `<key>.1`… past 3000 chars.
const cookies = {};
if (encoded.length <= 3000) cookies[STORAGE_KEY] = encoded;
else for (let i = 0; i * 3000 < encoded.length; i++) cookies[`${STORAGE_KEY}.${i}`] = encoded.slice(i * 3000, (i + 1) * 3000);
cookies.morada_locale = "fr";
const cookieHeader = Object.entries(cookies)
  .map(([k, v]) => `${k}=${v}`)
  .join("; ");

const get = async (path) => {
  const res = await fetch(`${BASE}${path}`, { headers: { cookie: cookieHeader, "cache-control": "no-cache" }, redirect: "manual" });
  const html = await res.text();
  return { status: res.status, text: html.replace(/<!--[^>]*-->/g, "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ") };
};
const post = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { cookie: cookieHeader, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};

// ── 2. The workspace: a first sign-in provisions it, like a real first visit ──
const home = await get("/app");
check("signed-in /app renders", home.status === 200, `(status ${home.status})`);

const stamp = Date.now().toString(36);
const propertyName = `Appartement E2E ${stamp}`;

// ── 3. Create property → Biens shows it, vacant ──
const created = await post("/api/biens/create", {
  type: "apartment",
  name: propertyName,
  street: "rue de la Gare",
  number: "12",
  postal: "1611",
  city: "Luxembourg",
  country: "LU",
  areaSqm: "72",
  rooms: "3",
  bedrooms: "2",
  floor: "2",
});
check("POST /api/biens/create", created.status === 200 && created.json.id, `(status ${created.status})`);
const propertyId = created.json.id;
const unitId = created.json.units?.[0]?.id;
check("property came back with its lot", Boolean(unitId));

let biens = await get("/app/biens");
check("Biens lists the new property", biens.text.includes(propertyName));
check("Biens shows it vacant", new RegExp(`${propertyName}.{0,120}Libre`).test(biens.text));

// ── 4. Add two tenants, create the active lease, set the rent ──
const today = new Date().toISOString().slice(0, 10);
const rental = await post("/api/locations/create", {
  unitId,
  tenants: [
    { firstName: "Anna", lastName: `Weber ${stamp}`, email: `anna.${stamp}@example.test` },
    { firstName: "Luc", lastName: `Weber ${stamp}` },
  ],
  colocation: false,
  type: "residential",
  startDate: today,
  rent: "1 250",
  charges: "150",
  paymentDay: "5",
  depositMonths: 2,
  depositForm: "bank_guarantee",
});
check("POST /api/locations/create", rental.status === 200 && rental.json.leaseId, `(status ${rental.status} ${JSON.stringify(rental.json).slice(0, 120)})`);
check("lease is active", rental.json.status === "active");
check("two tenants were created", rental.json.contactIds?.length === 2);
check("monthly obligation opened", (rental.json.periodsOpened ?? 0) >= 1, `(${rental.json.periodsOpened} periods)`);

// The next due date the page must show, by the ledger's own rule.
const day = "05";
const month = today.slice(0, 7);
const firstDue = `${month}-${day}` < today ? today : `${month}-${day}`;
const [y, m] = month.split("-").map(Number);
const nextMonthDue = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-${day}`;
const expectedNextDue = firstDue >= today ? firstDue : nextMonthDue;
const fr = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" });
const expectedNextDueLabel = fr.format(new Date(`${expectedNextDue}T12:00:00Z`));

// ── 5. Biens again: occupied, both tenants, rent, next due ──
biens = await get("/app/biens");
const card = biens.text.match(new RegExp(`${propertyName}.{0,400}`))?.[0] ?? "";
check("Biens still lists the property", card !== "");
check("Biens shows it occupied", /Occupé/.test(card), `(${card.slice(0, 160)})`);
check("Biens names both tenants", card.includes(`Anna Weber ${stamp}`) && card.includes(`Luc Weber ${stamp}`));
check("Biens shows rent + charges", /1\s?400\s?€\/mois/.test(card), `(${card.match(/[\d\s]+€\/mois/)?.[0]})`);

const sheet = await get(`/app/biens/${propertyId}`);
check("property sheet renders", sheet.status === 200);
check("sheet names both tenants", sheet.text.includes(`Anna Weber ${stamp}`) && sheet.text.includes(`Luc Weber ${stamp}`));
check("sheet shows the monthly total", /1\s?400,00\s?€/.test(sheet.text));
check("sheet shows the next due date", sheet.text.includes(expectedNextDueLabel), `(expected ${expectedNextDueLabel})`);
check("sheet is not late on day one", !/CE MOIS-CI\s+En retard/i.test(sheet.text));

// ── 6. A fresh request on a new connection, then a real browser reload ──
const again = await get("/app/biens");
check("a fresh request still shows the property occupied", new RegExp(`${propertyName}.{0,400}Occupé`).test(again.text));

try {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined });
  const ctx = await browser.newContext();
  const url = new URL(BASE);
  await ctx.addCookies(Object.entries(cookies).map(([name, value]) => ({ name, value, domain: url.hostname, path: "/" })));
  const page = await ctx.newPage();
  await page.goto(`${BASE}/app/biens`, { waitUntil: "networkidle" });
  const before = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  await page.reload({ waitUntil: "networkidle" });
  const after = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  const cardOf = (t) => t.match(new RegExp(`${propertyName}.{0,300}`))?.[0] ?? "";
  check("browser: property occupied with both tenants", /Occupé/.test(cardOf(before)) && cardOf(before).includes("Anna Weber"));
  check("browser: same after a full reload", /Occupé/.test(cardOf(after)) && cardOf(after).includes("Luc Weber") && /1\s?400\s?€\/mois/.test(cardOf(after)));
  await page.goto(`${BASE}/app/biens/${propertyId}`, { waitUntil: "networkidle" });
  await page.reload({ waitUntil: "networkidle" });
  const sheetText = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  check("browser: sheet after reload shows the next due date", sheetText.includes(expectedNextDueLabel));
  await browser.close();
} catch (e) {
  console.log("  skip browser reload step:", String(e).split("\n")[0]);
}

console.log(failures === 0 ? "\nE2E: all checks passed" : `\nE2E: ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
