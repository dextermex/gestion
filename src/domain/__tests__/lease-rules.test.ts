import { describe, expect, it } from "vitest";
import {
  LeaseDraft,
  assessTermination,
  commercialRenewalCalendar,
  validateLeaseDraft,
  validatePasDePorte,
} from "@/domain/lease/rules";
import { cents } from "@/domain/money";

const baseDraft = (over: Partial<LeaseDraft> = {}): LeaseDraft => ({
  type: "residential",
  startDate: "2026-09-01",
  endDate: null,
  monthlyRent: cents(1850),
  monthlyCharges: cents(250),
  depositMonths: 2,
  depositForm: "bank_guarantee",
  mentions: {
    parties_identity: "x",
    property_designation: "x",
    lease_start_date: "x",
    duration_or_indefinite: "x",
    rent_amount: "x",
    charges_regime: "x",
    deposit_terms: "x",
    capital_investi_declaration: "x",
  },
  hasCpiEscalationClause: false,
  furnished: false,
  colocation: false,
  ...over,
});

describe("residential lease rule pack", () => {
  it("accepts a compliant draft", () => {
    expect(validateLeaseDraft(baseDraft())).toEqual([]);
  });

  it("blocks a deposit over 2 months (post-2024)", () => {
    const issues = validateLeaseDraft(baseDraft({ depositMonths: 3 }));
    expect(issues.some((i) => i.code === "DEPOSIT_OVER_CAP" && i.severity === "blocking")).toBe(true);
  });

  it("blocks when any of the 8 mandatory mentions is missing", () => {
    const draft = baseDraft();
    delete draft.mentions.capital_investi_declaration;
    const issues = validateLeaseDraft(draft);
    expect(issues.some((i) => i.code === "MENTIONS_INCOMPLETE")).toBe(true);
  });

  it("refuses CPI escalation clauses in residential leases", () => {
    const issues = validateLeaseDraft(baseDraft({ hasCpiEscalationClause: true }));
    expect(issues.some((i) => i.code === "CPI_CLAUSE_PROHIBITED")).toBe(true);
  });

  it("enforces the 50/50 agency fee split", () => {
    const issues = validateLeaseDraft(
      baseDraft({ agencyFeeTotal: cents(2000), agencyFeeTenantShare: cents(1500) }),
    );
    expect(issues.some((i) => i.code === "AGENCY_FEE_SPLIT")).toBe(true);
    const ok = validateLeaseDraft(
      baseDraft({ agencyFeeTotal: cents(2000), agencyFeeTenantShare: cents(1000) }),
    );
    expect(ok).toEqual([]);
  });

  it("caps the furnished supplement at 1.5%/month of itemised furniture", () => {
    const blocked = validateLeaseDraft(
      baseDraft({ furnished: true, furnitureSupplement: cents(200), furnitureInvoiceTotal: cents(10000) }),
    );
    expect(blocked.some((i) => i.code === "FURNITURE_SUPPLEMENT_OVER_CAP")).toBe(true);
    const ok = validateLeaseDraft(
      baseDraft({ furnished: true, furnitureSupplement: cents(150), furnitureInvoiceTotal: cents(10000) }),
    );
    expect(ok).toEqual([]);
    const notItemised = validateLeaseDraft(baseDraft({ furnished: true, furnitureSupplement: cents(100) }));
    expect(notItemised.some((i) => i.code === "FURNITURE_NOT_ITEMISED")).toBe(true);
  });

  it("requires the pacte de colocation in the signing envelope", () => {
    const issues = validateLeaseDraft(baseDraft({ colocation: true }));
    expect(issues.some((i) => i.code === "PACTE_COLOCATION_MISSING")).toBe(true);
  });

  it("uses the 3-month cap for historical (pre-Aug-2024) drafts", () => {
    const issues = validateLeaseDraft(baseDraft({ startDate: "2023-06-01", depositMonths: 3 }));
    expect(issues).toEqual([]);
  });
});

describe("commercial lease rule pack", () => {
  it("caps the deposit at 6 months and flags pop-ups as out of scope", () => {
    const over = validateLeaseDraft(
      baseDraft({ type: "commercial", depositMonths: 7, startDate: "2026-01-01" }),
    );
    expect(over.some((i) => i.code === "DEPOSIT_OVER_CAP")).toBe(true);

    const popup = validateLeaseDraft(
      baseDraft({ type: "commercial", depositMonths: 3, startDate: "2026-01-01", endDate: "2026-07-01" }),
    );
    expect(popup.some((i) => i.code === "COMMERCIAL_POPUP_OUT_OF_SCOPE" && i.severity === "warning")).toBe(true);
  });

  it("voids pas-de-porte for leases concluded from 1.3.2018", () => {
    expect(validatePasDePorte("commercial", "2020-01-01", cents(10000))[0].code).toBe("PAS_DE_PORTE_VOID");
    expect(validatePasDePorte("commercial", "2017-01-01", cents(10000))[0].code).toBe("PAS_DE_PORTE_GRANDFATHERED");
    expect(validatePasDePorte("residential", "2020-01-01", cents(10000))).toEqual([]);
  });

  it("computes the renewal calendar (6-month request, 3-month answer, 9-year indemnity, 18-year preemption)", () => {
    const cal = commercialRenewalCalendar("2018-04-01", "2027-03-31");
    expect(cal.renewalRequestDeadline).toBe("2026-09-30");
    expect(cal.landlordAnswerDeadline("2026-09-15")).toBe("2026-12-15");
    expect(cal.evictionIndemnityFrom).toBe("2027-04-01");
    expect(cal.preemptionFrom).toBe("2036-04-01");
  });
});

describe("termination engine", () => {
  it("blocks sale as a residential termination ground", () => {
    const res = assessTermination({
      leaseType: "residential",
      ground: "landlord_sale",
      arReceivedDate: "2026-08-01",
      fixedTermEnd: null,
    });
    expect(res.valid).toBe(false);
    expect(res.issues[0].code).toBe("SALE_NOT_A_GROUND");
  });

  it("requires art. 12(3) verbatim for besoin personnel and uses 6-month notice", () => {
    const missing = assessTermination({
      leaseType: "residential",
      ground: "landlord_personal_need",
      arReceivedDate: "2026-08-01",
      fixedTermEnd: null,
      art12VerbatimIncluded: false,
    });
    expect(missing.valid).toBe(false);
    const ok = assessTermination({
      leaseType: "residential",
      ground: "landlord_personal_need",
      arReceivedDate: "2026-08-01",
      fixedTermEnd: null,
      art12VerbatimIncluded: true,
    });
    expect(ok.valid).toBe(true);
    expect(ok.noticeMonths).toBe(6);
    expect(ok.earliestLawfulEnd).toBe("2027-02-01");
  });

  it("computes tenant notice from the AR date, not the send date", () => {
    const res = assessTermination({
      leaseType: "residential",
      ground: "tenant_notice",
      arReceivedDate: "2026-08-14",
      fixedTermEnd: null,
    });
    expect(res.noticeMonths).toBe(3);
    expect(res.earliestLawfulEnd).toBe("2026-11-14");
  });

  it("applies the prorogation-légale date guard on fixed terms", () => {
    const res = assessTermination({
      leaseType: "residential",
      ground: "tenant_notice",
      arReceivedDate: "2026-01-10",
      fixedTermEnd: "2026-08-31",
    });
    expect(res.earliestLawfulEnd).toBe("2026-08-31");
    expect(res.issues.some((i) => i.code === "FIXED_TERM_DATE_GUARD")).toBe(true);
  });
});
