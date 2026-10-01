import { describe, expect, it } from "vitest";
import { attachmentsFor, buildTaxPack, ownerYearSummary, type TaxPackInput } from "@/domain/fiscal/taxpack";
import { computeYearAmortisation } from "@/domain/fiscal/amortisation";
import { cents } from "@/domain/money";
import * as data from "@/lib/demo/data";
import { defaultFiscalYear, prepareOwnerYear, selectFiscal } from "@/lib/fiscal/pack";
import { composeFiscalPack } from "@/lib/fiscal/pack-pdf";
import { csvDocument, csvEuros, safeFileName } from "@/lib/fiscal/csv";
import { fr as dict } from "@/lib/i18n/fr";

/**
 * The owner's exercise over the engines: the pack's stable codes, the
 * summary across properties, the pieces to attach, the sample cabinet's
 * prepared year (what the screen, the PDF and the CSV all read), and the
 * CSV writer.
 */
const rents = (monthly: number, months: number) =>
  Array.from({ length: months }, (_, i) => ({ period: `2025-${String(i + 1).padStart(2, "0")}`, category: "dwelling" as const, amount: cents(monthly) }));

const input = (over: Partial<TaxPackInput> = {}): TaxPackInput => ({
  taxYear: 2025,
  propertyLabel: "Apt 2",
  cadastralRef: "Luxembourg / Section A / 123",
  buildingCompletedOn: "2005-06-01",
  monthsLet: 12,
  vacancyMonths: 0,
  receipts: rents(1_850, 12),
  expenses: [
    { date: "2025-01-15", bucket: "debt_interest", label: "Intérêts", amount: cents(4_000), rechargedToTenant: false },
    { date: "2025-02-01", bucket: "impot_foncier", label: "Impôt foncier", amount: cents(300), rechargedToTenant: false },
    { date: "2025-05-01", bucket: "maintenance_repairs", label: "Peinture", amount: cents(1_200), rechargedToTenant: false },
  ],
  electedSpreadYears: null,
  priorSpreads: [],
  amortisation: null,
  ownerShare: 1,
  ownerResidency: "resident",
  socialRentalManagement: false,
  ...over,
});

describe("the tax pack's stable codes and totals", () => {
  it("names its warnings and lines by code, and totals the deductions it retained", () => {
    const pack = buildTaxPack(input());
    expect(pack.warningCodes).toEqual([{ code: "interest_certificate", vars: { amount: cents(4_000) } }]);
    const f = pack.sections.find((s) => s.code === "F")!;
    expect(f.lines.map((l) => l.code)).toEqual(["impot_foncier", "management_fees", "insurance", "permanent_charges"]);
    expect(pack.deductionsTotal).toBe(pack.grossRents.totalTaxable - pack.netResult);
    expect(pack.flatComparison.buildingAge).toBe(20);
    expect(pack.flatComparison.minAge).toBe(15);
  });

  it("sums an owner's year across properties", () => {
    const a = buildTaxPack(input());
    const b = buildTaxPack(input({ receipts: rents(900, 12), expenses: [], ownerShare: 0.5 }));
    const s = ownerYearSummary([a, b]);
    expect(s.properties).toBe(2);
    expect(s.grossRents).toBe(a.grossRents.totalTaxable + b.grossRents.totalTaxable);
    expect(s.netResult).toBe(a.netResult + b.netResult);
    expect(s.ownerShareNet).toBe(a.ownerShareNet + b.ownerShareNet);
  });

  it("lists the pieces the deductions call for, and who holds each", () => {
    const amort = computeYearAmortisation(
      { acquiredOn: "2021-03-15", completedOn: "2015-11-01", totalPrice: cents(1_000_000), landPrice: cents(200_000), vatPaid: 0, deedCosts: cents(70_000), investments: 0, energyWorksCost: cents(100_000), energyWorksCompletedOn: "2024-09-15", klimabonusReceived: cents(30_000), vefa2024Eligible: false },
      2025,
      { acceleratedSlotsUsed: 0, abattementAlreadyUsed: 0, jointlyTaxed: false },
    );
    const codes = attachmentsFor(buildTaxPack(input({ amortisation: amort })), amort).map((a) => `${a.code}:${a.providedBy}`);
    expect(codes).toEqual([
      "rent_ledger:cabinet",
      "repair_invoices:cabinet",
      "interest_certificate:owner",
      "impot_foncier_bulletin:owner",
      "klimabonus_decision:owner",
      "deed_and_costs:owner",
    ]);
    expect(attachmentsFor(buildTaxPack(input({ expenses: [] })), null).map((a) => a.code)).toEqual(["rent_ledger"]);
  });
});

describe("the sample cabinet's prepared exercise", () => {
  it("leads with the last closed year and prepares every owner for it", () => {
    expect(defaultFiscalYear([2026, 2025], "2026-08-23")).toBe(2025);
    expect(defaultFiscalYear([2026], "2026-08-23")).toBe(2026);
    const s = selectFiscal(data, {});
    expect(s.ownerId).toBe("c-lambert");
    expect(s.taxYear).toBe(2025);
    expect(s.all.map((o) => o.ownerId)).toEqual(["c-lambert", "c-faber"]);
    expect(s.current?.statements.map((st) => st.propertyId)).toEqual(["p-kirchberg", "p-gare"]);
    expect(s.current?.running).toBe(false);
    expect(selectFiscal(data, { ownerId: "c-faber", taxYear: 2026 }).current?.running).toBe(true);
    expect(selectFiscal(data, { ownerId: "nobody", taxYear: 1999 }).ownerId).toBe("c-lambert");
  });

  it("joins the vault to the checklist and knows what is still to ask for", () => {
    const faber = prepareOwnerYear(data, "c-faber", 2025)!;
    const certificate = faber.attachments.find((a) => a.propertyId === "p-beaulieu" && a.code === "interest_certificate")!;
    expect(certificate.state).toBe("vault");
    expect(certificate.documentName).toContain("BCEE 2025");
    const lambert = prepareOwnerYear(data, "c-lambert", 2025)!;
    expect(lambert.attachments.find((a) => a.propertyId === "p-gare" && a.code === "deed_and_costs")?.state).toBe("vault");
    expect(lambert.missing).toBeGreaterThan(0);
    expect(lambert.statements.every((st) => st.pack.nonResidentExport !== null)).toBe(true);
  });

  it("composes the pack with a section per statement and the annexes", () => {
    const lambert = prepareOwnerYear(data, "c-lambert", 2025)!;
    const model = composeFiscalPack(lambert, { d: dict, locale: "fr", cabinetName: "Cabinet Reuter", today: "2026-08-23", sample: true });
    expect(model.kind).toBe("fiscal_pack");
    expect(model.sections.map((s) => s.heading)).toEqual([
      dict.fiscalite.pdfSummary,
      "Relevé · Bureaux Kirchberg",
      "Relevé · Studio Quartier Gare",
      dict.fiscalite.planTitle,
      dict.fiscalite.checklistTitle,
      "Pack État de résidence · BE",
    ]);
    expect(model.watermark).toBe(dict.fiscalite.pdfSample);
  });
});

describe("the CSV writer", () => {
  it("writes a byte-order mark, semicolons, quoted fields and decimal commas", () => {
    expect(csvDocument([["a", "b;c", 'say "hi"'], [1, 2, 3]])).toBe("\uFEFFa;\"b;c\";\"say \"\"hi\"\"\"\r\n1;2;3\r\n");
    expect(csvEuros(123456)).toBe("1234,56");
    expect(csvEuros(-5)).toBe("-0,05");
    expect(safeFileName('Pack fiscal 2025 · Sophie Lambert/"x"')).toBe("Pack fiscal 2025 · Sophie Lambert x");
  });
});
