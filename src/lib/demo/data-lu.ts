/**
 * Luxembourgish demo dataset — the same portfolio as `data.ts`, kept as the
 * records of a Lëtzebuergesch-speaking cabinet (Cabinet Majerus, Minett).
 * Every id, number, date and enum is IDENTICAL to the French dataset by
 * construction: this module only overrides display strings (names, addresses,
 * free-text records). Engines therefore produce byte-identical figures on
 * either dataset. Legal terms of art stay French (bail, décompte, EDL,
 * mise en demeure), matching the product-wide i18n rule.
 */

import * as fr from "./data";
import type { DemoBankTx, DemoContact, DemoConversation, DemoDeposit, DemoDocument, DemoEdl, DemoLease, DemoMeter, DemoProperty, DemoTicket, DemoUnit, DemoWorkflow } from "./data";
import type { OpenInvoice } from "@/domain/banking/matching";

/** Merge per-id string overrides into a copy of the FR rows. Throws at module
 *  load when an override targets a missing id — dataset drift fails loudly. */
function overlay<T extends { id: string }>(rows: T[], patches: Record<string, Partial<T>>): T[] {
  for (const id of Object.keys(patches)) {
    if (!rows.some((r) => r.id === id)) throw new Error(`data-lu overlay: unknown id ${id}`);
  }
  return rows.map((r) => (patches[r.id] ? { ...r, ...patches[r.id] } : r));
}

export const TODAY = fr.TODAY;

export const ORG = {
  ...fr.ORG,
  name: "Morada Gestion · Cabinet Majerus",
  shortName: "Cabinet Majerus",
  managerName: "Anne Majerus",
  managerEmail: "anne@cabinet-majerus.lu",
  billInbox: "rechnungen@cabinet-majerus.morada.lu",
};

// ─── Contacts ───────────────────────────────────────────────────────────────

export const CONTACTS: DemoContact[] = overlay(fr.CONTACTS, {
  "c-muller": { name: "Jang Weis", email: "jang.weis@pt.lu" },
  "c-jeanne": { name: "Nathalie Klein", email: "nathalie.klein@gmail.com" },
  // Ana Santos stays — the Portuguese community is as real in the Minett as anywhere.
  "c-weber": { name: "Luc Wagener", email: "l.wagener@education.lu" },
  "c-dubois": { name: "Chantal Kremer", email: "chantal.kremer@outlook.com" },
  "c-hoffmann": { name: "Marco Steffen", email: "marco.steffen@pt.lu" },
  "c-krier": { name: "Pol Kirsch", email: "p.kirsch@kirsch-jong.lu", notes: "Heizung a Sanitär, kënnt bannent 48 Stonnen" },
  "c-da-silva": { name: "José Da Silva", email: "contact@dasilva-molerei.lu", notes: "Molerei, Buedem" },
  "c-elektro": { name: "Elektro Wagener Sàrl", email: "info@elektrowagener.lu" },
  "c-sci-bealieu": {
    name: "SCI Uelzecht",
    email: "sci.uelzecht@fiduciaire-majerus.lu",
    notes: "Société civile immobilière, transparent (Art. 175 LIR), Modell 200",
  },
  "c-faber": { name: "Marie-Josée Kieffer", email: "mj.kieffer@pt.lu" },
  "c-faber-p": { name: "Pierre Kieffer", email: "pierre.kieffer@pt.lu" },
  "c-lambert": {
    name: "Sabine Peeters",
    email: "sabine.peeters@skynet.be",
    country: "Belsch",
    notes: "Net-Residentin (BE), duebele Steierpack: Modell 100 LU + Cadre III BE",
  },
  "c-bock": { name: "Bäckerei Kremer Sàrl", email: "info@baeckerei-kremer.lu" },
  "c-wagner": { name: "Lynn Wampach", email: "lynn.wampach@gmail.com" },
  "c-notaire": { name: "Me Josée Konsbruck", email: "etude@konsbruck-notaire.lu" },
});

export const contactById = (id: string) => CONTACTS.find((c) => c.id === id)!;

// ─── Properties & units ─────────────────────────────────────────────────────

export const PROPERTIES: DemoProperty[] = overlay(fr.PROPERTIES, {
  "p-beaulieu": {
    name: "Residenz Uelzecht",
    address: "12, rue de l'Alzette, L-4010 Esch-sur-Alzette",
    commune: "Esch-sur-Alzette",
    cadastralRef: "Esch-sur-Alzette / Sektioun A vun Esch-Nord / n° 372/1145",
    type: "Wunn- a Geschäftshaus",
    syndicName: "Syndic Minett Gestioun SA",
    ownershipNote: "SCI Uelzecht (Marie-Josée Kieffer 60 %, Pierre Kieffer 40 %), transparent",
  },
  "p-bertrange": {
    name: "Haus Miersch",
    address: "8, um Kiesel, L-7526 Mersch",
    commune: "Mersch",
    cadastralRef: "Miersch / Sektioun C vu Miersch / n° 214/889",
    type: "Eefamilljenhaus",
    ownershipNote: "Marie-Josée & Pierre Kieffer, 50/50, kollektiv Besteierung",
  },
  "p-kirchberg": {
    name: "Büroen Nordstad",
    address: "4, avenue de la Gare, L-9044 Ettelbruck",
    commune: "Ettelbruck",
    cadastralRef: "Ettelbréck / Sektioun E vun Ettelbréck / n° 501/2231",
    type: "Bürosgebai",
    syndicName: "Syndic Nordstad Facilities",
    ownershipNote: "Sabine Peeters (Net-Residentin BE), 100 %",
  },
  "p-gare": {
    name: "Studio Diddeleng",
    address: "31, avenue Grande-Duchesse Charlotte, L-3441 Dudelange",
    commune: "Dudelange",
    cadastralRef: "Diddeleng / Sektioun HoB / n° 388/2020",
    type: "Appartement",
    ownershipNote: "Sabine Peeters, VEFA 2024 (Amortissement 6 %, Basis plafonéiert)",
  },
});

export const UNITS: DemoUnit[] = overlay(fr.UNITS, {
  "u-b-3b": { floor: "3. Stack" },
  "u-b-3c": { floor: "3. Stack" },
  "u-b-2a": { floor: "2. Stack" },
  "u-b-1a": { floor: "1. Stack" },
  "u-b-rdc": { label: "Studio Rez", floor: "Rez" },
  "u-bert": { label: "Haus" },
  "u-k-01": { label: "Plateau 1.", floor: "1. Stack" },
  "u-k-rdc": { label: "Lokal Rez", floor: "Rez" },
  "u-gare": { floor: "4. Stack" },
});

export const propertyById = (id: string) => PROPERTIES.find((p) => p.id === id)!;
export const unitById = (id: string) => UNITS.find((u) => u.id === id)!;

// ─── Leases & rent periods (no display strings — shared verbatim) ───────────

export const LEASES: DemoLease[] = fr.LEASES;
export const leaseById = (id: string) => LEASES.find((l) => l.id === id)!;

export function leaseTenantNames(l: DemoLease): string[] {
  return l.tenantContactIds.map((id) => contactById(id).name);
}

export function leaseUnitLabel(l: DemoLease): string {
  const u = unitById(l.unitId);
  const p = propertyById(u.propertyId);
  return `${u.label} · ${p.name}`;
}

export const RENT_PERIODS = fr.RENT_PERIODS;
export const IBAN_BINDINGS = fr.IBAN_BINDINGS;
export const LEASE_TANTIEMES = fr.LEASE_TANTIEMES;

// ─── Bank ───────────────────────────────────────────────────────────────────

export const BANK_ACCOUNTS = fr.BANK_ACCOUNTS.map((b) =>
  b.id === "ba-op"
    ? { ...b, label: "Gérance-Konto (Drëttfongen)", holderNameVerbatim: "CABINET MAJERUS GESTIOUN SARL" }
    : { ...b, label: "BGL · API-Flux (Enable Banking)", holderNameVerbatim: "CABINET MAJERUS GESTIOUN SARL" },
);

export const BANK_TXS: DemoBankTx[] = overlay(fr.BANK_TXS, {
  "tx-01": {
    counterpartyName: "JANG WEIS",
    remittanceInfo: `LOYER AUGUST ${fr.LEASES[0].rfReference}`,
    matchExplain:
      "RF-Referenz: deterministescht Rapprochement. Betrag = alen Loyer: INDEXATION_LAG erkannt, Daueroptrag net aktualiséiert (et feelen 70,00 €).",
  },
  "tx-02": {
    counterpartyName: "NATHALIE KLEIN",
    remittanceInfo: "Loyer 3C August",
    matchExplain: "Score 0,89 (Marge 0,31): exakte Betrag + Numm + Libellé « 3C ».",
  },
  "tx-03": {
    counterpartyName: "BAECKEREI KREMER SARL",
    remittanceInfo: "LOYER + CHARGEN PLATEAU NORDSTAD TVA",
    matchExplain: "Bezuelt-IBAN mam Bail verbonnen: FIFO-Allocatioun (Loyer 6 800 + Chargen 900 + TVA 17 %).",
  },
  "tx-04": {
    counterpartyName: "M STEFFEN",
    remittanceInfo: "loyer studio",
    matchExplain:
      "Score 0,74 ënner dem Seuil 0,85: onbekannten IBAN, Libellé ouni Unitéits-Nr. Virschlag: IBAN mam Bail Studio Rez verbannen (ee Klick).",
  },
  "tx-05": {
    counterpartyName: "CNAP PRESTATIONS",
    remittanceInfo: "AIDE LOGEMENT STEFFEN MARCO 08-2026",
    matchExplain:
      "Drëttbezueler (Wunnhëllef): Kandidat Studio Rez 0,71. CNAP-IBAN verbannen fir déi nächst Méint ze automatiséieren.",
  },
  "tx-06": {
    counterpartyName: "C KREMER",
    remittanceInfo: "Loyer August partiell - Solde no Regularisatioun",
    matchExplain: "Score 0,86: bekannten IBAN + Numm. Deelzuelung: FIFO alloziert, Rescht op (Preavis am Gaang).",
  },
  "tx-07": {
    counterpartyName: "KIRSCH & JONG",
    remittanceInfo: "RECHNUNG 2026-0812 HEIZKESSEL UELZECHT",
    matchExplain: "Ausgang: Handwierker-Rechnung (op der Rechnungssäit rapprochéiert).",
  },
  "tx-08": {
    counterpartyName: "MME SANTOS PAULA",
    remittanceInfo: "loyer ana + luc august",
    matchExplain:
      "Bezuelt-IBAN (Mamm vun der Ana Santos) mam Colocatiouns-Bail 2A verbonnen; Juli nach op, Relance am Gaang.",
  },
});

// ─── Deposits ───────────────────────────────────────────────────────────────

export const DEPOSITS: DemoDeposit[] = fr.DEPOSITS.map((dep) =>
  dep.id === "dep-gare"
    ? {
        ...dep,
        deductions: dep.deductions.map((x) =>
          x.id === "dd-1"
            ? { ...x, label: "Schafsdier verkraazt (EDL Sortie L-12)" }
            : x.id === "dd-2"
              ? { ...x, label: "Lächer net zougemaach am Wunnzëmmer" }
              : { ...x, label: "Reserve Décompte Chargen 2026" },
        ),
      }
    : dep,
);

export const ENDED_LEASES = fr.ENDED_LEASES.map((l) => ({
  ...l,
  label: "Studio 4A · Studio Diddeleng",
  tenant: "Nora Antony",
}));

// ─── EDL ────────────────────────────────────────────────────────────────────

export const EDLS: DemoEdl[] = overlay(fr.EDLS, {
  "edl-1": { unitLabel: "Studio Rez · Residenz Uelzecht" },
  "edl-2": { unitLabel: "Studio 4A · Studio Diddeleng" },
  "edl-3": { unitLabel: "Apt 1A · Residenz Uelzecht" },
  "edl-4": { unitLabel: "Haus · Haus Miersch" },
  "edl-5": { unitLabel: "Apt 2A · Residenz Uelzecht" },
});

// ─── Tickets ────────────────────────────────────────────────────────────────

export const TICKETS: DemoTicket[] = overlay(fr.TICKETS, {
  "t-1": {
    unitLabel: "Apt 3B · Residenz Uelzecht",
    title: "Heizkessel am Feeler, Drock op 0,4 Bar",
    rechargeDecision: { decision: "owner", note: "Grouss Reparatur: ni op de Locataire refakturéierbar (legale Blockage)." },
  },
  "t-2": { unitLabel: "Apt 2A · Residenz Uelzecht", title: "Fiichtegkeetsspuren op der Mauer, Schlofkummer 2" },
  "t-3": {
    unitLabel: "Plateau 1. · Büroen Nordstad",
    title: "Netzwierk-Priis defekt am Open Space",
    rechargeDecision: { decision: "tenant", note: "Kommerzielle Bail: Refakturatioun no der Chargen-Klausel (Equipement vum Preneur)." },
  },
  "t-4": { unitLabel: "Studio Rez · Residenz Uelzecht", title: "Silikon-Fuge an der Dusch nei ze maachen (EDL-Defekt Nr. 17)" },
  "t-5": {
    unitLabel: "Studio 4A · Studio Diddeleng",
    title: "Nei ustrachen virun der Neiverlounung",
    rechargeDecision: { decision: "owner", note: "Vetusté / Remise en état tëscht zwee Locatairen: Charge Proprietär." },
  },
});

// ─── Meters ─────────────────────────────────────────────────────────────────

export const METERS: DemoMeter[] = overlay(fr.METERS, {
  "m-2": { supplier: "Ville d'Esch-sur-Alzette" },
  "m-6": { supplier: "ista (Verdeelung)" },
});

// ─── Workflows ──────────────────────────────────────────────────────────────

export const WORKFLOWS: DemoWorkflow[] = overlay(fr.WORKFLOWS, {
  "wf-1": { label: "Haus Miersch · Chantal Kremer" },
  "wf-2": {
    label: "Studio 4A Diddeleng · Neiverlounung",
    blockedReason: "CPE do, Fotoe feelen nach; Publikatioun blockéiert soulaang d'Annonce net komplett ass",
  },
  "wf-3": { label: "Apt 1A · Chantal Kremer (Preavis)" },
  "wf-4": {
    label: "Studio 4A · Nora Antony",
    blockedReason: "1 Ofzuch ouni Justificatif, leeft de 15/07 of (duerno verfall)",
  },
  "wf-5": { label: "Lokal Rez Nordstad · Bäckerei-Café" },
});

// ─── Messaging ──────────────────────────────────────────────────────────────

export const CONVERSATIONS: DemoConversation[] = overlay(fr.CONVERSATIONS, {
  "conv-1": {
    subject: "Heizkessel: Interventioun freides",
    messages: [
      { from: "Jang Weis", kind: "tenant", body: "Moien, den Drock ass haut de Moien erëm op 0,4 gefall. Foto derbäi.", at: "2026-08-19T08:12:00" },
      { from: "Cabinet Majerus", kind: "manager", body: "Merci, Kirsch & Jong komme freides tëscht 8 an 10 Auer. Passt Iech de Creneau?", at: "2026-08-19T09:05:00" },
      { from: "Pol Kirsch", kind: "artisan", body: "Creneau ugeholl. W.e.g. den Zougang zum Keller virgesinn (Expansiounsgefäss).", at: "2026-08-21T16:40:00" },
    ],
  },
  "conv-2": {
    subject: "Attestation de logement",
    messages: [
      { from: "Ana Santos", kind: "tenant", body: "Moien, ech brauch eng Attestatioun fir d'Gemeng (Arrivée-Deklaratioun vum Luc).", at: "2026-08-20T10:48:00" },
      { from: "System", kind: "system", body: "Attestatioun am Self-Service generéiert (QR-Verifikatioun). Gemengendelai: 8 Deeg nom Anzuch.", at: "2026-08-20T11:02:00" },
    ],
  },
  "conv-3": {
    subject: "Daueroptrag unzepassen",
    messages: [
      { from: "System", kind: "system", body: "August-Zuelung zum ale Montant erakomm (1 450,00 € amplaz 1 520,00 €). Virausgefëllte Bréif « Daueroptrag aktualiséieren » prett fir ze schécken.", at: "2026-08-18T09:30:00" },
    ],
  },
  "conv-4": {
    subject: "Gérance-Décompte Juli",
    scopeLabel: "Mandat SCI Uelzecht",
    messages: [
      { from: "Cabinet Majerus", kind: "manager", body: "Juli-Décompte am Unhang: 5 Loyeren encaisséiert, Honorairen 4 % + TVA 17 %, Virement vum Solde den 5. exekutéiert.", at: "2026-08-05T14:20:00" },
      { from: "Marie-Josée Kieffer", kind: "owner", body: "Gutt krut, merci. D'Rechnung Kirsch kënnt jo op den August-Décompte?", at: "2026-08-05T15:01:00" },
    ],
  },
});

// ─── Fiscal portfolios ──────────────────────────────────────────────────────

export const LAMBERT_PORTFOLIO = fr.LAMBERT_PORTFOLIO.map((x) => ({
  ...x,
  label: x.propertyId === "p-kirchberg" ? "Büroen Nordstad" : "Studio Diddeleng (VEFA 2024)",
}));

export const SCI_BEAULIEU_PORTFOLIO = fr.SCI_BEAULIEU_PORTFOLIO.map((x) => ({
  ...x,
  label:
    x.propertyId === "p-beaulieu"
      ? "Residenz Uelzecht (iwwer SCI, Part Marie-Josée Kieffer 60 %)"
      : x.propertyId === "p-bertrange"
        ? "Haus Miersch (Part Marie-Josée Kieffer 50 %)"
        : "Appartement Iechternach (ausserhalb vum Mandat, vun der Proprietärin deklaréiert)",
}));

// ─── Charges / décompte showcase ────────────────────────────────────────────

const SYNDIC_LINE_LABELS: Record<string, string> = {
  heating: "Kollektiv Heizung (ista)",
  water: "Kaalt Waasser · gemeinsam",
  lift_maintenance: "Ascenseur-Entretien",
  cleaning_common: "Botze Gemeinschaftsraim",
  common_electricity: "Stroum Gemeinschaftsraim",
  management_fee: "Syndic-Honorairen",
  building_insurance: "Gebai-Assurance",
  major_repair: "Daachreparatur (Fonds de travaux)",
};

export const SYNDIC_DECOMPTE_2025 = {
  ...fr.SYNDIC_DECOMPTE_2025,
  lines: fr.SYNDIC_DECOMPTE_2025.lines.map((l) => ({ ...l, label: SYNDIC_LINE_LABELS[l.category] ?? l.label })),
};

// ─── Documents ──────────────────────────────────────────────────────────────

export const DOCUMENTS: DemoDocument[] = overlay(fr.DOCUMENTS, {
  "d-1": { name: "Bail Apt 3B · Weis (signéiert AES).pdf" },
  "d-2": { name: "EDL Entrée Studio Rez (versigelt, SHA-256-Manifest).pdf", relatedLabel: "Studio Rez" },
  "d-3": { name: "Rechnung Kirsch 2026-0812 · Heizkessel.pdf" },
  "d-4": { name: "Notariatsakt Studio Diddeleng (VEFA 2024).pdf", relatedLabel: "Studio Diddeleng" },
  "d-5": { name: "Zënscertificat BCEE 2025 · SCI Uelzecht.pdf", relatedLabel: "SCI Uelzecht" },
  "d-6": { name: "Mise en demeure Apt 2A · AR vum 12/08 (Scan).pdf" },
  "d-7": { name: "CDD · SCI Uelzecht (RBE, Associés-Register, UBO).pdf", relatedLabel: "SCI Uelzecht" },
  "d-8": { name: "Décompte Syndic 2025 · Residenz Uelzecht (AG approuvéiert).pdf", relatedLabel: "Residenz Uelzecht" },
  "d-9": { name: "Kandidatur-Dossier T. Schmit (net zréckbehalen).zip", relatedLabel: "Lokal Rez Nordstad" },
});

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
