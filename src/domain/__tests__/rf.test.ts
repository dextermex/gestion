import { describe, expect, it } from "vitest";
import { epcQrPayload, extractRF, generateRF, isValidRF, leaseRF, vopNameCheck } from "@/domain/banking/rf";
import { cents } from "@/domain/money";

describe("ISO 11649 RF references", () => {
  it("generates and validates round-trip", () => {
    const rf = generateRF("539007547034");
    expect(isValidRF(rf)).toBe(true);
    expect(rf.startsWith("RF")).toBe(true);
  });

  it("validates the ISO example RF18 5390 0754 7034", () => {
    expect(isValidRF("RF18539007547034")).toBe(true);
    expect(isValidRF("RF18 5390 0754 7034")).toBe(true);
    expect(isValidRF("RF19539007547034")).toBe(false);
  });

  it("extracts a checksum-valid RF from noisy free text (Luxembourg retail apps)", () => {
    expect(extractRF("LOYER MAI 2026 RF18 5390 0754 7034 MERCI")).toBe("RF18539007547034");
    expect(extractRF("virement loyer rf18539007547034")).toBe("RF18539007547034");
    expect(extractRF("LOYER MAI SANS REFERENCE")).toBeNull();
    // Corrupted checksum must not match.
    expect(extractRF("RF99 5390 0754 7034")).toBeNull();
  });

  it("derives a stable per-lease reference", () => {
    const rf = leaseRF(1, 42);
    expect(isValidRF(rf)).toBe(true);
    expect(leaseRF(1, 42)).toBe(rf);
    expect(leaseRF(1, 43)).not.toBe(rf);
  });
});

describe("EPC QR payload", () => {
  it("serializes the EPC069-12 structure with the RF in the structured slot", () => {
    const payload = epcQrPayload({
      beneficiaryName: "MORADA GESTION SARL",
      iban: "LU28 0019 4006 4475 0000",
      bic: "BCEELULL",
      amount: cents(1850),
      rfReference: "RF18539007547034",
    });
    const lines = payload.split("\n");
    expect(lines[0]).toBe("BCD");
    expect(lines[3]).toBe("SCT");
    expect(lines[6]).toBe("LU280019400644750000");
    expect(lines[7]).toBe("EUR1850.00");
    expect(lines[9]).toBe("RF18539007547034");
    expect(lines[10]).toBe("");
  });
});

describe("VoP name check", () => {
  it("accepts the verbatim registered name modulo case/accents/spacing", () => {
    expect(vopNameCheck("Société Immobilière Muller S.à r.l.", "SOCIETE IMMOBILIERE MULLER S A R L").ok).toBe(true);
  });

  it("blocks a divergent display name", () => {
    const res = vopNameCheck("Morada Gestion S.à r.l.", "Morada");
    expect(res.ok).toBe(false);
    expect(res.message).toContain("VoP");
  });
});
