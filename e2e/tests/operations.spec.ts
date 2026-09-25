import { expect, test, type Page } from "@playwright/test";
import { createHouse, foldGettingStarted, leaseIdOf, letLot, mail, signIn, signUp } from "./helpers";

/**
 * The operations of a tenancy, on the real database. A house let two years
 * ago: the capital investi is declared on the lease, the engine proposes
 * the adjustment, the letter goes out by registered post, the adjustment
 * is refused until the AR is in hand and applies from the month after it.
 * A charges décompte is entered line by line, a residential hard block
 * reaches the tenant as zero, and issuing it carries the balance onto this
 * month's rent. An intervention walks its ladder from the sheet, the
 * ticket following, out-of-order steps refused. The guarantee is received,
 * the tenancy ends with the keys back, retentions are recorded (damage
 * without an entry inventory retains nothing), one is justified, the first
 * tranche and then the balance leave for the engine's amounts, the balance
 * refused before the décompte. Every row is written and read back through
 * the same policies production uses.
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

const owner = { first: "Marc", last: "Wagner", email: mail("owner") };
const tenant = { first: "Lena", last: "Schmit", email: mail("tenant") };
const houseName = `Maison Schmit ${Date.now().toString(36)}`;

/** A day of the month n months back, as ISO (UTC, the day the app also counts in). */
function monthsBack(n: number, day = 1): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - n);
  d.setUTCDate(day);
  return d.toISOString().slice(0, 10);
}
/** The first day of the month after `iso`: the month a rent adjustment applies from. */
function monthAfter(iso: string): string {
  const [y, m] = iso.slice(0, 7).split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}
/** An amount as the screens print it, spacing left open: "1 375,00" whatever the thousands separator. */
const printed = (cents: number): RegExp => {
  const whole = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return new RegExp(`${whole},${String(cents % 100).padStart(2, "0")}`);
};

const today = new Date().toISOString().slice(0, 10);
const thisYear = Number(today.slice(0, 4));
// The tenancy began 25 months ago: the 24-month rule allows an adjustment.
const startDate = monthsBack(25);
const RENT = 125000;
const DEPOSIT = 2 * RENT;
let propertyId = "";
let unitId = "";
let leaseId = "";

const dialogOf = (page: Page) => page.getByRole("dialog");
/** A piece the bucket takes: a minimal PDF. */
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n");
const pdf = (name: string) => ({ name, mimeType: "application/pdf", buffer: PDF });

test("the owner lets a house to a tenancy that began two years ago", async ({ page }) => {
  await signUp(page, owner);
  ({ propertyId, unitId } = await createHouse(page, houseName));
  await letLot(page, unitId, tenant, "1250", startDate);
  leaseId = await leaseIdOf(page, propertyId);
});

test("indexation: capital declared, the letter sent, the AR back, the adjustment applied from the month after it", async ({ page }) => {
  await signIn(page, owner.email);
  await page.goto("/app/indexation");
  const row = page.locator(`[data-indexation-lease="${leaseId}"]`);
  await expect(row).toContainText("Capital investi non déclaré");
  // Without the declaration the engine has no ceiling: refused.
  expect((await page.request.post(`/api/baux/${leaseId}/indexation`)).status()).toBe(409);

  await row.getByRole("button", { name: "Déclarer le capital investi" }).click();
  const dialog = dialogOf(page);
  await dialog.getByLabel("Année").fill("2015");
  await dialog.getByLabel("Montant").fill("400000");
  await dialog.getByLabel("Nature").selectOption("construction");
  const saved = page.waitForResponse((r) => r.url().includes(`/api/baux/${leaseId}`) && r.request().method() === "PATCH");
  await dialog.getByRole("button", { name: "Enregistrer", exact: true }).click();
  expect((await saved).ok(), "the capital investi is written").toBe(true);
  await expect(dialog).toBeHidden();
  await page.reload();
  // +10 % step, well under the 5 % ceiling of a 400 000 € construction.
  await expect(row).toContainText("Possible, borné à +10 %");
  await expect(row).toContainText(printed(137500));

  // The adjustment needs its letter, then the letter's AR.
  let refused = await page.request.post(`/api/baux/${leaseId}/indexation`);
  expect(refused.status()).toBe(409);
  expect((await refused.json()).error).toBe("needs_letter");
  const sent = page.waitForResponse((r) => r.url().includes("/indexation/courrier") && r.request().method() === "POST");
  await row.getByRole("button", { name: "Envoyer le courrier d'ajustement" }).click();
  expect((await sent).ok(), "the letter is written").toBe(true);
  await expect(row.getByRole("status")).toContainText("Courrier d'ajustement enregistré");
  await page.reload();
  await expect(row).toContainText("en attente de l'accusé de réception");
  refused = await page.request.post(`/api/baux/${leaseId}/indexation`);
  expect((await refused.json()).error).toBe("needs_ar");
  expect((await page.request.post(`/api/baux/${leaseId}/indexation/courrier`, { data: {} })).status(), "one letter in flight per lease").toBe(409);

  const ar = page.waitForResponse((r) => r.url().includes("/api/lettres/") && r.request().method() === "PATCH");
  await row.getByRole("button", { name: "Enregistrer l'AR" }).click();
  expect((await ar).ok(), "the AR date is written").toBe(true);
  await page.reload();
  const apply = row.getByRole("button", { name: /Appliquer l'ajustement dès/ });
  await expect(apply).toBeVisible();
  const applied = page.waitForResponse((r) => /\/api\/baux\/[^/]+\/indexation$/.test(r.url()) && r.request().method() === "POST");
  await apply.click();
  const res = await applied;
  expect(res.ok(), "the adjustment is applied").toBe(true);
  const body = (await res.json()) as { newRentCents: number; effectiveFrom: string };
  expect(body.newRentCents).toBe(137500);
  expect(body.effectiveFrom, "effect runs from the month after the AR, never from the click").toBe(monthAfter(today));
  await page.reload();
  await expect(row).toContainText("dernier ajustement");
  await expect(row.locator("td").nth(1)).toContainText(printed(137500));
  // The letter is spent: applying again needs a new one.
  expect((await page.request.post(`/api/baux/${leaseId}/indexation`)).status()).toBe(409);
});

test("charges: a décompte entered, its blocked line at zero, issued and carried onto this month's rent", async ({ page }) => {
  await signIn(page, owner.email);
  await page.goto("/app/charges");
  await expect(page.getByText("Aucun décompte pour l'instant.")).toBeVisible();
  await page.getByRole("button", { name: "Nouveau décompte" }).click();
  const dialog = dialogOf(page);
  await dialog.getByLabel("Année").fill(String(thisYear));
  const line0 = dialog.locator("[data-charge-line='0']");
  await line0.getByLabel("Poste").fill("Chauffage collectif");
  await line0.getByLabel("Catégorie").selectOption("heating");
  await line0.getByLabel("Total immeuble").fill("60000");
  await line0.getByLabel("Millièmes du lot").fill("100");
  await line0.getByLabel("Total millièmes").fill("1000");
  await dialog.getByRole("button", { name: "Ajouter un poste" }).click();
  const line1 = dialog.locator("[data-charge-line='1']");
  await line1.getByLabel("Poste").fill("Honoraires du syndic");
  await line1.getByLabel("Catégorie").selectOption("management_fee");
  await line1.getByLabel("Quote-part lot").fill("300");
  const saved = page.waitForResponse((r) => r.url().endsWith("/api/charges/periodes") && r.request().method() === "POST");
  await dialog.getByRole("button", { name: "Enregistrer le brouillon" }).click();
  const res = await saved;
  expect(res.ok(), "the draft is written").toBe(true);
  const created = (await res.json()) as { id: string; actualCents: number; blockedCents: number; advancesBilledCents: number; balanceCents: number };
  expect(created.actualCents, "6 000 € of heating reach the tenant, the management fee does not").toBe(600000);
  expect(created.blockedCents).toBe(30000);
  await expect(dialog).toBeHidden();

  await page.goto(`/app/charges?periode=${created.id}`);
  const item = page.locator(`[data-charge-period="${created.id}"]`);
  await expect(item).toContainText("Brouillon");
  await expect(page.getByText("Frais de gérance — Jamais")).toBeVisible();
  await expect(page.getByText(printed(created.advancesBilledCents)).first()).toBeVisible();

  const issued = page.waitForResponse((r) => r.url().includes(`/api/charges/periodes/${created.id}/emettre`));
  await item.getByRole("button", { name: "Émettre", exact: true }).click();
  const ires = await issued;
  expect(ires.ok(), "the décompte is issued").toBe(true);
  const ibody = (await ires.json()) as { balanceCents: number; carriedTo: string | null };
  expect(ibody.balanceCents).toBe(600000 - created.advancesBilledCents);
  expect(ibody.carriedTo, "the balance lands on this month's rent").toBe(today.slice(0, 7));
  await expect(item.getByRole("status")).toContainText("Décompte émis le");
  await page.reload();
  await expect(item).toContainText("Émis");
  // Issued once; one per lease and year; an issued décompte is not discarded.
  expect((await page.request.post(`/api/charges/periodes/${created.id}/emettre`, { data: {} })).status()).toBe(409);
  expect((await page.request.post("/api/charges/periodes", { data: { leaseId, year: thisYear, lines: [{ label: "Eau", category: "water", lotShare: "10" }] } })).status()).toBe(409);
  expect((await page.request.delete(`/api/charges/periodes/${created.id}`)).status()).toBe(409);
});

test("interventions: a work order walks its ladder from the sheet, the ticket following", async ({ page }) => {
  await signIn(page, owner.email);
  const artisan = await page.request.post("/api/contacts/create", { data: { name: "Jos Kirsch", kind: "natural", role: "artisan" } });
  expect(artisan.ok()).toBe(true);
  const ticket = await page.request.post("/api/tickets/create", { data: { unitId, title: "Chaudière en panne" } });
  expect(ticket.ok()).toBe(true);
  const ticketId = ((await ticket.json()) as { id: string }).id;

  await page.goto("/app/interventions");
  const row = page.getByRole("row").filter({ hasText: "Chaudière en panne" });
  await expect(row).toContainText("Nouveau");
  await row.getByRole("button", { name: "Ouvrir", exact: true }).click();
  const dialog = dialogOf(page);
  await expect(dialog).toContainText("Pas encore d'ordre de travail.");
  const created = page.waitForResponse((r) => r.url().includes(`/api/demandes/${ticketId}/intervention`));
  await dialog.getByRole("button", { name: "Créer l'ordre de travail" }).click();
  const cres = await created;
  expect(cres.ok(), "the work order is written").toBe(true);
  const workOrderId = ((await cres.json()) as { id: string }).id;
  // Out of order: refused, nothing moves.
  const early = await page.request.patch(`/api/interventions/${workOrderId}`, { data: { action: "paid" } });
  expect(early.status()).toBe(409);
  expect((await early.json()).error).toBe("refused");

  await page.reload();
  await row.getByRole("button", { name: "Ouvrir", exact: true }).click();
  await expect(dialog).toContainText("Proposée");
  const step = async (name: string) => {
    const done = page.waitForResponse((r) => r.url().includes(`/api/interventions/${workOrderId}`) && r.request().method() === "PATCH");
    await dialog.getByRole("button", { name, exact: true }).click();
    expect((await done).ok(), `${name} is written`).toBe(true);
    await expect(dialog.getByRole("status")).toContainText("Enregistré.");
  };
  await dialog.getByLabel("Artisan").selectOption({ label: "Jos Kirsch" });
  await step("Confier à l'artisan");
  await expect(dialog.getByRole("button", { name: "Planifier", exact: true })).toBeVisible();
  await step("Planifier");
  await expect(dialog.getByRole("button", { name: "Travaux terminés", exact: true })).toBeVisible();
  await step("Travaux terminés");
  await dialog.getByLabel("Montant HT").fill("480");
  await dialog.getByLabel("TVA").fill("81,60");
  // The artisan's invoice is the piece: uploaded with the step, registered against the work order.
  await dialog.locator("#invoice-file").setInputFiles(pdf("facture-kirsch.pdf"));
  await expect(dialog).toContainText("Facture jointe : facture-kirsch.pdf");
  const invoiceStored = page.waitForResponse((r) => r.url().endsWith("/api/documents") && r.request().method() === "POST");
  await step("Enregistrer la facture");
  expect((await invoiceStored).status(), "the invoice is stored").toBe(201);
  await expect(dialog.getByRole("button", { name: "Facture payée", exact: true })).toBeVisible();
  await step("Facture payée");
  await expect(dialog).toContainText("Payée");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(row, "the ticket followed the work order to its close").toContainText("Clôturé");
  // The invoice sits in the register, with its file.
  await page.goto("/app/documents");
  await expect(page.locator("[data-document-file]").filter({ hasText: "facture-kirsch.pdf" })).toBeVisible();
});

test("guarantees: received, the tenancy closed, retentions, a justification, the décompte, the two tranches", async ({ page }) => {
  await signIn(page, owner.email);
  await page.goto("/app/garanties");
  // The floating "Bien démarrer" card sits over the bottom-left of a laptop viewport, where the settlement's actions land.
  await foldGettingStarted(page);
  const held = page.locator("li[data-deposit]").filter({ hasText: houseName });
  await expect(held).toContainText("En attente");
  await expect(held).toContainText(printed(DEPOSIT));
  const received = page.waitForResponse((r) => r.url().includes("/api/garanties/") && r.request().method() === "PATCH");
  await held.getByRole("button", { name: "Enregistrer la réception" }).click();
  expect((await received).ok(), "the receipt is written").toBe(true);
  await page.reload();
  await expect(held).toContainText("Détenue");
  const depositId = (await held.getAttribute("data-deposit")) ?? "";
  expect(depositId).not.toBe("");
  // A retention has no restitution to land on while the keys are not back.
  expect((await page.request.post(`/api/garanties/${depositId}/retenues`, { data: { kind: "arrears", label: "Trop tôt", amount: "10" } })).status()).toBe(409);

  // The tenancy ends today, keys back: the restitution opens.
  const closed = await page.request.post(`/api/baux/${leaseId}/cloture`, { data: { endDate: today, keysReturned: true, keysReturnedOn: today, depositOutcome: "release_pending" } });
  expect(closed.ok()).toBe(true);
  await page.goto("/app/garanties");
  const actions = page.locator(`[data-deposit-actions="${depositId}"]`);
  await expect(actions).toBeVisible();
  const early = await page.request.post(`/api/garanties/${depositId}/liberation`, { data: { tranche: "balance" } });
  expect(early.status(), "the balance waits for the décompte").toBe(409);
  expect((await early.json()).error).toBe("needs_decompte");

  const addRetention = async (kind: string, label: string, amount: string) => {
    await actions.getByRole("button", { name: "Ajouter une retenue" }).click();
    await actions.getByLabel("Nature").selectOption(kind);
    await actions.getByLabel("Libellé").fill(label);
    await actions.getByLabel("Montant").fill(amount);
    const added = page.waitForResponse((r) => r.url().endsWith("/retenues") && r.request().method() === "POST");
    await actions.getByRole("button", { name: "Ajouter la retenue" }).click();
    const res = await added;
    expect(res.ok(), `${label} is written`).toBe(true);
    return (await res.json()) as { id: string; status: string };
  };
  // Damage without a signed entry inventory: recorded, retains nothing.
  const damage = await addRetention("damage", "Porte rayée", "240");
  expect(damage.status).toBe("blocked_no_entry_edl");
  await expect(actions.getByRole("status")).toContainText("Sans EDL d'entrée");
  await page.reload();
  const damageLine = page.locator("li").filter({ hasText: "Porte rayée" }).first();
  await expect(damageLine).toContainText("Bloquée : pas d'EDL d'entrée");
  await expect(damageLine).toContainText(printed(0));
  // Arrears: pending until justified by a piece within the month.
  const arrears = await addRetention("arrears", "Loyer impayé", "300");
  expect(arrears.status).toBe("pending");
  await page.reload();
  const arrearsLine = page.locator("li").filter({ hasText: "Loyer impayé" }).first();
  await expect(arrearsLine).toContainText("Justificatif attendu");
  await arrearsLine.getByRole("button", { name: "Justifier" }).click();
  // The justification is a piece: the file goes to the register against this very line, then the line is dated.
  await arrearsLine.getByLabel("Pièce (PDF ou image)").setInputFiles(pdf("decompte-loyers.pdf"));
  await arrearsLine.getByLabel("Pièce (facture ou devis)").fill("Décompte de loyers");
  const pieceStored = page.waitForResponse((r) => r.url().endsWith("/api/documents") && r.request().method() === "POST");
  const justified = page.waitForResponse((r) => r.url().includes(`/retenues/${arrears.id}`) && r.request().method() === "PATCH");
  await arrearsLine.getByRole("button", { name: "Justifier" }).click();
  const piece = (await (await pieceStored).json()) as { id: string };
  expect((await justified).ok(), "the justification is written").toBe(true);
  await page.reload();
  await expect(arrearsLine).toContainText("Justifiée");
  // Once, and never without its piece.
  expect((await page.request.patch(`/api/garanties/${depositId}/retenues/${arrears.id}`, { data: { justifiedOn: today, documentId: piece.id } })).status(), "justified once").toBe(409);
  expect((await page.request.patch(`/api/garanties/${depositId}/retenues/${arrears.id}`, { data: { justifiedOn: today } })).status(), "a justification needs its piece").toBe(400);
  expect((await page.request.patch(`/api/garanties/${depositId}/retenues/${arrears.id}`, { data: { justifiedOn: today, documentId: "00000000-0000-4000-8000-000000000000" } })).status(), "a piece that is not this line's is refused").toBe(400);

  // First tranche: half the guarantee, the retention permitting.
  const first = page.waitForResponse((r) => r.url().includes("/liberation") && r.request().method() === "POST");
  await actions.getByRole("button", { name: /Verser la 1re tranche/ }).click();
  const fres = await first;
  expect(fres.ok(), "the first tranche is written").toBe(true);
  expect(((await fres.json()) as { amountCents: number }).amountCents).toBe(Math.min(DEPOSIT / 2, DEPOSIT - 30000));
  await page.reload();
  await expect(page.getByText("Partiellement restituée").first()).toBeVisible();
  // The décompte, then the balance: what is still owed.
  const decompte = page.waitForResponse((r) => r.url().endsWith(`/api/garanties/${depositId}`) && r.request().method() === "PATCH");
  await actions.getByRole("button", { name: "Émettre le décompte" }).click();
  expect((await decompte).ok(), "the décompte date is written").toBe(true);
  await page.reload();
  const balance = page.waitForResponse((r) => r.url().includes("/liberation") && r.request().method() === "POST");
  await actions.getByRole("button", { name: /Verser le solde/ }).click();
  const bres = await balance;
  expect(bres.ok(), "the balance is written").toBe(true);
  expect(((await bres.json()) as { amountCents: number }).amountCents).toBe(DEPOSIT - 30000 - Math.min(DEPOSIT / 2, DEPOSIT - 30000));
  await page.reload();
  await expect(page.locator(`[data-deposit-actions="${depositId}"]`), "nothing is left to settle").toHaveCount(0);
  await expect(page.locator(`li[data-deposit="${depositId}"]`)).toContainText("Restituée");
  expect((await page.request.post(`/api/garanties/${depositId}/liberation`, { data: { tranche: "balance" } })).status()).toBe(409);
});
