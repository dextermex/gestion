import { createHash } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { PASSWORD, createHouse, foldGettingStarted, inviteTenant, leaseIdOf, letLot, mail, nextUntil, signIn, signOutFromShell, signUp } from "./helpers";

/**
 * The paper trail, on the real database and the real bucket. Nothing is
 * produced before the workspace validated each template in its language
 * and version and said who the lessor is; the previews open as PDFs. Then
 * every document of a tenancy comes out of its own rows: the formal
 * reminder and the mise en demeure from the ladder, the notice of the
 * month and its receipt once the ledger says paid, the adjustment notice
 * from the letter, the charges statement once issued, the contract and
 * the housing certificate from the lease, the inventory report once
 * photos are attached and the session sealed, the guarantee settlement
 * once the keys are back. Each lands in the register as a sealed PDF with
 * its fingerprint and its relation, opens through its signed address, and
 * is asked for once (a new version is explicit). The tenant reads where to
 * pay and opens the contract of their own lease; a tenant account and
 * another workspace get nothing of it. Every row and file is written and
 * read under the caller's own token, through the same policies as
 * production, and the base's journal records the writes.
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

const owner = { first: "Nora", last: "Kremer", email: mail("owner") };
const tenant = { first: "Yann", last: "Biver", email: mail("tenant") };
const intruder = { first: "Sam", last: "Lorang", email: mail("intruder") };
const houseName = `Maison Biver ${Date.now().toString(36)}`;
const today = new Date().toISOString().slice(0, 10);
const thisYear = Number(today.slice(0, 4));

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

// The tenancy began 25 months ago: twelve past months in the ledger, the
// oldest long overdue, and the 24-month rule allows an adjustment.
const startDate = monthsBack(25);
const MONTHLY = 125000 + 15000;
const IBAN = "LU28 0019 4006 4475 0000";
const KINDS = ["rent_notice", "rent_receipt", "arrears_formal", "arrears_mise_en_demeure", "indexation_notice", "charges_statement", "deposit_settlement", "lease_contract", "housing_certificate", "edl_report"];
/** A picture the bucket takes: a one-pixel PNG. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

let propertyId = "";
let unitId = "";
let leaseId = "";
/** This month's rent period. */
let periodId = "";
let contractId = "";
let sessionId = "";
let token = "";

const arrearsCase = (page: Page, monthIso: string) => page.locator("li").filter({ hasText: "de retard" }).filter({ hasText: monthLabel(monthIso) });
const docControl = (page: Page, kind: string, sourceId: string) => page.locator(`[data-doc-kind="${kind}"][data-doc-source="${sourceId}"]`);

type Produced = { status: number; body: { documentId?: string; name?: string; sha256?: string; existing?: boolean; error?: string; reason?: string; missing?: string[] } };
/** Ask the register for a document from its control; what the route answered. */
async function produce(page: Page, control: Locator, again = false): Promise<Produced> {
  const done = page.waitForResponse((r) => r.url().endsWith("/api/documents/generer") && r.request().method() === "POST");
  await control.getByRole("button", { name: again ? "Nouvelle version" : /Produire/ }).click();
  const res = await done;
  return { status: res.status(), body: (await res.json()) as Produced["body"] };
}
/** The bytes behind a piece, through the signed address the register hands out: a PDF. */
async function fileOf(page: Page, documentId: string): Promise<Buffer> {
  const res = await page.request.get(`/api/documents/${documentId}/fichier`);
  expect(res.status(), `document ${documentId} opens`).toBe(200);
  const body = Buffer.from(await res.body());
  expect(body.subarray(0, 5).toString(), "a PDF comes back").toBe("%PDF-");
  return body;
}

test("the owner lets a house to a tenancy that began two years ago", async ({ page }) => {
  await signUp(page, owner);
  ({ propertyId, unitId } = await createHouse(page, houseName));
  await letLot(page, unitId, tenant, "1250", startDate);
  leaseId = await leaseIdOf(page, propertyId);
});

test("settings: nothing is produced before the templates are validated and the lessor named; previews, validations, the form and the journal", async ({ page }) => {
  await signIn(page, owner.email);
  await page.goto("/app/loyers");
  await foldGettingStarted(page);
  const notice = page.locator('[data-doc-kind="rent_notice"]').first();
  periodId = (await notice.getAttribute("data-doc-source")) ?? "";
  expect(periodId, "this month's period").not.toBe("");
  // The control says why in words, the route in a code.
  const refused = await produce(page, notice);
  expect(refused.status).toBe(409);
  expect(refused.body.error).toBe("template_not_validated");
  await expect(notice.getByRole("alert")).toContainText("Modèle à valider dans Réglages");

  await page.goto("/app/reglages");
  await expect(page.locator("[data-settings-incomplete]")).toBeVisible();
  await expect(page.locator("[data-template]")).toHaveCount(KINDS.length);
  await expect(page.locator('[data-template-status="validated"]')).toHaveCount(0);
  // The preview: the wording with fictitious values, as a PDF; no template in another language, no unknown kind.
  const preview = await page.request.get("/api/documents/modeles/rent_notice?lang=fr");
  expect(preview.status(), "the preview renders").toBe(200);
  expect(preview.headers()["content-type"]).toContain("application/pdf");
  expect(Buffer.from(await preview.body()).subarray(0, 5).toString()).toBe("%PDF-");
  expect((await page.request.get("/api/documents/modeles/rent_notice?lang=en")).status(), "no template is translated on the fly").toBe(404);
  expect((await page.request.get("/api/documents/modeles/poem?lang=fr")).status()).toBe(400);
  // Every template validated, one by one, its row saying so.
  for (const kind of KINDS) {
    const row = page.locator(`[data-template="${kind}"]`);
    const validated = page.waitForResponse((r) => r.url().includes(`/api/documents/modeles/${kind}`) && r.request().method() === "POST");
    await row.getByRole("button", { name: "Valider", exact: true }).click();
    expect((await validated).ok(), `${kind} validated`).toBe(true);
    await expect(row.locator('[data-template-status="validated"]')).toBeVisible();
  }
  // Withdrawn, the template produces nothing again; validated once more, it does.
  const certificate = page.locator('[data-template="housing_certificate"]');
  const withdrawn = page.waitForResponse((r) => r.url().includes("/api/documents/modeles/housing_certificate") && r.request().method() === "DELETE");
  await certificate.getByRole("button", { name: "Retirer", exact: true }).click();
  expect((await withdrawn).ok()).toBe(true);
  await expect(certificate.locator('[data-template-status="pending"]')).toBeVisible();
  expect((await page.request.post("/api/documents/generer", { data: { kind: "housing_certificate", sourceId: leaseId } })).status()).toBe(409);
  const revalidated = page.waitForResponse((r) => r.url().includes("/api/documents/modeles/housing_certificate") && r.request().method() === "POST");
  await certificate.getByRole("button", { name: "Valider", exact: true }).click();
  expect((await revalidated).ok()).toBe(true);
  await expect(certificate.locator('[data-template-status="validated"]')).toBeVisible();
  // Still refused: the lessor has no name, no address, no account.
  const noIdentity = await page.request.post("/api/documents/generer", { data: { kind: "rent_notice", sourceId: periodId } });
  expect(noIdentity.status()).toBe(409);
  expect(await noIdentity.json()).toMatchObject({ error: "settings_incomplete", missing: ["legalName", "address", "payment"] });

  // The form: an IBAN that fails its check is refused by name; the rest is saved and read back.
  const form = page.locator("#settings-form");
  await form.getByLabel("Nom ou raison sociale").fill("Nora Kremer");
  await form.getByLabel("Signataire").fill("Nora Kremer");
  await form.getByLabel("Rue", { exact: true }).fill("Rue de Bonnevoie");
  await form.getByLabel("N°", { exact: true }).fill("24");
  await form.getByLabel("Code postal").fill("1260");
  await form.getByLabel("Localité").fill("Luxembourg");
  await form.getByLabel("E-mail").fill(owner.email);
  await form.getByLabel("IBAN du compte à payer").fill("LU28 0019 4006 4475 0001");
  await form.getByLabel("BIC", { exact: true }).fill("BCEELULL");
  await form.getByLabel("Titulaire du compte (tel qu'à la banque)").fill("Nora Kremer");
  const badIban = page.waitForResponse((r) => r.url().endsWith("/api/reglages") && r.request().method() === "PATCH");
  await form.getByRole("button", { name: "Enregistrer", exact: true }).click();
  expect((await badIban).status(), "a wrong IBAN is refused").toBe(400);
  await expect(form.getByRole("alert")).toContainText("Cet IBAN n'est pas valide.");
  await form.getByLabel("IBAN du compte à payer").fill(IBAN);
  const saved = page.waitForResponse((r) => r.url().endsWith("/api/reglages") && r.request().method() === "PATCH");
  await form.getByRole("button", { name: "Enregistrer", exact: true }).click();
  expect((await saved).ok(), "the settings are written").toBe(true);
  await expect(form.getByRole("status")).toContainText("Réglages enregistrés.");
  await page.reload();
  await expect(page.locator("[data-settings-incomplete]")).toHaveCount(0);
  await expect(page.locator("#settings-form").getByLabel("IBAN du compte à payer")).toHaveValue("LU280019400644750000");
  await expect(page.locator("#settings-form").getByLabel("Nom ou raison sociale")).toHaveValue("Nora Kremer");
  // The base's own journal: the settings and the validations, written by this account.
  await expect(page.locator('[data-journal-entry="workspace_settings"]').first()).toBeVisible();
  await expect(page.locator('[data-journal-entry="template_validations"]').first()).toBeVisible();
  await expect(page.locator("[data-journal]")).toContainText("Nora Kremer");
});

test("arrears: the formal reminder's letter from the ladder's rows, the mise en demeure from the letter's own snapshot, each produced once", async ({ page }) => {
  await signIn(page, owner.email);
  await page.goto("/app/loyers");
  await foldGettingStarted(page);
  const li = arrearsCase(page, monthsBack(3));
  await expect(li).toBeVisible();
  const rentPeriodId = (await li.locator("[data-arrears-actions]").getAttribute("data-arrears-actions")) ?? "";
  expect(rentPeriodId).not.toBe("");
  for (const stage of ["friendly", "formal"]) {
    expect((await page.request.post(`/api/baux/${leaseId}/relances`, { data: { stage, rentPeriodId } })).ok(), `${stage} recorded`).toBe(true);
  }
  await page.reload();
  const formalControl = li.locator('[data-doc-kind="arrears_formal"]');
  await expect(formalControl).toBeVisible();
  const formal = await produce(page, formalControl);
  expect(formal.status, "the formal reminder's letter is produced").toBe(201);
  expect(formal.body.name).toContain("Relance formelle");
  await fileOf(page, formal.body.documentId!);

  const med = await page.request.post(`/api/baux/${leaseId}/relances`, { data: { stage: "mise_en_demeure", rentPeriodId } });
  expect(med.ok(), "the mise en demeure is recorded with its letter").toBe(true);
  const { letterId } = (await med.json()) as { letterId: string };
  expect(letterId).toBeTruthy();
  await page.reload();
  const medControl = docControl(page, "arrears_mise_en_demeure", letterId);
  await expect(medControl).toBeVisible();
  const letter = await produce(page, medControl);
  expect(letter.status, "the mise en demeure is produced").toBe(201);
  expect(letter.body.name).toContain("Mise en demeure");
  await fileOf(page, letter.body.documentId!);
  // Asked again for the same letter: the same document, not another.
  const same = await page.request.post("/api/documents/generer", { data: { kind: "arrears_mise_en_demeure", sourceId: letterId } });
  expect(same.status()).toBe(200);
  expect(((await same.json()) as { documentId: string; existing: boolean })).toMatchObject({ documentId: letter.body.documentId, existing: true });
  await page.reload();
  await expect(docControl(page, "arrears_mise_en_demeure", letterId).locator(`[data-doc-open="${letter.body.documentId}"]`)).toBeVisible();
});

test("rents: the notice of the month, a new version beside the first, the receipt only once the ledger says paid", async ({ page }) => {
  await signIn(page, owner.email);
  await page.goto("/app/loyers");
  await foldGettingStarted(page);
  const first = await produce(page, docControl(page, "rent_notice", periodId));
  expect(first.status, "the notice is produced").toBe(201);
  const noticeId = first.body.documentId!;
  expect(first.body.name).toMatch(/^Avis d'échéance · .+ · \d{4}-\d{2}\.pdf$/);
  expect(first.body.sha256).toMatch(/^[0-9a-f]{64}$/);
  await expect(docControl(page, "rent_notice", periodId).getByRole("status")).toContainText("Document produit");
  // The register's fingerprint is the file's.
  const bytes = await fileOf(page, noticeId);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(first.body.sha256);
  await page.reload();
  await expect(docControl(page, "rent_notice", periodId).locator(`[data-doc-open="${noticeId}"]`)).toBeVisible();
  const again = await produce(page, docControl(page, "rent_notice", periodId), true);
  expect(again.status, "a new version is another document").toBe(201);
  expect(again.body.documentId).not.toBe(noticeId);
  await fileOf(page, noticeId);

  // No receipt while the period is open: not offered, and refused with its reason.
  await expect(docControl(page, "rent_receipt", periodId)).toHaveCount(0);
  const early = await page.request.post("/api/documents/generer", { data: { kind: "rent_receipt", sourceId: periodId } });
  expect(early.status()).toBe(409);
  expect(await early.json()).toMatchObject({ error: "not_ready", reason: "unpaid" });
  // One transfer for the ledger's twelve open months up to this one, allocated oldest first.
  const paid = await page.request.post("/api/paiements/create", { data: { leaseId, amount: String((12 * MONTHLY) / 100), receivedOn: today } });
  expect(paid.ok(), "the payment is recorded").toBe(true);
  expect(await paid.json()).toMatchObject({ allocated: 12 * MONTHLY, credit: 0 });
  await page.reload();
  await expect(page.locator("tr").filter({ has: docControl(page, "rent_notice", periodId) })).toContainText("Payé");
  const receipt = await produce(page, docControl(page, "rent_receipt", periodId));
  expect(receipt.status, "the receipt is produced").toBe(201);
  expect(receipt.body.name).toContain("Quittance");
  await fileOf(page, receipt.body.documentId!);
});

test("indexation: the notice comes from the adjustment letter, once it went out", async ({ page }) => {
  await signIn(page, owner.email);
  await page.goto("/app/indexation");
  await foldGettingStarted(page);
  const row = page.locator(`[data-indexation-lease="${leaseId}"]`);
  await expect(row).toContainText("Capital investi non déclaré");
  await expect(row.locator('[data-doc-kind="indexation_notice"]')).toHaveCount(0);
  await row.getByRole("button", { name: "Déclarer le capital investi" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Année").fill("2015");
  await dialog.getByLabel("Montant").fill("400000");
  await dialog.getByLabel("Nature").selectOption("construction");
  const saved = page.waitForResponse((r) => r.url().includes(`/api/baux/${leaseId}`) && r.request().method() === "PATCH");
  await dialog.getByRole("button", { name: "Enregistrer", exact: true }).click();
  expect((await saved).ok()).toBe(true);
  await expect(dialog).toBeHidden();
  await page.reload();
  const sent = page.waitForResponse((r) => r.url().includes("/indexation/courrier") && r.request().method() === "POST");
  await row.getByRole("button", { name: "Envoyer le courrier d'ajustement" }).click();
  const letterRes = await sent;
  expect(letterRes.ok(), "the letter is written").toBe(true);
  const { id: letterId } = (await letterRes.json()) as { id: string };
  await page.reload();
  const notice = await produce(page, docControl(page, "indexation_notice", letterId));
  expect(notice.status, "the notice is produced from the letter").toBe(201);
  expect(notice.body.name).toContain("Notice d'ajustement");
  await fileOf(page, notice.body.documentId!);
});

test("charges: the statement once the décompte is issued, never for a draft", async ({ page }) => {
  await signIn(page, owner.email);
  const created = await page.request.post("/api/charges/periodes", {
    data: {
      leaseId,
      year: thisYear - 1,
      lines: [
        { label: "Chauffage collectif", category: "heating", lotShare: "600" },
        { label: "Honoraires du syndic", category: "management_fee", lotShare: "300" },
      ],
    },
  });
  expect(created.ok(), "the draft is written").toBe(true);
  const { id } = (await created.json()) as { id: string };
  await page.goto(`/app/charges?periode=${id}`);
  await foldGettingStarted(page);
  await expect(page.locator(`[data-charge-period="${id}"]`)).toContainText("Brouillon");
  await expect(docControl(page, "charges_statement", id)).toHaveCount(0);
  expect((await page.request.post(`/api/charges/periodes/${id}/emettre`, { data: {} })).ok(), "the décompte is issued").toBe(true);
  await page.reload();
  const statement = await produce(page, docControl(page, "charges_statement", id));
  expect(statement.status, "the statement is produced").toBe(201);
  expect(statement.body.name).toContain("Décompte des charges");
  await fileOf(page, statement.body.documentId!);
});

test("the lease sheet: the contract and the housing certificate from the lease's rows, listed with their fingerprints", async ({ page }) => {
  await signIn(page, owner.email);
  await page.goto(`/app/baux/${leaseId}?onglet=contrat`);
  await foldGettingStarted(page);
  const contract = await produce(page, docControl(page, "lease_contract", leaseId));
  expect(contract.status, "the contract is produced").toBe(201);
  contractId = contract.body.documentId!;
  expect(contract.body.name).toContain("Contrat de bail");
  const certificate = await produce(page, docControl(page, "housing_certificate", leaseId));
  expect(certificate.status, "the certificate is produced").toBe(201);
  expect(certificate.body.name).toContain("Attestation");
  await fileOf(page, contractId);
  await fileOf(page, certificate.body.documentId!);
  await page.reload();
  const row = page.locator(`[data-lease-document="${contractId}"]`);
  await expect(row).toContainText("Contrat de bail");
  await expect(row).toContainText("Empreinte SHA-256");
  await expect(row).toContainText("Scellé");
  await expect(docControl(page, "lease_contract", leaseId).locator(`[data-doc-open="${contractId}"]`)).toBeVisible();
});

test("the inventory: a photo on an item, the session sealed with its manifest, the report produced from the sealed rows; nothing more after the seal", async ({ page }) => {
  await signIn(page, owner.email);
  await page.goto(`/app/biens/etat-des-lieux?bail=${leaseId}&type=entry`);
  await page.getByRole("button", { name: "Suivant", exact: true }).click();
  const paint = page.locator("li").filter({ hasText: "Murs et peintures" }).first();
  await paint.getByRole("button", { name: "Bon", exact: true }).click();
  await paint.locator('[data-photo-input="paint"]').setInputFiles({ name: "mur.png", mimeType: "image/png", buffer: PNG });
  await expect(paint.locator('[data-photo-count="paint"]')).toContainText("1 photo");
  await nextUntil(page, page.getByRole("button", { name: "Enregistrer l'état des lieux" }), 12);
  await page.getByLabel("Signé par les deux parties").check();
  const saved = page.waitForResponse((r) => r.url().endsWith("/api/edl") && r.request().method() === "POST");
  const photo = page.waitForResponse((r) => r.url().includes("/photos") && r.request().method() === "POST");
  const sealed = page.waitForResponse((r) => r.url().includes("/sceller") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Enregistrer l'état des lieux" }).click();
  const sres = await saved;
  expect(sres.ok(), "the inventory is written").toBe(true);
  const session = (await sres.json()) as { id: string; status: string; items: number; itemRows: Array<{ id: string; room: string; category: string }> };
  sessionId = session.id;
  expect(session.status).toBe("signed");
  expect(session.itemRows.length, "the items come back with their ids").toBe(session.items);
  expect((await photo).status(), "the photo is stored against its item").toBe(201);
  const seal = (await (await sealed).json()) as { ok: boolean; sha256: string; report: { documentId: string; name: string } | null; reportError: string | null };
  expect(seal.ok).toBe(true);
  expect(seal.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(seal.reportError).toBeNull();
  expect(seal.report, "the report is produced at the seal").not.toBeNull();
  await expect(page.locator("[data-edl-sealed]")).toContainText(seal.sha256);
  await expect(page.locator(`[data-edl-report-link="${seal.report!.documentId}"]`)).toBeVisible();
  await fileOf(page, seal.report!.documentId);
  // Sealed: no second seal, no more pictures.
  expect((await page.request.post(`/api/edl/${sessionId}/sceller`)).status()).toBe(409);
  const late = await page.request.post(`/api/edl/${sessionId}/photos`, { multipart: { file: { name: "tard.png", mimeType: "image/png", buffer: PNG }, itemId: session.itemRows[0].id } });
  expect(late.status(), "a sealed inventory takes no more pictures").toBe(409);
  // Listed as sealed, with its report, from the list and from the sheet.
  await page.goto("/app/edl");
  const listed = page.locator("tr").filter({ has: page.locator(`[data-edl-report="${sessionId}"]`) });
  await expect(listed).toContainText("Scellé SHA-256");
  await expect(listed).toContainText("1 photo");
  await page.goto(`/app/baux/${leaseId}?onglet=edl`);
  await expect(page.locator(`[data-edl-report="${sessionId}"]`)).toBeVisible();
});

test("the register lists what was produced, by kind and fingerprint; the journal records it", async ({ page }) => {
  await signIn(page, owner.email);
  await page.goto("/app/documents");
  expect(await page.locator("[data-document-sha]").count(), "every produced document carries its fingerprint").toBeGreaterThanOrEqual(10);
  const row = page.locator("tr").filter({ has: page.locator(`[data-document-file="${contractId}"]`) });
  await expect(row).toContainText("Contrat de bail");
  await expect(row).toContainText("Empreinte SHA-256");
  await expect(row).toContainText(houseName);
  await expect(row).toContainText("Bail");
  await page.goto("/app/reglages");
  await expect(page.locator('[data-journal-entry="documents"]').first()).toBeVisible();
  await expect(page.locator('[data-journal-entry="edl_sessions"]').first()).toBeVisible();
  await expect(page.locator('[data-journal-entry="edl_media"]').first()).toBeVisible();
  await expect(page.locator('[data-journal-entry="registered_letters"]').first()).toBeVisible();
});

test("the tenant reads where to pay and opens the contract and the receipt of their own lease; the desk's routes stay closed", async ({ page }) => {
  await signIn(page, owner.email);
  ({ token } = await inviteTenant(page, propertyId));
  await signOutFromShell(page);
  await page.goto(`/invitation/${token}`);
  await page.getByRole("link", { name: "Créer mon compte" }).click();
  await expect(page.locator("#signup-email")).toHaveValue(tenant.email);
  await page.locator("#signup-first-name").fill(tenant.first);
  await page.locator("#signup-last-name").fill(tenant.last);
  await page.locator("#signup-password").fill(PASSWORD);
  await page.locator("#signup-form button[type=submit]").click();
  await page.waitForURL(/\/locataire/, { timeout: 90_000 });

  await page.goto("/locataire/paiements");
  await expect(page.locator("[data-pay-instructions]")).toContainText("Nora Kremer");
  await expect(page.locator("[data-pay-iban]")).toContainText(IBAN);
  // This month's receipt is the tenant's to download (the décompte issued since
  // carried its balance onto the month, so the month itself may read partial again).
  const month = page.locator("tr").filter({ hasText: monthLabel(today) }).first();
  const download = month.getByRole("link", { name: "Télécharger" });
  await expect(download).toBeVisible();
  const receipt = await page.request.get((await download.getAttribute("href")) ?? "");
  expect(receipt.status(), "the tenant opens the receipt through its signed address").toBe(200);
  expect(Buffer.from(await receipt.body()).subarray(0, 5).toString()).toBe("%PDF-");

  await page.goto("/locataire/bail");
  const contract = page.locator("li").filter({ hasText: "Contrat de bail" }).first();
  await expect(contract).toBeVisible();
  const open = contract.getByRole("link", { name: "Ouvrir" });
  await expect(open).toBeVisible();
  const file = await page.request.get((await open.getAttribute("href")) ?? "");
  expect(file.status(), "the tenant opens the contract through its signed address").toBe(200);
  expect(Buffer.from(await file.body()).subarray(0, 5).toString()).toBe("%PDF-");
  // A tenant account holds no key to the desk's side.
  expect([401, 403, 404]).toContain((await page.request.post("/api/documents/generer", { data: { kind: "rent_notice", sourceId: periodId } })).status());
  expect([401, 403, 404]).toContain((await page.request.get(`/api/documents/${contractId}/fichier`, { maxRedirects: 0 })).status());
  expect([401, 403, 404]).toContain((await page.request.patch("/api/reglages", { data: { legalName: "X" } })).status());
});

test("the guarantee: its settlement once the keys are back; another workspace finds none of it", async ({ page }) => {
  await signIn(page, owner.email);
  await page.goto("/app/garanties");
  await foldGettingStarted(page);
  const held = page.locator("li[data-deposit]").filter({ hasText: houseName });
  const received = page.waitForResponse((r) => r.url().includes("/api/garanties/") && r.request().method() === "PATCH");
  await held.getByRole("button", { name: "Enregistrer la réception" }).click();
  expect((await received).ok(), "the receipt of the guarantee is written").toBe(true);
  const depositId = (await held.getAttribute("data-deposit")) ?? "";
  expect(depositId).not.toBe("");
  const early = await page.request.post("/api/documents/generer", { data: { kind: "deposit_settlement", sourceId: depositId } });
  expect(early.status(), "no settlement while the keys are out").toBe(409);
  expect(await early.json()).toMatchObject({ error: "not_ready", reason: "keys_out" });
  const closed = await page.request.post(`/api/baux/${leaseId}/cloture`, { data: { endDate: today, keysReturned: true, keysReturnedOn: today, depositOutcome: "release_pending" } });
  expect(closed.ok(), "the tenancy is closed with the keys back").toBe(true);
  await page.goto("/app/garanties");
  await foldGettingStarted(page);
  const settlement = await produce(page, docControl(page, "deposit_settlement", depositId));
  expect(settlement.status, "the settlement is produced").toBe(201);
  expect(settlement.body.name).toContain("garantie");
  await fileOf(page, settlement.body.documentId!);

  // Another workspace, its own templates validated: the first one's records are not found, its files not served.
  // (The owner signs out first: the door offers the sign-up form to nobody in particular, not to a signed-in account.)
  await signOutFromShell(page);
  await signUp(page, intruder);
  for (const kind of ["lease_contract", "deposit_settlement"]) {
    expect((await page.request.post(`/api/documents/modeles/${kind}`, { data: { lang: "fr" } })).ok(), `${kind} validated by the other workspace`).toBe(true);
  }
  const foreign = await page.request.post("/api/documents/generer", { data: { kind: "lease_contract", sourceId: leaseId } });
  expect(foreign.status(), "another workspace's lease is not found").toBe(404);
  expect((await page.request.get(`/api/documents/${contractId}/fichier`, { maxRedirects: 0 })).status()).toBe(404);
  expect((await page.request.post(`/api/edl/${sessionId}/sceller`)).status()).toBe(404);
  expect((await page.request.post(`/api/documents/generer`, { data: { kind: "deposit_settlement", sourceId: depositId } })).status()).toBe(404);
  await page.goto("/app/documents");
  await expect(page.locator("[data-document-file]")).toHaveCount(0);
});
