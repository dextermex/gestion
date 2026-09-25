import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader } from "@/components/pro/ui";
import ArrearsActions, { type ArrearsLabels } from "@/components/gestion/ArrearsActions";
import GenerateDocument from "@/components/gestion/GenerateDocument";
import { LegalNote, MetaBadge, Panel } from "@/components/gestion/bits";
import { CountCard } from "@/components/gestion/filters";
import { getDemo, isSampleData } from "@/lib/demo";
import { euros, eurosWhole, formatDate, formatMonth, rentStatusMeta } from "@/lib/types";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";
import { assessArrears, type ArrearsStage } from "@/domain/arrears/ladder";
import { addMonths } from "@/domain/dates";
import { existingOf, generateLabels } from "@/lib/documents/labels";

export default async function LoyersPage({
  searchParams,
}: {
  searchParams: Promise<{ mois?: string; vue?: string }>;
}) {
  const params = await searchParams;
  const { locale, d } = await getI18n();
  const { ARREARS_ACTIONS, LEASES, ORG, REGISTERED_LETTERS, RENT_PERIODS, TODAY, generatedFor, leaseById, leaseTenantNames, leaseUnitLabel } = await getDemo();
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

  // Arrears ladder — the engine drives every relance, aligned with law. What
  // has been done is read from the rows (the steps recorded, the registered
  // letter and its AR date), never from a click.
  const letterById = new Map(REGISTERED_LETTERS.map((l) => [l.id, l]));
  const arrearsCases = RENT_PERIODS.filter(
    (rp) => (rp.status === "late" || rp.status === "partial") && rp.period <= liveMonth,
  ).map((rp) => {
    const steps = ARREARS_ACTIONS.filter((a) => a.rentPeriodId === rp.id).sort((a, b) => a.executedOn.localeCompare(b.executedOn));
    const executed: Partial<Record<Exclude<ArrearsStage, "none">, string>> = {};
    for (const a of steps) executed[a.stage] = a.executedOn;
    const medStep = steps.find((a) => a.stage === "mise_en_demeure");
    const letter =
      (medStep?.registeredLetterId ? letterById.get(medStep.registeredLetterId) : undefined) ??
      REGISTERED_LETTERS.find((l) => l.templateKey === "mise_en_demeure" && l.relatedType === "rent_period" && l.relatedId === rp.id);
    const arDate = letter?.arReceivedOn ?? null;
    const awaitingLetter = letter && letter.status === "dispatched" && letter.dispatchedOn ? { id: letter.id, dispatchedOn: letter.dispatchedOn } : null;
    const assessment = assessArrears(
      {
        invoiceId: rp.id,
        dueDate: rp.dueDate,
        openAmount: rp.totalCents - rp.allocatedCents,
        paymentPlanActive: false,
        executed,
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
    return { rp, assessment, notes, steps, letter, awaitingLetter };
  });
  const arrearsLabels: ArrearsLabels = {
    record: d.loyers.arrearsRecord,
    doneOn: d.loyers.arrearsDoneOn,
    dispatchedOn: d.loyers.arrearsDispatchedOn,
    confirmMed: d.loyers.arrearsConfirmMed,
    arOn: d.loyers.arrearsArOn,
    saveAr: d.loyers.arrearsSaveAr,
    awaitingAr: d.loyers.arrearsAwaitingAr,
    arReceived: d.loyers.arrearsArReceived,
    medRecorded: d.loyers.arrearsMedRecorded,
    justiceRecord: d.loyers.arrearsJusticeRecord,
    justiceDone: d.loyers.arrearsJusticeDone,
    stepDone: d.loyers.arrearsStepDone,
    failed: d.loyers.arrearsFailed,
    already: d.loyers.arrearsAlready,
    needsAr: d.loyers.arrearsNeedsAr,
    sampleConfirmed: d.loyers.arrearsConfirmed,
  };
  const sampleNote = sample ? fmt(d.shell.sampleBanner, { cabinet: ORG.shortName }) : null;
  // The paper of a period: its notice, and its receipt once the ledger says
  // it is paid. Both come from the register, produced from the rows.
  const docLabels = generateLabels(d);
  const backTo = `/app/loyers?mois=${month}${view ? `&vue=${view}` : ""}`;

  return (
    <div>
      <PageHeader title={d.loyers.title} subtitle={d.loyers.subtitle} />

      <div className="scroll-x mb-4 flex gap-2">
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
            <Link href={withView(undefined)} className="text-sm font-semibold text-brand-700 hover:underline max-sm:inline-flex max-sm:min-h-10 max-sm:items-center">
              {d.common.resetFilters}
            </Link>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="table-scroll">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-sand-100 bg-sand-50/60 text-left text-[11px] uppercase tracking-wide text-ink-soft">
                  <th className="px-4 py-2.5 font-semibold">{d.loyers.colUnit}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{d.loyers.colExpected}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{d.loyers.colCollected}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{d.loyers.colBalance}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{d.loyers.colDue}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{d.loyers.colStatus}</th>
                  <th className="relative px-4 py-2.5 text-right font-semibold">
                    <span className="sr-only">{d.hubs.library}</span>
                  </th>
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
                      <td className="px-3 py-3 text-right">
                        <MetaBadge meta={rentMeta[rp.status]} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex flex-col items-end gap-1.5">
                          <GenerateDocument
                            kind="rent_notice"
                            sourceId={rp.id}
                            label={d.loyers.docNotice}
                            existing={existingOf(generatedFor("rent_notice", rp.id), d, locale)}
                            writable={!sample}
                            sampleNote={sampleNote}
                            labels={docLabels}
                            backTo={backTo}
                            compact
                          />
                          {rp.status === "paid" && (
                            <GenerateDocument
                              kind="rent_receipt"
                              sourceId={rp.id}
                              label={d.loyers.docReceipt}
                              existing={existingOf(generatedFor("rent_receipt", rp.id), d, locale)}
                              writable={!sample}
                              sampleNote={sampleNote}
                              labels={docLabels}
                              backTo={backTo}
                              compact
                            />
                          )}
                        </div>
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
            {arrearsCases.map(({ rp, assessment, notes, steps, letter, awaitingLetter }) => {
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
                  {(steps.length > 0 || letter?.arReceivedOn) && (
                    <dl className="mt-2.5 space-y-0.5 text-[11px] text-ink-soft" aria-label={d.loyers.arrearsHistory}>
                      {steps.map((a) => (
                        <div key={a.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                          <dt>{stageLabel[a.stage]}</dt>
                          <dd className="flex flex-wrap items-center gap-2 tabular-nums">
                            {a.stage === "formal" && (
                              <GenerateDocument
                                kind="arrears_formal"
                                sourceId={a.id}
                                label={d.loyers.docLetter}
                                existing={existingOf(generatedFor("arrears_formal", a.id), d, locale)}
                                writable={!sample}
                                sampleNote={sampleNote}
                                labels={docLabels}
                                backTo={backTo}
                                compact
                              />
                            )}
                            {a.stage === "mise_en_demeure" && letter && (
                              <GenerateDocument
                                kind="arrears_mise_en_demeure"
                                sourceId={letter.id}
                                label={d.loyers.docLetter}
                                existing={existingOf(generatedFor("arrears_mise_en_demeure", letter.id), d, locale)}
                                writable={!sample}
                                sampleNote={sampleNote}
                                labels={docLabels}
                                backTo={backTo}
                                compact
                              />
                            )}
                            {formatDate(a.executedOn, locale)}
                          </dd>
                        </div>
                      ))}
                      {letter?.arReceivedOn && (
                        <div className="flex items-baseline justify-between gap-3 font-semibold text-ink">
                          <dt>{d.loyers.arrearsArOn}</dt>
                          <dd className="tabular-nums">{formatDate(letter.arReceivedOn, locale)}</dd>
                        </div>
                      )}
                    </dl>
                  )}
                  <ArrearsActions
                    leaseId={rp.leaseId}
                    rentPeriodId={rp.id}
                    next={assessment.nextStep && assessment.nextStep.dueFrom <= TODAY && !assessment.paused ? assessment.nextStep.stage : null}
                    awaitingLetter={awaitingLetter}
                    todayISO={TODAY}
                    stageLabel={assessment.nextStep ? stageLabel[assessment.nextStep.stage] : ""}
                    locale={locale}
                    writable={!sample}
                    sampleNote={sampleNote}
                    labels={arrearsLabels}
                  />
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
