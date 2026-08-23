/**
 * Demo dataset — the app runs fully navigable on this typed, realistic
 * Luxembourg portfolio until a Supabase project is wired (see README).
 * "Today" is 2026-08-23. Every figure is engine-consistent: pages feed this
 * data through the real domain engines, never through hand-written results.
 */

import { cents } from "@/domain/money";
import type { CapitalComponent } from "@/domain/indexation/engine";
import type { AcquisitionFacts } from "@/domain/fiscal/amortisation";
import type { BankTransaction, IbanBinding, OpenInvoice } from "@/domain/banking/matching";
import type {
  BankTxStatus,
  ContactRole,
  DepositStatus,
  EdlStatus,
  LeaseStatus,
  LeaseTypeUi,
  MeterKind,
  RentStatus,
  TicketSeverity,
  TicketStatus,
  WorkflowKind,
} from "@/lib/types";

export const TODAY = "2026-08-23";
export const ORG = {
  id: "org-1",
  name: "Morada Gestion — Cabinet Reuter",
  kind: "manager",
  autorisationNumber: "10123456/2",
  autorisationExpiry: "2028-03-31",
  piInsuranceProvider: "Foyer Assurances",
  piInsuranceExpiry: "2026-11-30",
  vatNumber: "LU31245987",
};

// ─── Contacts ───────────────────────────────────────────────────────────────

export interface DemoContact {
  id: string;
  kind: "natural" | "legal";
  name: string;
  email: string | null;
  phone: string | null;
  language: string;
  roles: ContactRole[];
  iban?: string;
  bankHolderName?: string;
  residency?: "resident" | "non_resident";
  country?: string;
  amlTier?: "light" | "full_cdd";
  riskBand?: "low" | "medium" | "high";
  notes?: string;
}

export const CONTACTS: DemoContact[] = [
  { id: "c-muller", kind: "natural", name: "Jean Muller", email: "jean.muller@pt.lu", phone: "+352 621 123 456", language: "fr", roles: ["tenant"] },
  { id: "c-jeanne", kind: "natural", name: "Jeanne Muller", email: "jeanne.muller@gmail.com", phone: "+352 621 654 321", language: "fr", roles: ["tenant"] },
  { id: "c-santos", kind: "natural", name: "Ana Santos", email: "ana.santos@gmail.com", phone: "+352 691 222 333", language: "pt", roles: ["tenant"] },
  { id: "c-weber", kind: "natural", name: "Lucas Weber", email: "l.weber@education.lu", phone: "+352 621 888 111", language: "lu", roles: ["tenant"] },
  { id: "c-dubois", kind: "natural", name: "Claire Dubois", email: "claire.dubois@outlook.com", phone: "+352 691 444 555", language: "fr", roles: ["tenant"] },
  { id: "c-hoffmann", kind: "natural", name: "Marc Hoffmann", email: "marc.hoffmann@pt.lu", phone: "+352 621 777 999", language: "de", roles: ["tenant"] },
  { id: "c-krier", kind: "natural", name: "Paul Krier", email: "p.krier@krier-fils.lu", phone: "+352 621 300 200", language: "lu", roles: ["artisan"], notes: "Chauffage & sanitaire — intervient sous 48 h" },
  { id: "c-da-silva", kind: "natural", name: "José Da Silva", email: "contact@dasilva-peinture.lu", phone: "+352 691 600 700", language: "pt", roles: ["artisan"], notes: "Peinture, sols" },
  { id: "c-elektro", kind: "legal", name: "Elektro Thill Sàrl", email: "info@elektrothill.lu", phone: "+352 26 44 55 66", language: "de", roles: ["artisan"] },
  {
    id: "c-sci-bealieu", kind: "legal", name: "SCI Beaulieu", email: "sci.beaulieu@fiduciaire-reuter.lu", phone: null, language: "fr",
    roles: ["owner"], amlTier: "full_cdd", riskBand: "low",
    notes: "Société civile immobilière — transparente (art. 175 LIR), modèle 200",
  },
  { id: "c-faber", kind: "natural", name: "Marie Faber", email: "marie.faber@pt.lu", phone: "+352 621 100 100", language: "fr", roles: ["owner"], residency: "resident" },
  { id: "c-faber-p", kind: "natural", name: "Pierre Faber", email: "pierre.faber@pt.lu", phone: "+352 621 100 101", language: "fr", roles: ["owner"], residency: "resident" },
  {
    id: "c-lambert", kind: "natural", name: "Sophie Lambert", email: "sophie.lambert@skynet.be", phone: "+32 475 12 34 56", language: "fr",
    roles: ["owner"], residency: "non_resident", country: "Belgique",
    notes: "Non-résidente (BE) — pack fiscal double : modèle 100 LU + cadre III BE",
    amlTier: "full_cdd", riskBand: "medium",
  },
  { id: "c-bock", kind: "legal", name: "Boulangerie Bock Sàrl", email: "info@bock.lu", phone: "+352 26 12 34 56", language: "lu", roles: ["tenant"], amlTier: "light" },
  { id: "c-schmit", kind: "natural", name: "Tom Schmit", email: "tom.schmit@gmail.com", phone: "+352 691 010 203", language: "en", roles: ["lead"] },
  { id: "c-wagner", kind: "natural", name: "Lea Wagner", email: "lea.wagner@gmail.com", phone: "+352 621 040 506", language: "de", roles: ["lead"] },
  { id: "c-notaire", kind: "natural", name: "Me Nathalie Thill", email: "etude@thill-notaire.lu", phone: "+352 26 00 11 22", language: "fr", roles: ["notary"] },
];

export const contactById = (id: string) => CONTACTS.find((c) => c.id === id)!;

// ─── Properties & units ─────────────────────────────────────────────────────

export interface DemoProperty {
  id: string;
  name: string;
  address: string;
  commune: string;
  cadastralRef: string;
  type: string;
  constructionYear: number;
  completionDate: string;
  energyClass: string;
  cpeIssuedOn: string;
  isCopropriete: boolean;
  syndicName?: string;
  syndicMandateStart?: string;
  nextAgDate?: string;
  smokeDetectorsConfirmed: boolean;
  ownerContactIds: string[];
  ownershipNote: string;
  unitsCount: number;
}

export const PROPERTIES: DemoProperty[] = [
  {
    id: "p-beaulieu",
    name: "Résidence Beaulieu",
    address: "12, rue de la Gare, L-1611 Luxembourg",
    commune: "Luxembourg",
    cadastralRef: "Luxembourg / Section HoA / n° 372/1145",
    type: "Immeuble de rapport",
    constructionYear: 2008,
    completionDate: "2008-09-01",
    energyClass: "C",
    cpeIssuedOn: "2017-03-01",
    isCopropriete: true,
    syndicName: "Syndic Lux-Gestion SA",
    syndicMandateStart: "2024-06-01",
    nextAgDate: "2026-10-20",
    smokeDetectorsConfirmed: true,
    ownerContactIds: ["c-sci-bealieu"],
    ownershipNote: "SCI Beaulieu (Marie Faber 60 %, Pierre Faber 40 %) — transparente",
    unitsCount: 6,
  },
  {
    id: "p-bertrange",
    name: "Maison Bertrange",
    address: "8, rue des Champs, L-8053 Bertrange",
    commune: "Bertrange",
    cadastralRef: "Bertrange / Section B / n° 214/889",
    type: "Maison",
    constructionYear: 2022,
    completionDate: "2022-05-15",
    energyClass: "A",
    cpeIssuedOn: "2022-05-20",
    isCopropriete: false,
    smokeDetectorsConfirmed: true,
    ownerContactIds: ["c-faber", "c-faber-p"],
    ownershipNote: "Marie & Pierre Faber — 50/50, imposition collective",
    unitsCount: 1,
  },
  {
    id: "p-kirchberg",
    name: "Bureaux Kirchberg",
    address: "4, avenue J.F. Kennedy, L-1855 Luxembourg",
    commune: "Luxembourg",
    cadastralRef: "Luxembourg / Section EiB / n° 501/2231",
    type: "Commercial",
    constructionYear: 2015,
    completionDate: "2015-11-01",
    energyClass: "B",
    cpeIssuedOn: "2019-06-15",
    isCopropriete: true,
    syndicName: "Syndic Kirchberg Facilities",
    syndicMandateStart: "2025-01-15",
    smokeDetectorsConfirmed: true,
    ownerContactIds: ["c-lambert"],
    ownershipNote: "Sophie Lambert (non-résidente BE) — 100 %",
    unitsCount: 2,
  },
  {
    id: "p-gare",
    name: "Studio Quartier Gare",
    address: "31, rue de Strasbourg, L-2561 Luxembourg",
    commune: "Luxembourg",
    cadastralRef: "Luxembourg / Section HoA / n° 388/2020",
    type: "Appartement",
    constructionYear: 2024,
    completionDate: "2024-04-30",
    energyClass: "A+",
    cpeIssuedOn: "2024-05-02",
    isCopropriete: true,
    syndicName: "Syndic Lux-Gestion SA",
    syndicMandateStart: "2024-09-01",
    smokeDetectorsConfirmed: false,
    ownerContactIds: ["c-lambert"],
    ownershipNote: "Sophie Lambert — VEFA 2024 (amortissement 6 %, base plafonnée)",
    unitsCount: 1,
  },
];

export interface DemoUnit {
  id: string;
  propertyId: string;
  label: string;
  kind: "dwelling" | "commercial" | "parking";
  floor: string;
  areaSqm: number;
  rooms: number;
  furnished: boolean;
  vacantSince?: string;
}

export const UNITS: DemoUnit[] = [
  { id: "u-b-3b", propertyId: "p-beaulieu", label: "Apt 3B", kind: "dwelling", floor: "3e", areaSqm: 72, rooms: 2, furnished: false },
  { id: "u-b-3c", propertyId: "p-beaulieu", label: "Apt 3C", kind: "dwelling", floor: "3e", areaSqm: 71, rooms: 2, furnished: false },
  { id: "u-b-2a", propertyId: "p-beaulieu", label: "Apt 2A", kind: "dwelling", floor: "2e", areaSqm: 85, rooms: 3, furnished: false },
  { id: "u-b-1a", propertyId: "p-beaulieu", label: "Apt 1A", kind: "dwelling", floor: "1er", areaSqm: 96, rooms: 3, furnished: false },
  { id: "u-b-rdc", propertyId: "p-beaulieu", label: "Studio RDC", kind: "dwelling", floor: "RDC", areaSqm: 38, rooms: 1, furnished: true },
  { id: "u-b-p1", propertyId: "p-beaulieu", label: "Parking P1", kind: "parking", floor: "-1", areaSqm: 12, rooms: 0, furnished: false },
  { id: "u-bert", propertyId: "p-bertrange", label: "Maison", kind: "dwelling", floor: "—", areaSqm: 168, rooms: 4, furnished: false },
  { id: "u-k-01", propertyId: "p-kirchberg", label: "Plateau 1er", kind: "commercial", floor: "1er", areaSqm: 240, rooms: 0, furnished: false },
  { id: "u-k-rdc", propertyId: "p-kirchberg", label: "Local RDC", kind: "commercial", floor: "RDC", areaSqm: 95, rooms: 0, furnished: false },
  { id: "u-gare", propertyId: "p-gare", label: "Studio 4A", kind: "dwelling", floor: "4e", areaSqm: 34, rooms: 1, furnished: true, vacantSince: "2026-01-10" },
];

export const propertyById = (id: string) => PROPERTIES.find((p) => p.id === id)!;
export const unitById = (id: string) => UNITS.find((u) => u.id === id)!;

// ─── Leases ─────────────────────────────────────────────────────────────────

export interface DemoLease {
  id: string;
  seq: number;
  unitId: string;
  type: LeaseTypeUi;
  status: LeaseStatus;
  tenantContactIds: string[];
  guarantorContactIds?: string[];
  colocation: boolean;
  startDate: string;
  endDate: string | null;
  rentCents: number;
  chargesCents: number;
  chargesRegime: "advances" | "forfait";
  depositMonths: number;
  depositForm: "cash" | "bank_guarantee" | "third_party_caution" | "insurance" | "state_guarantee";
  paymentDay: number;
  rfReference: string;
  lastAdjustmentOn: string | null;
  previousRentCents: number | null;
  capitalComponents: CapitalComponent[];
  vatRegime: "exempt" | "opted";
  vatOption?: { aedApprovalRef: string; decisionDate: string; effectiveFrom: string; tenantDeductionRatioPct: number };
  indexationClause?: { baseIndexValue: number; minMonthsBetween: number; series: string };
  noticeInfo?: { direction: "tenant" | "landlord"; ground: string; arReceivedOn: string; earliestEnd: string };
}

// RF refs are engine-generated (leaseRF) at seed time in the UI layer.
export const LEASES: DemoLease[] = [
  {
    id: "l-3b", seq: 1, unitId: "u-b-3b", type: "residential", status: "active",
    tenantContactIds: ["c-muller"], colocation: false,
    startDate: "2023-04-01", endDate: null,
    rentCents: cents(1520), chargesCents: cents(220), chargesRegime: "advances",
    depositMonths: 2, depositForm: "bank_guarantee", paymentDay: 1,
    rfReference: "", lastAdjustmentOn: "2026-04-01", previousRentCents: cents(1450),
    capitalComponents: [
      { year: 2008, amount: cents(95_000), kind: "land" },
      { year: 2008, amount: cents(290_000), kind: "construction" },
    ],
    vatRegime: "exempt",
  },
  {
    id: "l-3c", seq: 2, unitId: "u-b-3c", type: "residential", status: "active",
    tenantContactIds: ["c-jeanne"], colocation: false,
    startDate: "2024-07-01", endDate: null,
    rentCents: cents(1450), chargesCents: cents(210), chargesRegime: "advances",
    depositMonths: 2, depositForm: "cash", paymentDay: 1,
    rfReference: "", lastAdjustmentOn: null, previousRentCents: null,
    capitalComponents: [
      { year: 2008, amount: cents(94_000), kind: "land" },
      { year: 2008, amount: cents(285_000), kind: "construction" },
    ],
    vatRegime: "exempt",
  },
  {
    id: "l-2a", seq: 3, unitId: "u-b-2a", type: "residential", status: "active",
    tenantContactIds: ["c-santos", "c-weber"], colocation: true,
    startDate: "2025-09-01", endDate: null,
    rentCents: cents(1980), chargesCents: cents(260), chargesRegime: "advances",
    depositMonths: 2, depositForm: "state_guarantee", paymentDay: 3,
    rfReference: "", lastAdjustmentOn: null, previousRentCents: null,
    capitalComponents: [
      { year: 2008, amount: cents(110_000), kind: "land" },
      { year: 2008, amount: cents(340_000), kind: "construction" },
    ],
    vatRegime: "exempt",
  },
  {
    id: "l-1a", seq: 4, unitId: "u-b-1a", type: "residential", status: "notice",
    tenantContactIds: ["c-dubois"], colocation: false,
    startDate: "2019-10-01", endDate: "2026-11-14",
    rentCents: cents(2150), chargesCents: cents(290), chargesRegime: "advances",
    depositMonths: 2, depositForm: "cash", paymentDay: 1,
    rfReference: "", lastAdjustmentOn: "2024-10-01", previousRentCents: cents(2050),
    capitalComponents: [
      { year: 2008, amount: cents(125_000), kind: "land" },
      { year: 2008, amount: cents(385_000), kind: "construction" },
    ],
    vatRegime: "exempt",
    noticeInfo: { direction: "tenant", ground: "tenant_notice", arReceivedOn: "2026-08-14", earliestEnd: "2026-11-14" },
  },
  {
    id: "l-rdc", seq: 5, unitId: "u-b-rdc", type: "residential", status: "active",
    tenantContactIds: ["c-hoffmann"], colocation: false,
    startDate: "2026-02-01", endDate: null,
    rentCents: cents(1180), chargesCents: cents(150), chargesRegime: "forfait",
    depositMonths: 2, depositForm: "insurance", paymentDay: 1,
    rfReference: "", lastAdjustmentOn: null, previousRentCents: null,
    capitalComponents: [
      { year: 2008, amount: cents(52_000), kind: "land" },
      { year: 2008, amount: cents(160_000), kind: "construction" },
    ],
    vatRegime: "exempt",
  },
  {
    id: "l-bert", seq: 6, unitId: "u-bert", type: "residential", status: "active",
    tenantContactIds: ["c-dubois"], guarantorContactIds: [], colocation: false,
    startDate: "2026-12-01", endDate: null,
    rentCents: cents(3200), chargesCents: cents(0), chargesRegime: "forfait",
    depositMonths: 2, depositForm: "bank_guarantee", paymentDay: 1,
    rfReference: "", lastAdjustmentOn: null, previousRentCents: null,
    capitalComponents: [
      { year: 2022, amount: cents(310_000), kind: "land" },
      { year: 2022, amount: cents(680_000), kind: "construction" },
    ],
    vatRegime: "exempt",
  },
  {
    id: "l-k01", seq: 7, unitId: "u-k-01", type: "commercial", status: "active",
    tenantContactIds: ["c-bock"], colocation: false,
    startDate: "2019-01-01", endDate: "2028-12-31",
    rentCents: cents(6800), chargesCents: cents(900), chargesRegime: "advances",
    depositMonths: 6, depositForm: "bank_guarantee", paymentDay: 1,
    rfReference: "", lastAdjustmentOn: "2026-01-01", previousRentCents: cents(6560),
    capitalComponents: [],
    vatRegime: "opted",
    vatOption: { aedApprovalRef: "AED-OPT-2019-0142", decisionDate: "2018-11-20", effectiveFrom: "2018-12-01", tenantDeductionRatioPct: 100 },
    indexationClause: { baseIndexValue: 875.4, minMonthsBetween: 12, series: "STATEC IPCN" },
  },
  {
    id: "l-krdc", seq: 8, unitId: "u-k-rdc", type: "commercial", status: "draft",
    tenantContactIds: ["c-schmit"], colocation: false,
    startDate: "2026-10-01", endDate: "2031-09-30",
    rentCents: cents(3100), chargesCents: cents(420), chargesRegime: "advances",
    depositMonths: 6, depositForm: "bank_guarantee", paymentDay: 1,
    rfReference: "", lastAdjustmentOn: null, previousRentCents: null,
    capitalComponents: [],
    vatRegime: "exempt",
  },
];

export const leaseById = (id: string) => LEASES.find((l) => l.id === id)!;

export function leaseTenantNames(l: DemoLease): string[] {
  return l.tenantContactIds.map((id) => contactById(id).name);
}

export function leaseUnitLabel(l: DemoLease): string {
  const u = unitById(l.unitId);
  const p = propertyById(u.propertyId);
  return `${u.label} — ${p.name}`;
}

// ─── Rent periods (2026) ────────────────────────────────────────────────────

export interface DemoRentPeriod {
  id: string;
  leaseId: string;
  period: string; // YYYY-MM
  dueDate: string;
  rentCents: number;
  chargesCents: number;
  vatCents: number;
  totalCents: number;
  allocatedCents: number;
  status: RentStatus;
}

function mkPeriods(): DemoRentPeriod[] {
  const out: DemoRentPeriod[] = [];
  const months = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
  for (const l of LEASES) {
    if (l.status === "draft" || l.startDate > "2026-09-30") continue;
    for (const m of months) {
      if (`${m}-01` < l.startDate.slice(0, 8) + "01") continue;
      const vat = l.vatRegime === "opted" && l.vatOption ? Math.round((l.rentCents + l.chargesCents) * 0.17) : 0;
      const total = l.rentCents + l.chargesCents + vat;
      const due = `${m}-${String(l.paymentDay).padStart(2, "0")}`;
      let allocated = total;
      let status: RentStatus = "paid";
      if (m === "2026-09") {
        allocated = 0;
        status = "upcoming";
      } else if (m === "2026-08") {
        // August: the live month. 3B paid at OLD rent (indexation lag);
        // 2A unpaid (late); 1A partial; others paid.
        if (l.id === "l-3b") {
          allocated = cents(1450) + l.chargesCents;
          status = "partial";
        } else if (l.id === "l-2a") {
          allocated = 0;
          status = "late";
        } else if (l.id === "l-1a") {
          allocated = Math.round(total / 2);
          status = "partial";
        }
      } else if (m === "2026-07" && l.id === "l-2a") {
        allocated = 0;
        status = "late";
      }
      out.push({
        id: `rp-${l.id}-${m}`,
        leaseId: l.id,
        period: m,
        dueDate: due,
        rentCents: l.rentCents,
        chargesCents: l.chargesCents,
        vatCents: vat,
        totalCents: total,
        allocatedCents: allocated,
        status,
      });
    }
  }
  return out;
}

export const RENT_PERIODS: DemoRentPeriod[] = mkPeriods();

// ─── Bank ───────────────────────────────────────────────────────────────────

export const BANK_ACCOUNTS = [
  {
    id: "ba-op",
    label: "Compte de gérance (fonds de tiers)",
    iban: "LU28 0019 4006 4475 0000",
    bic: "BCEELULL",
    holderNameVerbatim: "CABINET REUTER GESTION SARL",
    kind: "third_party_receiving",
    provider: "camt",
    consentExpiresAt: null as string | null,
    balanceCents: cents(48_732.4),
  },
  {
    id: "ba-eb",
    label: "BGL — flux API (Enable Banking)",
    iban: "LU12 0030 1234 5678 9000",
    bic: "BGLLLULL",
    holderNameVerbatim: "CABINET REUTER GESTION SARL",
    kind: "operating",
    provider: "enable_banking",
    consentExpiresAt: "2026-09-12",
    balanceCents: cents(12_204.1),
  },
];

export interface DemoBankTx extends BankTransaction {
  status: BankTxStatus;
  matchTier?: string;
  matchExplain?: string;
  matchedLeaseId?: string;
}

export const IBAN_BINDINGS: IbanBinding[] = [
  { payerIban: "LU120010001234567891", leaseId: "l-3b" },
  { payerIban: "LU980020009876543210", leaseId: "l-2a" }, // Ana's mother pays
  { payerIban: "LU550030001111222233", leaseId: "l-k01" },
];

export const BANK_TXS: DemoBankTx[] = [
  {
    id: "tx-01", bookedAt: "2026-08-03", amount: cents(1670),
    counterpartyName: "JEAN MULLER", counterpartyIban: "LU120010001234567891",
    remittanceInfo: "LOYER AOUT RF48 0001 0000 0001", endToEndId: null,
    status: "auto", matchTier: "rf", matchExplain: "Référence RF — rapprochement déterministe. Montant = ancien loyer : INDEXATION_LAG détecté, ordre permanent non mis à jour (manque 70,00 €).",
    matchedLeaseId: "l-3b",
  },
  {
    id: "tx-02", bookedAt: "2026-08-02", amount: cents(1660),
    counterpartyName: "JEANNE MULLER", counterpartyIban: "LU440010005555666677",
    remittanceInfo: "Loyer 3C aout", endToEndId: null,
    status: "auto", matchTier: "fuzzy", matchExplain: "Score 0,89 (marge 0,31) : montant exact + nom + libellé « 3C ».",
    matchedLeaseId: "l-3c",
  },
  {
    id: "tx-03", bookedAt: "2026-08-05", amount: cents(9009),
    counterpartyName: "BOULANGERIE BOCK SARL", counterpartyIban: "LU550030001111222233",
    remittanceInfo: "LOYER + CHARGES PLATEAU KIRCHBERG TVA", endToEndId: null,
    status: "auto", matchTier: "iban_binding", matchExplain: "IBAN payeur lié au bail — allocation FIFO (loyer 6 800 + charges 900 + TVA 17 %).",
    matchedLeaseId: "l-k01",
  },
  {
    id: "tx-04", bookedAt: "2026-08-04", amount: cents(1330),
    counterpartyName: "M HOFFMANN", counterpartyIban: "LU770040004444333322",
    remittanceInfo: "loyer studio", endToEndId: null,
    status: "review", matchExplain: "Score 0,74 sous le seuil 0,85 : IBAN inconnu, libellé sans n° d'unité. Suggestion : lier l'IBAN au bail Studio RDC (une touche).",
  },
  {
    id: "tx-05", bookedAt: "2026-08-06", amount: cents(1220),
    counterpartyName: "CNAP PRESTATIONS", counterpartyIban: "LU160090008888777766",
    remittanceInfo: "AIDE LOGEMENT HOFFMANN MARC 08-2026", endToEndId: null,
    status: "review", matchExplain: "Tiers payeur (aide au logement) — candidat Studio RDC 0,71. Lier l'IBAN CNAP pour automatiser les mois suivants.",
  },
  {
    id: "tx-06", bookedAt: "2026-08-01", amount: cents(2240),
    counterpartyName: "C DUBOIS", counterpartyIban: "LU330010002222111100",
    remittanceInfo: "Loyer aout partiel — solde apres regularisation", endToEndId: null,
    status: "auto", matchTier: "fuzzy", matchExplain: "Score 0,86 : IBAN connu + nom. Paiement partiel — alloué FIFO, reliquat ouvert (préavis en cours).",
    matchedLeaseId: "l-1a",
  },
  {
    id: "tx-07", bookedAt: "2026-08-08", amount: -cents(1240),
    counterpartyName: "KRIER & FILS", counterpartyIban: "LU200020003333444455",
    remittanceInfo: "FACTURE 2026-0812 CHAUDIERE BEAULIEU", endToEndId: null,
    status: "ignored", matchExplain: "Sortant — facture artisan (rapprochée côté factures).",
  },
  {
    id: "tx-08", bookedAt: "2026-08-10", amount: cents(1980) + cents(260),
    counterpartyName: "MME SANTOS PAULA", counterpartyIban: "LU980020009876543210",
    remittanceInfo: "loyer ana + lucas aout", endToEndId: null,
    status: "auto", matchTier: "iban_binding", matchExplain: "IBAN payeur (mère d'Ana Santos) lié au bail colocation 2A — juillet reste ouvert, relance en cours.",
    matchedLeaseId: "l-2a",
  },
];

// ─── Deposits ───────────────────────────────────────────────────────────────

export interface DemoDeposit {
  id: string;
  leaseId: string;
  form: DemoLease["depositForm"];
  amountCents: number;
  status: DepositStatus;
  keyHandoverOn?: string;
  decompteIssuedOn?: string | null;
  miseEnDemeureArOn?: string | null;
  entryEdlExists: boolean;
  deductions: Array<{
    id: string;
    kind: "arrears" | "damage" | "charge_reserve";
    label: string;
    amountCents: number;
    justifiedAt?: string;
    justificationDocRef?: string;
    edlItemRef?: string;
  }>;
  releasedFirstTrancheCents: number;
  releasedBalanceCents: number;
}

export const DEPOSITS: DemoDeposit[] = [
  { id: "dep-3b", leaseId: "l-3b", form: "bank_guarantee", amountCents: cents(2900), status: "held", entryEdlExists: true, deductions: [], releasedFirstTrancheCents: 0, releasedBalanceCents: 0 },
  { id: "dep-3c", leaseId: "l-3c", form: "cash", amountCents: cents(2900), status: "held", entryEdlExists: true, deductions: [], releasedFirstTrancheCents: 0, releasedBalanceCents: 0 },
  { id: "dep-2a", leaseId: "l-2a", form: "state_guarantee", amountCents: cents(3960), status: "held", entryEdlExists: true, deductions: [], releasedFirstTrancheCents: 0, releasedBalanceCents: 0 },
  { id: "dep-1a", leaseId: "l-1a", form: "cash", amountCents: cents(4100), status: "held", entryEdlExists: true, deductions: [], releasedFirstTrancheCents: 0, releasedBalanceCents: 0 },
  { id: "dep-rdc", leaseId: "l-rdc", form: "insurance", amountCents: cents(2360), status: "held", entryEdlExists: true, deductions: [], releasedFirstTrancheCents: 0, releasedBalanceCents: 0 },
  {
    // The settlement showcase: previous tenant of Studio Gare left 15 June.
    id: "dep-gare", leaseId: "l-gare-old", form: "cash", amountCents: cents(2600), status: "release_pending",
    keyHandoverOn: "2026-06-15", decompteIssuedOn: null, miseEnDemeureArOn: null, entryEdlExists: true,
    deductions: [
      { id: "dd-1", kind: "damage", label: "Porte placard rayée (EDL sortie L-12)", amountCents: cents(240), justifiedAt: "2026-07-02", justificationDocRef: "devis-dasilva-118", edlItemRef: "edl-exit-12" },
      { id: "dd-2", kind: "damage", label: "Trous non rebouchés séjour", amountCents: cents(180) },
      { id: "dd-3", kind: "charge_reserve", label: "Réserve décompte charges 2026", amountCents: cents(300), justifiedAt: "2026-06-20", justificationDocRef: "budget-syndic-2026" },
    ],
    releasedFirstTrancheCents: cents(1040), releasedBalanceCents: 0,
  },
  { id: "dep-k01", leaseId: "l-k01", form: "bank_guarantee", amountCents: cents(40_800), status: "held", entryEdlExists: true, deductions: [], releasedFirstTrancheCents: 0, releasedBalanceCents: 0 },
];

// A synthetic ended lease backing the settlement showcase.
export const ENDED_LEASES: Array<{ id: string; label: string; tenant: string; rentCents: number }> = [
  { id: "l-gare-old", label: "Studio 4A — Studio Quartier Gare", tenant: "Nora Adam", rentCents: cents(1300) },
];

// ─── EDL ────────────────────────────────────────────────────────────────────

export interface DemoEdl {
  id: string;
  leaseId: string;
  unitLabel: string;
  kind: "entry" | "intermediate" | "exit";
  status: EdlStatus;
  scheduledAt: string | null;
  completedAt: string | null;
  itemsCount: number;
  photosCount: number;
  keyHandoverAt: string | null;
  hashSealed: boolean;
}

export const EDLS: DemoEdl[] = [
  { id: "edl-1", leaseId: "l-rdc", unitLabel: "Studio RDC — Résidence Beaulieu", kind: "entry", status: "sealed", scheduledAt: "2026-01-30", completedAt: "2026-01-30", itemsCount: 42, photosCount: 128, keyHandoverAt: "2026-01-30", hashSealed: true },
  { id: "edl-2", leaseId: "l-gare-old", unitLabel: "Studio 4A — Studio Quartier Gare", kind: "exit", status: "signed", scheduledAt: "2026-06-15", completedAt: "2026-06-15", itemsCount: 38, photosCount: 96, keyHandoverAt: "2026-06-15", hashSealed: true },
  { id: "edl-3", leaseId: "l-1a", unitLabel: "Apt 1A — Résidence Beaulieu", kind: "exit", status: "draft", scheduledAt: "2026-11-13", completedAt: null, itemsCount: 0, photosCount: 0, keyHandoverAt: null, hashSealed: false },
  { id: "edl-4", leaseId: "l-bert", unitLabel: "Maison — Maison Bertrange", kind: "entry", status: "draft", scheduledAt: "2026-11-28", completedAt: null, itemsCount: 0, photosCount: 0, keyHandoverAt: null, hashSealed: false },
  { id: "edl-5", leaseId: "l-2a", unitLabel: "Apt 2A — Résidence Beaulieu", kind: "entry", status: "sealed", scheduledAt: "2025-08-30", completedAt: "2025-08-30", itemsCount: 51, photosCount: 164, keyHandoverAt: "2025-08-30", hashSealed: true },
];

// ─── Tickets ────────────────────────────────────────────────────────────────

export interface DemoTicket {
  id: string;
  ref: string;
  unitLabel: string;
  leaseId: string | null;
  source: "tenant" | "manager" | "edl_defect" | "owner";
  category: string;
  severity: TicketSeverity;
  status: TicketStatus;
  title: string;
  createdAt: string;
  slaDueAt: string | null;
  artisanContactId?: string;
  amountCents?: number;
  rechargeDecision?: { decision: "owner" | "tenant" | "split"; note: string };
}

export const TICKETS: DemoTicket[] = [
  {
    id: "t-1", ref: "INT-2026-0141", unitLabel: "Apt 3B — Résidence Beaulieu", leaseId: "l-3b",
    source: "tenant", category: "heating", severity: "urgent", status: "scheduled",
    title: "Chaudière en défaut — pression à 0,4 bar", createdAt: "2026-08-19", slaDueAt: "2026-08-25",
    artisanContactId: "c-krier", amountCents: cents(1240),
    rechargeDecision: { decision: "owner", note: "Grosse réparation — jamais refacturable au locataire (blocage légal)." },
  },
  {
    id: "t-2", ref: "INT-2026-0142", unitLabel: "Apt 2A — Résidence Beaulieu", leaseId: "l-2a",
    source: "tenant", category: "damp_mould", severity: "priority", status: "in_progress",
    title: "Trace d'humidité mur chambre 2", createdAt: "2026-08-12", slaDueAt: "2026-08-27",
    artisanContactId: "c-da-silva",
  },
  {
    id: "t-3", ref: "INT-2026-0139", unitLabel: "Plateau 1er — Bureaux Kirchberg", leaseId: "l-k01",
    source: "tenant", category: "electrics", severity: "routine", status: "done",
    title: "Prise réseau défectueuse open space", createdAt: "2026-08-02", slaDueAt: "2026-08-16",
    artisanContactId: "c-elektro", amountCents: cents(380),
    rechargeDecision: { decision: "tenant", note: "Bail commercial — refacturation selon clause charges (équipement preneur)." },
  },
  {
    id: "t-4", ref: "INT-2026-0143", unitLabel: "Studio RDC — Résidence Beaulieu", leaseId: "l-rdc",
    source: "edl_defect", category: "plumbing", severity: "routine", status: "pending_tenant",
    title: "Joint silicone douche à refaire (défaut EDL n° 17)", createdAt: "2026-08-05", slaDueAt: null,
  },
  {
    id: "t-5", ref: "INT-2026-0144", unitLabel: "Studio 4A — Studio Quartier Gare", leaseId: null,
    source: "manager", category: "common_areas", severity: "routine", status: "offered",
    title: "Remise en peinture avant relocation", createdAt: "2026-08-18", slaDueAt: null,
    artisanContactId: "c-da-silva", amountCents: cents(2150),
    rechargeDecision: { decision: "owner", note: "Vétusté / remise en état entre locataires — charge propriétaire." },
  },
];

// ─── Meters ─────────────────────────────────────────────────────────────────

export interface DemoMeter {
  id: string;
  unitId: string | null;
  propertyId: string;
  kind: MeterKind;
  serial: string;
  supplier: string;
  lastReading: { date: string; value: number; source: string; tenantAck: boolean; managerAck: boolean } | null;
}

export const METERS: DemoMeter[] = [
  { id: "m-1", unitId: "u-b-3b", propertyId: "p-beaulieu", kind: "electricity", serial: "LU-ENO-448291", supplier: "Enovos", lastReading: { date: "2026-08-01", value: 34_812, source: "photo_ocr", tenantAck: true, managerAck: true } },
  { id: "m-2", unitId: "u-b-3b", propertyId: "p-beaulieu", kind: "water_cold", serial: "VDL-W-77120", supplier: "Ville de Luxembourg", lastReading: { date: "2026-08-01", value: 412.6, source: "photo_ocr", tenantAck: true, managerAck: false } },
  { id: "m-3", unitId: "u-b-2a", propertyId: "p-beaulieu", kind: "electricity", serial: "LU-ENO-448305", supplier: "Enovos", lastReading: { date: "2025-08-30", value: 12_040, source: "edl", tenantAck: true, managerAck: true } },
  { id: "m-4", unitId: "u-bert", propertyId: "p-bertrange", kind: "gas", serial: "SUDGAZ-90112", supplier: "Sudgaz", lastReading: null },
  { id: "m-5", unitId: "u-gare", propertyId: "p-gare", kind: "electricity", serial: "LU-ENO-501822", supplier: "Enovos", lastReading: { date: "2026-06-15", value: 8_921, source: "edl", tenantAck: true, managerAck: true } },
  { id: "m-6", unitId: null, propertyId: "p-beaulieu", kind: "heat", serial: "ISTA-COL-2210", supplier: "ista (répartition)", lastReading: { date: "2026-07-01", value: 148_220, source: "import", tenantAck: false, managerAck: true } },
];

// ─── Workflows ──────────────────────────────────────────────────────────────

export interface DemoWorkflow {
  id: string;
  kind: WorkflowKind;
  label: string;
  currentState: string;
  startedAt: string;
  blockedReason: string | null;
}

export const WORKFLOWS: DemoWorkflow[] = [
  { id: "wf-1", kind: "move_in", label: "Maison Bertrange — Claire Dubois", currentState: "PRE_MOVE_IN", startedAt: "2026-07-20", blockedReason: null },
  { id: "wf-2", kind: "move_in", label: "Studio 4A Gare — relocation", currentState: "MARKETING", startedAt: "2026-06-20", blockedReason: "CPE présent, photos en attente — publication bloquée tant que l'annonce est incomplète" },
  { id: "wf-3", kind: "move_out", label: "Apt 1A — Claire Dubois (préavis)", currentState: "PRE_EXIT", startedAt: "2026-08-14", blockedReason: null },
  { id: "wf-4", kind: "move_out", label: "Studio 4A — Nora Adam", currentState: "SETTLEMENT", startedAt: "2026-06-15", blockedReason: "1 déduction sans justificatif — expire le 15/07 (forfaite ensuite)" },
  { id: "wf-5", kind: "move_in", label: "Local RDC Kirchberg — Boulangerie-café", currentState: "LEASE", startedAt: "2026-08-01", blockedReason: null },
];

// ─── Messaging ──────────────────────────────────────────────────────────────

export interface DemoConversation {
  id: string;
  subject: string;
  scopeLabel: string;
  lastMessageAt: string;
  unread: number;
  messages: Array<{ from: string; kind: "tenant" | "manager" | "owner" | "artisan" | "system"; body: string; at: string }>;
}

export const CONVERSATIONS: DemoConversation[] = [
  {
    id: "conv-1", subject: "Chaudière — intervention vendredi", scopeLabel: "INT-2026-0141 · Apt 3B", lastMessageAt: "2026-08-21T16:40:00", unread: 1,
    messages: [
      { from: "Jean Muller", kind: "tenant", body: "Bonjour, la pression est retombée à 0,4 ce matin. Photo jointe.", at: "2026-08-19T08:12:00" },
      { from: "Cabinet Reuter", kind: "manager", body: "Merci — Krier & Fils passe vendredi 8 h–10 h. Le créneau vous convient ?", at: "2026-08-19T09:05:00" },
      { from: "Paul Krier", kind: "artisan", body: "Créneau accepté. Prévoir accès à la cave (vase d'expansion).", at: "2026-08-21T16:40:00" },
    ],
  },
  {
    id: "conv-2", subject: "Attestation de logement", scopeLabel: "Bail Apt 2A", lastMessageAt: "2026-08-20T11:02:00", unread: 0,
    messages: [
      { from: "Ana Santos", kind: "tenant", body: "Bonjour, il me faut une attestation pour la commune (déclaration d'arrivée de Lucas).", at: "2026-08-20T10:48:00" },
      { from: "Système", kind: "system", body: "Attestation générée en libre-service (QR de vérification) — délai commune : 8 jours après emménagement.", at: "2026-08-20T11:02:00" },
    ],
  },
  {
    id: "conv-3", subject: "Ordre permanent à mettre à jour", scopeLabel: "Bail Apt 3B", lastMessageAt: "2026-08-18T09:30:00", unread: 0,
    messages: [
      { from: "Système", kind: "system", body: "Paiement d'août reçu à l'ancien montant (1 450,00 € au lieu de 1 520,00 €). Courrier pré-rempli « mettez à jour votre ordre permanent » prêt à envoyer.", at: "2026-08-18T09:30:00" },
    ],
  },
  {
    id: "conv-4", subject: "Décompte de gérance juillet", scopeLabel: "Mandat SCI Beaulieu", lastMessageAt: "2026-08-05T14:20:00", unread: 0,
    messages: [
      { from: "Cabinet Reuter", kind: "manager", body: "Décompte de juillet joint : 5 loyers encaissés, honoraires 4 % + TVA 17 %, virement du solde exécuté le 5.", at: "2026-08-05T14:20:00" },
      { from: "Marie Faber", kind: "owner", body: "Bien reçu, merci. La facture Krier passera bien sur août ?", at: "2026-08-05T15:01:00" },
    ],
  },
];

// ─── Fiscal (amortisation showcase for Sophie Lambert) ──────────────────────

export const LAMBERT_PORTFOLIO: Array<{ propertyId: string; label: string; facts: AcquisitionFacts; ownershipShare: number }> = [
  {
    propertyId: "p-kirchberg",
    label: "Bureaux Kirchberg",
    ownershipShare: 1,
    facts: {
      acquiredOn: "2021-03-15", completedOn: "2015-11-01",
      totalPrice: cents(2_100_000), landPrice: cents(420_000), vatPaid: 0,
      deedCosts: cents(147_000), investments: cents(85_000),
      energyWorksCost: cents(120_000), energyWorksCompletedOn: "2024-09-15", klimabonusReceived: cents(38_000),
      vefa2024Eligible: false,
    },
  },
  {
    propertyId: "p-gare",
    label: "Studio Quartier Gare (VEFA 2024)",
    ownershipShare: 1,
    facts: {
      acquiredOn: "2024-06-01", completedOn: "2024-04-30",
      totalPrice: cents(640_000), landPrice: null, vatPaid: cents(19_200),
      deedCosts: cents(44_800), investments: 0,
      energyWorksCost: 0, energyWorksCompletedOn: null, klimabonusReceived: 0,
      vefa2024Eligible: true,
    },
  },
];

export const SCI_BEAULIEU_PORTFOLIO: Array<{ propertyId: string; label: string; facts: AcquisitionFacts; ownershipShare: number }> = [
  {
    propertyId: "p-beaulieu",
    label: "Résidence Beaulieu (via SCI, part Marie Faber 60 %)",
    ownershipShare: 0.6,
    facts: {
      acquiredOn: "2021-06-01", completedOn: "2021-03-15",
      totalPrice: cents(2_450_000), landPrice: cents(490_000), vatPaid: cents(73_500),
      deedCosts: cents(171_500), investments: 0,
      energyWorksCost: 0, energyWorksCompletedOn: null, klimabonusReceived: 0,
      vefa2024Eligible: false,
    },
  },
  {
    propertyId: "p-bertrange",
    label: "Maison Bertrange (part Marie Faber 50 %)",
    ownershipShare: 0.5,
    facts: {
      acquiredOn: "2022-06-01", completedOn: "2022-05-15",
      totalPrice: cents(990_000), landPrice: cents(310_000), vatPaid: cents(29_700),
      deedCosts: cents(69_300), investments: 0,
      energyWorksCost: 0, energyWorksCompletedOn: null, klimabonusReceived: 0,
      vefa2024Eligible: false,
    },
  },
  {
    propertyId: "p-x-echternach",
    label: "Appartement Echternach (hors mandat, déclaré par la propriétaire)",
    ownershipShare: 1,
    facts: {
      acquiredOn: "2023-02-01", completedOn: "2022-11-30",
      totalPrice: cents(720_000), landPrice: cents(144_000), vatPaid: cents(21_600),
      deedCosts: cents(50_400), investments: 0,
      energyWorksCost: 0, energyWorksCompletedOn: null, klimabonusReceived: 0,
      vefa2024Eligible: false,
    },
  },
];

// ─── Charges / décompte showcase ────────────────────────────────────────────

export const SYNDIC_DECOMPTE_2025 = {
  propertyId: "p-beaulieu",
  year: 2025,
  agApproved: true,
  tantiemesTotal: 1000,
  lines: [
    { label: "Chauffage collectif (ista)", category: "heating" as const, totalBuilding: cents(18_400) },
    { label: "Eau froide commune", category: "water" as const, totalBuilding: cents(4_100) },
    { label: "Entretien ascenseur", category: "lift_maintenance" as const, totalBuilding: cents(3_600) },
    { label: "Nettoyage communs", category: "cleaning_common" as const, totalBuilding: cents(5_200) },
    { label: "Électricité communs", category: "common_electricity" as const, totalBuilding: cents(2_300) },
    { label: "Honoraires syndic", category: "management_fee" as const, totalBuilding: cents(7_800) },
    { label: "Assurance immeuble", category: "building_insurance" as const, totalBuilding: cents(5_900) },
    { label: "Réfection toiture (fonds travaux)", category: "major_repair" as const, totalBuilding: cents(24_000) },
  ],
};

export const LEASE_TANTIEMES: Record<string, number> = {
  "l-3b": 118,
  "l-3c": 116,
  "l-2a": 141,
  "l-1a": 158,
  "l-rdc": 64,
};

// ─── Documents ──────────────────────────────────────────────────────────────

export interface DemoDocument {
  id: string;
  name: string;
  klass: string;
  retentionClass: string;
  retentionUntil: string | null;
  sealed: boolean;
  relatedLabel: string;
  sizeKb: number;
  createdAt: string;
}

export const DOCUMENTS: DemoDocument[] = [
  { id: "d-1", name: "Bail Apt 3B — Muller (signé AES).pdf", klass: "lease", retentionClass: "accounting_10y", retentionUntil: "2036-04-01", sealed: true, relatedLabel: "Apt 3B", sizeKb: 842, createdAt: "2023-03-20" },
  { id: "d-2", name: "EDL entrée Studio RDC (scellé, manifeste SHA-256).pdf", klass: "edl", retentionClass: "accounting_10y", retentionUntil: "2036-02-01", sealed: true, relatedLabel: "Studio RDC", sizeKb: 12_400, createdAt: "2026-01-30" },
  { id: "d-3", name: "Facture Krier 2026-0812 — chaudière.pdf", klass: "invoice", retentionClass: "accounting_10y", retentionUntil: "2036-08-08", sealed: false, relatedLabel: "INT-2026-0141", sizeKb: 210, createdAt: "2026-08-08" },
  { id: "d-4", name: "Acte notarié Studio Gare (VEFA 2024).pdf", klass: "deed", retentionClass: "permanent", retentionUntil: null, sealed: true, relatedLabel: "Studio Quartier Gare", sizeKb: 4_820, createdAt: "2024-06-01" },
  { id: "d-5", name: "Certificat d'intérêts BCEE 2025 — SCI Beaulieu.pdf", klass: "tax", retentionClass: "accounting_10y", retentionUntil: "2036-01-15", sealed: false, relatedLabel: "SCI Beaulieu", sizeKb: 96, createdAt: "2026-01-15" },
  { id: "d-6", name: "Mise en demeure Apt 2A — AR du 12/08 (scan).pdf", klass: "registered_letter", retentionClass: "accounting_10y", retentionUntil: "2036-08-12", sealed: true, relatedLabel: "Apt 2A", sizeKb: 380, createdAt: "2026-08-12" },
  { id: "d-7", name: "CDD — SCI Beaulieu (RBE, registre associés, UBO).pdf", klass: "id_document", retentionClass: "aml_5y_from_end", retentionUntil: null, sealed: false, relatedLabel: "SCI Beaulieu", sizeKb: 1_240, createdAt: "2026-02-10" },
  { id: "d-8", name: "Décompte syndic 2025 — Résidence Beaulieu (AG approuvé).pdf", klass: "decompte", retentionClass: "accounting_10y", retentionUntil: "2036-05-30", sealed: false, relatedLabel: "Résidence Beaulieu", sizeKb: 1_860, createdAt: "2026-05-30" },
  { id: "d-9", name: "Dossier candidature T. Schmit (non retenu).zip", klass: "other", retentionClass: "applicant_3m", retentionUntil: "2026-10-30", sealed: false, relatedLabel: "Local RDC Kirchberg", sizeKb: 3_100, createdAt: "2026-07-30" },
];

// ─── Open invoices helper for the matching engine demo ──────────────────────

export function openInvoicesForMatching(): OpenInvoice[] {
  return RENT_PERIODS.filter((rp) => rp.allocatedCents < rp.totalCents && rp.period <= "2026-08").map((rp) => {
    const l = leaseById(rp.leaseId);
    return {
      id: rp.id,
      leaseId: l.id,
      tenantNames: leaseTenantNames(l),
      rfReference: l.rfReference,
      dueDate: rp.dueDate,
      totalAmount: rp.totalCents,
      openAmount: rp.totalCents - rp.allocatedCents,
      previousRentAmount: l.previousRentCents,
      unitLabel: leaseUnitLabel(l),
    };
  });
}
