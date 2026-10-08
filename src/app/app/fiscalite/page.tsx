import { Fragment } from "react";
import Link from "next/link";
import { Card, EmptyState, PageHeader } from "@/components/pro/ui";
import { Icon } from "@/components/pro/icons";
import { CollapsiblePanel, Panel } from "@/components/gestion/bits";
import FiscalControls from "@/components/gestion/FiscalControls";
import { getDemo } from "@/lib/demo";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";
import { amortReasonText, energyReasonText } from "@/lib/i18n/engine";
import { euros, eurosWhole, formatDate } from "@/lib/types";
import { getParamValue } from "@/domain/legal/params";
import { selectFiscal, type FiscalOwnerYear } from "@/lib/fiscal/pack";
import { attachmentLabel, filingDeadline, flatText, lineLabel, regimeLabel, sectionLabel, warningText } from "@/lib/fiscal/labels";

type Params = { proprietaire?: string; exercice?: string };

/**
 * Fiscalité: one owner and one exercise at a time, only the real estate
 * let. The net rental income leads, the year's amortisation and the
 * pieces still to gather beside it; then one ledger per property (the
 * modèle 190/210 statement the engine builds), the taxpayer's
 * amortisation plan, the residence-state annex when it applies, the
 * checklist, the downloads, every owner for the exercise, and how the
 * engine decides, folded. No other income, no estimate of tax due.
 */
export default async function FiscalitePage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const { locale, d } = await getI18n();
  const data = await getDemo();
  const selection = selectFiscal(data, { ownerId: params.proprietaire, taxYear: Number(params.exercice) || undefined });
  const money = (c: number) => euros(c, locale);

  if (!selection.current || selection.ownerId === null || selection.taxYear === null) {
    return (
      <div>
        <PageHeader title={d.fiscalite.title} subtitle={d.fiscalite.subtitle} />
        <EmptyState icon="euro" title={d.fiscalite.emptyTitle} body={d.fiscalite.emptyBody} />
      </div>
    );
  }

  const owner = selection.current;
  const year = owner.year.taxYear;
  const jan1 = `${year}-01-01`;
  const maxSlots = getParamValue("amort.accelerated_max_buildings_per_taxpayer", jan1);
  const abattementCap = getParamValue("amort.abattement_special_cap_eur_per_taxpayer", jan1) * 100 * (owner.year.jointlyTaxed ? 2 : 1);
  const vefaCap = eurosWhole(getParamValue("amort.vefa2024_base_cap_eur_per_year", jan1) * 100, locale);
  const runningFrom = Number(data.TODAY.slice(0, 4));
  const packHref = (o: FiscalOwnerYear, format: "pdf" | "csv", propertyId?: string) =>
    `/api/fiscalite/pack?proprietaire=${encodeURIComponent(o.ownerId)}&exercice=${o.year.taxYear}&format=${format}${propertyId ? `&bien=${encodeURIComponent(propertyId)}` : ""}`;
  const loss = owner.summary.ownerShareNet < 0;
  const nr = owner.statements.map((s) => s.pack.nonResidentExport).filter((x): x is NonNullable<typeof x> => x !== null);
  const sumNr = (pick: (x: (typeof nr)[number]) => number) => nr.reduce((a, x) => a + pick(x), 0);
  const stateLabel = { vault: d.fiscalite.stateVault, cabinet: d.fiscalite.stateCabinet, ask: d.fiscalite.stateAsk };
  const labelOfProperty = (propertyId: string) => owner.plan.rows.find((r) => r.propertyId === propertyId)?.label ?? propertyId;

  return (
    <div>
      <PageHeader
        title={d.fiscalite.title}
        subtitle={d.fiscalite.subtitle}
        actions={
          <a href={packHref(owner, "pdf")} className="ui-button inline-flex items-center justify-center gap-2 rounded-full bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 max-sm:min-h-11">
            <Icon name="documents" size={16} />
            {d.fiscalite.downloadPdf}
          </a>
        }
      />

      <div className="mb-5">
        <FiscalControls
          owners={selection.owners}
          ownerId={selection.ownerId}
          years={selection.years}
          taxYear={year}
          runningFrom={runningFrom}
          labels={{ owner: d.fiscalite.ownerLabel, year: d.fiscalite.yearLabel, running: d.fiscalite.yearRunning }}
        />
      </div>

      <section className="crm-lead" aria-label={fmt(d.fiscalite.heroTitle, { year })}>
        <Card className={"crm-metric crm-lead-hero" + (loss ? " crm-metric-loss" : "")}>
          <div className="crm-metric-top">
            <span>{fmt(d.fiscalite.heroTitle, { year })}</span>
            <span className="crm-symbol">
              <Icon name="euro" size={22} />
            </span>
          </div>
          <p className="crm-metric-value">{money(owner.summary.ownerShareNet)}</p>
          <p className="crm-metric-sub">{fmt(d.fiscalite.heroSub, { gross: money(owner.summary.grossRents), deductions: money(owner.summary.deductions) })}</p>
          {loss && <p className="crm-fiscal-note">{d.fiscalite.heroLoss}</p>}
          <p className="crm-fiscal-note">
            {owner.ownerName} · {owner.year.residency === "non_resident" ? fmt(d.fiscalite.pdfNonResident, { country: owner.year.residenceCountry ?? "" }) : d.fiscalite.pdfResident}
            {owner.year.jointlyTaxed ? ` · ${d.fiscalite.jointLabel}` : ""}
          </p>
          <p className="crm-fiscal-note">{fmt(d.fiscalite.heroDeadline, { date: formatDate(filingDeadline(year), locale) })}</p>
        </Card>

        <Card className="crm-metric">
          <div className="crm-metric-top">
            <span>{fmt(d.fiscalite.amortTitle, { year })}</span>
            <span className="crm-symbol">
              <Icon name="properties" size={22} />
            </span>
          </div>
          <p className="crm-metric-value">{money(owner.plan.totalAmortisation)}</p>
          <p className="crm-metric-sub">{fmt(d.fiscalite.amortSub, { used: owner.plan.acceleratedSlotsUsed, max: maxSlots, abattement: money(owner.plan.totalAbattement) })}</p>
          <a href="#plan" className="crm-metric-action">
            {d.fiscalite.planTitle}
            <Icon name="chevron-right" size={15} />
          </a>
        </Card>

        <Card className={"crm-metric" + (owner.missing > 0 ? " crm-metric-attention" : "")}>
          <div className="crm-metric-top">
            <span>{d.fiscalite.piecesTitle}</span>
            <span className="crm-symbol">
              <Icon name={owner.missing > 0 ? "alert" : "check"} size={22} />
            </span>
          </div>
          <p className="crm-metric-value">{owner.missing}</p>
          <p className="crm-metric-sub">{owner.missing > 0 ? d.fiscalite.piecesSub : d.fiscalite.piecesNone}</p>
          <a href="#pieces" className="crm-metric-action">
            {d.fiscalite.piecesAction}
            <Icon name="chevron-right" size={15} />
          </a>
        </Card>
      </section>

      {owner.statements.map(({ property, pack }) => {
        const flat = pack.flatComparison.eligible && pack.flatComparison.recommendation === "flat";
        const replaced = new Set(["A", "B2", "C", "D"]);
        return (
          <Panel
            key={property.id}
            title={fmt(d.fiscalite.statementTitle, { property: property.name })}
            className="mb-5"
            action={
              <div className="crm-ledger-tools">
                <a href={packHref(owner, "csv", property.id)}>{d.fiscalite.exportCsv}</a>
                <a href={packHref(owner, "pdf")}>{d.fiscalite.exportPdf}</a>
              </div>
            }
          >
            <p className="crm-ledger-meta">
              <span>{fmt(d.fiscalite.monthsLet, { n: pack.monthsLet })}</span>
              {pack.vacancyMonths > 0 && <span>{fmt(d.fiscalite.vacancy, { n: pack.vacancyMonths })}</span>}
              <span>{property.cadastralRef}</span>
            </p>
            <table className="crm-ledger">
              <tbody>
                <tr className="is-section">
                  <td>{d.fiscalite.grossRents}</td>
                  <td>{money(pack.grossRents.totalTaxable)}</td>
                </tr>
                {pack.grossRents.dwelling > 0 && (
                  <tr className="is-line">
                    <td>{d.fiscalite.rentDwelling}</td>
                    <td>{money(pack.grossRents.dwelling)}</td>
                  </tr>
                )}
                {pack.grossRents.garageParking > 0 && (
                  <tr className="is-line">
                    <td>{d.fiscalite.rentGarage}</td>
                    <td>{money(pack.grossRents.garageParking)}</td>
                  </tr>
                )}
                {pack.grossRents.furnitureSupplement > 0 && (
                  <tr className="is-line">
                    <td>{d.fiscalite.rentFurniture}</td>
                    <td>{money(pack.grossRents.furnitureSupplement)}</td>
                  </tr>
                )}
                {pack.grossRents.retainedDeposits > 0 && (
                  <tr className="is-line">
                    <td>{d.fiscalite.rentRetained}</td>
                    <td>{money(pack.grossRents.retainedDeposits)}</td>
                  </tr>
                )}
                {pack.sections.map((s) => (
                  <Fragment key={s.code}>
                    <tr className={"is-section" + (flat && replaced.has(s.code) ? " is-replaced" : "")}>
                      <td>{sectionLabel(d, s.code)}</td>
                      <td>{money(s.amount)}</td>
                    </tr>
                    {s.lines
                      .filter((l) => l.amount > 0)
                      .map((l, i) => (
                        <tr key={i} className="is-line">
                          <td>{lineLabel(d, l)}</td>
                          <td>{money(l.amount)}</td>
                        </tr>
                      ))}
                  </Fragment>
                ))}
                <tr className="is-subtotal">
                  <td>{d.fiscalite.totalDeductions}</td>
                  <td>{money(pack.deductionsTotal)}</td>
                </tr>
                {pack.socialExemptionApplied > 0 && (
                  <tr className="is-line">
                    <td>{d.fiscalite.socialExemption}</td>
                    <td>{money(-pack.socialExemptionApplied)}</td>
                  </tr>
                )}
                <tr className={"is-net" + (pack.netResult < 0 ? " is-loss" : "")}>
                  <td>{d.fiscalite.netResult}</td>
                  <td>{money(pack.netResult)}</td>
                </tr>
                {pack.ownerShareNet !== pack.netResult && (
                  <tr className="is-share">
                    <td>{fmt(d.fiscalite.ownerShare, { pct: Math.round((pack.ownerShareNet / (pack.netResult || 1)) * 100) })}</td>
                    <td>{money(pack.ownerShareNet)}</td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="crm-fiscal-warnings">
              <p>
                <Icon name="percent" size={16} />
                <span>
                  {flatText(d, pack, locale)} {d.fiscalite.flatNote}
                </span>
              </p>
              {pack.warningCodes.map((w) => (
                <p key={w.code}>
                  <Icon name="alert" size={16} />
                  <span>{warningText(d, w, locale)}</span>
                </p>
              ))}
            </div>
          </Panel>
        );
      })}

      <section id="plan" className="scroll-mt-24">
        <Panel title={d.fiscalite.planTitle} className="mb-5">
          <div className="table-scroll crm-fiscal-table">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-sand-100 text-left text-ink-soft">
                  <th className="px-3 py-2.5 font-semibold">{d.fiscalite.colProperty}</th>
                  <th className="px-3 py-2.5 font-semibold">{d.fiscalite.colRegime}</th>
                  <th className="px-3 py-2.5 text-right font-semibold max-md:hidden">{d.fiscalite.colBase}</th>
                  <th className="px-3 py-2.5 text-right font-semibold max-sm:hidden">{d.fiscalite.colRate}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{d.fiscalite.colAnnuity}</th>
                  <th className="px-3 py-2.5 text-right font-semibold max-md:hidden">{d.fiscalite.colShare}</th>
                </tr>
              </thead>
              <tbody>
                {owner.plan.rows.map((r) => (
                  <Fragment key={r.propertyId}>
                    <tr className="border-b border-sand-100 align-top">
                      <td className="px-3 py-3">
                        <p className="font-semibold text-ink">{r.label}</p>
                        <p className="crm-plan-sub">{amortReasonText(d, r.result.regime.reason, { cap: vefaCap })}</p>
                      </td>
                      <td className="px-3 py-3 font-medium text-ink">{regimeLabel(d, r.result.regime.regime)}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-ink-soft max-md:hidden">{money(r.result.regime.cappedBase)}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-ink-soft max-sm:hidden">{r.result.regime.ratePct} %</td>
                      <td className="px-3 py-3 text-right font-semibold tabular-nums text-ink">{money(r.result.buildingAmount)}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-ink max-md:hidden">{money(r.taxpayerShareAmount)}</td>
                    </tr>
                    {r.result.energy.applicable && (
                      <tr className="border-b border-sand-100 align-top">
                        <td className="px-3 py-3 pl-8">
                          <p className="font-medium text-ink">{fmt(d.fiscalite.lineEnergy, { rate: r.result.energy.ratePct })}</p>
                          <p className="crm-plan-sub">{energyReasonText(d, r.result.energy.reason, { rate: r.result.energy.ratePct, years: r.result.energy.yearsRemaining })}</p>
                        </td>
                        <td className="px-3 py-3 text-ink-soft">{d.fiscalite.regimeEnergy}</td>
                        <td className="px-3 py-3 max-md:hidden" />
                        <td className="px-3 py-3 text-right tabular-nums text-ink-soft max-sm:hidden">{r.result.energy.ratePct} %</td>
                        <td className="px-3 py-3 text-right font-semibold tabular-nums text-ink">{money(r.result.energy.amount)}</td>
                        <td className="px-3 py-3 max-md:hidden" />
                      </tr>
                    )}
                  </Fragment>
                ))}
                <tr>
                  <td className="px-3 py-3 font-semibold text-ink" colSpan={4}>
                    {d.fiscalite.totalAmort}
                  </td>
                  <td className="px-3 py-3 text-right font-semibold tabular-nums text-ink" colSpan={2}>
                    {money(owner.plan.totalAmortisation)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="crm-plan-foot">
            <p>{fmt(d.fiscalite.slotsLine, { used: owner.plan.acceleratedSlotsUsed, max: maxSlots })}</p>
            {owner.plan.slotWaitlist.map((id) => (
              <p key={id}>{fmt(d.fiscalite.slotsWaitlist, { property: labelOfProperty(id) })}</p>
            ))}
            <p>{fmt(d.fiscalite.abattementLine, { amount: money(owner.plan.totalAbattement), cap: money(abattementCap) })}</p>
            {owner.year.jointlyTaxed && <p>{d.fiscalite.jointLabel}</p>}
          </div>
        </Panel>
      </section>

      {nr.length > 0 && (
        <Panel title={fmt(d.fiscalite.nrTitle, { country: owner.year.residenceCountry ?? "" })} className="mb-5">
          <table className="crm-ledger">
            <tbody>
              <tr className="is-section">
                <td>{d.fiscalite.nrGross}</td>
                <td>{money(sumNr((x) => x.grossRents))}</td>
              </tr>
              <tr className="is-section">
                <td>{d.fiscalite.nrExpenses}</td>
                <td>{money(sumNr((x) => x.deductibleExpensesExclAmort))}</td>
              </tr>
              <tr className="is-section">
                <td>{d.fiscalite.nrInterest}</td>
                <td>{money(sumNr((x) => x.debtInterest))}</td>
              </tr>
              <tr className="is-subtotal">
                <td>{d.fiscalite.nrAmort}</td>
                <td>{money(sumNr((x) => x.luxembourgOnlyAmortisation))}</td>
              </tr>
            </tbody>
          </table>
          <p className="crm-fiscal-note">{d.fiscalite.howNr}</p>
        </Panel>
      )}

      <section id="pieces" className="scroll-mt-24">
        <Panel title={d.fiscalite.checklistTitle} className="mb-5">
          <ul className="crm-check">
            {owner.attachments.map((a) => (
              <li key={`${a.propertyId}:${a.code}`}>
                <div className="min-w-0">
                  <p className="crm-check-name">{attachmentLabel(d, a.code)}</p>
                  <p className="crm-check-sub">
                    {a.propertyName}
                    {a.amount !== null ? ` · ${money(a.amount)}` : ""}
                    {a.state === "vault" && a.documentName ? ` · ${a.documentName}` : ""}
                  </p>
                </div>
                <span className={"crm-check-state is-" + a.state}>
                  <Icon name={a.state === "ask" ? "alert" : "check"} size={14} />
                  {stateLabel[a.state]}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </section>

      <Panel title={d.fiscalite.downloadsTitle} className="mb-5">
        <ul className="crm-downloads">
          <li>
            <div className="min-w-0">
              <p className="crm-downloads-name">{fmt(d.fiscalite.dlPack, { year, owner: owner.ownerName })}</p>
              <p className="crm-downloads-sub">{d.fiscalite.dlPackBody}</p>
            </div>
            <a className="crm-download" href={packHref(owner, "pdf")}>
              <Icon name="documents" size={16} />
              {d.fiscalite.download}
            </a>
          </li>
          <li>
            <div className="min-w-0">
              <p className="crm-downloads-name">{fmt(d.fiscalite.dlLines, { year, owner: owner.ownerName })}</p>
              <p className="crm-downloads-sub">{d.fiscalite.dlLinesBody}</p>
            </div>
            <a className="crm-download" href={packHref(owner, "csv")}>
              <Icon name="documents" size={16} />
              {d.fiscalite.download}
            </a>
          </li>
          {owner.statements.map(({ property }) => (
            <li key={property.id}>
              <div className="min-w-0">
                <p className="crm-downloads-name">{fmt(d.fiscalite.dlForm, { year, property: property.name })}</p>
                <p className="crm-downloads-sub">{d.fiscalite.dlFormBody}</p>
              </div>
              <a className="crm-download" href={packHref(owner, "csv", property.id)}>
                <Icon name="documents" size={16} />
                {d.fiscalite.download}
              </a>
            </li>
          ))}
        </ul>
      </Panel>

      {selection.all.length > 1 && (
        <Panel title={d.fiscalite.allOwnersTitle} className="mb-5">
          <div className="table-scroll crm-fiscal-table">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-sand-100 text-left text-ink-soft">
                  <th className="px-3 py-2.5 font-semibold">{d.fiscalite.colOwner}</th>
                  <th className="px-3 py-2.5 text-right font-semibold max-sm:hidden">{d.fiscalite.colProperties}</th>
                  <th className="px-3 py-2.5 text-right font-semibold max-md:hidden">{d.fiscalite.colGross}</th>
                  <th className="px-3 py-2.5 text-right font-semibold max-md:hidden">{d.fiscalite.colDeductions}</th>
                  <th className="px-3 py-2.5 text-right font-semibold max-sm:hidden">{d.fiscalite.colAmort}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{d.fiscalite.colNet}</th>
                  <th className="px-3 py-2.5 text-right font-semibold max-sm:hidden">{d.fiscalite.colMissing}</th>
                </tr>
              </thead>
              <tbody>
                {selection.all.map((o) => (
                  <tr key={o.ownerId} className="border-b border-sand-100 last:border-0" aria-current={o.ownerId === owner.ownerId ? "true" : undefined}>
                    <td className="px-3 py-3">
                      <Link href={`/app/fiscalite?proprietaire=${encodeURIComponent(o.ownerId)}&exercice=${year}`} className="font-semibold text-ink hover:text-brand-700 hover:underline max-sm:inline-flex max-sm:min-h-11 max-sm:items-center">
                        {o.ownerName}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-ink-soft max-sm:hidden">{o.summary.properties}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-ink-soft max-md:hidden">{money(o.summary.grossRents)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-ink-soft max-md:hidden">{money(o.summary.deductions)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-ink-soft max-sm:hidden">{money(o.plan.totalAmortisation)}</td>
                    <td className={"px-3 py-3 text-right font-semibold tabular-nums " + (o.summary.ownerShareNet < 0 ? "text-[#9b411f]" : "text-ink")}>{money(o.summary.ownerShareNet)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-ink-soft max-sm:hidden">{o.missing}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <CollapsiblePanel title={d.fiscalite.howTitle}>
        <dl className="crm-how">
          <div>
            <dt>{d.fiscalite.howAmortTitle}</dt>
            <dd>{d.fiscalite.howAmort}</dd>
          </div>
          <div>
            <dt>{d.fiscalite.howTaxpayerTitle}</dt>
            <dd>{d.fiscalite.howTaxpayer}</dd>
          </div>
          <div>
            <dt>{d.fiscalite.howForfaitTitle}</dt>
            <dd>{d.fiscalite.howForfait}</dd>
          </div>
          <div>
            <dt>{d.fiscalite.howNrTitle}</dt>
            <dd>{d.fiscalite.howNr}</dd>
          </div>
          <div>
            <dt>{d.fiscalite.howScopeTitle}</dt>
            <dd>{d.fiscalite.howScope}</dd>
          </div>
        </dl>
      </CollapsiblePanel>
    </div>
  );
}
