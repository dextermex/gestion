import { describe, expect, it } from "vitest";
import { ACQUISITION_COLUMNS, LOAN_COLUMNS, investmentWrite, mapAcquisitionRow, mapLoanRow } from "@/lib/gestion/investment";

/**
 * The create and the edit routes write a loan or a purchase project through
 * one mapping: every field the form sends lands in its column, and reading
 * the row back gives the same record.
 */
const columns = (list: string) => new Set(list.split(",").filter((c) => !["id", "created_at", "updated_at"].includes(c)));

describe("one mapping for the investment routes", () => {
  it("writes every column of a loan and reads it back unchanged", () => {
    const loan = { propertyId: "p-1", unitId: null, name: "Crédit", bankName: "Spuerkeess", originalCents: 42000000, balanceCents: 28100000, balanceDate: "2026-08-23", annualRatePct: 2.45, rateType: "fixed", remainingMonths: 198, insuranceCents: 4200, nextPaymentDate: "2026-10-05", fixedUntil: "2031-10-05", notes: "" };
    const row = investmentWrite(loan, "loans");
    expect(new Set(Object.keys(row))).toEqual(columns(LOAN_COLUMNS));
    expect(mapLoanRow({ ...row, id: "l-1", created_at: "x", updated_at: "y" })).toEqual({ ...loan, id: "l-1", createdAt: "x", updatedAt: "y" });
  });

  it("writes every column of a purchase project", () => {
    const row = investmentWrite({ name: "Résidence", address: "Bertrange", stage: "viewing", askingPriceCents: 1, expectedRentCents: 2, bankName: "", financingStatus: "research", notaryName: "", nextAction: "", nextActionDate: null, viewingDate: null, compromisDate: null, financeDeadline: null, notaryAppointmentDate: null, deedSignedDate: null, transferDate: null, handoverDate: null, notes: "" }, "acquisitions");
    expect(new Set(Object.keys(row))).toEqual(columns(ACQUISITION_COLUMNS));
    expect(mapAcquisitionRow({ ...row, id: "a-1" }).name).toBe("Résidence");
  });
});
