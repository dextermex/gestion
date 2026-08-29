import Link from "next/link";
import HubTabs from "@/components/gestion/HubTabs";
import { Badge, Card, EmptyState, PageHeader } from "@/components/pro/ui";
import { DemoAction } from "@/components/gestion/DemoAction";
import { LegalNote, MetaBadge, Panel } from "@/components/gestion/bits";
import { CountCard } from "@/components/gestion/filters";
import { getDemo, isSampleData } from "@/lib/demo";
import { euros, eurosWhole, formatDate, formatMonth, rentStatusMeta } from "@/lib/types";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";
import { assessArrears, type ArrearsStage } from "@/domain/arrears/ladder";
import { addMonths } from "@/domain/dates";

export default async function LoyersPage({
  searchParams,
}: {
  searchParams: Promise<{ mois?: string; vue?: string }>;
}) {
  const params = await searchParams;
  const { locale, d } = await getI18n();
  const { LEASES, RENT_PERIODS, TODAY, leaseById, leaseTenantNames, leaseUnitLabel } = await getDemo();
  const sample = await isSampleData();
  const rentMeta = rentStatusMeta(d);
  // The live month and its four neighbours, derived from today — the demo
  // pins its date, a real account simply follows the calendar.
  const liveMonth = TODAY.slice(0, 7);
  const MONTHS = [-3, -2, -1, 0, 1].map((k) => addMonths(`${liveMonth}-01`, k).slice(0, 7));
  const month = MONTHS.includes(params.mois ?? "") ? params.mois! : liveMonth;
  const view = params.vue === "impayes" || params.vue === "payes" ? params.vue : undefined;

  const monthRows = RENT_PERIODS.filter((rp) => rp.period === month);
  const expected = monthRows.reduce((a, r) => a + r.totalCents, 0);
  const collected = monthRows.reduce((a, r) => a + r.allocatedCents, 0);
  const open = expected - collected;

  const rows =
    view === "impayes"
      ? monthRows.filter((rp) => rp.status === "late" || rp.status === "partial")
      : view === "payes"
        ? monthRows.filter((rp) => rp.status === "paid")
        : monthRows;

  const withView = (vue?: string) => {
    const q = new URLSearchParams({ mois: month });
    if (vue) q.set("vue", vue);
    return `/app/loyers?${q.toString()}`;
  };

  const stageLabel: Record<Exclude<ArrearsStage, "none">, string> = {
    friendly: d.legal.arrears.stageFriendly,
    formal: d.legal.arrears.stageFormal,
    mise_en_demeure: d.legal.arrears.stageMed,
    justice_dossier: d.legal.arrears.stageJustice,
  };
  const stageDescription: Record<Exclude<ArrearsStage, "none">, string> = {
    friendly: d.legal.arrears.friendly,
    formal: d.legal.arrears.formal,
    mise_en_demeure: d.legal.arrears.mise_en_demeure,
    justice_dossier: d.legal.arrears.justice_dossier,
  };

  // Arrears ladder — the engine drives every relance, aligned with law.
  const arrearsCases = RENT_PERIODS.filter(
    (rp) => (rp.status === "late" || rp.status === "partial") && rp.period <= liveMonth,
  ).map((rp) => {
    const executedByPeriod: Record<string, Partial<Record<Exclude<ArrearsStage, "none">, string>>> = {
      "rp-l-2a-2026-07": { friendly: "2026-07-07", formal: "2026-07-14" },
      "rp-l-2a-2026-08": {},
      "rp-l-3b-2026-08": {},
      "rp-l-1a-2026-08": {},
    };
    const arDate = rp.id === "rp-l-2a-2026-07" ? "2026-08-12" : null;
    const assessment = assessArrears(
      {
        invoiceId: rp.id,
        dueDate: rp.dueDate,
        openAmount: rp.totalCents - rp.allocatedCents,
        paymentPlanActive: false,
        executed: executedByPeriod[rp.id] ?? {},
        miseEnDemeureArDate: arDate,
      },
      TODAY,
    );
    // Localized notes, derived from the structured assessment — never from
    // the engine's English internals.
    const notes: string[] = [];
    if (assessment.paused) notes.push(d.legal.arrears.notePaused);
    if (assessment.nextStep?.stage === "mise_en_demeure") notes.push(d.legal.arrears.noteMedManual);
    if (assessment.nextStep === null && !assessment.paused && assessment.daysOverdue >= 45 && !arDate) {
      notes.push(d.legal.arrears.noteNeedAr);
    }
    return { rp, assessment, notes };
  });

  return (
    <div>
      <HubTabs d={d} hub="finances" active="/app/loyers" />
      <PageHeader title={d.loyers.title} subtitle={d.loyers.subtitle} />

      <div className="no-scrollbar mb-4 flex gap-2 overflow-x-auto">
        {MONTHS.map((m) => (
          <Link
            key={m}
            href={`/app/loyers?mois=${m}${view ? `&vue=${view}` : ""}`}
            aria-current={m === month ? "page" : undefined}
            className={
              "flex shrink-0 items-center rounded-full px-3.5 py-1.5 text-sm font-medium transition max-sm:min-h-11 " +
              (m === month
                ? "bg-brand-600 text-white"
                : "bg-white text-ink-soft border border-sand-200 hover:border-brand-200 hover:text-brand-700")
            }
          >
            {formatMonth(m, locale)}
          </Link>
        ))}
      </div>

      {/* Overdue / expected / paid — the immocloud triple, wired as views */}
      <div className="stagger-rise mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <CountCard
          href={withView(view === "impayes" ? undefined : "impayes")}
          value={eurosWhole(open, locale)}
          label={`${d.loyers.openBalance} · ${d.loyers.viewOpen}`}
          selected={view === "impayes"}
          tone={open > 0 ? "bad" : "good"}
        />
        {/* No outline when nothing is filtered — a highlight must mean an
            active view, not the default state. */}
        <CountCard
          href={withView(undefined)}
          value={eurosWhole(expected, locale)}
          label={`${d.loyers.expected} · ${d.loyers.viewAll}`}
        />
        <CountCard
          href={withView(view === "payes" ? undefined : "payes")}
          value={eurosWhole(collected, locale)}
          label={`${d.loyers.collected} · ${d.loyers.viewPaid}`}
          selected={view === "payes"}
          tone={collected >= expected && expected > 0 ? "good" : "default"}
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={d.loyers.emptyTitle}
          body={d.loyers.emptyBody}
          action={
            <Link href={withView(undefined)} className="text-sm font-semibold text-brand-700 hover:underline">
              {d.common.resetFilters}
            </Link>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-sand-100 bg-sand-50/60 text-left text-[11px] uppercase tracking-wide text-ink-soft">
                  <th className="px-4 py-2.5 font-semibold">{d.loyers.colUnit}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{d.loyers.colExpected}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{d.loyers.colCollected}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{d.loyers.colBalance}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{d.loyers.colDue}</th>
                  <th className="px-4 py-2.5 text-right font-semibold">{d.loyers.colStatus}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((rp) => {
                  const l = leaseById(rp.leaseId);
                  const rowOpen = rp.totalCents - rp.allocatedCents;
                  return (
                    <tr key={rp.id} className="border-b border-sand-50 last:border-0 hover:bg-sand-50/50">
                      <td className="px-4 py-3">
                        <Link href={`/app/baux/${l.id}`} className="font-semibold text-ink hover:text-brand-700">
                          {leaseUnitLabel(l)}
                        </Link>
                        <p className="text-xs text-ink-soft">{leaseTenantNames(l).join(", ")}</p>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-ink">{euros(rp.totalCents, locale)}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-ink">{euros(rp.allocatedCents, locale)}</td>
                      <td
                        className={
                          "px-3 py-3 text-right tabular-nums " +
                          (rowOpen > 0 ? "font-semibold text-red-700" : "text-ink-soft")
                        }
                      >
                        {euros(rowOpen, locale)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-ink-soft">{formatDate(rp.dueDate, locale)}</td>
                      <td className="px-4 py-3 text-right">
                        <MetaBadge meta={rentMeta[rp.status]} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel title={d.loyers.arrearsTitle}>
          <ul className="space-y-4">
            {arrearsCases.map(({ rp, assessment, notes }) => {
              const l = leaseById(rp.leaseId);
              return (
                <li key={rp.id} className="rounded-xl border border-sand-200 p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">
                        {leaseUnitLabel(l)} · {formatMonth(rp.period, locale)}
                      </p>
                      <p className="text-xs text-ink-soft">
                        {fmt(d.legal.arrears.openAmount, { amount: euros(rp.totalCents - rp.allocatedCents, locale) })}{" "}
                        · {fmt(d.legal.arrears.daysLate, { n: assessment.daysOverdue })}
                      </p>
                    </div>
                    {assessment.currentStage !== "none" && (
                      <Badge className="bg-orange-100 text-orange-800">{stageLabel[assessment.currentStage]}</Badge>
                    )}
                  </div>
                  {assessment.nextStep && (
                    <div className="mt-2.5 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-sand-50 px-3 py-2">
                      <p className="text-xs text-ink-soft">
                        <span className="font-semibold text-ink">{d.legal.arrears.nextStep}</span>{" "}
                        {stageDescription[assessment.nextStep.stage]}
                        {assessment.nextStep.dueFrom > TODAY &&
                          " " + fmt(d.legal.arrears.fromDate, { date: formatDate(assessment.nextStep.dueFrom, locale) })}
                      </p>
                      {assessment.nextStep.requiresRegisteredLetter && (
                        <Badge className="bg-accent-50 text-accent-700">{d.loyers.arrearsLrar}</Badge>
                      )}
                    </div>
                  )}
                  {notes.map((n) => (
                    <p key={n} className="mt-1.5 text-[11px] text-ink-soft">
                      {n}
                    </p>
                  ))}
                  {assessment.nextStep?.stage === "mise_en_demeure" && sample && (
                    <div className="mt-2.5">
                      <DemoAction label={d.loyers.arrearsConfirmMed} doneMessage={d.loyers.arrearsConfirmed} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <LegalNote>{d.loyers.arrearsLegal}</LegalNote>
        </Panel>

        <Panel title={d.loyers.refsTitle}>
          {/* Said once for the whole list — the same sentence under every row
              read as seven different facts when it was one. */}
          <p className="mb-3 text-xs leading-relaxed text-ink-soft">{d.loyers.refsSub}</p>
          <ul className="divide-y divide-sand-100 text-sm">
            {LEASES.filter((l) => l.status === "active" || l.status === "notice").map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 py-2">
                <p className="min-w-0 truncate font-semibold text-ink">{leaseUnitLabel(l)}</p>
                <code className="shrink-0 rounded-md bg-sand-50 px-2 py-1 text-[11px] font-semibold tabular-nums text-brand-800">
                  {l.rfReference}
                </code>
              </li>
            ))}
          </ul>
          <LegalNote>{d.loyers.refsLegal}</LegalNote>
        </Panel>
      </div>
    </div>
  );
}
