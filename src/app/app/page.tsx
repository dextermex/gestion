import Link from "next/link";
import { Badge, Card } from "@/components/pro/ui";
import { Kpi, LinkRow, MetaBadge, Panel, Timeline } from "@/components/gestion/bits";
import {
  BANK_ACCOUNTS,
  BANK_TXS,
  DEPOSITS,
  EDLS,
  ENDED_LEASES,
  LEASES,
  RENT_PERIODS,
  TICKETS,
  TODAY,
  UNITS,
  WORKFLOWS,
  leaseTenantNames,
  leaseUnitLabel,
} from "@/lib/demo/data";
import { euros, eurosWhole, formatDate, formatPct, rentStatusMeta, workflowStateLabel } from "@/lib/types";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";
import { settlementNotes } from "@/lib/i18n/engine";
import { vacancyClock } from "@/domain/compliance/deadlines";
import { computeSettlement } from "@/domain/deposits/settlement";

export default async function DashboardPage() {
  const { locale, d } = await getI18n();
  const rentMeta = rentStatusMeta(d);

  // ── KPIs computed from the ledger, never hand-written ──
  const august = RENT_PERIODS.filter((rp) => rp.period === "2026-08");
  const expected = august.reduce((a, rp) => a + rp.totalCents, 0);
  const collected = august.reduce((a, rp) => a + rp.allocatedCents, 0);
  const lateAmount = RENT_PERIODS.filter((rp) => rp.status === "late" || rp.status === "partial")
    .filter((rp) => rp.period <= "2026-08")
    .reduce((a, rp) => a + (rp.totalCents - rp.allocatedCents), 0);

  const lettable = UNITS.filter((u) => u.kind !== "parking");
  const occupied = new Set(
    LEASES.filter((l) => l.status === "active" || l.status === "notice").map((l) => l.unitId),
  );
  const occupancyPct = Math.round((100 * lettable.filter((u) => occupied.has(u.id)).length) / lettable.length);

  const openTickets = TICKETS.filter((t) => !["done", "closed", "cancelled"].includes(t.status));
  const reviewQueue = BANK_TXS.filter((t) => t.status === "review");

  // ── Engine-derived alerts ──
  const gareUnit = UNITS.find((u) => u.id === "u-gare")!;
  const gareVacancy = vacancyClock("Studio 4A", gareUnit.vacantSince!, TODAY);

  const settlementDeposit = DEPOSITS.find((x) => x.id === "dep-gare")!;
  const settlementInput = {
    depositAmount: settlementDeposit.amountCents,
    depositForm: settlementDeposit.form,
    monthlyRent: ENDED_LEASES[0].rentCents,
    keyHandoverDate: settlementDeposit.keyHandoverOn!,
    decompteIssuedAt: settlementDeposit.decompteIssuedOn ?? null,
    entryEdlExists: settlementDeposit.entryEdlExists,
    deductions: settlementDeposit.deductions.map((x) => ({
      id: x.id,
      kind: x.kind,
      label: x.label,
      amount: x.amountCents,
      justificationDocRef: x.justificationDocRef,
      justifiedAt: x.justifiedAt,
    })),
    miseEnDemeureArDate: settlementDeposit.miseEnDemeureArOn ?? null,
    releasedFirstTranche: settlementDeposit.releasedFirstTrancheCents,
    releasedBalance: settlementDeposit.releasedBalanceCents,
    asOf: TODAY,
  };
  const settlement = computeSettlement(settlementInput);
  const settlementWarn = settlementNotes(d, locale, settlementInput, settlement);

  const consentAccount = BANK_ACCOUNTS.find((b) => b.consentExpiresAt);

  const todo: Array<{ href: string; title: string; sub: string; badge: { label: string; color: string } }> = [
    {
      href: "/app/banque",
      title: fmt(d.dash.todoReview, { n: reviewQueue.length }),
      sub: d.dash.todoReviewSub,
      badge: { label: d.dash.badgeBank, color: "bg-amber-100 text-amber-800" },
    },
    {
      href: "/app/indexation",
      title: d.dash.todoLag,
      sub: d.dash.todoLagSub,
      badge: { label: d.dash.badgeIndexation, color: "bg-sky-100 text-sky-800" },
    },
    {
      href: "/app/loyers",
      title: d.dash.todoMed,
      sub: d.dash.todoMedSub,
      badge: { label: d.dash.badgeArrears, color: "bg-red-100 text-red-700" },
    },
    {
      href: "/app/garanties",
      title: d.dash.todoDeposit,
      sub: settlementWarn[0] ?? "",
      badge: { label: d.dash.badgeDeposit, color: "bg-orange-100 text-orange-800" },
    },
    {
      href: "/app/banque",
      title: fmt(d.dash.todoConsent, { date: formatDate(consentAccount?.consentExpiresAt ?? null, locale) }),
      sub: d.dash.todoConsentSub,
      badge: { label: d.dash.badgeConnection, color: "bg-sand-100 text-ink-soft" },
    },
    {
      href: "/app/conformite",
      title: d.dash.todoAg,
      sub: d.dash.todoAgSub,
      badge: { label: d.dash.badgeSyndic, color: "bg-violet-100 text-violet-800" },
    },
  ];

  const endingLeases = LEASES.filter((l) => l.status === "notice");

  // Newest first — the feed reads top-down like an inbox.
  const activity = [
    { kind: "ticket", label: d.dash.activityTicket, sub: d.dash.activityTicketSub, atIso: "2026-08-21" },
    { kind: "document", label: d.dash.activityAttestation, sub: d.dash.activityAttestationSub, atIso: "2026-08-20" },
    { kind: "lease", label: d.dash.activityNotice, sub: d.dash.activityNoticeSub, atIso: "2026-08-14" },
    { kind: "letter", label: d.dash.activityMed, sub: d.dash.activityMedSub, atIso: "2026-08-12" },
    { kind: "payment", label: d.dash.activityKirchberg, sub: d.dash.activityKirchbergSub, atIso: "2026-08-05" },
  ].map((e) => ({ ...e, at: formatDate(e.atIso, locale) }));

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink">{d.dash.greeting}</h1>
        <p className="mt-1 text-sm text-ink-soft">{d.dash.subtitle}</p>
      </div>

      <div className="stagger-rise grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label={d.dash.kpiCollected}
          value={eurosWhole(collected, locale)}
          sub={fmt(d.dash.kpiCollectedSub, { expected: eurosWhole(expected, locale) })}
          tone={collected >= expected ? "good" : "default"}
        />
        <Kpi
          label={d.dash.kpiOccupancy}
          value={formatPct(occupancyPct, locale)}
          sub={fmt(d.dash.kpiOccupancySub, {
            occupied: lettable.filter((u) => occupied.has(u.id)).length,
            total: lettable.length,
          })}
        />
        <Kpi
          label={d.dash.kpiLate}
          value={eurosWhole(lateAmount, locale)}
          sub={d.dash.kpiLateSub}
          tone={lateAmount > 0 ? "bad" : "good"}
        />
        <Kpi label={d.dash.kpiTickets} value={String(openTickets.length)} sub={d.dash.kpiTicketsSub} />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Panel title={d.dash.todoTitle} className="lg:col-span-2">
          <ul className="divide-y divide-sand-100">
            {todo.map((t) => (
              <li key={t.title}>
                <LinkRow href={t.href} title={t.title} sub={t.sub} right={<Badge className={t.badge.color}>{t.badge.label}</Badge>} />
              </li>
            ))}
          </ul>
        </Panel>

        <div className="flex flex-col gap-5">
          <Panel title={d.dash.activityTitle}>
            <Timeline entries={activity} />
          </Panel>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Panel
          title={d.dash.rentMonthTitle}
          action={
            <Link href="/app/loyers" className="text-sm font-semibold text-brand-700 hover:underline">
              {d.common.seeAll}
            </Link>
          }
        >
          <ul className="divide-y divide-sand-100">
            {august.slice(0, 5).map((rp) => {
              const l = LEASES.find((x) => x.id === rp.leaseId)!;
              return (
                <li key={rp.id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{leaseUnitLabel(l)}</p>
                    <p className="truncate text-xs text-ink-soft">{leaseTenantNames(l).join(", ")}</p>
                  </div>
                  <p className="tabular-nums text-sm text-ink">{euros(rp.totalCents, locale)}</p>
                  <MetaBadge meta={rentMeta[rp.status]} />
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel title={d.dash.endingTitle}>
          {endingLeases.length === 0 ? (
            <p className="text-sm text-ink-soft">{d.dash.endingNone}</p>
          ) : (
            <ul className="divide-y divide-sand-100">
              {endingLeases.map((l) => (
                <li key={l.id}>
                  <LinkRow
                    href={`/app/baux/${l.id}`}
                    title={leaseUnitLabel(l)}
                    sub={fmt(d.dash.endingNotice, {
                      who: l.noticeInfo?.direction === "tenant" ? d.dash.endingTenant : d.dash.endingLandlord,
                      date: formatDate(l.noticeInfo?.earliestEnd ?? null, locale),
                    })}
                    right={<Badge className="bg-orange-100 text-orange-800">{d.status.lease.notice}</Badge>}
                  />
                </li>
              ))}
              <li>
                <LinkRow
                  href="/app/garanties"
                  title={d.dash.endingDepositRow}
                  sub={fmt(d.dash.endingDepositSub, { amount: euros(settlement.balanceAmount, locale) })}
                  right={<Badge className="bg-amber-100 text-amber-800">{d.dash.inProgress}</Badge>}
                />
              </li>
            </ul>
          )}
        </Panel>

        <Panel title={d.dash.vigilanceTitle}>
          <ul className="space-y-3 text-sm">
            <li className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-ink">
                  {fmt(d.dash.vigilanceVacancy, { months: gareVacancy.monthsVacant })}
                </p>
                <p className="text-xs text-ink-soft">{d.dash.vigilanceVacancySub}</p>
              </div>
              <Badge className="bg-red-100 text-red-700">INOL</Badge>
            </li>
            <li className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-ink">{d.dash.vigilanceCpe}</p>
                <p className="text-xs text-ink-soft">{d.dash.vigilanceCpeSub}</p>
              </div>
              <Badge className="bg-amber-100 text-amber-800">CPE</Badge>
            </li>
            <li className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-ink">{d.dash.vigilanceRc}</p>
                <p className="text-xs text-ink-soft">{d.dash.vigilanceRcSub}</p>
              </div>
              <Badge className="bg-amber-100 text-amber-800">RC</Badge>
            </li>
            <li className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-ink">{d.dash.vigilanceSmoke}</p>
                <p className="text-xs text-ink-soft">{d.dash.vigilanceSmokeSub}</p>
              </div>
              <Badge className="bg-red-100 text-red-700">{d.dash.vigilanceSmokeBadge}</Badge>
            </li>
          </ul>
          <Link href="/app/conformite" className="mt-4 block text-sm font-semibold text-brand-700 hover:underline">
            {d.dash.openCompliance}
          </Link>
        </Panel>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel
          title={d.dash.workflowsTitle}
          action={
            <Link href="/app/workflows" className="text-sm font-semibold text-brand-700 hover:underline">
              {d.common.seeAll}
            </Link>
          }
        >
          <ul className="divide-y divide-sand-100">
            {WORKFLOWS.slice(0, 4).map((w) => (
              <li key={w.id}>
                <LinkRow
                  href="/app/workflows"
                  title={w.label}
                  sub={w.blockedReason ?? fmt(d.dash.workflowsStep, { state: workflowStateLabel(d, w.currentState) })}
                  right={
                    w.blockedReason ? (
                      <Badge className="bg-amber-100 text-amber-800">{d.status.blocked}</Badge>
                    ) : (
                      <Badge className="bg-sky-100 text-sky-800">{workflowStateLabel(d, w.currentState)}</Badge>
                    )
                  }
                />
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title={d.dash.edlTitle}>
          <ul className="divide-y divide-sand-100">
            {EDLS.filter((e) => e.status === "draft").map((e) => (
              <li key={e.id}>
                <LinkRow
                  href="/app/workflows"
                  title={`${e.kind === "entry" ? d.dash.edlEntry : e.kind === "exit" ? d.dash.edlExit : d.dash.edlIntermediate} — ${e.unitLabel}`}
                  sub={fmt(d.dash.edlScheduled, { date: formatDate(e.scheduledAt, locale) })}
                  right={<Badge className="bg-sand-100 text-ink-soft">{d.status.planned}</Badge>}
                />
              </li>
            ))}
          </ul>
          <Card className="mt-3 border-dashed bg-sand-50/50 p-3">
            <p className="text-xs leading-relaxed text-ink-soft">{d.dash.edlFooter}</p>
          </Card>
        </Panel>
      </div>
    </div>
  );
}
