import Link from "next/link";
import { Badge, EmptyState } from "@/components/pro/ui";
import { LinkRow, Panel, Timeline } from "@/components/gestion/bits";
import { RingCard } from "@/components/gestion/Ring";
import { CashflowChart } from "@/components/gestion/Cashflow";
import { getDemo } from "@/lib/demo";
import { euros, eurosWhole, formatDate, formatMonth } from "@/lib/types";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";
import { settlementNotes } from "@/lib/i18n/engine";
import { vacancyClock } from "@/domain/compliance/deadlines";
import { computeSettlement } from "@/domain/deposits/settlement";
import { monthlyCashflow } from "@/domain/finance/cashflow";
import { addDays, addYears } from "@/domain/dates";

const LIVE_MONTH = "2026-08";
const CHART_MONTHS = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];

export default async function DashboardPage() {
  const { locale, d } = await getI18n();
  const demo = await getDemo();

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
    RENT_PERIODS,
    TODAY,
    UNITS,
    WORKFLOWS,
    contactById,
    leaseTenantNames,
    propertyById,
    unitById,
  } = demo;

  // ── Rings: computed from the ledger, never hand-written ──
  const august = RENT_PERIODS.filter((rp) => rp.period === LIVE_MONTH);
  const expected = august.reduce((a, rp) => a + rp.totalCents, 0);
  const collected = august.reduce((a, rp) => a + rp.allocatedCents, 0);
  const paidCount = august.filter((rp) => rp.status === "paid").length;
  const lateCount = august.filter((rp) => rp.status === "late" || rp.status === "partial").length;

  const lettable = UNITS.filter((u) => u.kind !== "parking");
  const occupied = new Set(
    LEASES.filter((l) => l.status === "active" || l.status === "notice").map((l) => l.unitId),
  );
  const occupiedCount = lettable.filter((u) => occupied.has(u.id)).length;
  const vacantCount = lettable.length - occupiedCount;

  // ── Named records the templates point at (dataset-aware) ──
  const lease3b = LEASES.find((l) => l.id === "l-3b")!;
  const unit3b = unitById("u-b-3b").label;
  const unit2a = unitById("u-b-2a").label;
  const unit1a = unitById("u-b-1a").label;
  const unitGare = unitById("u-gare");
  const unitK01 = unitById("u-k-01").label;
  const beaulieu = propertyById("p-beaulieu");
  const reviewQueue = BANK_TXS.filter((t) => t.status === "review");
  const consentAccount = BANK_ACCOUNTS.find((b) => b.consentExpiresAt);
  const boilerTicket = demo.TICKETS.find((t) => t.id === "t-1")!;
  const kirchbergTx = BANK_TXS.find((t) => t.id === "tx-03")!;

  const gareVacancy = vacancyClock(unitGare.label, unitGare.vacantSince!, TODAY);

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

  // ── Recommended actions (top of the day, each linking into its module) ──
  const todo: Array<{ href: string; title: string; sub: string; badge: { label: string; color: string } }> = [
    {
      href: "/app/banque",
      title: fmt(d.dash.todoReview, { n: reviewQueue.length }),
      sub: d.dash.todoReviewSub,
      badge: { label: d.dash.badgeBank, color: "bg-amber-100 text-amber-800" },
    },
    {
      href: "/app/indexation",
      title: fmt(d.dash.todoLag, {
        unit: unit3b,
        amount: euros(lease3b.rentCents - (lease3b.previousRentCents ?? lease3b.rentCents), locale),
      }),
      sub: d.dash.todoLagSub,
      badge: { label: d.dash.badgeIndexation, color: "bg-sky-100 text-sky-800" },
    },
    {
      href: "/app/loyers",
      title: fmt(d.dash.todoMed, { unit: unit2a }),
      sub: d.dash.todoMedSub,
      badge: { label: d.dash.badgeArrears, color: "bg-red-100 text-red-700" },
    },
    {
      href: "/app/garanties",
      title: fmt(d.dash.todoDeposit, { unit: unitGare.label }),
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
      title: fmt(d.dash.todoAg, {
        property: beaulieu.name,
        date: formatDate(beaulieu.nextAgDate ?? null, locale),
        deadline: formatDate(beaulieu.nextAgDate ? addDays(beaulieu.nextAgDate, -15) : null, locale),
      }),
      sub: d.dash.todoAgSub,
      badge: { label: d.dash.badgeSyndic, color: "bg-violet-100 text-violet-800" },
    },
  ];

  // ── Workflow counters ──
  const wfBlocked = WORKFLOWS.filter((w) => w.blockedReason);
  const wfCounts = [
    { label: d.dash.wfRunning, value: WORKFLOWS.length - wfBlocked.length, edge: "border-l-brand-400" },
    { label: d.dash.wfBlocked, value: wfBlocked.length, edge: wfBlocked.length > 0 ? "border-l-red-400" : "border-l-sand-200" },
    { label: d.dash.wfMoveIn, value: WORKFLOWS.filter((w) => w.kind === "move_in").length, edge: "border-l-sky-400" },
    { label: d.dash.wfMoveOut, value: WORKFLOWS.filter((w) => w.kind === "move_out").length, edge: "border-l-amber-400" },
  ];

  // ── Cashflow (engine-aggregated) ──
  const cashflow = monthlyCashflow(RENT_PERIODS, CHART_MONTHS);

  // ── Activity feed, newest first, all names from the active dataset ──
  const activity = [
    {
      kind: "ticket",
      label: fmt(d.dash.activityTicket, {
        ref: boilerTicket.ref,
        artisan: boilerTicket.artisanContactId ? contactById(boilerTicket.artisanContactId).name : "—",
      }),
      sub: d.dash.activityTicketSub,
      atIso: "2026-08-21",
    },
    {
      kind: "document",
      label: fmt(d.dash.activityAttestation, { unit: unit2a }),
      sub: d.dash.activityAttestationSub,
      atIso: "2026-08-20",
    },
    {
      kind: "lease",
      label: fmt(d.dash.activityNotice, {
        unit: unit1a,
        tenant: leaseTenantNames(LEASES.find((l) => l.id === "l-1a")!)[0],
      }),
      sub: fmt(d.dash.activityNoticeSub, {
        date: formatDate(LEASES.find((l) => l.id === "l-1a")!.noticeInfo!.earliestEnd, locale),
      }),
      atIso: "2026-08-14",
    },
    {
      kind: "letter",
      label: fmt(d.dash.activityMed, { unit: unit2a }),
      sub: d.dash.activityMedSub,
      atIso: "2026-08-12",
    },
    {
      kind: "payment",
      label: fmt(d.dash.activityRent, { unit: unitK01, amount: euros(kirchbergTx.amount, locale) }),
      sub: d.dash.activityRentSub,
      atIso: "2026-08-05",
    },
  ].map((e) => ({ ...e, at: formatDate(e.atIso, locale) }));

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink">
          {fmt(d.dash.greeting, { name: ORG.managerName.split(" ")[0] })}
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          {fmt(d.dash.subtitle, { org: ORG.shortName, date: formatDate(TODAY, locale) })}
        </p>
      </div>

      {/* Personal overview — three rings, one action each */}
      <div className="stagger-rise grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <RingCard
          fraction={expected === 0 ? 0 : collected / expected}
          label={fmt(d.dash.ringCollected, { month: formatMonth(LIVE_MONTH, locale) })}
          value={eurosWhole(collected, locale)}
          sub={fmt(d.dash.ringCollectedSub, { expected: eurosWhole(expected, locale) })}
          actionHref="/app/banque"
          actionLabel={d.dash.ringCollectedAction}
        />
        <RingCard
          fraction={august.length === 0 ? 0 : paidCount / august.length}
          label={d.dash.ringPaid}
          value={`${paidCount}/${august.length}`}
          sub={lateCount > 0 ? fmt(d.dash.ringPaidSub, { late: lateCount }) : d.dash.ringPaidNone}
          actionHref="/app/loyers?vue=impayes"
          actionLabel={d.dash.ringPaidAction}
        />
        <RingCard
          fraction={lettable.length === 0 ? 0 : occupiedCount / lettable.length}
          label={d.dash.ringOccupancy}
          value={`${occupiedCount}/${lettable.length}`}
          sub={vacantCount > 0 ? fmt(d.dash.ringOccupancySub, { n: vacantCount }) : d.dash.ringOccupancyNone}
          actionHref="/app/biens?occupation=vacants"
          actionLabel={d.dash.ringOccupancyAction}
        />
      </div>

      <div className="mt-5 grid grid-cols-1 items-start gap-5 lg:grid-cols-3">
        <Panel
          title={d.dash.todoTitle}
          className="lg:col-span-2"
          action={
            <Badge className="bg-brand-50 text-brand-700">{fmt(d.dash.todoCount, { n: todo.length })}</Badge>
          }
        >
          <ul className="divide-y divide-sand-100">
            {todo.map((t) => (
              <li key={t.title}>
                <LinkRow
                  href={t.href}
                  title={t.title}
                  sub={t.sub}
                  right={<Badge className={t.badge.color}>{t.badge.label}</Badge>}
                />
              </li>
            ))}
          </ul>
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
                  sub={w.blockedReason ?? ""}
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
            legendExpected={d.dash.cashflowExpected}
            legendCollected={d.dash.cashflowCollected}
            ariaLabel={d.dash.cashflowAria}
          />
        </Panel>
      </div>

      <div className="mt-5 grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <Panel title={d.dash.activityTitle}>
          <Timeline entries={activity} />
        </Panel>

        <Panel title={d.dash.vigilanceTitle}>
          <ul className="space-y-3 text-sm">
            <li className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-ink">
                  {fmt(d.dash.vigilanceVacancy, { unit: unitGare.label, months: gareVacancy.monthsVacant })}
                </p>
                <p className="text-xs text-ink-soft">{d.dash.vigilanceVacancySub}</p>
              </div>
              <Badge className="bg-red-100 text-red-700">INOL</Badge>
            </li>
            <li className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-ink">{fmt(d.dash.vigilanceCpe, { property: beaulieu.name })}</p>
                <p className="text-xs text-ink-soft">
                  {fmt(d.dash.vigilanceCpeSub, { date: formatDate(addYears(beaulieu.cpeIssuedOn, 10), locale) })}
                </p>
              </div>
              <Badge className="bg-amber-100 text-amber-800">CPE</Badge>
            </li>
            <li className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-ink">{d.dash.vigilanceRc}</p>
                <p className="text-xs text-ink-soft">
                  {fmt(d.dash.vigilanceRcSub, { date: formatDate(ORG.piInsuranceExpiry, locale) })}
                </p>
              </div>
              <Badge className="bg-amber-100 text-amber-800">RC</Badge>
            </li>
            <li className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-ink">{fmt(d.dash.vigilanceSmoke, { unit: unitGare.label })}</p>
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
    </div>
  );
}
