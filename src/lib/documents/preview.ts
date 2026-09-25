import type { Locale } from "@/lib/i18n/config";
import type { DocumentKind } from "./kinds";
import type { ComposeInput, KindData } from "./model";
import { wordingFor } from "./wording";

/**
 * What a template looks like before it is validated: the same composer,
 * fictitious values that say so on every page. Never stored, never a
 * document of the workspace: the settings screen shows it so the person
 * validating reads exactly the wording a real document will carry.
 */
const FIXTURE_ON = "2026-09-26";

export function previewInput(kind: DocumentKind, lang: Locale): ComposeInput {
  const w = wordingFor(lang);
  const watermark = w?.common.previewWatermark ?? "PREVIEW";
  const base = {
    lang,
    lessor: {
      legalName: "Bailleur Exemple",
      signatoryName: "Prénom Nom (signataire)",
      addressLine: "1, rue de l'Exemple, L-0000 Commune",
      city: "Commune",
      email: "bailleur@exemple.lu",
      phone: "+352 000 000 000",
      iban: "LU280019400644750000",
      bic: "BCEELULL",
      holderName: "Bailleur Exemple",
    },
    tenants: ["Locataire Exemple"],
    place: { unitLabel: "Appartement Exemple", propertyName: "Résidence Exemple", propertyAddress: "2, rue de l'Exemple, L-0000 Commune" },
    on: FIXTURE_ON,
    reference: "EXEMPLE-0000",
    watermark,
  };
  const data: KindData = {
    rent_notice: { period: "2026-10", dueDate: "2026-10-01", rentCents: 125000, chargesCents: 15000, otherCents: 0, otherLabel: null, vatCents: 0, totalCents: 140000, allocatedCents: 0, rfReference: "RF18539007547034" },
    rent_receipt: { period: "2026-09", totalCents: 140000, allocations: [{ on: "2026-09-02", cents: 140000 }] },
    arrears_formal: { period: "2026-09", dueDate: "2026-09-01", totalCents: 140000, openCents: 140000, on: FIXTURE_ON, friendlyOn: "2026-09-04", formalOn: null, rfReference: "RF18539007547034", openPeriods: [{ period: "2026-09", dueDate: "2026-09-01", totalCents: 140000, openCents: 140000 }] },
    arrears_mise_en_demeure: { period: "2026-09", dueDate: "2026-09-01", totalCents: 140000, openCents: 140000, on: FIXTURE_ON, friendlyOn: "2026-09-04", formalOn: "2026-09-11", rfReference: "RF18539007547034", openPeriods: [{ period: "2026-09", dueDate: "2026-09-01", totalCents: 140000, openCents: 140000 }] },
    indexation_notice: { dispatchedOn: FIXTURE_ON, currentRentCents: 125000, proposedRentCents: 137500, ceilingMonthlyCents: 166666, bindingConstraint: "step_cap", lastAdjustmentOn: null, leaseStartDate: "2024-08-01" },
    charges_statement: {
      year: 2025,
      regime: "advances",
      issuedOn: FIXTURE_ON,
      dueOn: "2026-10-26",
      lines: [
        { label: "Chauffage collectif", category: "heating", buildingTotalCents: 800000, tantiemes: 120, tantiemesTotal: 1000, lotShareCents: 96000, tenantShareCents: 96000, blocked: false },
        { label: "Honoraires du syndic", category: "syndic_fees", buildingTotalCents: 300000, tantiemes: 120, tantiemesTotal: 1000, lotShareCents: 36000, tenantShareCents: 0, blocked: true },
      ],
      actualCents: 96000,
      blockedCents: 36000,
      advancesCents: 180000,
      balanceCents: -84000,
    },
    deposit_settlement: {
      depositCents: 250000,
      form: "cash",
      receivedOn: "2024-08-01",
      keyHandoverOn: "2026-08-31",
      decompteIssuedOn: FIXTURE_ON,
      lines: [{ kind: "arrears", label: "Loyer d'août", amountCents: 30000, status: "justified", retainedCents: 30000, justifiedOn: "2026-09-10", deadline: "2026-09-30" }],
      totalRetainedCents: 30000,
      firstTrancheCents: 125000,
      firstTrancheDueOn: "2026-09-30",
      balanceCents: 95000,
      balanceDueOn: "2026-10-26",
      releasedFirstTrancheCents: 125000,
      releasedBalanceCents: 0,
      outstandingCents: 95000,
      penaltyMonths: 0,
      penaltyCents: 0,
    },
    lease_contract: {
      leaseType: "residential",
      startDate: "2026-10-01",
      endDate: null,
      rentCents: 125000,
      chargesCents: 15000,
      chargesRegime: "advances",
      paymentDay: 1,
      rfReference: "RF18539007547034",
      depositMonths: 2,
      depositCents: 250000,
      depositForm: "cash",
      furnished: false,
      furnitureSupplementCents: 0,
      colocation: false,
      capitalComponents: [{ year: 2015, cents: 40000000, kind: "construction" }],
      tenants: [{ name: "Locataire Exemple", email: "locataire@exemple.lu" }],
      unit: { label: "Appartement Exemple", floor: "2", areaSqm: 72, rooms: 3, bedrooms: 2 },
      energyClass: "C",
      cadastral: null,
    },
    housing_certificate: { tenants: ["Locataire Exemple"], startDate: "2026-10-01", endDate: null },
    edl_report: {
      kind: "entry",
      completedAt: FIXTURE_ON,
      keyHandoverAt: FIXTURE_ON,
      signed: true,
      manifestSha256: "0000000000000000000000000000000000000000000000000000000000000000",
      rooms: [{ room: "Séjour", items: [{ category: "paint", condition: "good", notes: "Trace au-dessus de la porte", photos: 1 }] }],
      readings: [{ meter: "Électricité 000000", value: "12345", readOn: FIXTURE_ON }],
      photos: [{ room: "Séjour", category: "paint", capturedAt: `${FIXTURE_ON}T10:00:00Z`, sha256: "0000000000000000000000000000000000000000000000000000000000000000" }],
      tenants: ["Locataire Exemple"],
    },
  };
  return { ...base, kind, data: data[kind] } as ComposeInput;
}
