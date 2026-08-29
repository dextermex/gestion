import Link from "next/link";
import { Badge, EmptyState } from "@/components/pro/ui";
import { LinkRow, Panel, Timeline } from "@/components/gestion/bits";
import { RingCard } from "@/components/gestion/Ring";
import { CashflowChart } from "@/components/gestion/Cashflow";
import { getDemo } from "@/lib/demo";
import { getIdentity } from "@/lib/workspace";
import { euros, eurosWhole, formatDate, formatMonth } from "@/lib/types";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";
import { settlementNotes } from "@/lib/i18n/engine";
import { cpeExpiryDeadline, vacancyClock } from "@/domain/compliance/deadlines";
import { assessArrears } from "@/domain/arrears/ladder";
import { computeSettlement } from "@/domain/deposits/settlement";
import { monthlyCashflow } from "@/domain/finance/cashflow";
import { addDays, addMonths, diffDays } from "@/domain/dates";

/**
 * Aujourd'hui: the command center. Every block is DERIVED — a row appears
 * because the data carries its signal, on the sample cabinets and on a real
 * account alike. Nothing here names a record that might not exist.
 */
export default async function DashboardPage() {
  const { locale, d } = await getI18n();
  const demo = await getDemo();
  const identity = await getIdentity();

  // A real account with nothing in it: say so rather than reach for a
  // showcase record that no longer exists.
  if (demo.UNITS.length === 0)
    return <EmptyState title={fmt(d.common.emptyTitle, { section: d.nav.home })} body={d.common.emptyBody} />;
  const {
    BANK_ACCOUNTS,
    BANK_TXS,
    DEPOSITS,
    ENDED_LEASES,
    LEASES,
    ORG,
    PROPERTIES,
    RENT_PERIODS,
    TICKETS,
    TODAY,
    UNITS,
    WORKFLOWS,
    leaseTenantNames,
    leaseUnitLabel,
  } = demo;

  const liveMonth = TODAY.slice(0, 7);
  const chartMonths = [-3, -2, -1, 0, 1].map((k) => addMonths(`${liveMonth}-01`, k).slice(0, 7));
  const leaseIndex = new Map(LEASES.map((l) => [l.id, l]));
  const labelOfLease = (id: string): string => {
    const l = leaseIndex.get(id);
    if (l) return leaseUnitLabel(l);
    return ENDED_LEASES.find((e) => e.id === id)?.label ?? "";
  };

  // ── Rings: computed from the ledger, never hand-written ──
  const month = RENT_PERIODS.filter((rp) => rp.period === liveMonth);
  const expected = month.reduce((a, rp) => a + rp.totalCents, 0);
  const collected = month.reduce((a, rp) => a + rp.allocatedCents, 0);
  const paidCount = month.filter((rp) => rp.status === "paid").length;
  const lateCount = month.filter((rp) => rp.status === "late" || rp.status === "partial").length;

  const lettable = UNITS.filter((u) => u.kind !== "parking");
  const occupied = new Set(
    LEASES.filter((l) => l.status === "active" || l.status === "notice").map((l) => l.unitId),
  );
  const occupiedCount = lettable.filter((u) => occupied.has(u.id)).length;
  const vacantCount = lettable.length - occupiedCount;

  // ── Recommended actions: each row exists because its signal exists ──
  const todo: Array<{ href: string; title: string; sub: string; badge: { label: string; color: string } }> = [];

  const reviewQueue = BANK_TXS.filter((t) => t.status === "review");
  if (reviewQueue.length > 0) {
    todo.push({
      href: "/app/banque",
      title: fmt(d.dash.todoReview, { n: reviewQueue.length }),
      sub: d.dash.todoReviewSub,
      badge: { label: d.dash.badgeBank, color: "bg-sand-100 text-ink-soft" },
    });
  }

  // Indexation lag: this month's payment arrived at the previous rent.
  const lagLease = LEASES.find((l) => {
    if (!l.previousRentCents || l.previousRentCents >= l.rentCents) return false;
    const rp = RENT_PERIODS.find((x) => x.leaseId === l.id && x.period === liveMonth);
    return rp ? rp.allocatedCents > 0 && rp.allocatedCents === l.previousRentCents + rp.chargesCents : false;
  });
  if (lagLease) {
    todo.push({
      href: "/app/indexation",
      title: fmt(d.dash.todoLag, {
        unit: leaseUnitLabel(lagLease),
        amount: euros(lagLease.rentCents - (lagLease.previousRentCents ?? 0), locale),
      }),
      sub: d.dash.todoLagSub,
      badge: { label: d.dash.badgeIndexation, color: "bg-sand-100 text-ink-soft" },
    });
  }

  // Oldest open arrears case, assessed by the legal ladder.
  const lateOpen = RENT_PERIODS.filter(
    (rp) => (rp.status === "late" || rp.status === "partial") && rp.period <= liveMonth && rp.allocatedCents < rp.totalCents,
  ).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
  if (lateOpen.length > 0) {
    const worst = lateOpen[0];
    const assessment = assessArrears(
      {
        invoiceId: worst.id,
        dueDate: worst.dueDate,
        openAmount: worst.totalCents - worst.allocatedCents,
        paymentPlanActive: false,
        executed: {},
        miseEnDemeureArDate: null,
      },
      TODAY,
    );
    todo.push({
      href: "/app/loyers?vue=impayes",
      title: fmt(d.dash.todoMed, {
        unit: labelOfLease(worst.leaseId),
        month: formatMonth(worst.period, locale),
        days: assessment.daysOverdue,
      }),
      sub: d.dash.todoMedSub,
      badge: { label: d.dash.badgeArrears, color: "bg-red-100 text-red-700" },
    });
  }

  // Deposits mid-restitution with retentions still waiting on their proof.
  for (const dep of DEPOSITS) {
    if (dep.status === "held" || dep.status === "released") continue;
    const monthlyRent =
      leaseIndex.get(dep.leaseId)?.rentCents ?? ENDED_LEASES.find((e) => e.id === dep.leaseId)?.rentCents ?? 0;
    const input = {
      depositAmount: dep.amountCents,
      depositForm: dep.form,
      monthlyRent,
      keyHandoverDate: dep.keyHandoverOn ?? TODAY,
      decompteIssuedAt: dep.decompteIssuedOn ?? null,
      entryEdlExists: dep.entryEdlExists,
      deductions: dep.deductions.map((x) => ({
        id: x.id,
        kind: x.kind,
        label: x.label,
        amount: x.amountCents,
        justificationDocRef: x.justificationDocRef,
        justifiedAt: x.justifiedAt,
      })),
      miseEnDemeureArDate: dep.miseEnDemeureArOn ?? null,
      releasedFirstTranche: dep.releasedFirstTrancheCents,
      releasedBalance: dep.releasedBalanceCents,
      asOf: TODAY,
    };
    const settlement = computeSettlement(input);
    // To handle: waiting on proof, forfeited (release the money), or blocked.
    const pending = settlement.lines.filter((li) => li.status !== "justified").length;
    if (pending > 0) {
      todo.push({
        href: "/app/garanties",
        title: fmt(d.dash.todoDeposit, { unit: labelOfLease(dep.leaseId), n: pending }),
        sub: settlementNotes(d, locale, input, settlement)[0] ?? "",
        badge: { label: d.dash.badgeDeposit, color: "bg-sand-100 text-ink-soft" },
      });
      break;
    }
  }

  const consentAccount = BANK_ACCOUNTS.filter((b) => b.consentExpiresAt).sort((a, b) =>
    (a.consentExpiresAt ?? "") < (b.consentExpiresAt ?? "") ? -1 : 1,
  )[0];
  if (consentAccount?.consentExpiresAt && diffDays(TODAY, consentAccount.consentExpiresAt) <= 45) {
    todo.push({
      href: "/app/banque",
      title: fmt(d.dash.todoConsent, { date: formatDate(consentAccount.consentExpiresAt, locale) }),
      sub: d.dash.todoConsentSub,
      badge: { label: d.dash.badgeConnection, color: "bg-sand-100 text-ink-soft" },
    });
  }

  const agProperty = PROPERTIES.filter((p) => p.nextAgDate).sort((a, b) =>
    (a.nextAgDate ?? "") < (b.nextAgDate ?? "") ? -1 : 1,
  )[0];
  if (agProperty?.nextAgDate) {
    todo.push({
      href: "/app/conformite",
      title: fmt(d.dash.todoAg, {
        property: agProperty.name,
        date: formatDate(agProperty.nextAgDate, locale),
        deadline: formatDate(addDays(agProperty.nextAgDate, -15), locale),
      }),
      sub: d.dash.todoAgSub,
      badge: { label: d.dash.badgeSyndic, color: "bg-sand-100 text-ink-soft" },
    });
  }

  // ── Workflow counters ──
  const wfBlocked = WORKFLOWS.filter((w) => w.blockedReason);
  const wfCounts = [
    { label: d.dash.wfRunning, value: WORKFLOWS.length - wfBlocked.length, edge: "border-l-brand-400" },
    { label: d.dash.wfBlocked, value: wfBlocked.length, edge: wfBlocked.length > 0 ? "border-l-red-400" : "border-l-sand-200" },
    { label: d.dash.wfMoveIn, value: WORKFLOWS.filter((w) => w.kind === "move_in").length, edge: "border-l-sky-400" },
    { label: d.dash.wfMoveOut, value: WORKFLOWS.filter((w) => w.kind === "move_out").length, edge: "border-l-amber-400" },
  ];

  // ── Cashflow (engine-aggregated) ──
  const cashflow = monthlyCashflow(RENT_PERIODS, chartMonths);

  // ── Activity feed: recent facts, newest first ──
  const activity = [
    ...BANK_TXS.filter((t) => t.status === "auto" || t.status === "manual")
      .slice(-3)
      .map((t) => ({
        kind: "payment",
        label: fmt(d.dash.activityRent, {
          unit: t.matchedLeaseId ? labelOfLease(t.matchedLeaseId) : t.counterpartyName,
          amount: euros(t.amount, locale),
        }),
        sub: d.dash.activityRentSub,
        atIso: t.bookedAt,
      })),
    ...TICKETS.slice(-2).map((t) => ({
      kind: "ticket",
      label: fmt(d.dash.activityTicket, { ref: t.ref, title: t.title }),
      sub: t.unitLabel,
      atIso: t.createdAt,
    })),
    ...LEASES.filter((l) => l.noticeInfo).map((l) => ({
      kind: "lease",
      label: fmt(d.dash.activityNotice, { unit: leaseUnitLabel(l), tenant: leaseTenantNames(l)[0] ?? "" }),
      sub: fmt(d.dash.activityNoticeSub, { date: formatDate(l.noticeInfo!.earliestEnd, locale) }),
      atIso: l.noticeInfo!.arReceivedOn,
    })),
  ]
    .sort((a, b) => (a.atIso < b.atIso ? 1 : -1))
    .slice(0, 5)
    .map((e) => ({ ...e, at: formatDate(e.atIso, locale) }));

  // ── Vigilance: the moat working, not a menu entry ──
  const vigilance: Array<{ title: string; sub: string; badge: { label: string; color: string } }> = [];
  const vacantWithClock = UNITS.filter((u) => u.vacantSince);
  if (vacantWithClock.length > 0) {
    const clock = vacancyClock(vacantWithClock[0].label, vacantWithClock[0].vacantSince!, TODAY);
    vigilance.push({
      title: fmt(d.dash.vigilanceVacancy, { unit: clock.unitLabel, months: clock.monthsVacant }),
      sub: d.dash.vigilanceVacancySub,
      badge: { label: "INOL", color: "bg-red-100 text-red-700" },
    });
  }
  const cpeSoonest = PROPERTIES.filter((p) => p.cpeIssuedOn)
    .map((p) => ({ p, dl: cpeExpiryDeadline(p.name, p.cpeIssuedOn) }))
    .sort((a, b) => (a.dl.dueAt < b.dl.dueAt ? -1 : 1))[0];
  if (cpeSoonest) {
    vigilance.push({
      title: fmt(d.dash.vigilanceCpe, { property: cpeSoonest.p.name }),
      sub: fmt(d.dash.vigilanceCpeSub, { date: formatDate(cpeSoonest.dl.dueAt, locale) }),
      badge: { label: "CPE", color: "bg-amber-100 text-amber-800" },
    });
  }
  if (ORG.piInsuranceExpiry) {
    vigilance.push({
      title: d.dash.vigilanceRc,
      sub: fmt(d.dash.vigilanceRcSub, { date: formatDate(ORG.piInsuranceExpiry, locale) }),
      badge: { label: "RC", color: "bg-amber-100 text-amber-800" },
    });
  }
  const smokeMissing = PROPERTIES.find((p) => !p.smokeDetectorsConfirmed);
  if (smokeMissing) {
    vigilance.push({
      title: fmt(d.dash.vigilanceSmoke, { unit: smokeMissing.name }),
      sub: d.dash.vigilanceSmokeSub,
      badge: { label: d.dash.vigilanceSmokeBadge, color: "bg-red-100 text-red-700" },
    });
  }

  const firstName = (identity?.displayName ?? ORG.managerName ?? "").split(" ")[0] || ORG.shortName;

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink">
          {fmt(d.dash.greeting, { name: firstName })}
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          {fmt(d.dash.subtitle, { org: ORG.shortName, date: formatDate(TODAY, locale) })}
        </p>
      </div>

      {/* Personal overview — three rings, one action each */}
      <div className="stagger-rise grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <RingCard
          fraction={expected === 0 ? 0 : collected / expected}
          label={fmt(d.dash.ringCollected, { month: formatMonth(liveMonth, locale) })}
          value={eurosWhole(collected, locale)}
          sub={fmt(d.dash.ringCollectedSub, { expected: eurosWhole(expected, locale) })}
          actionHref="/app/banque"
          actionLabel={d.dash.ringCollectedAction}
        />
        <RingCard
          fraction={month.length === 0 ? 0 : paidCount / month.length}
          label={d.dash.ringPaid}
          value={`${paidCount}/${month.length}`}
          sub={lateCount > 0 ? fmt(d.dash.ringPaidSub, { late: lateCount }) : d.dash.ringPaidNone}
          actionHref="/app/loyers?vue=impayes"
          actionLabel={d.dash.ringPaidAction}
        />
        <RingCard
          fraction={lettable.length === 0 ? 0 : occupiedCount / lettable.length}
          label={d.dash.ringOccupancy}
          value={`${occupiedCount}/${lettable.length}`}
          sub={
            vacantCount === 0
              ? d.dash.ringOccupancyNone
              : vacantCount === 1
                ? d.dash.ringOccupancySubOne
                : fmt(d.dash.ringOccupancySubMany, { n: vacantCount })
          }
          actionHref="/app/biens?occupation=vacants"
          actionLabel={d.dash.ringOccupancyAction}
        />
      </div>

      <div className="mt-5 grid grid-cols-1 items-start gap-5 lg:grid-cols-3">
        <Panel
          title={d.dash.todoTitle}
          className="lg:col-span-2"
          action={
            todo.length > 0 ? (
              <Badge className="bg-brand-50 text-brand-700">{fmt(d.dash.todoCount, { n: todo.length })}</Badge>
            ) : undefined
          }
        >
          {todo.length === 0 ? (
            <p className="text-sm text-ink-soft">{d.dash.todoNone}</p>
          ) : (
            <ul className="divide-y divide-sand-100">
              {todo.map((t) => (
                <li key={t.title}>
                  <LinkRow
                    href={t.href}
                    title={t.title}
                    sub={t.sub}
                    right={
                      // On a phone the chip would squeeze the sentence it labels;
                      // the row itself already says where it leads.
                      <span className="max-sm:hidden">
                        <Badge className={t.badge.color}>{t.badge.label}</Badge>
                      </span>
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title={d.dash.workflowsTitle}
          action={
            <Link href="/app/workflows" className="text-sm font-semibold text-brand-700 hover:underline">
              {d.common.seeAll}
            </Link>
          }
        >
          <div className="grid grid-cols-2 gap-3">
            {wfCounts.map((w) => (
              <Link
                key={w.label}
                href="/app/workflows"
                className={`rounded-xl border border-sand-200 bg-white p-3.5 transition hover:border-brand-200 border-l-4 ${w.edge}`}
              >
                <p className="font-display text-xl font-bold tabular-nums text-ink">{w.value}</p>
                <p className="mt-0.5 text-xs font-medium text-ink-soft">{w.label}</p>
              </Link>
            ))}
          </div>
          <ul className="mt-3 divide-y divide-sand-100">
            {wfBlocked.slice(0, 2).map((w) => (
              <li key={w.id}>
                <LinkRow
                  href="/app/workflows"
                  title={w.label}
                  sub={(w.blockedReason ?? "").split(". ")[0]}
                  right={<Badge className="bg-amber-100 text-amber-800">{d.status.blocked}</Badge>}
                />
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <div className="mt-5">
        <Panel title={d.dash.cashflowTitle}>
          <p className="-mt-2 mb-4 text-xs text-ink-soft">{d.dash.cashflowSub}</p>
          <CashflowChart
            data={cashflow}
            locale={locale}
            currentMonth={liveMonth}
            legendExpected={d.dash.cashflowExpected}
            legendCollected={d.dash.cashflowCollected}
            ariaLabel={d.dash.cashflowAria}
          />
        </Panel>
      </div>

      <div className="mt-5 grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <Panel title={d.dash.activityTitle}>
          {activity.length === 0 ? (
            <p className="text-sm text-ink-soft">{d.dash.activityNone}</p>
          ) : (
            <Timeline entries={activity} />
          )}
        </Panel>

        <Panel title={d.dash.vigilanceTitle}>
          {vigilance.length === 0 ? (
            <p className="text-sm text-ink-soft">{d.dash.vigilanceNone}</p>
          ) : (
            <ul className="space-y-3 text-sm">
              {vigilance.map((v) => (
                <li key={v.title} className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-ink">{v.title}</p>
                    <p className="text-xs text-ink-soft">{v.sub}</p>
                  </div>
                  <Badge className={v.badge.color}>{v.badge.label}</Badge>
                </li>
              ))}
            </ul>
          )}
          <Link href="/app/conformite" className="mt-4 block text-sm font-semibold text-brand-700 hover:underline">
            {d.dash.openCompliance}
          </Link>
        </Panel>
      </div>
    </div>
  );
}
