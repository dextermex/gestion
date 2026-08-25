import { Badge, PageHeader } from "@/components/pro/ui";
import { LegalNote, Panel } from "@/components/gestion/bits";
import { getDemo } from "@/lib/demo";
import { euros, eurosWhole } from "@/lib/types";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";
import { amortReasonText, energyReasonText } from "@/lib/i18n/engine";
import { planTaxpayerYear, type YearAmortisation } from "@/domain/fiscal/amortisation";
import { buildTaxPack } from "@/domain/fiscal/taxpack";
import { getParamValue } from "@/domain/legal/params";
import { cents } from "@/domain/money";

export default async function FiscalitePage() {
  const { locale, d } = await getI18n();
  const { LAMBERT_PORTFOLIO, SCI_BEAULIEU_PORTFOLIO, contactById, propertyById } = await getDemo();
  const lambertName = contactById("c-lambert").name;
  const faberName = contactById("c-faber").name;

  // Taxpayer-level amortisation plans — the max-2-buildings rule in action.
  const lambertPlan = planTaxpayerYear(LAMBERT_PORTFOLIO, 2026, { jointlyTaxed: false });
  const faberPlan = planTaxpayerYear(SCI_BEAULIEU_PORTFOLIO, 2026, { jointlyTaxed: true });

  // Modèle 190/210 pack for Bureaux Kirchberg (Sophie Lambert, non-resident).
  const kirchbergAmort = lambertPlan.rows.find((r) => r.propertyId === "p-kirchberg")!;
  const completedOn = "2015-11-01";
  const taxYear = 2026;
  const pack = buildTaxPack({
    taxYear,
    propertyLabel: "Bureaux Kirchberg — Plateau 1er",
    cadastralRef: "Luxembourg / Section EiB / n° 501/2231",
    buildingCompletedOn: completedOn,
    monthsLet: 12,
    vacancyMonths: 0,
    receipts: Array.from({ length: 12 }, (_, i) => ({
      period: `2026-${String(i + 1).padStart(2, "0")}`,
      category: "dwelling" as const,
      amount: cents(6800),
    })),
    expenses: [
      { date: "2026-03-10", bucket: "maintenance_repairs", label: "Reprise étanchéité terrasse", amount: cents(9_400), rechargedToTenant: false },
      { date: "2026-01-15", bucket: "debt_interest", label: "Intérêts prêt BGL (certificat)", amount: cents(31_200), rechargedToTenant: false },
      { date: "2026-02-01", bucket: "impot_foncier", label: "Impôt foncier", amount: cents(1_450), rechargedToTenant: false },
      { date: "2026-12-31", bucket: "management_fees", label: "Honoraires Cabinet Reuter", amount: cents(3_260), rechargedToTenant: false },
      { date: "2026-06-30", bucket: "insurance", label: "Assurance propriétaire", amount: cents(2_050), rechargedToTenant: false },
    ],
    electedSpreadYears: null,
    priorSpreads: [],
    amortisation: kirchbergAmort.result,
    ownerShare: 1,
    ownerResidency: "non_resident",
    socialRentalManagement: false,
  });
  const hasDebtInterest = pack.sections.some((s) => s.code === "E" && s.amount > 0);

  const regimeLabel: Record<string, string> = {
    normal_2: d.fiscalite.regimeNormal,
    accelerated_4: d.fiscalite.regimeAccel,
    grandfathered_6: d.fiscalite.regimeGrand,
    vefa2024_6: d.fiscalite.regimeVefa,
    energy_renovation: d.fiscalite.regimeEnergy,
  };
  const vefaCap = eurosWhole(getParamValue("amort.vefa2024_base_cap_eur_per_year", "2026-01-01") * 100, locale);

  // Localized engine explanations — always from the stable reason codes.
  const regimeNote = (r: YearAmortisation) =>
    amortReasonText(d, r.regime.reason, { cap: vefaCap });
  const energyNote = (r: YearAmortisation) =>
    energyReasonText(d, r.energy.reason, { rate: r.energy.ratePct, years: r.energy.yearsRemaining });

  return (
    <div>
      <PageHeader title={d.fiscalite.title} subtitle={d.fiscalite.subtitle} />

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <Panel title={fmt(d.fiscalite.lambertTitle, { owner: lambertName })}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-sand-100 bg-sand-50/60 text-left text-[11px] uppercase tracking-wide text-ink-soft">
                  <th className="px-3 py-2.5 font-semibold">{d.fiscalite.colProperty}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{d.fiscalite.colRegime}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{d.fiscalite.colBase}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{d.fiscalite.colAnnuity}</th>
                </tr>
              </thead>
              <tbody>
                {lambertPlan.rows.map((r) => (
                  <tr key={r.propertyId} className="border-b border-sand-50 align-top last:border-0">
                    <td className="px-3 py-2.5">
                      <p className="font-semibold text-ink">{r.label}</p>
                      <p className="text-[11px] leading-snug text-ink-soft">{regimeNote(r.result)}</p>
                      {r.result.energy.applicable && (
                        <p className="text-[11px] leading-snug text-emerald-700">{energyNote(r.result)}</p>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Badge
                        className={
                          r.result.regime.regime === "vefa2024_6"
                            ? "bg-violet-100 text-violet-800"
                            : r.result.regime.regime === "accelerated_4"
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-sand-100 text-ink-soft"
                        }
                      >
                        {regimeLabel[r.result.regime.regime]}
                        {r.result.energy.applicable ? ` + ${r.result.energy.ratePct} %` : ""}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink-soft">
                      {eurosWhole(r.result.regime.cappedBase, locale)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-ink">
                      {euros(r.result.totalAmount, locale)}
                    </td>
                  </tr>
                ))}
                <tr className="bg-sand-50/60">
                  <td className="px-3 py-2.5 font-bold text-ink" colSpan={3}>
                    {d.fiscalite.totalAmort}
                  </td>
                  <td className="px-3 py-2.5 text-right font-display font-bold tabular-nums text-ink">
                    {euros(lambertPlan.totalAmortisation, locale)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <LegalNote>
            {fmt(d.fiscalite.lambertLegal, {
              p1: LAMBERT_PORTFOLIO[0].label,
              p2: LAMBERT_PORTFOLIO[1].label,
            })}
          </LegalNote>
        </Panel>

        <Panel title={fmt(d.fiscalite.faberTitle, { owner: faberName })}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge className="bg-emerald-100 text-emerald-800">
              {fmt(d.fiscalite.slotsUsed, { used: faberPlan.acceleratedSlotsUsed })}
            </Badge>
            {faberPlan.slotWaitlist.length > 0 && (
              <Badge className="bg-amber-100 text-amber-800">
                {fmt(d.fiscalite.slotsWaitlist, { n: faberPlan.slotWaitlist.length })}
              </Badge>
            )}
            <Badge className="bg-sand-100 text-ink-soft">{d.fiscalite.jointBadge}</Badge>
          </div>
          <ul className="space-y-2.5">
            {faberPlan.rows.map((r) => (
              <li key={r.propertyId} className="rounded-xl border border-sand-200 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="min-w-0 truncate text-sm font-semibold text-ink">{r.label}</p>
                  <Badge
                    className={
                      r.result.regime.regime === "accelerated_4"
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-sand-100 text-ink-soft"
                    }
                  >
                    {regimeLabel[r.result.regime.regime]}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-ink-soft">{regimeNote(r.result)}</p>
                <div className="mt-1.5 flex items-center justify-between text-xs">
                  <span className="text-ink-soft">
                    {fmt(d.fiscalite.taxpayerShare, {
                      pct: Math.round((r.taxpayerShareAmount / (r.result.totalAmount || 1)) * 100),
                    })}
                  </span>
                  <span className="font-semibold tabular-nums text-ink">{euros(r.taxpayerShareAmount, locale)}</span>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center justify-between rounded-xl bg-brand-50 px-4 py-3">
            <p className="text-sm font-semibold text-brand-800">{d.fiscalite.abattementLine}</p>
            <p className="font-display text-lg font-bold tabular-nums text-brand-800">
              {euros(faberPlan.totalAbattement, locale)}
            </p>
          </div>
          <LegalNote>{d.fiscalite.faberLegal}</LegalNote>
        </Panel>
      </div>

      <Panel title={fmt(d.fiscalite.packTitle, { property: propertyById("p-kirchberg").name, owner: lambertName })} className="mt-5">
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-sand-50 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                  {d.fiscalite.grossRents}
                </p>
                <p className="mt-0.5 font-display text-lg font-bold tabular-nums text-ink">
                  {euros(pack.grossRents.totalTaxable, locale)}
                </p>
                <p className="text-[11px] text-ink-soft">{fmt(d.fiscalite.monthsLet, { n: pack.monthsLet })}</p>
              </div>
              <div className="rounded-xl bg-sand-50 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                  {d.fiscalite.fraisObtention}
                </p>
                <p className="mt-0.5 font-display text-lg font-bold tabular-nums text-ink">
                  {euros(pack.grossRents.totalTaxable - pack.netResult, locale)}
                </p>
                <p className="text-[11px] text-ink-soft">{d.fiscalite.itemised}</p>
              </div>
              <div className="rounded-xl bg-sand-50 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                  {d.fiscalite.netIncome}
                </p>
                <p className="mt-0.5 font-display text-lg font-bold tabular-nums text-ink">
                  {euros(pack.netResult, locale)}
                </p>
                <p className="text-[11px] text-ink-soft">{d.fiscalite.netCarried}</p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="mt-4 w-full text-sm">
                <tbody>
                  {pack.sections.map((s) => (
                    <tr key={s.code} className="border-b border-sand-50 last:border-0">
                      <td className="py-2 pr-3">
                        <span className="mr-2 inline-flex h-6 w-8 items-center justify-center rounded-md bg-brand-50 text-xs font-bold text-brand-700">
                          §{s.code}
                        </span>
                        <span className="text-ink">{s.label}</span>
                      </td>
                      <td className="py-2 text-right font-semibold tabular-nums text-ink">{euros(s.amount, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {hasDebtInterest && (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {d.fiscalite.warnInterestCert}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-4">
            <div className="rounded-2xl border border-sand-200 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{d.fiscalite.flatTitle}</p>
              {pack.flatComparison.eligible ? (
                <>
                  <p className="mt-1.5 text-sm text-ink">
                    {fmt(d.fiscalite.flatVs, {
                      flat: euros(pack.flatComparison.flatAmount, locale),
                      itemised: euros(pack.flatComparison.itemisedReplaceable, locale),
                    })}
                  </p>
                  <Badge
                    className={
                      "mt-2 " +
                      (pack.flatComparison.recommendation === "itemise"
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-sky-100 text-sky-800")
                    }
                  >
                    {pack.flatComparison.recommendation === "itemise"
                      ? fmt(d.fiscalite.flatRecoItemise, { savings: euros(pack.flatComparison.savings, locale) })
                      : fmt(d.fiscalite.flatRecoFlat, { savings: euros(pack.flatComparison.savings, locale) })}
                  </Badge>
                </>
              ) : (
                <p className="mt-1.5 text-xs text-ink-soft">
                  {fmt(d.legal.flatIneligible, {
                    age: taxYear - Number(completedOn.slice(0, 4)),
                    min: getParamValue("tax.flat_deduction_min_building_age_years", "2026-01-01"),
                  })}
                </p>
              )}
              <p className="mt-2 text-[11px] leading-relaxed text-ink-soft">{d.fiscalite.flatNote}</p>
            </div>

            {pack.nonResidentExport && (
              <div className="rounded-2xl border border-violet-200 bg-violet-50/50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-violet-800">{d.fiscalite.nrTitle}</p>
                <ul className="mt-2 space-y-1 text-xs text-ink">
                  <li className="flex justify-between">
                    <span>{d.fiscalite.nrGross}</span>
                    <span className="font-semibold tabular-nums">
                      {euros(pack.nonResidentExport.grossRents, locale)}
                    </span>
                  </li>
                  <li className="flex justify-between">
                    <span>{d.fiscalite.nrExpenses}</span>
                    <span className="font-semibold tabular-nums">
                      {euros(pack.nonResidentExport.deductibleExpensesExclAmort, locale)}
                    </span>
                  </li>
                  <li className="flex justify-between">
                    <span>{d.fiscalite.nrInterest}</span>
                    <span className="font-semibold tabular-nums">
                      {euros(pack.nonResidentExport.debtInterest, locale)}
                    </span>
                  </li>
                  <li className="flex justify-between text-violet-800">
                    <span>{d.fiscalite.nrAmort}</span>
                    <span className="font-semibold tabular-nums">
                      {euros(pack.nonResidentExport.luxembourgOnlyAmortisation, locale)}
                    </span>
                  </li>
                </ul>
                <p className="mt-2 text-[11px] leading-relaxed text-violet-800">{d.fiscalite.nrNote}</p>
              </div>
            )}
          </div>
        </div>
      </Panel>
    </div>
  );
}
