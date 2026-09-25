import Link from "next/link";
import { Badge, PageHeader, EmptyState } from "@/components/pro/ui";
import { AdjustmentSteps, CapitalEditor, LagReminder, type LetterStep } from "@/components/gestion/IndexationActions";
import GenerateDocument from "@/components/gestion/GenerateDocument";
import { LegalNote, Panel } from "@/components/gestion/bits";
import { getDemo, isSampleData } from "@/lib/demo";
import { euros, formatDate, formatMonth, formatNumber } from "@/lib/types";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";
import { adjustmentLetterState } from "@/lib/gestion/indexation";
import { existingOf, generateLabels } from "@/lib/documents/labels";
import {
  applyCommercialIndexation,
  computeCapitalInvesti,
  proposeResidentialAdjustment,
} from "@/domain/indexation/engine";

export default async function IndexationPage() {
  const { locale, d } = await getI18n();
  const { LEASES, ORG, REGISTERED_LETTERS, RENT_PERIODS, TODAY, generatedFor, leaseTenantNames, leaseUnitLabel } = await getDemo();
  const sample = await isSampleData();
  const writable = !sample;
  const sampleNote = sample ? fmt(d.shell.sampleBanner, { cabinet: ORG.shortName }) : null;
  const indexationLabels = { ...d.indexation, close: d.common.close };
  const docLabels = generateLabels(d);

  // A real account with nothing in it: say so rather than reach for a
  // showcase record that no longer exists.
  if (LEASES.length === 0)
    return (
      <div>
        <EmptyState title={fmt(d.common.emptyTitle, { section: d.hubs.indexation })} body={d.common.emptyBody} />
      </div>
    );

  // Every live residential tenancy: with its capital investi declared, the
  // engine proposes; without, the row says what is missing and offers it.
  const residential = LEASES.filter((l) => l.type === "residential" && (l.status === "active" || l.status === "notice"));

  const proposals = residential.map((l) => {
    const capital = l.capitalComponents.length > 0 ? computeCapitalInvesti(l.capitalComponents, TODAY) : null;
    const proposal = capital
      ? proposeResidentialAdjustment({
          currentMonthlyRent: l.rentCents,
          lastAdjustmentDate: l.lastAdjustmentOn,
          leaseStartDate: l.startDate,
          proposedDate: TODAY,
          capital,
        })
      : null;
    const letters = REGISTERED_LETTERS.filter((r) => r.templateKey === "rent_adjustment" && r.relatedType === "lease" && r.relatedId === l.id);
    const state = adjustmentLetterState(letters, l.lastAdjustmentOn);
    const step: LetterStep =
      state.kind === "awaiting_ar"
        ? { kind: "awaiting_ar", letterId: state.letter.id, dispatchedOn: state.letter.dispatchedOn ?? TODAY }
        : state.kind === "ar_received"
          ? { kind: "ar_received", effectiveFrom: state.effectiveFrom }
          : { kind: "none" };
    const increase = Boolean(proposal?.allowed && proposal.proposedMonthlyRent > l.rentCents);
    // The notice is the letter's paper: it exists once a letter went out.
    const letterId = state.kind === "none" ? null : state.letter.id;
    return { l, proposal, step, letterId, showSteps: step.kind !== "none" || increase };
  });

  // The commercial computation needs the latest IPC STATEC value. The demo
  // pins one; no production feed exists yet, so the worked example renders
  // on sample data only. A real commercial clause shows on its lease sheet.
  const DEMO_LATEST_IPC = { month: "2026-07", value: 934.1 };
  const commercial = sample
    ? LEASES.find((l) => l.type === "commercial" && l.indexationClause)
    : undefined;
  const commercialNow = commercial
    ? applyCommercialIndexation({
        currentMonthlyRent: commercial.rentCents,
        baseIndexValue: commercial.indexationClause!.baseIndexValue,
        minMonthsBetweenAdjustments: commercial.indexationClause!.minMonthsBetween,
        lastAdjustmentDate: commercial.lastAdjustmentOn,
        leaseStartDate: commercial.startDate,
        proposedDate: TODAY,
        latestIndex: DEMO_LATEST_IPC,
      })
    : null;

  // Standing order still on the previous rent: detected, never asserted.
  const month = TODAY.slice(0, 7);
  const lagLease = LEASES.find((l) => {
    if (!l.previousRentCents || l.previousRentCents >= l.rentCents) return false;
    const rp = RENT_PERIODS.find((x) => x.leaseId === l.id && x.period === month);
    return rp ? rp.allocatedCents > 0 && rp.allocatedCents === l.previousRentCents + rp.chargesCents : false;
  });
  const lagFacts = lagLease
    ? {
        month: formatMonth(month, locale),
        paid: euros(lagLease.previousRentCents ?? 0, locale),
        rent: euros(lagLease.rentCents, locale),
        date: formatDate(lagLease.lastAdjustmentOn, locale),
        shortfall: euros(lagLease.rentCents - (lagLease.previousRentCents ?? 0), locale),
      }
    : null;

  return (
    <div>
      <PageHeader title={d.indexation.title} subtitle={d.indexation.subtitle} />

      <Panel title={d.indexation.residentialTitle}>
        <div className="table-scroll">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sand-100 bg-sand-50/60 text-left text-[11px] uppercase tracking-wide text-ink-soft">
                <th className="px-4 py-2.5 font-semibold">{d.indexation.colLease}</th>
                <th className="px-3 py-2.5 text-right font-semibold">{d.indexation.colCurrent}</th>
                <th className="px-3 py-2.5 text-right font-semibold">{d.indexation.colCeiling}</th>
                <th className="px-3 py-2.5 text-right font-semibold">{d.indexation.colProposal}</th>
                <th className="px-3 py-2.5 text-right font-semibold">{d.indexation.colDecision}</th>
                {/* Anchored: a visually hidden label is absolutely positioned, and would otherwise escape the scrolling table and widen the page. */}
                <th className="relative px-4 py-2.5 text-right font-semibold">
                  <span className="sr-only">{d.indexation.colActions}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {proposals.map(({ l, proposal, step, letterId, showSteps }) => (
                <tr key={l.id} className="border-b border-sand-50 last:border-0 hover:bg-sand-50/50" data-indexation-lease={l.id}>
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
                    {proposal ? euros(proposal.caps.ceilingMonthly, locale) : "—"}
                  </td>
                  <td className="px-3 py-3 text-right font-semibold tabular-nums text-ink">
                    {proposal?.allowed ? euros(proposal.proposedMonthlyRent, locale) : "—"}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {!proposal ? (
                      <p className="max-w-xs text-xs text-amber-800 sm:ml-auto">{d.indexation.capitalNone}</p>
                    ) : proposal.allowed ? (
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
                  <td className="px-4 py-3 text-right">
                    <div className="flex flex-col items-end gap-2">
                      <CapitalEditor
                        leaseId={l.id}
                        components={l.capitalComponents}
                        todayISO={TODAY}
                        writable={writable}
                        sampleNote={sampleNote}
                        labels={indexationLabels}
                      />
                      {letterId && (
                        <GenerateDocument
                          kind="indexation_notice"
                          sourceId={letterId}
                          label={d.indexation.docNotice}
                          existing={existingOf(generatedFor("indexation_notice", letterId), d, locale)}
                          writable={writable}
                          sampleNote={sampleNote}
                          labels={docLabels}
                          backTo="/app/indexation"
                          compact
                        />
                      )}
                      {showSteps && (
                        <AdjustmentSteps
                          leaseId={l.id}
                          step={step}
                          proposedCents={proposal?.proposedMonthlyRent ?? l.rentCents}
                          todayISO={TODAY}
                          locale={locale}
                          writable={writable}
                          sampleNote={sampleNote}
                          labels={indexationLabels}
                        />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <LegalNote>{d.indexation.residentialLegal}</LegalNote>
      </Panel>

      {(lagLease || commercialNow) && (
      <div className="mt-5 grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        {lagLease && lagFacts && (
        <Panel title={d.indexation.lagTitle}>
          <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3">
            <p className="text-sm font-semibold text-sky-800">{fmt(d.indexation.lagCase, { unit: leaseUnitLabel(lagLease), tenant: leaseTenantNames(lagLease)[0] ?? "" })}</p>
            <p className="mt-1 text-xs leading-relaxed text-sky-800">{sample ? d.indexation.lagBody : fmt(d.indexation.lagBodyLive, lagFacts)}</p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <LagReminder leaseId={lagLease.id} message={fmt(d.indexation.lagMessage, lagFacts)} writable={writable} labels={indexationLabels} />
              <Link
                href="/app/banque"
                className="inline-flex items-center rounded-xl border border-sand-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink-soft hover:border-brand-300 hover:text-brand-700 max-sm:min-h-10"
              >
                {d.indexation.lagView}
              </Link>
            </div>
          </div>
          <LegalNote>{d.indexation.lagLegal}</LegalNote>
        </Panel>
        )}

        {commercial && commercialNow && (
        <Panel title={d.indexation.commercialTitle}>
          <div className="rounded-xl border border-sand-200 p-4">
            <p className="text-sm font-semibold text-ink">
              {leaseUnitLabel(commercial)} · {leaseTenantNames(commercial)[0] ?? ""}
            </p>
            <ul className="mt-2 space-y-1.5 text-sm">
              <li className="flex justify-between gap-3">
                <span className="text-ink-soft">{d.indexation.commercialSeries}</span>
                <span className="font-semibold text-ink">{commercial.indexationClause!.series}</span>
              </li>
              <li className="flex justify-between gap-3">
                <span className="text-ink-soft">{d.indexation.commercialIndex}</span>
                <span className="font-semibold tabular-nums text-ink">
                  {formatNumber(commercial.indexationClause!.baseIndexValue, locale)} →{" "}
                  {formatNumber(DEMO_LATEST_IPC.value, locale)}
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
        )}
      </div>
      )}
    </div>
  );
}
