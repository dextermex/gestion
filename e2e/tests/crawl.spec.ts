import { expect, test, type Page } from "@playwright/test";
import { createAccountFromInvitation, createHouse, inviteTenant, letLot, mail, signIn, signOutFromShell, signUp } from "./helpers";

/**
 * Every page a landlord and a tenant can reach by following links, on the
 * real database, in a workspace that holds one tenancy: none answers 404 or
 * 5xx, none shows the error screen, none is left on a spinner, and no link
 * is without a destination. The crawl starts from every section of each
 * space and follows what the pages themselves offer, so a link added
 * tomorrow is covered without touching this file.
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(900_000);

const owner = { first: "Camille", last: "Reding", email: mail("owner") };
const tenant = { first: "Luc", last: "Thill", email: mail("tenant") };
const houseName = `Maison Thill ${Date.now().toString(36)}`;

let propertyId = "";
let unitId = "";
let token = "";

const MANAGER_SEEDS = [
  "/app", "/app/biens", "/app/biens/nouveau", "/app/baux", "/app/loyers", "/app/finance", "/app/banque", "/app/charges", "/app/rapports",
  "/app/fiscalite", "/app/emprunts", "/app/acquisitions", "/app/financement/simulateur", "/app/interventions", "/app/workflows", "/app/messages",
  "/app/messages?onglet=demandes", "/app/contacts", "/app/documents", "/app/contrats", "/app/edl", "/app/garanties", "/app/indexation",
  "/app/assurances", "/app/compteurs", "/app/calculateurs", "/app/conformite", "/app/aml", "/app/reglages", "/app/utilisateurs",
  "/app/integrations", "/app/abonnement", "/app/compte",
];
const TENANT_SEEDS = ["/locataire", "/locataire/bail", "/locataire/paiements", "/locataire/demandes", "/locataire/messages", "/locataire/documents", "/locataire/profil", "/locataire/parametres", "/locataire/aide"];

interface Visit {
  path: string;
  status: number;
  problems: string[];
}

/** Breadth-first over the links of one space; file and export links are fetched as a click would. */
async function crawl(page: Page, seeds: string[], scope: RegExp, max: number): Promise<{ visits: Visit[]; files: Array<{ href: string; status: number; from: string }> }> {
  const origin = new URL(page.url()).origin;
  const queue = [...seeds];
  const seen = new Set(queue);
  const perPath = new Map<string, number>();
  const visits: Visit[] = [];
  const fileLinks = new Map<string, string>();
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  while (queue.length > 0 && visits.length < max) {
    const path = queue.shift() as string;
    pageErrors.length = 0;
    const problems: string[] = [];
    const res = await page.goto(path, { waitUntil: "domcontentloaded" });
    const status = res?.status() ?? 0;
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => null);
    if (status >= 400) problems.push(`answers ${status}`);
    const landed = new URL(page.url());
    if (landed.pathname.startsWith("/connexion")) problems.push("sent to the sign-in door");
    const read = await page.evaluate(() => {
      const visible = (el: Element) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
      };
      const links = Array.from(document.querySelectorAll("a")).map((a) => ({ href: a.getAttribute("href"), text: (a.getAttribute("aria-label") || a.textContent || "").trim().slice(0, 50), visible: visible(a) }));
      return {
        errorScreen: Boolean(document.querySelector('[role="alert"].ui-empty')),
        main: Boolean(document.querySelector("main")),
        mainText: (document.querySelector("main")?.textContent ?? "").trim().length,
        // The wizards draw their step over the page, outside <main>: a visible heading is content too.
        heading: Array.from(document.querySelectorAll("h1")).some((h) => visible(h) && (h.textContent ?? "").trim().length > 0),
        busy: Array.from(document.querySelectorAll('[aria-busy="true"]')).filter(visible).length,
        links,
      };
    });
    if (read.errorScreen) problems.push("shows the error screen");
    if (status < 400 && !landed.pathname.startsWith("/connexion") && !read.heading && (!read.main || read.mainText < 20)) problems.push("renders nothing");
    if (read.busy > 0) {
      // Something still says it is loading once the network is quiet: give it a moment, then call it stuck.
      await page.waitForTimeout(4_000);
      const still = await page.evaluate(() => Array.from(document.querySelectorAll('[aria-busy="true"]')).filter((el) => el.getBoundingClientRect().height > 0).length);
      if (still > 0) problems.push("is still loading after the network went quiet");
    }
    for (const l of read.links) {
      if (!l.visible) continue;
      if (l.href === null || l.href === "" || l.href === "#") {
        problems.push(`has a link with no destination ("${l.text}")`);
        continue;
      }
      if (/^(mailto:|tel:|sms:|blob:|data:)/.test(l.href) || l.href.startsWith("#")) continue;
      let url: URL;
      try {
        url = new URL(l.href, landed);
      } catch {
        problems.push(`has a malformed link ("${l.href}")`);
        continue;
      }
      if (url.origin !== origin) continue;
      const target = url.pathname + url.search;
      if (url.pathname.startsWith("/api/")) {
        if (!fileLinks.has(target)) fileLinks.set(target, path);
        continue;
      }
      if (!scope.test(url.pathname) || seen.has(target)) continue;
      const n = perPath.get(url.pathname) ?? 0;
      if (url.search && n >= 5) continue;
      perPath.set(url.pathname, n + 1);
      seen.add(target);
      queue.push(target);
    }
    if (pageErrors.length > 0) problems.push(`raises a script error (${pageErrors[0].slice(0, 120)})`);
    visits.push({ path, status, problems });
  }

  const files: Array<{ href: string; status: number; from: string }> = [];
  for (const [href, from] of fileLinks) {
    // Session-changing and provider routes are not files: a link to one is followed by a person, not here.
    if (/\/api\/(abonnement|banking|signature|cron)\b/.test(href)) continue;
    const r = await page.request.get(href, { maxRedirects: 0 });
    files.push({ href, status: r.status(), from });
  }
  return { visits, files };
}

function report(visits: Visit[]): string {
  return visits.filter((v) => v.problems.length > 0).map((v) => `${v.path}: ${v.problems.join("; ")}`).join("\n");
}

test("set up: a house, a tenancy in force, the tenant invited and signed up", async ({ page }) => {
  await signUp(page, owner);
  ({ propertyId, unitId } = await createHouse(page, houseName));
  await letLot(page, unitId, tenant);
  ({ token } = await inviteTenant(page, propertyId));
  await signOutFromShell(page);
  await page.goto(`/invitation/${token}`);
  await createAccountFromInvitation(page, tenant, token);
  await page.waitForURL(/\/locataire/, { timeout: 90_000 });
  await expect(page.getByText(houseName).first()).toBeVisible();
});

test("every page the landlord can reach opens, with nothing broken on it", async ({ page }) => {
  await signIn(page, owner.email);
  const { visits, files } = await crawl(page, [...MANAGER_SEEDS, `/app/biens/${propertyId}`], /^\/app(\/|$)/, 220);
  await test.info().attach("manager-pages.txt", { body: visits.map((v) => `${v.status} ${v.path}`).join("\n"), contentType: "text/plain" });
  expect(visits.length, "the crawl went beyond its seeds").toBeGreaterThan(MANAGER_SEEDS.length);
  expect(report(visits), "pages with a problem").toBe("");
  expect(files.filter((f) => f.status >= 400).map((f) => `${f.status} ${f.href} (linked from ${f.from})`).join("\n"), "file and export links that fail").toBe("");
});

test("every page the tenant can reach opens, with nothing broken on it", async ({ page }) => {
  await signIn(page, tenant.email, "/locataire");
  const { visits, files } = await crawl(page, TENANT_SEEDS, /^\/locataire(\/|$)/, 80);
  await test.info().attach("tenant-pages.txt", { body: visits.map((v) => `${v.status} ${v.path}`).join("\n"), contentType: "text/plain" });
  expect(report(visits), "pages with a problem").toBe("");
  expect(files.filter((f) => f.status >= 400).map((f) => `${f.status} ${f.href} (linked from ${f.from})`).join("\n"), "file and export links that fail").toBe("");
});

test("an address that does not exist says so inside each space, with a way back", async ({ page }) => {
  await signIn(page, owner.email);
  for (const path of ["/app/nulle-part", "/app/biens/00000000-0000-0000-0000-000000000000", "/app/baux/00000000-0000-0000-0000-000000000000", "/app/contacts/00000000-0000-0000-0000-000000000000"]) {
    const res = await page.goto(path);
    expect(res?.status(), `${path} answers 404`).toBe(404);
    // The application's own screen: its navigation is still there and it offers a way on.
    await expect(page.getByRole("navigation", { name: "Morada Gestion" }).first(), `${path} keeps the navigation`).toBeAttached();
    await expect(page.locator("main a[href='/app']").first(), `${path} offers the way home`).toBeVisible();
  }
});
