import { describe, expect, it } from "vitest";
import { getParam, getParamValue, paramsInForce, LegalParamError } from "@/domain/legal/params";

describe("legal parameter registry", () => {
  it("resolves the residential deposit cap as 2 months from 1.8.2024", () => {
    expect(getParamValue("residential.deposit_max_months", "2024-08-01")).toBe(2);
    expect(getParamValue("residential.deposit_max_months", "2026-08-23")).toBe(2);
  });

  it("resolves the pre-2024 deposit cap as 3 months (historical computations)", () => {
    expect(getParamValue("residential.deposit_max_months", "2023-05-01")).toBe(3);
  });

  it("switches the energy amortisation rate 6% → 10% at tax year 2026", () => {
    expect(getParamValue("amort.rate_energy_pct", "2025-12-31")).toBe(6);
    expect(getParamValue("amort.rate_energy_pct", "2026-01-01")).toBe(10);
  });

  it("throws on a date with no parameter in force — never a silent default", () => {
    expect(() => getParam("residential.deposit_max_months", "1990-01-01")).toThrow(LegalParamError);
  });

  it("flags uncertain params so engines can surface them", () => {
    const p = getParam("residential.deposit_first_tranche_months_after_keys", "2026-01-01");
    expect(p.status).toBe("uncertain");
    const vatCap = getParam("vat.logement_max_advantage_eur", "2026-01-01");
    expect(vatCap.status).toBe("uncertain");
  });

  it("lists exactly one value per key for a given date", () => {
    const inForce = paramsInForce("2026-08-23");
    const keys = inForce.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("vat.standard_rate_pct");
  });
});
