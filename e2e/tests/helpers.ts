import { expect, type Page } from "@playwright/test";

/**
 * The moves every flow is made of, written once. Each one drives the real
 * screens by their visible French labels (the dictionaries are typed, so a
 * renamed label breaks the suite loudly) and waits for the outcome the
 * database produced, never for a timer.
 */

export const PASSWORD = "E2e-Passw0rd-Morada!";

/** A fresh, unmistakable address per run: the database is real, so nothing may collide. */
export function mail(who: string): string {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return `${who}.${stamp}@e2e.morada.test`;
}

export const isoDate = (d: Date): string => d.toISOString().slice(0, 10);
export const daysFromNow = (n: number): string => isoDate(new Date(Date.now() + n * 86_400_000));

export interface Person {
  first: string;
  last: string;
  email: string;
}

/** Create an account on the door and land where `next` says (the management space by default). */
export async function signUp(page: Page, person: Person, next = "/app"): Promise<void> {
  await page.goto(`/connexion?onglet=inscription&next=${encodeURIComponent(next)}`);
  await leaveSignedInAccountIfAny(page);
  await page.locator("#signup-first-name").fill(person.first);
  await page.locator("#signup-last-name").fill(person.last);
  await page.locator("#signup-email").fill(person.email);
  await page.locator("#signup-password").fill(PASSWORD);
  await page.locator("#signup-form button[type=submit]").click();
  await page.waitForURL((url) => url.pathname.startsWith(next.split("?")[0]), { timeout: 60_000 });
}

/** Sign in on the door, leaving whatever account the browser still holds. */
export async function signIn(page: Page, email: string, next = "/app"): Promise<void> {
  await page.goto(`/connexion?next=${encodeURIComponent(next)}`);
  await leaveSignedInAccountIfAny(page);
  await page.locator("#signin-email").fill(email);
  await page.locator("#signin-password").fill(PASSWORD);
  await page.locator("#signin-form button[type=submit]").click();
  await page.waitForURL((url) => url.pathname.startsWith(next.split("?")[0]), { timeout: 60_000 });
}

/** The door shows a signed-in account as a choice: take the other one. */
export async function leaveSignedInAccountIfAny(page: Page): Promise<void> {
  const card = page.getByTestId("signed-in-card");
  if (await card.isVisible().catch(() => false)) {
    await card.getByRole("button").click();
    await expect(page.locator("#signin-form, #signup-form").first()).toBeVisible();
  }
}

/** Sign out from the management shell, through its account menu (wizard screens have no shell: start from the dashboard). */
export async function signOutFromShell(page: Page): Promise<void> {
  await page.goto("/app");
  await page.getByRole("button", { name: "Mon compte" }).click();
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await page.waitForURL(/\/connexion/, { timeout: 30_000 });
}

/** Sign out from the tenant space. */
export async function signOutFromTenantSpace(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await page.waitForURL(/\/connexion/, { timeout: 30_000 });
}

/** The e-mail the management shell's account menu shows, without leaving the page. */
export async function accountEmailInShell(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Mon compte" }).click();
  const menu = page.locator("text=/@e2e\\.morada\\.test/").first();
  const email = (await menu.textContent())?.trim() ?? "";
  await page.keyboard.press("Escape");
  return email;
}

/**
 * Click "Suivant" until the given control shows up, at most `max` times.
 * Leaving a step saves the dossier first, so the next screen appears only
 * once the server has answered: each click waits for the step's heading to
 * change before looking again, and a step that refuses to be left (a
 * validation the flow did not satisfy) fails here, naming that heading.
 */
export async function nextUntil(page: Page, target: ReturnType<Page["getByRole"]>, max = 10): Promise<void> {
  const next = page.getByRole("button", { name: "Suivant", exact: true }).first();
  // A step handing over to the next can show the control twice for a
  // moment (the old footer and the new one): the first is enough.
  const wanted = target.first();
  for (let i = 0; i < max; i++) {
    await expect(wanted.or(next).first()).toBeVisible();
    if (await wanted.isVisible()) return;
    await nextStep(page, "Suivant");
  }
  await expect(wanted).toBeVisible();
}

/** Press the step's move-on button (by its exact name) and wait for the next step's heading. */
export async function nextStep(page: Page, name: string): Promise<void> {
  const heading = page.getByRole("heading", { level: 1 }).first();
  const before = (await heading.textContent()) ?? "";
  await page.getByRole("button", { name, exact: true }).first().click();
  await expect(heading, `the step "${before}" should hand over to the next one`).not.toHaveText(before, { timeout: 30_000 });
}

/**
 * The property wizard, start to finish, for a standalone house: type, name,
 * address, then straight through to "Créer le bien". Returns the property id
 * and the "add a tenant" lot link the done screen offers.
 */
export async function createHouse(page: Page, name: string): Promise<{ propertyId: string; unitId: string }> {
  await page.goto("/app/biens/nouveau");
  await page.getByRole("button", { name: "Maison individuelle" }).click();
  await page.getByLabel("Nom du bien").fill(name);
  await page.getByRole("button", { name: "Suivant", exact: true }).click();
  await page.getByLabel("Rue").fill("Rue de la Gare");
  await page.getByLabel("N°").fill("12");
  await page.getByLabel("Code postal").fill("L-8001");
  await page.getByLabel("Localité").fill("Strassen");
  await page.getByRole("button", { name: "Suivant", exact: true }).click();
  await nextUntil(page, page.getByRole("button", { name: "Créer le bien" }));
  await page.getByRole("button", { name: "Créer le bien" }).first().click();
  await expect(page.getByText(`${name} a été créé.`)).toBeVisible({ timeout: 30_000 });

  // The done screen's "Ajouter un locataire" carries the lot id; the finish
  // button carries the property id. Both are read from the navigation they
  // trigger, so the ids are the database's, not guessed.
  await page.getByRole("button", { name: "Ajouter un locataire" }).click();
  await page.waitForURL(/\/app\/biens\/locataire\?lot=/);
  const unitId = new URL(page.url()).searchParams.get("lot") ?? "";
  const back = page.getByRole("link", { name: "Retour", exact: true }).first();
  const href = (await back.getAttribute("href")) ?? "";
  const propertyId = href.match(/\/app\/biens\/([^/?#]+)/)?.[1] ?? "";
  expect(unitId, "lot id from the wizard").not.toBe("");
  expect(propertyId, "property id from the wizard").not.toBe("");
  return { propertyId, unitId };
}

/**
 * The rental dossier for a lot, through its nine steps, activated at the
 * end: the tenant's identity, the rent, and "Suivant" on everything the
 * owner may fill in later. Ends on "<tenant> est locataire."
 */
export async function letLot(page: Page, unitId: string, tenant: Person, rent = "1250"): Promise<void> {
  await page.goto(`/app/biens/locataire?lot=${encodeURIComponent(unitId)}`);
  await page.getByLabel("Prénom").first().fill(tenant.first);
  await page.getByLabel("Nom", { exact: true }).first().fill(tenant.last);
  await page.getByLabel("E-mail").first().fill(tenant.email);
  await page.getByRole("button", { name: "Suivant", exact: true }).click(); // tenant → lease
  await page.getByRole("button", { name: "Suivant", exact: true }).click(); // lease → rent
  await page.getByLabel("Loyer hors charges").fill(rent);
  await page.getByLabel("Charges mensuelles").fill("150");
  await nextUntil(page, page.getByRole("button", { name: "Activer la location" }), 8);
  await page.getByRole("button", { name: "Activer la location" }).click();
  // Activation lands on the property's Location tab, where the tenant now
  // appears with the day the tenancy started.
  await page.waitForURL(/\/app\/biens\/[^/?]+\?onglet=location/, { timeout: 30_000 });
  await expect(page.getByText(`${tenant.first} ${tenant.last}`).first()).toBeVisible();
  await expect(page.getByText(/Locataire depuis le/).first()).toBeVisible();
}

/** The lease id, read from the departure link the property's Location tab offers. */
export async function leaseIdOf(page: Page, propertyId: string): Promise<string> {
  await page.goto(`/app/biens/${propertyId}?onglet=location`);
  const link = page.getByRole("link", { name: "Enregistrer le départ du locataire" });
  await expect(link).toBeVisible();
  const href = (await link.getAttribute("href")) ?? "";
  const id = href.match(/bail=([^&]+)/)?.[1] ?? "";
  expect(id, "lease id from the departure link").not.toBe("");
  return decodeURIComponent(id);
}

/**
 * The floating "Bien démarrer" card sits over the bottom-left of a laptop
 * viewport and takes the clicks meant for what lies under it. A person folds
 * it with its own button; so does the flow, once per browser (the choice is
 * remembered), before reaching for anything at the bottom of a page.
 */
export async function foldGettingStarted(page: Page): Promise<void> {
  const card = page.getByRole("region", { name: "Bien démarrer avec Morada Gestion" });
  const fold = card.getByRole("button", { name: "Réduire", exact: true });
  if (await fold.isVisible().catch(() => false)) {
    await fold.click();
    await expect(card).toBeHidden();
  }
}

/** Invite the lease's tenant and read the link the owner is handed (no mail leaves in tests). */
export async function inviteTenant(page: Page, propertyId: string): Promise<{ token: string; link: string }> {
  await page.goto(`/app/biens/${propertyId}?onglet=location`);
  await foldGettingStarted(page);
  await page.getByRole("button", { name: "Inviter le locataire" }).first().click();
  const code = page.locator("code").filter({ hasText: "/invitation/" }).first();
  await expect(code).toBeVisible({ timeout: 30_000 });
  const link = (await code.textContent())?.trim() ?? "";
  const token = link.split("/invitation/")[1]?.split(/[?#]/)[0] ?? "";
  expect(token.length, "invitation token").toBeGreaterThanOrEqual(32);
  return { token, link };
}

/**
 * Safari's way of filling a form: the value appears in the field, no input
 * event reaches the page's scripts.
 */
export async function autofill(page: Page, values: Record<string, string>): Promise<void> {
  await page.evaluate((v) => {
    for (const [selector, value] of Object.entries(v)) {
      const el = document.querySelector<HTMLInputElement>(selector);
      if (el) el.value = value;
    }
  }, values);
}

/** Type key by key into a field and report whether it kept the caret and the whole text. */
export async function typeAndKeepFocus(page: Page, selector: string, text: string): Promise<void> {
  const field = page.locator(selector).first();
  await field.click();
  const before = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 120));
  await page.keyboard.type(text, { delay: 30 });
  const after = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 120));
  expect(after, "the field kept the caret while typing").toBe(before);
  await expect(field).toHaveValue(new RegExp(`${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
}
