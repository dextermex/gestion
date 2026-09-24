import { expect, test, type Page } from "@playwright/test";
import { createHouse, foldGettingStarted, leaseIdOf, letLot, mail, signIn, signUp } from "./helpers";

/**
 * Money, on the real database. A cabinet without a bank feed imports the
 * statement its bank exports: the line carrying the tenancy's RF reference
 * matches by itself, a debit is set aside, an unknown payer waits in the
 * review queue. The desk assigns that one to the tenancy and has the
 * payer's IBAN remembered; the next statement's transfer from the same
 * payer then matches on its own. On Loyers, the arrears ladder is recorded
 * step by step for a period that has been open for months, the AR date is
 * what carries legal effect, and the justice-de-paix file is refused until
 * that date is there. Every row is written and read back through the same
 * policies production uses.
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

const owner = { first: "Léa", last: "Thoma", email: mail("owner") };
const tenant = { first: "Paul", last: "Faber", email: mail("tenant") };
const houseName = `Maison Faber ${Date.now().toString(36)}`;
const payerIban = "LU550030001111222233";

/** A day of the month n months back, as ISO (UTC, the day the app also counts in). */
function monthsBack(n: number, day = 1): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - n);
  d.setUTCDate(day);
  return d.toISOString().slice(0, 10);
}
/** The month as Loyers prints it: "Juin 2026". */
function monthLabel(iso: string): string {
  const s = new Date(`${iso}T00:00:00`).toLocaleDateString("fr-LU", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
/** Day-first dates in the file, the way a bank writes them. */
const frDate = (iso: string): string => iso.split("-").reverse().join("/");
const statement = (lines: string[]): string => ["Date;Montant;Contrepartie;IBAN;Communication", ...lines].join("\n");

// The tenancy began five months ago: five past months in the ledger, the oldest ones long overdue.
const startDate = monthsBack(5);
let propertyId = "";
let unitId = "";
let leaseId = "";
let rf = "";

/** Import a statement from the Banque page; returns what the server said landed. */
async function importStatement(page: Page, csv: string, newAccount?: { label: string; iban: string; holder: string }): Promise<Record<string, number>> {
  await page.getByRole("button", { name: "Importer un relevé (CSV)" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  if (newAccount) {
    await dialog.locator("#bank-import-account").selectOption("");
    await dialog.locator("#bank-import-label").fill(newAccount.label);
    await dialog.locator("#bank-import-iban").fill(newAccount.iban);
    await dialog.locator("#bank-import-holder").fill(newAccount.holder);
  }
  await dialog.locator("#bank-import-file").setInputFiles({ name: "releve.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") });
  const imported = page.waitForResponse((r) => r.url().includes("/api/banque/import") && r.request().method() === "POST");
  await dialog.getByRole("button", { name: "Importer", exact: true }).click();
  const res = await imported;
  expect(res.ok(), "the statement is accepted").toBe(true);
  const body = (await res.json()) as Record<string, number>;
  await expect(dialog.getByRole("status")).toContainText("opérations importées");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.reload();
  return body;
}

const txRow = (page: Page, text: string) => page.getByRole("table").getByRole("row").filter({ hasText: text });
/** The period's card on the arrears ladder: the only list items that say how late a month is. */
const arrearsCase = (page: Page, monthIso: string) => page.locator("li").filter({ hasText: "de retard" }).filter({ hasText: monthLabel(monthIso) });

test("the owner lets a house to a tenancy that began five months ago", async ({ page }) => {
  await signUp(page, owner);
  ({ propertyId, unitId } = await createHouse(page, houseName));
  await letLot(page, unitId, tenant, "1250", startDate);
  leaseId = await leaseIdOf(page, propertyId);
  // The tenancy's permanent RF reference, printed on Loyers for the avis.
  await page.goto("/app/loyers");
  rf = ((await page.locator("code").filter({ hasText: /^RF\d{2}/ }).first().textContent()) ?? "").trim();
  expect(rf, "the lease's RF reference").toMatch(/^RF\d{2}/);
  // Five months in, the oldest periods are on the arrears ladder.
  await expect(arrearsCase(page, monthsBack(5))).toBeVisible();
  await expect(arrearsCase(page, monthsBack(3))).toBeVisible();
});

test("a statement imported by hand: the RF line matches itself, a debit is set aside, the unknown payer waits for review", async ({ page }) => {
  await signIn(page, owner.email);
  await page.goto("/app/banque");
  await foldGettingStarted(page);
  // No bank feed: the honest empty rail, and the import as the way in.
  await expect(page.getByText("Aucun compte bancaire relié")).toBeVisible();
  const csv = statement([
    `${frDate(monthsBack(5, 3))};1400,00;PAUL FABER;LU120010001234567891;${rf} loyer`,
    `${frDate(monthsBack(4, 3))};700,00;CNAP AIDE AU LOGEMENT;${payerIban};Aide logement Faber`,
    `${frDate(monthsBack(4, 5))};-89,90;CREOS;LU980000000000000000;Facture electricite`,
  ]);
  const first = await importStatement(page, csv, { label: "Compte de gérance", iban: "LU28 0019 4006 4475 0000", holder: "LEA THOMA GESTION" });
  expect(first).toMatchObject({ imported: 3, skipped: 0, auto: 1, review: 1, ignored: 1 });
  // The rail carries the account; the workspace, one verdict per line.
  await expect(page.getByText("Compte de gérance")).toBeVisible();
  await expect(txRow(page, "PAUL FABER")).toContainText("Auto");
  await expect(txRow(page, "PAUL FABER")).toContainText("RF");
  await expect(txRow(page, "CNAP")).toContainText("À vérifier");
  await expect(txRow(page, "CREOS")).toContainText("Ignorée");
  // The oldest month is paid: it has left the arrears ladder.
  await page.goto("/app/loyers");
  await expect(arrearsCase(page, monthsBack(5))).toHaveCount(0);
  await expect(arrearsCase(page, monthsBack(4))).toBeVisible();
  // The same file again lands nothing new.
  await page.goto("/app/banque");
  const again = await importStatement(page, csv);
  expect(again).toMatchObject({ imported: 0, skipped: 3 });
  await expect(txRow(page, "CNAP")).toHaveCount(1);
});

test("the review queue's decision becomes a payment, and the payer's IBAN a binding the next statement uses", async ({ page }) => {
  await signIn(page, owner.email);
  await page.goto("/app/banque");
  await foldGettingStarted(page);
  const row = page.locator("[data-operation]").filter({ hasText: "CNAP" });
  await expect(row).toBeVisible();
  // The tenancy is offered; the IBAN will be remembered.
  await expect(row.getByRole("combobox")).toHaveValue(/.+/);
  await expect(row.getByRole("checkbox")).toBeChecked();
  const patched = page.waitForResponse((r) => r.url().includes("/api/banque/operations/") && r.request().method() === "PATCH");
  await row.getByRole("button", { name: "Rapprocher", exact: true }).click();
  expect((await patched).ok(), "the decision is written").toBe(true);
  await expect(row.getByRole("status")).toContainText("Rapproché");
  await expect(row.getByRole("status")).toContainText("IBAN mémorisé");
  // Written, not played: a fresh read says Manuel, and the ledger shows the partial month.
  await page.reload();
  await expect(txRow(page, "CNAP")).toContainText("Manuel");
  await expect(page.locator("[data-operation]")).toHaveCount(0);
  await page.goto("/app/loyers");
  await expect(arrearsCase(page, monthsBack(4))).toContainText(/700,00\s?€ ouverts/);
  // The next statement: the same payer, the rest of that month. The binding matches it alone.
  await page.goto("/app/banque");
  const second = await importStatement(page, statement([`${frDate(monthsBack(3, 3))};700,00;CNAP AIDE AU LOGEMENT;${payerIban};Aide logement Faber`]));
  expect(second).toMatchObject({ imported: 1, auto: 1, review: 0 });
  await expect(txRow(page, "CNAP").filter({ hasText: "Auto" })).toContainText("IBAN lié");
  await page.goto("/app/loyers");
  await expect(arrearsCase(page, monthsBack(4))).toHaveCount(0);
  await expect(arrearsCase(page, monthsBack(3))).toBeVisible();
});

test("the arrears ladder is recorded step by step; the AR carries legal effect and gates the justice file", async ({ page }) => {
  await signIn(page, owner.email);
  await page.goto("/app/loyers");
  await foldGettingStarted(page);
  const m3 = monthsBack(3);
  const li = arrearsCase(page, m3);
  await expect(li).toBeVisible();
  const rentPeriodId = (await li.locator("[data-arrears-actions]").getAttribute("data-arrears-actions")) ?? "";
  expect(rentPeriodId).not.toBe("");
  const recorded = () => page.waitForResponse((r) => r.url().includes("/relances") && r.request().method() === "POST");

  // Friendly, then formal: each recorded on a date, each read back as history.
  for (const stage of ["Relance amiable", "Relance formelle"]) {
    const res = recorded();
    await li.getByRole("button", { name: "Enregistrer la relance" }).click();
    expect((await res).ok(), `${stage} is recorded`).toBe(true);
    await expect(li.getByRole("status")).toContainText(`${stage} enregistrée le`);
    await page.reload();
    await expect(li.locator("dl")).toContainText(stage);
  }
  // The mise en demeure: sent by registered letter today, then waiting for its AR.
  const med = recorded();
  await li.getByRole("button", { name: "Confirmer la mise en demeure" }).click();
  expect((await med).ok(), "the mise en demeure is recorded").toBe(true);
  await expect(li.getByRole("status")).toContainText("Mise en demeure enregistrée");
  await page.reload();
  await expect(li).toContainText("en attente de l'accusé de réception");
  await expect(li.locator("dl")).toContainText("Mise en demeure");
  // The justice file is refused until the AR is in hand: the law's order, checked server-side too.
  const early = await page.request.post(`/api/baux/${leaseId}/relances`, { data: { stage: "justice_dossier", rentPeriodId } });
  expect(early.status(), "no justice file before the AR").toBe(409);
  expect((await early.json()).error).toBe("needs_ar");
  const twice = await page.request.post(`/api/baux/${leaseId}/relances`, { data: { stage: "friendly", rentPeriodId } });
  expect(twice.status(), "a step is never recorded twice").toBe(409);
  // The AR comes back today: legal effect runs from that date, and the file can be put together.
  const ar = page.waitForResponse((r) => r.url().includes("/api/lettres/") && r.request().method() === "PATCH");
  await li.getByRole("button", { name: "Enregistrer l'AR" }).click();
  expect((await ar).ok(), "the AR date is written").toBe(true);
  await expect(li.getByRole("status")).toContainText("AR reçu le");
  await page.reload();
  await expect(li.locator("dl")).toContainText("AR reçu le");
  await expect(li).toContainText("Mise en demeure");
  const justice = recorded();
  await li.getByRole("button", { name: "Consigner le dossier justice de paix" }).click();
  expect((await justice).ok(), "the justice file is recorded once the AR is there").toBe(true);
  await page.reload();
  await expect(li.locator("dl")).toContainText("Dossier justice");
  await expect(li.locator("[data-arrears-actions]")).toHaveCount(0);
});
