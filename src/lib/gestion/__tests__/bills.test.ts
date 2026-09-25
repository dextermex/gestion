import { describe, expect, it } from "vitest";
import { billState, parseBillInput, splitVat } from "@/lib/gestion/bills";
import { documentName, retentionFor } from "@/lib/gestion/documents-rules";
import { pageBounds, pageInfo, pageRequest, windowStart } from "@/lib/demo/scope";

/**
 * The books' arithmetic and the register's rules: VAT derived once from a
 * total at a Luxembourg rate, a form read once and not believed, a bill's
 * state from its dates, a document's retention clock from its class, and
 * the way a screen names a page or a window of history.
 */
describe("bills", () => {
  it("derives the VAT inside a total, rounded once, at every Luxembourg rate", () => {
    expect(splitVat(124000, 17)).toEqual({ netCents: 105983, vatCents: 18017 });
    expect(splitVat(48000, 17)).toEqual({ netCents: 41026, vatCents: 6974 });
    expect(splitVat(10000, 3)).toEqual({ netCents: 9709, vatCents: 291 });
    expect(splitVat(10000, 0)).toEqual({ netCents: 10000, vatCents: 0 });
  });
  it("reads a form once: euro notation, dates, flags, the fiscal bucket", () => {
    const bill = parseBillInput({ subject: " Chaudière ", category: "maintenance_repairs", vatRate: "17", amount: "1 240,00", docDate: "2026-08-08", dueOn: "", paid: "true", cashflow: "false", supplierContactId: "c-1", unitId: "u-1", docNo: "2026-0812", direction: "expense" });
    expect(bill).toMatchObject({ subject: "Chaudière", amountCents: 124000, vatCents: 18017, docDate: "2026-08-08", dueOn: null, paid: true, cashflow: false, supplierContactId: "c-1", unitId: "u-1", docNo: "2026-0812", direction: "expense" });
    expect(parseBillInput({ subject: "", category: "insurance", vatRate: "0", amount: "10" })).toEqual({ problem: "subject" });
    expect(parseBillInput({ subject: "x", category: "fees", vatRate: "0", amount: "10" })).toEqual({ problem: "category" });
    expect(parseBillInput({ subject: "x", category: "insurance", vatRate: "21", amount: "10" })).toEqual({ problem: "vat" });
    expect(parseBillInput({ subject: "x", category: "insurance", vatRate: "0", amount: "0" })).toEqual({ problem: "amount" });
    expect(parseBillInput({ subject: "x", category: "insurance", vatRate: "0", amount: "10", docDate: "2026-13-40" })).toEqual({ problem: "date" });
    // Cash flow is on unless the form says otherwise; income is the other direction.
    expect(parseBillInput({ subject: "Loyer garage", category: "other_frais", vatRate: "0", amount: "80", direction: "income" })).toMatchObject({ cashflow: true, direction: "income" });
  });
  it("tells a paid bill from one due and one overdue", () => {
    expect(billState({ paidOn: "2026-07-10", dueOn: "2026-07-25" }, "2026-09-01")).toBe("paid");
    expect(billState({ paidOn: null, dueOn: "2026-09-07" }, "2026-09-01")).toBe("due");
    expect(billState({ paidOn: null, dueOn: "2026-08-07" }, "2026-09-01")).toBe("overdue");
    expect(billState({ paidOn: null, dueOn: null }, "2026-09-01")).toBe("due");
  });
});

describe("documents", () => {
  it("gives each class its retention clock", () => {
    expect(retentionFor("deed")).toBe("permanent");
    expect(retentionFor("id_document")).toBe("aml_5y_from_end");
    expect(retentionFor("photo")).toBe("gdpr_minimised");
    expect(retentionFor("invoice")).toBe("accounting_10y");
    expect(retentionFor("lease")).toBe("accounting_10y");
  });
  it("keeps a name bounded and never empty", () => {
    expect(documentName("  Facture Krier.pdf ", "x.pdf")).toBe("Facture Krier.pdf");
    expect(documentName("", "facture.pdf")).toBe("facture.pdf");
    expect(documentName("a".repeat(200), "x")).toHaveLength(160);
  });
});

describe("read scope", () => {
  it("reads a page from the address, bounded", () => {
    expect(pageRequest(undefined)).toEqual({ page: 1, size: 50 });
    expect(pageRequest({ page: "3", taille: "20" })).toEqual({ page: 3, size: 20 });
    expect(pageRequest({ page: "0", taille: "9999" })).toEqual({ page: 1, size: 200 });
    expect(pageRequest({ page: "x", taille: "0" })).toEqual({ page: 1, size: 50 });
    expect(pageBounds({ page: 2, size: 50 })).toEqual({ from: 50, to: 99 });
    expect(pageInfo({ page: 2, size: 2 }, 3)).toEqual({ page: 2, size: 2, total: 3, pages: 2 });
    expect(pageInfo({ page: 1, size: 50 }, 0)).toEqual({ page: 1, size: 50, total: 0, pages: 1 });
  });
  it("opens the history window on the first day of a month, so many months back", () => {
    expect(windowStart("2026-09-24", 24)).toBe("2024-09-01");
    expect(windowStart("2026-01-15", 1)).toBe("2025-12-01");
    expect(windowStart("2026-03-01", 0)).toBe("2026-03-01");
  });
});
