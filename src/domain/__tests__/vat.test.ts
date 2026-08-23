import { describe, expect, it } from "vitest";
import {
  assessVatOption,
  managementFeeVat,
  rentVat,
  validateInvoiceContent,
} from "@/domain/fiscal/vat";
import { cents } from "@/domain/money";

describe("VAT option to tax", () => {
  it("blocks the option outright for residential leases", () => {
    const res = assessVatOption({
      leaseType: "residential",
      tenantIsTaxablePerson: true,
      tenantDeductionRatioPct: 100,
      aedApprovalRef: "AED-123",
      aedDecisionDate: "2026-03-10",
    });
    expect(res.allowed).toBe(false);
    expect(res.issues.some((i) => i.code === "VAT_OPTION_RESIDENTIAL")).toBe(true);
  });

  it("requires a taxable tenant deducting ≥ 50% and prior AED approval", () => {
    const lowRatio = assessVatOption({
      leaseType: "commercial",
      tenantIsTaxablePerson: true,
      tenantDeductionRatioPct: 40,
      aedApprovalRef: "AED-1",
      aedDecisionDate: "2026-03-10",
    });
    expect(lowRatio.allowed).toBe(false);

    const ok = assessVatOption({
      leaseType: "commercial",
      tenantIsTaxablePerson: true,
      tenantDeductionRatioPct: 100,
      aedApprovalRef: "AED-1",
      aedDecisionDate: "2026-03-10",
    });
    expect(ok.allowed).toBe(true);
    // First day of the month following the decision — never retroactive.
    expect(ok.effectiveFrom).toBe("2026-04-01");
  });
});

describe("rent VAT", () => {
  it("keeps the exempt mention citing art. 44(1)(g) when exempt", () => {
    const line = rentVat(cents(1850), "exempt", "2026-05-01", null);
    expect(line.vat).toBe(0);
    expect(line.exemptionMention).toContain("art. 44");
  });

  it("never charges VAT before the option's effective date", () => {
    const before = rentVat(cents(4000), "opted", "2026-03-25", "2026-04-01");
    expect(before.vat).toBe(0);
    const after = rentVat(cents(4000), "opted", "2026-04-01", "2026-04-01");
    expect(after.vatRatePct).toBe(17);
    expect(after.vat).toBe(cents(680));
    expect(after.gross).toBe(cents(4680));
  });
});

describe("management fee VAT", () => {
  it("always applies 17% even when the letting is exempt", () => {
    const line = managementFeeVat(cents(1000), "2026-05-01");
    expect(line.vatRatePct).toBe(17);
    expect(line.vat).toBe(cents(170));
  });
});

describe("invoice content validation", () => {
  const okInvoice = {
    issueDate: "2026-05-01",
    sequentialNumber: "2026-000123",
    supplierVatNumber: "LU12345678",
    supplierNameAddress: "Morada Gestion Sàrl, 1 rue X, L-1111 Luxembourg",
    customerNameAddress: "Jean Muller, 2 rue Y, L-2222 Luxembourg",
    supplyDate: "2026-05-01",
    natureOfSupply: "Loyer mai 2026",
    netByRate: [{ ratePct: 0, net: cents(1850), vat: 0 }],
    exemptionReason: "Art. 44(1)(g) loi TVA",
    totalIncl: cents(1850),
  };

  it("passes a complete exempt rent invoice", () => {
    const issues = validateInvoiceContent(okInvoice);
    expect(issues.filter((i) => i.severity === "blocking")).toEqual([]);
  });

  it("blocks an exempt line without the exemption reason", () => {
    const issues = validateInvoiceContent({ ...okInvoice, exemptionReason: null });
    expect(issues.some((i) => i.code === "INV_EXEMPTION_REASON")).toBe(true);
  });

  it("notes the simplified-invoice allowance under €100", () => {
    const issues = validateInvoiceContent({ ...okInvoice, totalIncl: cents(95) });
    expect(issues.some((i) => i.code === "INV_SIMPLIFIED_OK")).toBe(true);
  });
});
