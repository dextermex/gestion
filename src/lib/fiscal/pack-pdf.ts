import type { DocumentModel, Section } from "@/lib/documents/model";
import type { Dict } from "@/lib/i18n/fr";
import { fmt, type Locale } from "@/lib/i18n/config";
import { euros, formatDate } from "@/lib/types";
import { getParamValue } from "@/domain/legal/params";
import type { FiscalOwnerYear } from "./pack";
import { attachmentLabel, filingDeadline, flatText, lineLabel, regimeLabel, sectionLabel, warningText } from "./labels";

/**
 * The pack as a document: a cover with the owner and the exercise, the
 * summary, one statement per property as a two-column ledger, the
 * taxpayer's amortisation plan, the pieces to attach with their state,
 * the residence-state annex when it applies. The same renderer draws it
 * as every produced document; the figures come from the prepared
 * exercise, never recomputed here.
 */
export const FISCAL_PACK_VERSION = "2026-10-01.1";

export function composeFiscalPack(owner: FiscalOwnerYear, input: { d: Dict; locale: Locale; cabinetName: string; today: string; sample: boolean }): DocumentModel {
  const { d, locale } = input;
  const year = owner.year.taxYear;
  const money = (c: number) => euros(c, locale);
  const residency = owner.year.residency === "non_resident" ? fmt(d.fiscalite.pdfNonResident, { country: owner.year.residenceCountry ?? "" }) : d.fiscalite.pdfResident;

  const summary: Section = {
    heading: d.fiscalite.pdfSummary,
    keyValues: [
      [fmt(d.fiscalite.heroTitle, { year }), money(owner.summary.ownerShareNet)],
      [d.fiscalite.grossRents, money(owner.summary.grossRents)],
      [d.fiscalite.totalDeductions, money(owner.summary.deductions)],
      [fmt(d.fiscalite.amortTitle, { year }), money(owner.plan.totalAmortisation)],
      [d.fiscalite.pdfProperties, String(owner.summary.properties)],
      [d.fiscalite.pdfResidency, residency],
    ],
    note: fmt(d.fiscalite.heroDeadline, { date: formatDate(filingDeadline(year), locale) }),
  };

  const statements: Section[] = owner.statements.map(({ property, pack }) => {
    const rows: string[][] = [];
    rows.push([d.fiscalite.grossRents, money(pack.grossRents.totalTaxable)]);
    if (pack.grossRents.dwelling > 0) rows.push([`  ${d.fiscalite.rentDwelling}`, money(pack.grossRents.dwelling)]);
    if (pack.grossRents.garageParking > 0) rows.push([`  ${d.fiscalite.rentGarage}`, money(pack.grossRents.garageParking)]);
    if (pack.grossRents.furnitureSupplement > 0) rows.push([`  ${d.fiscalite.rentFurniture}`, money(pack.grossRents.furnitureSupplement)]);
    if (pack.grossRents.retainedDeposits > 0) rows.push([`  ${d.fiscalite.rentRetained}`, money(pack.grossRents.retainedDeposits)]);
    for (const s of pack.sections) {
      rows.push([sectionLabel(d, s.code), money(s.amount)]);
      for (const l of s.lines) if (l.amount > 0) rows.push([`  ${lineLabel(d, l)}`, money(l.amount)]);
    }
    rows.push([d.fiscalite.totalDeductions, money(pack.deductionsTotal)]);
    if (pack.socialExemptionApplied > 0) rows.push([d.fiscalite.socialExemption, money(-pack.socialExemptionApplied)]);
    const total = [d.fiscalite.netResult, money(pack.netResult)];
    const notes = [flatText(d, pack, locale), ...pack.warningCodes.map((w) => warningText(d, w, locale))].filter(Boolean);
    return {
      heading: fmt(d.fiscalite.statementTitle, { property: property.name }),
      paragraphs: [`${property.cadastralRef} · ${fmt(d.fiscalite.monthsLet, { n: pack.monthsLet })}${pack.vacancyMonths > 0 ? ` · ${fmt(d.fiscalite.vacancy, { n: pack.vacancyMonths })}` : ""}`],
      table: { columns: [{ label: d.fiscalite.csvLine, width: 3 }, { label: d.fiscalite.csvEuros, align: "right", width: 1 }], rows, total },
      keyValues: pack.sections.length > 0 && pack.ownerShareNet !== pack.netResult ? [[fmt(d.fiscalite.ownerShare, { pct: Math.round((pack.ownerShareNet / (pack.netResult || 1)) * 100) }), money(pack.ownerShareNet)]] : undefined,
      note: notes.join(" "),
    };
  });

  const jan1 = `${year}-01-01`;
  const maxSlots = getParamValue("amort.accelerated_max_buildings_per_taxpayer", jan1);
  const cap = getParamValue("amort.abattement_special_cap_eur_per_taxpayer", jan1) * 100 * (owner.year.jointlyTaxed ? 2 : 1);
  const plan: Section = {
    heading: d.fiscalite.planTitle,
    table: {
      columns: [
        { label: d.fiscalite.colProperty, width: 3 },
        { label: d.fiscalite.colRegime, width: 2 },
        { label: d.fiscalite.colBase, align: "right", width: 1.5 },
        { label: d.fiscalite.colRate, align: "right", width: 0.8 },
        { label: d.fiscalite.colAnnuity, align: "right", width: 1.3 },
        { label: d.fiscalite.colShare, align: "right", width: 1.3 },
      ],
      rows: owner.plan.rows.flatMap((r) => [
        [r.label, regimeLabel(d, r.result.regime.regime), money(r.result.regime.cappedBase), `${r.result.regime.ratePct} %`, money(r.result.buildingAmount), money(r.taxpayerShareAmount)],
        ...(r.result.energy.applicable ? [[`  ${fmt(d.fiscalite.lineEnergy, { rate: r.result.energy.ratePct })}`, "", "", `${r.result.energy.ratePct} %`, money(r.result.energy.amount), ""]] : []),
      ]),
      total: [d.fiscalite.totalAmort, "", "", "", "", money(owner.plan.totalAmortisation)],
    },
    note: [
      fmt(d.fiscalite.slotsLine, { used: owner.plan.acceleratedSlotsUsed, max: maxSlots }),
      fmt(d.fiscalite.abattementLine, { amount: money(owner.plan.totalAbattement), cap: money(cap) }),
      owner.year.jointlyTaxed ? d.fiscalite.jointLabel : "",
    ]
      .filter(Boolean)
      .join(" "),
  };

  const stateLabel = { vault: d.fiscalite.stateVault, cabinet: d.fiscalite.stateCabinet, ask: d.fiscalite.stateAsk };
  const checklist: Section = {
    heading: d.fiscalite.checklistTitle,
    table: {
      columns: [{ label: d.fiscalite.csvLine, width: 3 }, { label: d.fiscalite.colProperty, width: 2 }, { label: d.fiscalite.csvValue, width: 1.5 }],
      rows: owner.attachments.map((a) => [attachmentLabel(d, a.code), a.propertyName, a.state === "vault" && a.documentName ? `${stateLabel.vault} · ${a.documentName}` : stateLabel[a.state]]),
    },
  };

  const nr = owner.statements.map((s) => s.pack.nonResidentExport).filter((x): x is NonNullable<typeof x> => x !== null);
  const annex: Section[] =
    nr.length > 0
      ? [
          {
            heading: fmt(d.fiscalite.nrTitle, { country: owner.year.residenceCountry ?? "" }),
            keyValues: [
              [d.fiscalite.nrGross, money(nr.reduce((a, x) => a + x.grossRents, 0))],
              [d.fiscalite.nrExpenses, money(nr.reduce((a, x) => a + x.deductibleExpensesExclAmort, 0))],
              [d.fiscalite.nrInterest, money(nr.reduce((a, x) => a + x.debtInterest, 0))],
              [d.fiscalite.nrAmort, money(nr.reduce((a, x) => a + x.luxembourgOnlyAmortisation, 0))],
            ],
            note: d.fiscalite.howNr,
          },
        ]
      : [];

  return {
    kind: "fiscal_pack",
    lang: locale,
    version: FISCAL_PACK_VERSION,
    title: fmt(d.fiscalite.pdfTitle, { year }),
    subtitle: d.fiscalite.pdfSubtitle,
    sender: { name: input.cabinetName, lines: [d.fiscalite.pdfCabinet] },
    recipient: { name: owner.ownerName, lines: [residency] },
    dateLine: formatDate(input.today, locale),
    reference: fmt(d.fiscalite.dlPack, { year, owner: owner.ownerName }),
    sections: [summary, ...statements, plan, checklist, ...annex],
    footer: fmt(d.fiscalite.pdfFooter, { year, date: formatDate(input.today, locale) }),
    watermark: input.sample ? d.fiscalite.pdfSample : undefined,
  };
}
