import Link from "next/link";
import { notFound } from "next/navigation";
import { getI18n } from "@/lib/i18n";
import { PageHeader } from "@/components/pro/ui";
import BillingPanel from "@/components/gestion/BillingPanel";
import { BillingBanner, Paywall, TrialChip, TrialPrompt, type ShellBilling } from "@/components/gestion/BillingShell";
import { DAY, billingState, type BillingPhase, type SubscriptionFacts } from "@/domain/billing/trial";
import { billingPhaseMeta } from "@/lib/types";
import type { BillingPageData, SubscriptionSummary } from "@/lib/billing/view";

/**
 * Development only: every state of the subscription screens on one page
 * (the chip, the banner, the dashboard prompt, the paywall, the page), with
 * no Stripe call. Answers 404 anywhere else.
 */
const STATES = ["trial", "soon", "urgent", "trial_card", "active", "past_due", "expired"] as const;
type State = (typeof STATES)[number];

function scenario(state: State, now: number): { data: BillingPageData; shell: ShellBilling; phase: BillingPhase } {
  const trialEnd = now + (state === "soon" ? 5 : state === "urgent" ? 1 : state === "expired" ? -1 : 18) * DAY + 3600;
  const card = { brand: "visa", last4: "4242" };
  const subFacts: Record<string, (SubscriptionFacts & SubscriptionSummary) | null> = {
    trial_card: { status: "trialing", trialEnd, periodEnd: trialEnd, cancelAtPeriodEnd: false, plan: "landlord", rhythm: "quarter", card, charged: 18000, lots: 12, seats: 0 },
    active: { status: "active", trialEnd: null, periodEnd: now + 64 * DAY, cancelAtPeriodEnd: false, plan: "landlord", rhythm: "year", card, charged: 57600, lots: 12, seats: 0 },
    past_due: { status: "past_due", trialEnd: null, periodEnd: now + 2 * DAY, cancelAtPeriodEnd: false, plan: "landlord", rhythm: "quarter", card, charged: 18000, lots: 12, seats: 0 },
  };
  const sub = subFacts[state] ?? null;
  const facts = { now, trialEnd, subscription: sub };
  const s = billingState(facts);
  return {
    phase: s.phase,
    data: { status: "ready", mode: "test", canManage: true, plan: sub?.plan ?? "landlord", rhythm: sub?.rhythm ?? "quarter", trialEnd, canExtend: state === "expired", state: s, subscription: sub },
    shell: { phase: s.phase, daysLeft: s.daysLeft, nudge: s.nudge, trialEnd, canManage: true, canExtend: state === "expired", lots: 12, leases: 9 },
  };
}

export default async function BillingPreviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  const { locale, d } = await getI18n();
  const params = await searchParams;
  const state: State = STATES.find((s) => s === params.etat) ?? "trial";
  const now = Math.floor(Date.now() / 1000);
  const { data, shell, phase } = scenario(state, now);
  return (
    <>
      <nav className="mb-4 flex flex-wrap gap-2 text-xs">
        {STATES.map((s) => (
          <Link key={s} href={`/app/abonnement/apercu?etat=${s}`} aria-current={s === state ? "page" : undefined} className="rounded-full border border-sand-200 bg-white px-3 py-1.5 font-semibold text-ink-soft aria-[current=page]:border-brand-600 aria-[current=page]:text-brand-800">{s}</Link>
        ))}
      </nav>
      <div className="mb-4 flex flex-wrap items-center gap-3"><TrialChip billing={shell} d={d} /></div>
      <div className="-mx-4 mb-6 sm:-mx-6"><BillingBanner billing={shell} d={d} locale={locale} /></div>
      <TrialPrompt billing={shell} d={d} locale={locale} />
      <PageHeader title={d.billing.title} subtitle={d.billing.subtitle} />
      <BillingPanel locale={locale} b={d.billing} data={data} lots={12} seats={2} sample={false} now={now} badge={billingPhaseMeta(d)[phase]} confirmed={false} />
      <Paywall billing={shell} d={d} locale={locale} initiallyOpen={params.paywall === "1"} />
    </>
  );
}
