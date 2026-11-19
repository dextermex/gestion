import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/pro/ui";
import { Hero, HeroAction, HeroChip, HeroRing, MonthSwitch, Money, Row, Rows, Section } from "@/components/gestion/Hero";
import MonthBars, { type MonthBar } from "@/components/gestion/MonthBars";
import GlassHouse from "@/components/gestion/GlassHouse";
import { Icon, type IconName } from "@/components/pro/icons";
import { getDemo } from "@/lib/demo";
import { getIdentity } from "@/lib/workspace";
import { euros, eurosWhole, formatDate, formatMonth } from "@/lib/types";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";
import { settlementNotes } from "@/lib/i18n/engine";
import { cpeExpiryDeadline, vacancyClock } from "@/domain/compliance/deadlines";
import { computeSettlement } from "@/domain/deposits/settlement";
import { monthlyCashflow } from "@/domain/finance/cashflow";
import { addDays, addMonths, diffDays } from "@/domain/dates";

/**
 * Aujourd'hui: the command center. Every block is DERIVED — a row appears
 * because the data carries its signal, on the sample cabinets and on a real
 * account alike. Nothing here names a record that might not exist.
 */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ mois?: string }> }) {
  const params = await searchParams;
  const { locale, d } = await getI18n();
  const demo = await getDemo();
  const identity = await getIdentity();

  // A real account with nothing in it: say so rather than reach for a
  // showcase record that no longer exists.
  if (demo.UNITS.length === 0)
    return <div>
      <PageHeader title={d.nav.home} subtitle={d.biens.subtitle} />
      <div className="crm-welcome"><GlassHouse /><EmptyState icon="properties" title={d.biens.emptyFirstTitle} body={d.biens.emptyFirstBody}
        action={<Link href="/app/biens/nouveau" className="ui-button inline-flex items-center gap-2 rounded-full bg-brand-700 px-5 py-3 text-sm font-semibold text-white hover:bg-brand-800"><Icon name="plus" size={16} />{d.biens.addProperty}</Link>} /></div>
    </div>;
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
  const chartMonths = [-4, -3, -2, -1, 0, 1].map((k) => addMonths(`${liveMonth}-01`, k).slice(0, 7));
  // The month on the screen: the one the address names when it is one of the bars and has begun, else this one.
  const pastMonths = chartMonths.filter((m) => m <= liveMonth);
  const shownMonth = params.mois && pastMonths.includes(params.mois) ? params.mois : liveMonth;
  const monthHref = (m: string) => (m === liveMonth ? "/app" : `/app?mois=${m}`);
  const leaseIndex = new Map(LEASES.map((l) => [l.id, l]));
  const labelOfLease = (id: string): string => {
    const l = leaseIndex.get(id);
    if (l) return leaseUnitLabel(l);
    return ENDED_LEASES.find((e) => e.id === id)?.label ?? "";
  };

  // ── Overview: computed from the ledger, never hand-written ──
  const month = RENT_PERIODS.filter((rp) => rp.period === shownMonth);
  const expected = month.reduce((a, rp) => a + rp.totalCents, 0);
  const collected = month.reduce((a, rp) => a + rp.allocatedCents, 0);
  const paidCount = month.filter((rp) => rp.status === "paid").length;
  const lateMonth = month.filter((rp) => (rp.status === "late" || rp.status === "partial") && rp.allocatedCents < rp.totalCents);
  const lateCount = lateMonth.length;
  const lateMonthCents = lateMonth.reduce((a, rp) => a + rp.totalCents - rp.allocatedCents, 0);

  const lettable = UNITS.filter((u) => u.kind !== "parking");
  const occupied = new Set(
    LEASES.filter((l) => l.status === "active" || l.status === "notice").map((l) => l.unitId),
  );
  const occupiedCount = lettable.filter((u) => occupied.has(u.id)).length;

  // ── Recommended actions: each row exists because its signal exists ──
  const todo: Array<{ priority?: number; href: string; title: string; sub: string; amount?: string; badge: { label: string; color: string } }> = [];

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
    // Late tenants once, as one row: who is late is the Loyers screen's to say.
    const tenants = new Set(lateOpen.map((rp) => rp.leaseId)).size;
    todo.push({
      priority: 1,
      href: "/app/loyers?vue=impayes",
      title: tenants === 1 ? d.home.arrearsOne : fmt(d.home.arrearsMany, { n: tenants }),
      sub: d.home.arrearsSub,
      amount: eurosWhole(lateOpen.reduce((sum, rp) => sum + rp.totalCents - rp.allocatedCents, 0), locale),
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
        priority: 2,
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

  todo.sort((a, b) => (a.priority ?? 3) - (b.priority ?? 3));

  // ── Workflow counters ──
  const wfBlocked = WORKFLOWS.filter((w) => w.blockedReason);

  // ── Cashflow (engine-aggregated) ──
  const cashflow = monthlyCashflow(RENT_PERIODS, chartMonths);

  // ── Activity feed: recent facts, newest first ──
  const activity = [
    ...BANK_TXS.filter((t) => t.status === "auto" || t.status === "manual")
      .slice(-3)
      .map((t) => ({
        kind: "payment",
        label: d.experience.activityPayment,
        sub: `${t.matchedLeaseId ? labelOfLease(t.matchedLeaseId) : t.counterpartyName} · ${d.dash.activityRentSub}`,
        amount: eurosWhole(t.amount, locale),
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

  const pct = expected === 0 ? 0 : Math.round((collected / expected) * 100);
  const at = pastMonths.indexOf(shownMonth);
  const iconOf = (href: string) => (href.includes("banque") ? "bank" : href.includes("garanties") ? "shield-check" : href.includes("loyers") ? "alert" : href.includes("indexation") ? "trending-up" : "calendar") as IconName;
  const activityIcon: Record<string, IconName> = { payment: "euro", ticket: "tasks", lease: "key" };
  const bars: MonthBar[] = cashflow.map((c) => ({
    month: c.month,
    label: formatMonth(c.month, locale).split(" ")[0],
    expectedCents: c.expectedCents,
    collectedCents: c.collectedCents,
    future: c.month > liveMonth,
    href: c.month > liveMonth ? null : monthHref(c.month),
    expected: eurosWhole(c.expectedCents, locale),
    collected: eurosWhole(c.collectedCents, locale),
  }));

  return (
    <div className="space-y-9">
      {/* The month, in the one raised card of the page: what came in, of what, who is late, how full the lots are. */}
      <Hero
        title={d.nav.home}
        art
        eyebrow={fmt(d.dash.greeting, { name: firstName })}
        top={
          <MonthSwitch
            label={formatMonth(shownMonth, locale)}
            prev={at > 0 ? monthHref(pastMonths[at - 1]) : null}
            next={at < pastMonths.length - 1 ? monthHref(pastMonths[at + 1]) : null}
            prevLabel={d.home.prevMonth}
            nextLabel={d.home.nextMonth}
          />
        }
        label={fmt(d.dash.ringCollected, { month: formatMonth(shownMonth, locale) })}
        figure={<Money value={eurosWhole(collected, locale)} />}
        aside={
          <HeroRing
            fraction={month.length === 0 ? 0 : paidCount / month.length}
            value={`${paidCount}/${month.length}`}
            label={d.home.ringLabel}
            sub={lateCount > 0 ? fmt(d.home.ringOpen, { n: month.length - paidCount }) : d.home.ringAllPaid}
          />
        }
        actions={
          <>
            <HeroAction create="payment" icon="plus" label={d.home.actPayment} />
            <HeroAction create="lease" icon="documents" label={d.home.actLease} />
            <HeroAction href="/app/biens/nouveau" icon="properties" label={d.home.actProperty} />
            <HeroAction href="/app/finance" icon="euro" label={d.home.actFinance} />
          </>
        }
      >
        <HeroChip href={shownMonth === liveMonth ? "/app/loyers" : `/app/loyers?mois=${shownMonth}`} icon="trending-up">
          {fmt(d.home.collectedOf, { pct, expected: eurosWhole(expected, locale) })}
        </HeroChip>
        {lateCount > 0 && (
          <HeroChip href="/app/loyers?vue=impayes" icon="alert" tone="late">
            {fmt(d.home.lateChip, { n: lateCount, amount: eurosWhole(lateMonthCents, locale) })}
          </HeroChip>
        )}
        <HeroChip href="/app/biens?occupation=vacants" icon="key">
          {fmt(d.home.lotsChip, { let: occupiedCount, total: lettable.length })}
        </HeroChip>
      </Hero>

      <div className="grid grid-cols-1 gap-9 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:gap-10">
        <Section title={d.dash.todoTitle} className="min-w-0 lg:order-2">
          {todo.length === 0 ? (
            <p className="px-1 text-sm text-ink-soft">{d.dash.todoNone}</p>
          ) : (
            <Rows>
              {todo.map((t) => (
                <Row key={t.title} href={t.href} icon={iconOf(t.href)} tone={t.priority === 1 ? "late" : "plain"} title={t.title} sub={t.badge.label} right={t.amount} rightTone="late" />
              ))}
            </Rows>
          )}
        </Section>

        <Section title={d.dash.cashflowTitle} className="min-w-0 lg:order-1">
          <MonthBars bars={bars} selected={shownMonth} legendCollected={d.dash.cashflowCollected} legendExpected={d.dash.cashflowExpected} monthHeading={d.dash.cashflowMonth} ariaLabel={d.dash.cashflowAria} />
        </Section>

        <Section title={d.dash.activityTitle} className="min-w-0 lg:order-3">
          {activity.length === 0 ? (
            <p className="px-1 text-sm text-ink-soft">{d.dash.activityNone}</p>
          ) : (
            <Rows>
              {activity.map((e) => (
                <Row key={`${e.atIso}:${e.label}`} icon={activityIcon[e.kind] ?? "calendar"} title={e.label} sub={`${e.at} · ${e.sub}`} right={"amount" in e ? `+ ${e.amount}` : undefined} rightTone="in" />
              ))}
            </Rows>
          )}
        </Section>

        <div className="min-w-0 space-y-9 lg:order-4">
          {vigilance.length > 0 && (
            <Section title={d.dash.vigilanceTitle} action={<Link href="/app/conformite" className="text-sm font-semibold text-brand-700 hover:underline max-sm:inline-flex max-sm:min-h-10 max-sm:items-center">{d.home.seeAll}</Link>}>
              <Rows>
                {vigilance.map((v) => (
                  <Row key={v.title} href="/app/conformite" icon="calendar" tone={v.badge.color.includes("red") ? "late" : "plain"} title={v.title} sub={v.sub} />
                ))}
              </Rows>
            </Section>
          )}
          {WORKFLOWS.length > 0 && (
            <Section title={d.dash.workflowsTitle} action={<Link href="/app/workflows" className="text-sm font-semibold text-brand-700 hover:underline max-sm:inline-flex max-sm:min-h-10 max-sm:items-center">{d.home.seeAll}</Link>}>
              <Rows>
                <Row href="/app/workflows" icon="key" title={fmt(d.home.moves, { running: WORKFLOWS.length - wfBlocked.length, blocked: wfBlocked.length })} sub={`${d.dash.wfMoveIn} ${WORKFLOWS.filter((w) => w.kind === "move_in").length} · ${d.dash.wfMoveOut} ${WORKFLOWS.filter((w) => w.kind === "move_out").length}`} />
                {wfBlocked.slice(0, 2).map((w) => (
                  <Row key={w.id} href="/app/workflows" icon="alert" tone="late" title={w.label} sub={(w.blockedReason ?? "").split(". ")[0]} right={d.status.blocked} rightTone="soft" />
                ))}
              </Rows>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
