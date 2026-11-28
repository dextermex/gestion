import Link from "next/link";
import { notFound } from "next/navigation";
import { getI18n } from "@/lib/i18n";
import { PageHeader } from "@/components/pro/ui";
import BillingPanel from "@/components/gestion/BillingPanel";
import Locked from "@/components/gestion/Locked";
import { BillingBanner, TrialChip, type ShellBilling } from "@/components/gestion/BillingShell";
import { DAY, billingState, type LockReason, type SubscriptionFacts } from "@/domain/billing/trial";
import { TRIAL_DAYS, quote } from "@/domain/billing/pricing";
import { billingPhaseMeta } from "@/lib/types";
import type { BillingPageData, SubscriptionSummary } from "@/lib/billing/view";

/**
 * Development only: every state of the subscription screens on one page
 * (the chip, the banner, the page, the locked screen), with no Stripe call.
 * Only an open workspace sees the page; the three locked states show the
 * screen that replaces the space. Answers 404 anywhere else.
 */
const STATES = ["trial", "soon", "urgent", "canceling", "active", "loyal", "large", "team", "no_trial", "ended", "payment"] as const;
type State = (typeof STATES)[number];
const LOCKED: readonly string[] = ["no_trial", "ended", "payment"];

/** Twelve lots let across the bands, and a portfolio past the published 50. */
const RENTS = [152_000, 145_000, 98_000, 175_000, 132_000, 210_000, 89_000, 125_000, 160_000, 118_000, 340_000, 99_000];
const LARGE = Array.from({ length: 56 }, (_, i) => 90_000 + (i % 7) * 30_000);

function scenario(state: State, now: number): { data: BillingPageData; shell: ShellBilling; rents: number[] } {
  const trialEnd = now + (state === "soon" ? 5 : state === "urgent" ? 1 : 18) * DAY + 3600;
  const card = { brand: "visa", last4: "4242" };
  const rents = state === "large" ? LARGE : RENTS;
  const trialing = { status: "trialing", trialEnd, periodEnd: trialEnd, cancelAtPeriodEnd: false, rhythm: "quarter" as const, card, charged: quote(rents, "quarter").charged, managed: true };
  const subs: Record<string, SubscriptionFacts & SubscriptionSummary> = {
    trial: trialing, soon: trialing, urgent: trialing, large: trialing,
    canceling: { ...trialing, cancelAtPeriodEnd: true },
    active: { status: "active", trialEnd: null, periodEnd: now + 64 * DAY, cancelAtPeriodEnd: false, rhythm: "year", card, charged: quote(rents, "year").charged, managed: true },
    loyal: { status: "active", trialEnd: null, periodEnd: now + 40 * DAY, cancelAtPeriodEnd: false, rhythm: "quarter", card, charged: quote(rents, "quarter", 2).charged, managed: true },
    team: { status: "active", trialEnd: null, periodEnd: now + 120 * DAY, cancelAtPeriodEnd: false, rhythm: "year", card, charged: 1_250_000, managed: false },
  };
  const sub = subs[state] ?? trialing;
  const s = billingState({ now, subscription: sub });
  return {
    rents,
    data: { status: "ready", mode: "test", canManage: true, rhythm: sub.rhythm ?? "quarter", year: state === "loyal" ? 2 : 1, trialOffered: false, state: s, subscription: sub },
    shell: { phase: s.phase, daysLeft: s.daysLeft, nudge: s.nudge, firstChargeAt: s.firstChargeAt, charged: sub.charged, rhythm: sub.rhythm ?? "quarter", canManage: true },
  };
}

export default async function BillingPreviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  const { locale, d } = await getI18n();
  const params = await searchParams;
  const state: State = STATES.find((s) => s === params.etat) ?? "trial";
  const now = Math.floor(Date.now() / 1000);
  const nav = (
    <nav className="mb-4 flex flex-wrap gap-2 text-xs">
      {STATES.map((s) => (
        <Link key={s} href={`/app/abonnement/apercu?etat=${s}`} aria-current={s === state ? "page" : undefined} className="rounded-full border border-sand-200 bg-white px-3 py-1.5 font-semibold text-ink-soft aria-[current=page]:border-brand-600 aria-[current=page]:text-brand-800">{s}</Link>
      ))}
    </nav>
  );
  if (LOCKED.includes(state)) {
    return (
      <>
        {nav}
        <Locked reason={state as LockReason} email="test@example.invalid" canManage offer={null} trialDays={TRIAL_DAYS} copy={d.billing.lock} errGeneric={d.billing.errGeneric} signOut={d.shell.signOut} />
      </>
    );
  }
  const { data, shell, rents } = scenario(state, now);
  return (
    <>
      {nav}
      <div className="mb-4 flex flex-wrap items-center gap-3"><TrialChip billing={shell} d={d} /></div>
      <div className="-mx-4 mb-6 sm:-mx-6"><BillingBanner billing={shell} d={d} locale={locale} /></div>
      <PageHeader title={d.billing.title} subtitle={d.billing.subtitle} />
      <BillingPanel locale={locale} b={d.billing} data={data} rents={rents} sample={false} now={now} badge={billingPhaseMeta(d)[shell.phase]} confirmed={false} />
    </>
  );
}
