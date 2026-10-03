"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card } from "@/components/pro/ui";
import { Icon } from "@/components/pro/icons";
import type { Dict } from "@/lib/i18n/fr";
import { fmt, type Locale } from "@/lib/i18n/config";
import { formatDate } from "@/lib/types";
import { PLANS, PLAN_IDS, REMINDER_DAYS, RHYTHMS, bestPlan, quote, yearlyDiscountPct, type PlanId, type Rhythm } from "@/domain/billing/plans";
import { DAY } from "@/domain/billing/trial";
import { dayOf, daysLeftLabel, lotsLabel, periodName, planName, price, seatsLabel } from "@/lib/billing/format";
import type { BillingPageData } from "@/lib/billing/view";

type B = Dict["billing"];

export interface BillingPanelProps {
  locale: Locale;
  b: B;
  data: BillingPageData;
  /** Lots the subscription counts and active users, from the account's own rows. */
  lots: number;
  seats: number;
  sample: boolean;
  /** Unix seconds, from the server, so the page and its dates agree. */
  now: number;
  /** The phase's badge, from the colour maps (src/lib/types.ts). */
  badge: { label: string; color: string } | null;
  /** Back from Stripe's Checkout. */
  confirmed: boolean;
}

const RUNNING = ["trialing", "active", "past_due", "incomplete"];

function errorText(b: B, code: unknown): string {
  switch (code) {
    case "forbidden":
    case "not_manager": return b.errNotManager;
    case "not_configured": return b.errNotConfigured;
    case "unavailable":
    case "storage_failed": return b.errUnavailable;
    case "already_subscribed": return b.errAlreadySubscribed;
    case "plan_too_small": return b.errPlanTooSmall;
    case "not_offered": return b.errNotOffered;
    case "sample_read_only": return b.sampleNote;
    default: return b.errGeneric;
  }
}

/**
 * The subscription page: the plans led by their monthly price, the rhythm,
 * and beside them what the account would pay for its own lots, today and
 * from the trial's end, with the one action that moves it forward. Every
 * figure comes from the catalogue (src/domain/billing/plans.ts), the same
 * one the Stripe prices are created from.
 */
export default function BillingPanel({ locale, b, data, lots, seats, sample, now, badge, confirmed }: BillingPanelProps) {
  const router = useRouter();
  const sub = data.subscription;
  const running = !!sub && RUNNING.includes(sub.status);
  const [plan, setPlan] = useState<PlanId>(quote(data.plan, data.rhythm, lots, seats).fits ? data.plan : "professional");
  const [rhythm, setRhythm] = useState<Rhythm>(data.rhythm);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const state = data.state;
  const phase = state?.phase ?? "trial";
  const q = quote(plan, rhythm, lots, seats);
  const recommended = bestPlan(lots, seats, rhythm);
  const live = data.status === "ready" && !sample;
  const canAct = live && data.canManage;
  const changed = running && (plan !== sub!.plan || rhythm !== sub!.rhythm);
  const date = (unix: number | null | undefined) => (unix ? formatDate(dayOf(unix), locale) : "");
  const trialEnd = state?.firstChargeAt ?? data.trialEnd ?? now + 30 * DAY;
  const pct = yearlyDiscountPct(plan);

  async function post(path: string, body: object): Promise<Record<string, unknown> | null> {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      setError(errorText(b, json.error));
      return null;
    }
    return json;
  }
  const act = (key: string, work: () => Promise<void>) => async () => {
    if (busy) return;
    setBusy(key);
    setError("");
    try {
      await work();
    } catch {
      setError(b.errGeneric);
    } finally {
      setBusy(null);
    }
  };
  // Stripe's own pages take it from here; the button stays busy until the browser leaves.
  const leaveFor = async (path: string, body: object) => {
    const answer = await post(path, body);
    if (typeof answer?.url === "string") {
      window.location.assign(answer.url);
      await new Promise(() => undefined);
    }
  };
  const checkout = act("checkout", () => leaveFor("/api/abonnement/checkout", { plan, rhythm }));
  const portal = (flow?: "payment_method_update") => act("portal", () => leaveFor("/api/abonnement/portail", flow ? { flow } : {}));
  const apply = act("apply", async () => {
    if (await post("/api/abonnement", { plan, rhythm })) {
      setNotice(b.confirmed);
      router.refresh();
    }
  });
  const extend = act("extend", async () => {
    const answer = await post("/api/abonnement/prolonger", {});
    if (answer && typeof answer.trialEnd === "number") {
      setNotice(fmt(b.extended, { date: date(answer.trialEnd) }));
      router.refresh();
    }
  });

  const confirmedText = confirmed ? (phase === "trial_card" ? fmt(b.confirmedTrial, { date: date(trialEnd) }) : b.confirmed) : "";
  const statusNote =
    sample ? b.sampleNote
      : data.status === "off" ? b.off
      : data.status === "not_secret" ? b.notSecret
      : data.status === "unreachable" ? b.unreachable
      : data.status === "exempt" ? b.exempt
      : !data.canManage ? b.notManager
      : null;

  // What the summary says the account pays: from the subscription once one runs, from the choice otherwise.
  const forWhom = PLANS[plan].seat ? fmt(b.summaryForSeats, { lots: lotsLabel(b, locale, q.lots), seats: seatsLabel(b, locale, q.seats) }) : fmt(b.summaryFor, { lots: lotsLabel(b, locale, q.lots) });
  const chargedLine = fmt(rhythm === "quarter" ? b.chargedQuarter : b.chargedYear, { amount: price(q.charged, locale) });
  const startsNow = phase === "expired" || phase === "ended";

  let status: string | null = null;
  if (sub && phase === "trial_card") status = fmt(b.statusCard, { plan: planName(b, sub.plan ?? plan), date: date(trialEnd), amount: price(sub.charged, locale), period: periodName(b, sub.rhythm ?? rhythm) });
  else if (sub && phase === "active") status = sub.cancelAtPeriodEnd ? fmt(b.statusCanceling, { date: date(sub.periodEnd) }) : fmt(b.statusActive, { plan: planName(b, sub.plan ?? plan), date: date(sub.periodEnd), amount: price(sub.charged, locale) });
  else if (phase === "past_due") status = b.statusPastDue;
  else if (phase === "expired") status = b.statusExpired;
  else if (phase === "ended") status = b.statusEnded;

  return (
    <div className="crm-billing grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
      <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-start-1">
        {(confirmedText || notice) && <p role="status" data-billing-notice className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">{notice || confirmedText}</p>}
        {statusNote && <p role="status" data-billing-status={sample ? "sample" : data.status} className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">{statusNote}</p>}
        {live && data.mode === "test" && <p className="rounded-2xl bg-sky-50 px-4 py-3 text-sm text-sky-900">{b.testMode}</p>}

        <Card className="crm-panel p-5 sm:p-7">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-lg font-bold text-ink">{running ? b.current : b.chooseTitle}</h2>
            <div className="crm-segmented" role="group" aria-label={b.rhythmLabel}>
              {RHYTHMS.map((value) => (
                <button key={value} type="button" aria-pressed={rhythm === value} onClick={() => setRhythm(value)} data-rhythm={value}>
                  {value === "quarter" ? b.rhythmQuarter : b.rhythmYear}
                  {value === "year" && <span>{fmt(b.rhythmSave, { pct })}</span>}
                </button>
              ))}
            </div>
          </div>
          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="sr-only">{b.title}</legend>
            {PLAN_IDS.map((id) => {
              const offer = PLANS[id];
              const fits = quote(id, rhythm, lots, seats).fits;
              const monthly = offer.lot[rhythm];
              return (
                <label key={id} className="billing-plan" data-plan={id}>
                  <input type="radio" name="plan" value={id} checked={plan === id} disabled={!fits} onChange={() => setPlan(id)} />
                  <span className="flex min-h-6 flex-wrap items-center gap-2">
                    <span className="font-display text-lg font-bold text-ink">{planName(b, id)}</span>
                    {sub?.plan === id && running && <span className="rounded-full bg-white px-2.5 py-0.5 text-[11px] font-semibold text-brand-800">{b.current}</span>}
                    {!(sub?.plan === id && running) && id === recommended && <span className="rounded-full bg-white px-2.5 py-0.5 text-[11px] font-semibold text-brand-800">{lots > 0 ? b.bestForYou : b.recommended}</span>}
                  </span>
                  <span className="text-sm text-ink-soft">{id === "landlord" ? b.taglineLandlord : b.taglineProfessional}</span>
                  <span className="flex items-baseline gap-2">
                    <span className="billing-price">{price(monthly, locale)}</span>
                    <span className="text-sm text-ink-soft">{b.perLot}</span>
                  </span>
                  {offer.seat && <span className="text-sm font-medium text-ink">{fmt(b.perSeat, { amount: price(offer.seat[rhythm], locale) })}</span>}
                  <span className="text-xs text-ink-soft">{fmt(rhythm === "quarter" ? b.billedPerLotQuarter : b.billedPerLotYear, { amount: price(monthly * (rhythm === "quarter" ? 3 : 12), locale) })}</span>
                  {!fits && <span className="text-xs font-medium text-amber-800">{b.tooManyLots}</span>}
                </label>
              );
            })}
          </fieldset>
          <p className="mt-4 text-xs leading-relaxed text-ink-soft">{b.freeKinds} {b.vatIncluded}.</p>
        </Card>
      </div>

      <aside className="space-y-6 lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1" aria-label={b.summaryTitle}>
        <Card className="crm-panel billing-summary p-5 sm:p-7" data-billing-summary={phase}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-lg font-bold text-ink">{b.summaryTitle}</h2>
            {badge && <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${badge.color}`}>{badge.label}</span>}
          </div>
          {phase === "trial" && state && (
            <p className="mb-4 text-sm font-medium text-brand-800">
              {state.daysLeft <= 1 ? b.trialLastDay : `${fmt(b.trialUntil, { date: date(trialEnd) })} · ${daysLeftLabel(b, locale, state.daysLeft)}`}
            </p>
          )}
          {status && <p className="mb-4 rounded-2xl bg-sand-50 px-4 py-3 text-sm leading-relaxed text-ink">{status}</p>}
          {sub?.card && running && (
            <p className="mb-4 flex items-center gap-2 text-sm text-ink-soft">
              <Icon name="lock" size={16} aria-hidden />
              {sub.card.brand === "sepa_debit" ? fmt(b.sepaOnFile, { last4: sub.card.last4 }) : fmt(b.cardOnFile, { brand: sub.card.brand.charAt(0).toUpperCase() + sub.card.brand.slice(1), last4: sub.card.last4 })}
            </p>
          )}

          <p className="text-sm text-ink-soft">{forWhom}</p>
          <p className="mt-1 flex items-baseline gap-2">
            <span className="billing-total" data-billing-monthly={q.monthly}>{price(q.monthly, locale)}</span>
            <span className="text-sm text-ink-soft">{b.perMonth}</span>
          </p>
          <p className="mt-1 text-xs text-ink-soft">{chargedLine} · {b.vatIncluded}</p>
          {q.yearlySaving > 0 && <p className="mt-1 text-xs font-semibold text-brand-700">{fmt(b.saving, { amount: price(q.yearlySaving, locale) })}</p>}

          {!running && (
            <dl className="mt-5 space-y-2 border-t border-sand-100 pt-4 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-ink-soft">{b.today}</dt>
                <dd className="font-semibold tabular-nums text-ink">{startsNow ? price(q.charged, locale) : price(0, locale)}</dd>
              </div>
              {!startsNow && (
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-ink-soft">{fmt(b.fromDate, { date: date(trialEnd) })}</dt>
                  <dd className="font-semibold tabular-nums text-ink">{price(q.charged, locale)}</dd>
                </div>
              )}
            </dl>
          )}

          {data.status !== "exempt" && data.canManage && (
            <div className="mt-6 space-y-3">
              {!running && (
                <Button className="w-full min-h-14 text-[15px]" onClick={checkout} loading={busy === "checkout"} disabled={!canAct || !q.fits || (busy !== null && busy !== "checkout")} data-billing-action="checkout">
                  {startsNow ? b.activate : b.addCard}
                </Button>
              )}
              {running && phase === "past_due" && (
                <Button className="w-full min-h-14 text-[15px]" onClick={portal("payment_method_update")} loading={busy === "portal"} disabled={!canAct} data-billing-action="update-card">
                  {b.updateCard}
                </Button>
              )}
              {running && changed && (
                <Button className="w-full min-h-14 text-[15px]" onClick={apply} loading={busy === "apply"} disabled={!canAct || !q.fits} data-billing-action="apply">
                  {b.applyPlan}
                </Button>
              )}
              {sub && (
                <Button variant="secondary" className="w-full min-h-12" onClick={portal()} loading={busy === "portal" && phase !== "past_due"} disabled={!canAct} data-billing-action="portal">
                  {sub.cancelAtPeriodEnd ? b.resume : b.manage}
                </Button>
              )}
              {data.canExtend && canAct && (
                <button type="button" onClick={extend} disabled={busy !== null} className="block min-h-11 w-full text-center text-sm font-medium text-brand-700 underline underline-offset-4 hover:no-underline disabled:opacity-50">
                  {b.extend}
                </button>
              )}
              {!running && <p className="text-center text-xs leading-relaxed text-ink-soft">{startsNow ? b.reassureNow : fmt(b.reassure, { date: date(trialEnd) })}</p>}
              <p className="flex items-start justify-center gap-1.5 text-center text-[11px] leading-relaxed text-ink-soft">
                <Icon name="lock" size={13} className="mt-0.5 shrink-0" aria-hidden />
                {b.secure}
              </p>
            </div>
          )}
          {error && <p role="alert" className="mt-4 text-sm font-medium text-red-700">{error}</p>}
        </Card>

        {(phase === "trial" || phase === "trial_card") && (
          <Card className="crm-panel p-5 sm:p-7">
            <h2 className="mb-5 font-display text-lg font-bold text-ink">{b.timelineTitle}</h2>
            <ol className="billing-timeline">
              <li data-first>
                <span className="billing-timeline-dot" aria-hidden />
                <strong>{b.today}</strong>
                <span>{b.timelineToday}</span>
              </li>
              <li>
                <span className="billing-timeline-dot" aria-hidden />
                <strong>{date(trialEnd - REMINDER_DAYS * DAY)}</strong>
                <span>{b.timelineReminder}</span>
              </li>
              <li>
                <span className="billing-timeline-dot" aria-hidden />
                <strong>{date(trialEnd)}</strong>
                <span>{fmt(b.timelineCharge, { amount: price(running && sub ? sub.charged : q.charged, locale) })}</span>
              </li>
            </ol>
            {phase === "trial" && <p className="mt-5 text-xs leading-relaxed text-ink-soft">{b.timelineNoCard}</p>}
          </Card>
        )}
      </aside>

      <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-start-2">
        <Card className="crm-panel p-5 sm:p-7">
          <h2 className="mb-4 font-display text-lg font-bold text-ink">{b.includedTitle}</h2>
          <ul className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {[b.included1, b.included2, b.included3, b.included4, b.included5].map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-sm text-ink">
                <Icon name="check" size={18} className="mt-0.5 shrink-0 text-brand-600" aria-hidden />
                {item}
              </li>
            ))}
          </ul>
        </Card>

        <Card className="crm-panel p-5 sm:p-7">
          <h2 className="mb-2 font-display text-lg font-bold text-ink">{b.faqTitle}</h2>
          {[[b.faqEndQ, b.faqEndA], [b.faqCancelQ, b.faqCancelA], [b.faqPriceQ, b.faqPriceA]].map(([question, answer]) => (
            <details key={question} className="billing-faq group border-b border-sand-100 last:border-b-0">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 py-3 text-sm font-semibold text-ink">
                {question}
                <Icon name="chevron-down" size={18} className="shrink-0 text-ink-soft transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
              </summary>
              <p className="pb-4 text-sm leading-relaxed text-ink-soft">{answer}</p>
            </details>
          ))}
        </Card>
      </div>

    </div>
  );
}
