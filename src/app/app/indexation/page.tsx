import Link from "next/link";
import { Badge, PageHeader, EmptyState } from "@/components/pro/ui";
import { DemoAction } from "@/components/gestion/DemoAction";
import { LegalNote, Panel } from "@/components/gestion/bits";
import { getDemo } from "@/lib/demo";
import { euros, formatDate, formatNumber } from "@/lib/types";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";
import {
  applyCommercialIndexation,
  computeCapitalInvesti,
  proposeResidentialAdjustment,
} from "@/domain/indexation/engine";

export default async function IndexationPage() {
  const { locale, d } = await getI18n();
  const { LEASES, TODAY, leaseTenantNames, leaseUnitLabel, unitById } = await getDemo();

  // A real account with nothing in it: say so rather than reach for a
  // showcase record that no longer exists.
  if (LEASES.length === 0)
    return <EmptyState title={fmt(d.common.emptyTitle, { section: d.nav.indexation })} body={d.common.emptyBody} />;

  const residential = LEASES.filter(
    (l) =>
      l.type === "residential" && (l.status === "active" || l.status === "notice") && l.capitalComponents.length > 0,
  );

  const proposals = residential.map((l) => {
    const capital = computeCapitalInvesti(l.capitalComponents, TODAY);
    const proposal = proposeResidentialAdjustment({
      currentMonthlyRent: l.rentCents,
      lastAdjustmentDate: l.lastAdjustmentOn,
      leaseStartDate: l.startDate,
      proposedDate: TODAY,
      capital,
    });
    return { l, capital, proposal };
  });

  const commercial = LEASES.find((l) => l.id === "l-k01")!;
  const commercialNow = applyCommercialIndexation({
    currentMonthlyRent: commercial.rentCents,
    baseIndexValue: commercial.indexationClause!.baseIndexValue,
    minMonthsBetweenAdjustments: commercial.indexationClause!.minMonthsBetween,
    lastAdjustmentDate: commercial.lastAdjustmentOn,
    leaseStartDate: commercial.startDate,
    proposedDate: TODAY,
    latestIndex: { month: "2026-07", value: 934.1 },
  });

  return (
    <div>
      <PageHeader title={d.indexation.title} subtitle={d.indexation.subtitle} />

      <Panel title={d.indexation.residentialTitle}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sand-100 bg-sand-50/60 text-left text-[11px] uppercase tracking-wide text-ink-soft">
                <th className="px-4 py-2.5 font-semibold">{d.indexation.colLease}</th>
                <th className="px-3 py-2.5 text-right font-semibold">{d.indexation.colCurrent}</th>
                <th className="px-3 py-2.5 text-right font-semibold">{d.indexation.colCeiling}</th>
                <th className="px-3 py-2.5 text-right font-semibold">{d.indexation.colProposal}</th>
                <th className="px-4 py-2.5 text-right font-semibold">{d.indexation.colDecision}</th>
              </tr>
            </thead>
            <tbody>
              {proposals.map(({ l, proposal }) => (
                <tr key={l.id} className="border-b border-sand-50 last:border-0 hover:bg-sand-50/50">
                  <td className="px-4 py-3">
                    <Link href={`/app/baux/${l.id}`} className="font-semibold text-ink hover:text-brand-700">
                      {leaseUnitLabel(l)}
                    </Link>
                    <p className="text-xs text-ink-soft">
                      {leaseTenantNames(l).join(", ")}
                      {l.lastAdjustmentOn
                        ? ` · ${fmt(d.indexation.lastAdjusted, { date: formatDate(l.lastAdjustmentOn, locale) })}`
                        : ` · ${d.indexation.neverAdjusted}`}
                    </p>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-ink">{euros(l.rentCents, locale)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-ink-soft">
                    {euros(proposal.caps.ceilingMonthly, locale)}
                  </td>
                  <td className="px-3 py-3 text-right font-semibold tabular-nums text-ink">
                    {proposal.allowed ? euros(proposal.proposedMonthlyRent, locale) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {proposal.allowed ? (
                      <Badge className="bg-emerald-100 text-emerald-800">
                        {proposal.bindingConstraint === "ceiling"
                          ? d.indexation.decisionCeiling
                          : d.indexation.decisionStep}
                      </Badge>
                    ) : proposal.nextAllowedDate ? (
                      <Badge className="bg-sand-100 text-ink-soft">
                        {fmt(d.indexation.decisionLocked, { date: formatDate(proposal.nextAllowedDate, locale) })}
                      </Badge>
                    ) : (
                      <Badge className="bg-amber-100 text-amber-800">{d.indexation.decisionAtCeiling}</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <LegalNote>{d.indexation.residentialLegal}</LegalNote>
      </Panel>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel title={d.indexation.lagTitle}>
          <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3">
            <p className="text-sm font-semibold text-sky-800">{fmt(d.indexation.lagCase, { unit: unitById("u-b-3b").label, tenant: leaseTenantNames(LEASES.find((l) => l.id === "l-3b")!)[0] })}</p>
            <p className="mt-1 text-xs leading-relaxed text-sky-800">{d.indexation.lagBody}</p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <DemoAction label={d.indexation.lagSend} doneMessage={d.indexation.lagSent} />
              <Link
                href="/app/banque"
                className="rounded-xl border border-sand-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink-soft hover:border-brand-300 hover:text-brand-700"
              >
                {d.indexation.lagView}
              </Link>
            </div>
          </div>
          <LegalNote>{d.indexation.lagLegal}</LegalNote>
        </Panel>

        <Panel title={d.indexation.commercialTitle}>
          <div className="rounded-xl border border-sand-200 p-4">
            <p className="text-sm font-semibold text-ink">{leaseUnitLabel(commercial)} — Boulangerie Bock</p>
            <ul className="mt-2 space-y-1.5 text-sm">
              <li className="flex justify-between gap-3">
                <span className="text-ink-soft">{d.indexation.commercialSeries}</span>
                <span className="font-semibold text-ink">{commercial.indexationClause!.series}</span>
              </li>
              <li className="flex justify-between gap-3">
                <span className="text-ink-soft">{d.indexation.commercialIndex}</span>
                <span className="font-semibold tabular-nums text-ink">
                  {formatNumber(commercial.indexationClause!.baseIndexValue, locale)} →{" "}
                  {formatNumber(934.1, locale)}
                </span>
              </li>
              <li className="flex justify-between gap-3">
                <span className="text-ink-soft">{d.indexation.commercialFreq}</span>
                <span className="font-semibold text-ink">
                  {fmt(d.indexation.commercialFreqValue, { date: formatDate(commercial.lastAdjustmentOn, locale) })}
                </span>
              </li>
              <li className="flex justify-between gap-3">
                <span className="text-ink-soft">{d.indexation.commercialDecision}</span>
                <span className="font-semibold text-ink">
                  {commercialNow.allowed
                    ? fmt(d.indexation.commercialNewRent, { amount: euros(commercialNow.newMonthlyRent, locale) })
                    : d.indexation.commercialLocked}
                </span>
              </li>
            </ul>
            {!commercialNow.allowed && (
              <p className="mt-2 rounded-lg bg-sand-50 px-3 py-2 text-xs text-ink-soft">
                {fmt(d.legal.vatClauseLocked, { months: commercial.indexationClause!.minMonthsBetween })}
              </p>
            )}
          </div>
          <LegalNote>{d.indexation.commercialLegal}</LegalNote>
        </Panel>
      </div>
    </div>
  );
}
