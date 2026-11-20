import Link from "next/link";
import ArrearsActions, { type ArrearsLabels } from "@/components/gestion/ArrearsActions";
import GenerateDocument from "@/components/gestion/GenerateDocument";
import { LegalNote } from "@/components/gestion/bits";
import DegradedNote from "@/components/gestion/DegradedNote";
import { FoldRow, GroupHead, Hero, HeroAction, HeroChip, HeroRing, MonthSwitch, Money, Rows, Step, Steps } from "@/components/gestion/Hero";
import { getDemo, isSampleData } from "@/lib/demo";
import { euros, eurosWhole, formatDate, formatMonth, initials, rentStatusMeta } from "@/lib/types";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";
import { assessArrears, type ArrearsStage } from "@/domain/arrears/ladder";
import { addMonths } from "@/domain/dates";
import { isOverdue } from "@/lib/gestion/ledger";
import { existingOf, generateLabels } from "@/lib/documents/labels";

export default async function LoyersPage({
  searchParams,
}: {
  searchParams: Promise<{ mois?: string; vue?: string; ouvrir?: string }>;
}) {
  const params = await searchParams;
  const { locale, d } = await getI18n();
  const { ARREARS_ACTIONS, DEGRADED, ORG, REGISTERED_LETTERS, RENT_PERIODS, TODAY, generatedFor, leaseById, leaseTenantNames, leaseUnitLabel } = await getDemo();
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
  // Behind is what is unpaid past its due date: a month part-paid before it falls due is still to come, as the tenant reads it.
  const isOpen = (rp: (typeof RENT_PERIODS)[number]) => isOverdue(rp, TODAY);
  // Late first, then what is partly paid, the oldest due date leading each.
  const byUrgency = (x: (typeof RENT_PERIODS)[number], y: (typeof RENT_PERIODS)[number]) =>
    x.status === y.status ? x.dueDate.localeCompare(y.dueDate) : x.status === "late" ? -1 : 1;

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
  const arrearsCases = RENT_PERIODS.filter((rp) => isOverdue(rp, TODAY) && rp.period <= liveMonth).map((rp) => {
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
    outdated: d.loyers.arrearsOutdated,
    already: d.loyers.arrearsAlready,
    needsAr: d.loyers.arrearsNeedsAr,
    sampleConfirmed: d.loyers.arrearsConfirmed,
    datePlaceholder: d.loyers.datePlaceholder,
  };
  const sampleNote = sample ? fmt(d.shell.sampleBanner, { cabinet: ORG.shortName }) : null;
  // The paper of a period: its notice, and its receipt once the ledger says
  // it is paid. Both come from the register, produced from the rows.
  const docLabels = generateLabels(d);
  const backTo = `/app/loyers?mois=${month}${view ? `&vue=${view}` : ""}`;

  type Period = (typeof RENT_PERIODS)[number];
  const caseOf = new Map(arrearsCases.map((c) => [c.rp.id, c]));
  const openNow = monthRows.filter(isOpen).sort(byUrgency);
  const earlier = RENT_PERIODS.filter((rp) => isOpen(rp) && rp.period < month).sort((x, y) => y.period.localeCompare(x.period) || byUrgency(x, y));
  const upcoming = monthRows.filter((rp) => rp.status === "pending" || rp.status === "upcoming" || (rp.status === "partial" && !isOverdue(rp, TODAY)));
  const paid = monthRows.filter((rp) => rp.status === "paid");
  const openCents = (rows: Period[]) => rows.reduce((a, rp) => a + rp.totalCents - rp.allocatedCents, 0);
  const lateTenants = new Set([...openNow, ...earlier].map((rp) => rp.leaseId)).size;
  const at = MONTHS.indexOf(month);
  const hrefOf = (m: string) => (m === liveMonth ? "/app/loyers" : `/app/loyers?mois=${m}`);

  /** The papers of a rent period: its notice, its receipt once paid, and the way to the lease. */
  const papers = (rp: Period) => (
    <div className="flex flex-wrap items-center gap-2">
      <GenerateDocument kind="rent_notice" sourceId={rp.id} label={d.loyers.docNotice} existing={existingOf(generatedFor("rent_notice", rp.id), d, locale)} writable={!sample} sampleNote={sampleNote} labels={docLabels} backTo={backTo} compact />
      {rp.status === "paid" && (
        <GenerateDocument kind="rent_receipt" sourceId={rp.id} label={d.loyers.docReceipt} existing={existingOf(generatedFor("rent_receipt", rp.id), d, locale)} writable={!sample} sampleNote={sampleNote} labels={docLabels} backTo={backTo} compact />
      )}
      <Link href={`/app/baux/${rp.leaseId}`} className="inline-flex min-h-10 items-center rounded-full px-3 text-sm font-semibold text-brand-700 hover:underline">
        {d.loyers.openLease}
      </Link>
    </div>
  );

  /** One tenant's rent of one month, still to collect: the ladder waits inside the row. */
  const openRow = (rp: Period) => {
    const l = leaseById(rp.leaseId);
    const names = leaseTenantNames(l).join(", ");
    const c = caseOf.get(rp.id);
    const due = rp.totalCents - rp.allocatedCents;
    const late = c ? fmt(d.legal.arrears.daysLate, { n: c.assessment.daysOverdue }) : fmt(d.loyers.dueOn, { date: formatDate(rp.dueDate, locale) });
    const next = c && c.assessment.nextStep && c.assessment.nextStep.dueFrom <= TODAY && !c.assessment.paused ? c.assessment.nextStep.stage : null;
    const actionable = Boolean(c && (next || c.awaitingLetter));
    return (
      <FoldRow
        key={rp.id}
        id={rp.id}
        open={params.ouvrir === rp.id}
        initials={initials(names)}
        tone="late"
        title={names || leaseUnitLabel(l)}
        sub={rp.period === month ? `${leaseUnitLabel(l)} · ${late}` : `${leaseUnitLabel(l)} · ${formatMonth(rp.period, locale)} · ${late}`}
        right={eurosWhole(due, locale)}
        rightSub={rp.status === "partial" ? rentMeta.partial.label : rentMeta.late.label}
        rightTone="late"
        action={actionable ? d.loyers.relaunch : undefined}
      >
        <p className="mb-3 text-[13px] text-ink-soft">
          {formatMonth(rp.period, locale)} · {fmt(d.legal.arrears.openAmount, { amount: euros(due, locale) })}
          {rp.status === "partial" && ` · ${fmt(d.loyers.partialOf, { open: euros(due, locale), total: euros(rp.totalCents, locale) })}`}
        </p>
        {c && (
          <Steps label={d.loyers.arrearsHistory}>
            {c.steps.map((a) => (
              <Step key={a.id} state="done" title={stageLabel[a.stage]} date={formatDate(a.executedOn, locale)}>
                {a.stage === "formal" && (
                  <div className="mt-1.5">
                    <GenerateDocument kind="arrears_formal" sourceId={a.id} label={d.loyers.docLetter} existing={existingOf(generatedFor("arrears_formal", a.id), d, locale)} writable={!sample} sampleNote={sampleNote} labels={docLabels} backTo={backTo} compact />
                  </div>
                )}
                {a.stage === "mise_en_demeure" && c.letter && (
                  <div className="mt-1.5">
                    <GenerateDocument kind="arrears_mise_en_demeure" sourceId={c.letter.id} label={d.loyers.docLetter} existing={existingOf(generatedFor("arrears_mise_en_demeure", c.letter.id), d, locale)} writable={!sample} sampleNote={sampleNote} labels={docLabels} backTo={backTo} compact />
                  </div>
                )}
              </Step>
            ))}
            {c.letter?.arReceivedOn && <Step state="done" title={d.loyers.arrearsArOn} date={formatDate(c.letter.arReceivedOn, locale)} />}
            {(c.assessment.nextStep || c.awaitingLetter) && (
              <Step
                state="next"
                title={c.assessment.nextStep ? `${d.legal.arrears.nextStep} ${stageLabel[c.assessment.nextStep.stage]}` : d.loyers.arrearsArOn}
                date={c.assessment.nextStep && c.assessment.nextStep.dueFrom > TODAY ? fmt(d.legal.arrears.fromDate, { date: formatDate(c.assessment.nextStep.dueFrom, locale) }) : undefined}
              >
                {c.assessment.nextStep && (
                  <p className="mt-0.5 text-[13px] text-ink-soft">
                    {stageDescription[c.assessment.nextStep.stage]}
                    {c.assessment.nextStep.requiresRegisteredLetter && ` ${d.loyers.arrearsLrar}.`}
                  </p>
                )}
                {c.notes.map((n) => (
                  <p key={n} className="mt-1 text-[13px] text-ink-soft">{n}</p>
                ))}
                <ArrearsActions
                  leaseId={rp.leaseId}
                  rentPeriodId={rp.id}
                  next={next}
                  awaitingLetter={c.awaitingLetter}
                  todayISO={TODAY}
                  stageLabel={c.assessment.nextStep ? stageLabel[c.assessment.nextStep.stage] : ""}
                  locale={locale}
                  writable={!sample}
                  sampleNote={null}
                  labels={arrearsLabels}
                />
              </Step>
            )}
          </Steps>
        )}
        <div className="mt-4">{papers(rp)}</div>
      </FoldRow>
    );
  };

  /** A rent that asks for nothing: paid, or not yet due. Quiet, its papers inside. */
  const quietRow = (rp: Period) => {
    const l = leaseById(rp.leaseId);
    const names = leaseTenantNames(l).join(", ");
    return (
      <FoldRow
        key={rp.id}
        id={rp.id}
        open={params.ouvrir === rp.id}
        initials={initials(names)}
        tone="quiet"
        title={names || leaseUnitLabel(l)}
        sub={`${leaseUnitLabel(l)} · ${rp.status === "paid" ? rentMeta.paid.label : fmt(d.loyers.dueOn, { date: formatDate(rp.dueDate, locale) })}`}
        right={eurosWhole(rp.totalCents, locale)}
        rightTone="soft"
      >
        {papers(rp)}
      </FoldRow>
    );
  };

  return (
    <div className="space-y-8">
      {/* A read of this page failed (the shell says when the whole workspace could not be read). */}
      <DegradedNote tables={DEGRADED.filter((t) => t !== "hydration")} d={d} />
      <Hero
        title={d.loyers.title}
        top={
          <MonthSwitch
            label={formatMonth(month, locale)}
            prev={at > 0 ? hrefOf(MONTHS[at - 1]) : null}
            next={at < MONTHS.length - 1 ? hrefOf(MONTHS[at + 1]) : null}
            prevLabel={d.home.prevMonth}
            nextLabel={d.home.nextMonth}
          />
        }
        label={fmt(d.loyers.heroLabel, { month: formatMonth(month, locale) })}
        figure={<Money value={eurosWhole(open, locale)} />}
        aside={
          expected > 0 ? (
            <HeroRing
              fraction={collected / expected}
              value={`${Math.round((collected / expected) * 100)} %`}
              label={fmt(d.loyers.chipCollected, { amount: eurosWhole(collected, locale) })}
              sub={fmt(d.loyers.ofExpected, { expected: eurosWhole(expected, locale) })}
            />
          ) : undefined
        }
        actions={
          <>
            <HeroAction create="payment" icon="plus" label={d.loyers.actPayment} />
            <HeroAction create="lease" icon="documents" label={d.loyers.actLease} />
            <HeroAction href="/app/finance" icon="euro" label={d.loyers.actFinance} />
          </>
        }
      >
        {lateTenants > 0 && (
          <HeroChip href="#a-encaisser" icon="alert" tone="late">
            {fmt(d.loyers.chipLate, { n: lateTenants })}
          </HeroChip>
        )}
      </Hero>

      <div className="mx-auto max-w-4xl">
        {monthRows.length === 0 && earlier.length === 0 && <p className="px-1 text-sm text-ink-soft">{d.loyers.nothingDue}</p>}
        {monthRows.length > 0 && openNow.length === 0 && upcoming.length === 0 && view !== "payes" && <p className="px-1 text-sm font-medium text-emerald-800">{d.loyers.allPaid}</p>}

        {view !== "payes" && openNow.length > 0 && (
          <>
            <GroupHead id="a-encaisser" title={formatMonth(month, locale)} total={eurosWhole(openCents(openNow), locale)} tone="late" />
            <Rows>{openNow.map(openRow)}</Rows>
          </>
        )}
        {view !== "payes" && earlier.length > 0 && (
          <>
            <GroupHead id={openNow.length === 0 ? "a-encaisser" : undefined} title={d.loyers.groupEarlier} total={eurosWhole(openCents(earlier), locale)} tone="late" />
            <Rows>{earlier.map(openRow)}</Rows>
          </>
        )}
        {view !== "impayes" && upcoming.length > 0 && (
          <>
            <GroupHead title={d.loyers.groupUpcoming} total={eurosWhole(openCents(upcoming), locale)} />
            <Rows>{upcoming.map(quietRow)}</Rows>
          </>
        )}
        {view !== "impayes" && paid.length > 0 && (
          <details className="mt-7" open={view === "payes" || (openNow.length === 0 && earlier.length === 0)}>
            <summary className="mb-2 flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-1 text-sm font-semibold text-ink-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 [&::-webkit-details-marker]:hidden">
              <span>{fmt(d.loyers.groupPaid, { n: paid.length })}</span>
              <span className="tabular-nums text-emerald-700">{eurosWhole(paid.reduce((a, rp) => a + rp.allocatedCents, 0), locale)}</span>
            </summary>
            <Rows>{paid.map(quietRow)}</Rows>
          </details>
        )}

        {(openNow.length > 0 || earlier.length > 0) && <LegalNote>{d.loyers.arrearsLegal}</LegalNote>}
      </div>
    </div>
  );
}
