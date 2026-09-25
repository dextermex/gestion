import { expect, test } from "@playwright/test";
import { createHouse, daysFromNow, foldGettingStarted, letLot, mail, signIn, signUp } from "./helpers";

/**
 * The register and the books, on the real database. A piece is uploaded
 * from Documents into the workspace's private folder and read back through
 * the signed address its row opens; a kind the bucket refuses is refused; a
 * piece for another workspace's record is not found; the register pages as
 * the address asks. A bill enters the books with its invoice, shows as due,
 * is marked paid, its piece opens from the row and sits in the register; a
 * bill without a readable amount, one on a foreign lot and a payment date
 * in the future are refused. Every row and every file is written and read
 * under the caller's own token, through the same policies as production.
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

const owner = { first: "Claire", last: "Hoffmann", email: mail("owner") };
const tenant = { first: "Tom", last: "Reuter", email: mail("tenant") };
const houseName = `Maison Reuter ${Date.now().toString(36)}`;
const today = new Date().toISOString().slice(0, 10);
/** A file the bucket takes: a minimal PDF, the same bytes every time so the read-back can be compared. */
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n");
const pdf = (name: string) => ({ name, mimeType: "application/pdf", buffer: PDF });
const NOBODY = "00000000-0000-4000-8000-000000000000";
/** An amount as the screens print it, spacing left open: "1 240,00" whatever the thousands separator. */
const printed = (cents: number): RegExp => {
  const whole = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return new RegExp(`${whole},${String(cents % 100).padStart(2, "0")}`);
};

let unitId = "";
let documentId = "";

test("the owner lets a house", async ({ page }) => {
  await signUp(page, owner);
  ({ unitId } = await createHouse(page, houseName));
  await letLot(page, unitId, tenant);
});

test("documents: a piece uploaded from the register, read back through its signed address, the wrong kind and a foreign record refused", async ({ page }) => {
  await signIn(page, owner.email);
  await page.goto("/app/documents");
  await foldGettingStarted(page);
  await page.getByRole("button", { name: "Ajouter un document" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("#document-file").setInputFiles(pdf("quittance-septembre.pdf"));
  // The file's name is offered as the piece's; the owner names it herself.
  await expect(dialog.getByLabel("Nom", { exact: true })).toHaveValue("quittance-septembre.pdf");
  await dialog.getByLabel("Nom", { exact: true }).fill("Quittance septembre");
  await dialog.getByLabel("Classe").selectOption("receipt");
  await dialog.getByLabel("Rattaché à").selectOption({ label: houseName });
  const stored = page.waitForResponse((r) => r.url().endsWith("/api/documents") && r.request().method() === "POST");
  await dialog.getByRole("button", { name: "Téléverser" }).click();
  const res = await stored;
  expect(res.status(), "the piece is stored").toBe(201);
  const body = (await res.json()) as { id: string; name: string; sizeBytes: number; sha256: string };
  documentId = body.id;
  expect(body.name).toBe("Quittance septembre");
  expect(body.sizeBytes).toBe(PDF.length);
  expect(body.sha256).toMatch(/^[0-9a-f]{64}$/);
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: "Document ajouté." })).toBeVisible();
  // The row: the name opens the file, the property it hangs off is named, the class is the one chosen.
  const link = page.locator(`[data-document-file="${documentId}"]`);
  await expect(link).toHaveText("Quittance septembre");
  const row = page.locator("tr").filter({ has: link });
  await expect(row).toContainText(houseName);
  await expect(row).toContainText("Reçu");
  await expect(row).not.toContainText("Référence sans fichier");
  // The file itself, through the signed address the link opens: the bytes that went in.
  const file = await page.request.get(`/api/documents/${documentId}/fichier`);
  expect(file.status(), "the signed address serves the file").toBe(200);
  expect(Buffer.from(await file.body()).equals(PDF), "the same bytes come back").toBe(true);
  // A kind the bucket does not take.
  const refused = await page.request.post("/api/documents", {
    multipart: { file: { name: "script.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") }, class: "other", name: "script" },
  });
  expect(refused.status(), "an executable is refused").toBe(415);
  // A piece for a record that is not this workspace's, and one with no class.
  const foreign = await page.request.post("/api/documents", { multipart: { file: pdf("x.pdf"), class: "other", name: "x", relatedType: "property", relatedId: NOBODY } });
  expect(foreign.status(), "another workspace's record is not found").toBe(404);
  const unclassed = await page.request.post("/api/documents", { multipart: { file: pdf("x.pdf"), class: "poem", name: "x" } });
  expect(unclassed.status()).toBe(400);
  // A piece nobody registered has no file to serve.
  expect((await page.request.get(`/api/documents/${NOBODY}/fichier`, { maxRedirects: 0 })).status()).toBe(404);
});

test("documents: the register pages as the address asks, bounded", async ({ page }) => {
  await signIn(page, owner.email);
  // Two more pieces straight through the door.
  for (const name of ["facture-eau.pdf", "attestation-assurance.pdf"]) {
    const res = await page.request.post("/api/documents", { multipart: { file: pdf(name), class: "invoice", name } });
    expect(res.status(), `${name} is stored`).toBe(201);
  }
  await page.goto("/app/documents?taille=2");
  const nav = page.locator("[data-pagination]");
  await expect(nav).toContainText(/Page 1 sur [2-9]/);
  await expect(page.locator("[data-document-file]")).toHaveCount(2);
  // Newest first: the last two pieces open the register.
  await expect(page.locator("[data-document-file]").first()).toHaveText("attestation-assurance.pdf");
  await nav.getByRole("link", { name: "Suivante" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.locator("[data-pagination]")).toContainText(/Page 2 sur [2-9]/);
  await expect(page.locator("[data-document-file]").first()).toBeVisible();
  // A size or a page the address may not ask for is bounded, never an error: everything on one page.
  await page.goto("/app/documents?taille=0&page=-3");
  await expect(page.locator(`[data-document-file="${documentId}"]`)).toBeVisible();
  await expect(page.locator("[data-document-file]").filter({ hasText: "facture-eau.pdf" })).toBeVisible();
  await expect(page.locator("[data-pagination]")).toHaveCount(0);
});

test("finance: a bill with its invoice enters the books, is due, is marked paid, its piece opens; a bad amount, a foreign lot and a future payment are refused", async ({ page }) => {
  await signIn(page, owner.email);
  await page.goto("/app/finance");
  await foldGettingStarted(page);
  await expect(page.getByText("Aucune facture pour l'instant.")).toBeVisible();
  await page.locator("[data-bill-add]").click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("#bill-file").setInputFiles(pdf("facture-chaudiere.pdf"));
  await expect(dialog).toContainText("facture-chaudiere.pdf");
  await dialog.getByLabel("Objet").fill("Entretien chaudière");
  await dialog.getByLabel("N° de document").fill("F-2026-118");
  await dialog.getByLabel("Date du document").fill(today);
  await dialog.getByLabel("Échéance").fill(daysFromNow(30));
  await dialog.getByLabel("Catégorie").selectOption("maintenance_repairs");
  await dialog.getByLabel("TVA").selectOption("17");
  await dialog.getByLabel("Montant").fill("1240");
  const created = page.waitForResponse((r) => r.url().endsWith("/api/finance/factures") && r.request().method() === "POST");
  await dialog.getByRole("button", { name: "Créer l'écriture" }).click();
  const res = await created;
  expect(res.status(), "the bill is written").toBe(201);
  const bill = (await res.json()) as { id: string; documentId: string | null; amountCents: number; vatCents: number };
  // The total is the amount entered; the VAT inside it is derived once, on the server.
  expect([bill.amountCents, bill.vatCents]).toEqual([124000, 18017]);
  expect(bill.documentId, "the invoice is registered with the bill").not.toBeNull();
  await expect(dialog.getByRole("status").filter({ hasText: "Facture enregistrée." })).toBeVisible();
  await dialog.getByRole("button", { name: "Annuler" }).click();
  await expect(dialog).toBeHidden();

  const row = page.locator(`[data-bill="${bill.id}"]`);
  await expect(row).toContainText("Entretien chaudière");
  await expect(row).toContainText("F-2026-118");
  await expect(row).toContainText(houseName);
  await expect(row).toContainText(printed(124000));
  await expect(row).toContainText(printed(18017));
  await expect(row).toContainText("À payer");
  const openDoc = row.getByRole("link", { name: "Voir la pièce" });
  await expect(openDoc).toHaveAttribute("href", `/api/documents/${bill.documentId}/fichier`);
  const file = await page.request.get(`/api/documents/${bill.documentId}/fichier`);
  expect(file.status(), "the invoice opens through its signed address").toBe(200);

  // Paid today, from the row; the books say so after a reload too.
  const paid = page.waitForResponse((r) => r.url().includes(`/api/finance/factures/${bill.id}`) && r.request().method() === "PATCH");
  await row.locator(`[data-bill-paid="${bill.id}"]`).click();
  expect((await paid).ok(), "the payment date is written").toBe(true);
  await expect(row.getByRole("status")).toContainText("marquée payée");
  await page.reload();
  await expect(page.locator(`[data-bill="${bill.id}"]`)).toContainText("Payée");
  await expect(page.locator(`[data-bill="${bill.id}"] [data-bill-paid]`)).toHaveCount(0);

  // The invoice is in the register, as an invoice, with its file.
  await page.goto("/app/documents");
  const piece = page.locator(`[data-document-file="${bill.documentId}"]`);
  await expect(piece).toHaveText("facture-chaudiere.pdf");
  await expect(page.locator("tr").filter({ has: piece })).toContainText("Facture");

  // What the books refuse: no readable amount, a lot of another workspace, a payment date in the future.
  const bad = await page.request.post("/api/finance/factures", { multipart: { subject: "Sans montant", category: "other_frais", vatRate: "17", amount: "abc", direction: "expense" } });
  expect(bad.status(), "a bill needs an amount").toBe(400);
  expect(((await bad.json()) as { problem: string }).problem).toBe("amount");
  const foreign = await page.request.post("/api/finance/factures", {
    multipart: { subject: "Lot étranger", category: "other_frais", vatRate: "17", amount: "10", direction: "expense", unitId: NOBODY },
  });
  expect(foreign.status(), "a foreign lot is refused").toBe(400);
  const early = await page.request.patch(`/api/finance/factures/${bill.id}`, { data: { paidOn: daysFromNow(3) } });
  expect(early.status(), "a payment cannot be dated in the future").toBe(400);
  expect((await page.request.patch(`/api/finance/factures/${NOBODY}`, { data: { paidOn: today } })).status()).toBe(404);
});
