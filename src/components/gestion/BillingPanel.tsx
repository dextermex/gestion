"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card } from "@/components/pro/ui";
import { Icon } from "@/components/pro/icons";
import type { Dict } from "@/lib/i18n/fr";
import { fmt, type Locale } from "@/lib/i18n/config";
import { formatDate } from "@/lib/types";
import { TEAM_EMAIL } from "@/lib/constants";
import type { Cents } from "@/domain/money";
import { LOYALTY_PCT, MAX_LOTS, PAID_MONTHS, RENT_BANDS, REMINDER_DAYS, RHYTHMS, RHYTHM_MONTHS, VOLUME, quote, type Rhythm } from "@/domain/billing/pricing";
import { DAY } from "@/domain/billing/trial";
import { bandLabel, dayOf, daysLeftLabel, lotsLabel, lotsLetLabel, pctOff, periodName, price } from "@/lib/billing/format";
import type { BillingPageData } from "@/lib/billing/view";

type B = Dict["billing"];

export interface BillingPanelProps {
  locale: Locale;
  b: B;
  data: BillingPageData;
  /** The rents of the lots the subscription bills, from the account's own rows. */
  rents: Cents[];
  sample: boolean;
  /** Unix seconds, from the server, so the page and its dates agree. */
  now: number;
  /** The phase's badge, from the colour maps (src/lib/types.ts). */
  badge: { label: string; color: string } | null;
  /** Back from Stripe's Checkout. */
  confirmed: boolean;
}

const RUNNING = ["trialing", "active", "past_due", "incomplete"];
const TEAM_HREF = `mailto:${TEAM_EMAIL}?subject=${encodeURIComponent("Morada Gestion")}`;

function errorText(b: B, code: unknown): string {
  switch (code) {
    case "forbidden":
    case "not_manager": return b.errNotManager;
    case "not_configured": return b.errNotConfigured;
    case "unavailable":
    case "storage_failed": return b.errUnavailable;
    case "already_subscribed": return b.errAlreadySubscribed;
    case "too_many_lots": return fmt(b.errTooManyLots, { max: MAX_LOTS });
    case "custom_terms": return b.errCustomTerms;
    case "not_offered": return b.errNotOffered;
    case "sample_read_only": return b.sampleNote;
    default: return b.errGeneric;
  }
}

/**
 * The subscription page: how to be billed, each way led by the account's
 * own price per month, the line by line of that price (each lot by its
 * rent, the volume brackets), how it falls over time, and beside it the one
 * action that moves the subscription forward. Every figure comes from
 * src/domain/billing/pricing.ts, the same engine the Stripe price is
 * computed by, over the rents of the lots the account lets.
 */
export default function BillingPanel({ locale, b, data, rents, sample, now, badge, confirmed }: BillingPanelProps) {
  const router = useRouter();
  const sub = data.subscription;
  const running = !!sub && RUNNING.includes(sub.status);
  // Terms set up with the team: their price is the team's, not this page's.
  const custom = running && !sub!.managed;
  const [rhythm, setRhythm] = useState<Rhythm>(data.rhythm);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const state = data.state;
  const phase = state?.phase ?? "trial";
  const year = running ? data.year : 1;
  const quotes = { quarter: quote(rents, "quarter", year), year: quote(rents, "year", year) };
  const q = quotes[rhythm];
  // Beyond the published terms, a portfolio not yet subscribed gets its price from the team, not an estimate.
  const quoted = running ? !custom : q.fits;
  const live = data.status === "ready" && !sample;
  const canAct = live && data.canManage;
  const changed = running && !custom && rhythm !== sub!.rhythm;
  const money = (cents: Cents) => price(cents, locale);
  const date = (unix: number | null | undefined) => (unix ? formatDate(dayOf(unix), locale) : "");
  const trialEnd = state?.firstChargeAt ?? data.trialEnd ?? now + 30 * DAY;
  const freeMonths = RHYTHM_MONTHS.year - PAID_MONTHS.year;
  // The month after the yearly offer and before loyalty: the bill's rows add up to the price exactly.
  const afterOffer = Math.round(q.base / RHYTHM_MONTHS[q.rhythm]);

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
  const checkout = act("checkout", () => leaveFor("/api/abonnement/checkout", { rhythm }));
  const portal = (flow?: "payment_method_update") => act("portal", () => leaveFor("/api/abonnement/portail", flow ? { flow } : {}));
  const apply = act("apply", async () => {
    if (await post("/api/abonnement", { rhythm })) {
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
  // Until subscriptions open, the figures are the published launch hypothesis.
  const prelaunch = sample || data.status === "off" || data.status === "not_secret";

  const forWhom = q.lots > 0 ? fmt(b.summaryFor, { lots: lotsLetLabel(b, locale, q.lots) }) : b.noLotsLet;
  const chargedLine = fmt(rhythm === "quarter" ? b.chargedQuarter : b.chargedYear, { amount: money(custom ? sub!.charged : q.charged) });
  const startsNow = phase === "expired" || phase === "ended";

  let status: string | null = null;
  if (sub && phase === "trial_card") status = fmt(b.statusCard, { date: date(trialEnd), amount: money(sub.charged), period: periodName(b, sub.rhythm ?? rhythm) });
  else if (sub && phase === "active") status = sub.cancelAtPeriodEnd ? fmt(b.statusCanceling, { date: date(sub.periodEnd) }) : fmt(b.statusActive, { date: date(sub.periodEnd), amount: money(sub.charged) });
  else if (phase === "past_due") status = b.statusPastDue;
  else if (phase === "expired") status = b.statusExpired;
  else if (phase === "ended") status = b.statusEnded;

  return (
    <div className="crm-billing grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
      <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-start-1">
        {(confirmedText || notice) && <p role="status" data-billing-notice className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">{notice || confirmedText}</p>}
        {statusNote && <p role="status" data-billing-status={sample ? "sample" : data.status} className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">{statusNote}</p>}
        {live && data.mode === "test" && <p className="rounded-2xl bg-sky-50 px-4 py-3 text-sm text-sky-900">{b.testMode}</p>}

        {!quoted ? (
          <Card className="crm-panel p-5 sm:p-7" data-billing-terms="team">
            <h2 className="mb-2 font-display text-lg font-bold text-ink">{custom ? b.current : fmt(b.tooManyLots, { max: MAX_LOTS })}</h2>
            {custom && <p className="text-sm leading-relaxed text-ink-soft">{b.teamTerms}</p>}
            <a href={TEAM_HREF} className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-brand-700 underline underline-offset-4 hover:no-underline">{b.teamCta}</a>
          </Card>
        ) : (
          <Card className="crm-panel p-5 sm:p-7">
            <h2 className="mb-5 font-display text-lg font-bold text-ink">{running ? b.current : b.chooseTitle}</h2>
            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="sr-only">{b.rhythmLabel}</legend>
              {RHYTHMS.map((value) => {
                const option = quotes[value];
                return (
                  <label key={value} className="billing-plan" data-rhythm={value}>
                    <input type="radio" name="rhythm" value={value} checked={rhythm === value} onChange={() => setRhythm(value)} />
                    <span className="flex min-h-6 flex-wrap items-center gap-2">
                      <span className="font-display text-lg font-bold text-ink">{value === "quarter" ? b.rhythmQuarter : b.rhythmYear}</span>
                      {value === "year" && <span className="rounded-full bg-white px-2.5 py-0.5 text-[11px] font-semibold text-brand-800">{fmt(b.yearBadge, { months: freeMonths })}</span>}
                    </span>
                    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="billing-price">{money(option.shownMonthly)}</span>
                      <span className="text-sm text-ink-soft">{b.perMonth}</span>
                      {value === "year" && (
                        <>
                          <s className="text-sm text-ink-soft tabular-nums" aria-hidden>{money(option.fullMonthly)}</s>
                          <span className="sr-only">{fmt(b.was, { amount: money(option.fullMonthly) })}</span>
                        </>
                      )}
                    </span>
                    <span className="text-xs leading-relaxed text-ink-soft">
                      {fmt(b.averagePerLot, { amount: money(option.shownPerLot) })} · {fmt(value === "quarter" ? b.billedQuarter : b.billedYear, { amount: money(option.charged) })}
                    </span>
                  </label>
                );
              })}
            </fieldset>
          </Card>
        )}
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

          {!custom && <p className="text-sm text-ink-soft">{forWhom}</p>}
          {quoted && (
            <>
              <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
                <span className="billing-total" data-billing-monthly={q.shownMonthly}>{money(q.shownMonthly)}</span>
                <span className="text-sm text-ink-soft">{b.perMonth}</span>
                {rhythm === "year" && <s className="text-sm text-ink-soft tabular-nums" aria-hidden>{money(q.fullMonthly)}</s>}
              </p>
            </>
          )}
          {(quoted || custom) && <p className="mt-1 text-xs text-ink-soft">{chargedLine} · {b.vatIncluded}</p>}
          {quoted && q.loyaltyPct > 0 && <p className="mt-1 text-xs font-semibold text-brand-700">{fmt(b.loyaltyNow, { pct: pctOff(q.loyaltyPct, locale) })}</p>}
          {quoted && (rhythm === "year" ? (
            <p className="mt-1 text-xs font-semibold text-brand-700">{fmt(b.save, { amount: money(q.yearlySaving) })}</p>
          ) : (
            <button type="button" onClick={() => setRhythm("year")} data-billing-switch-year className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-full bg-brand-50 px-3 text-xs font-semibold text-brand-800 transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-brand-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">
              {fmt(b.switchYear, { months: freeMonths })}
              <span className="tabular-nums">{"−"}{money(quotes.year.yearlySaving)}</span>
            </button>
          ))}

          {!running && quoted && (
            <dl className="mt-5 space-y-2 border-t border-sand-100 pt-4 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-ink-soft">{b.today}</dt>
                <dd className="font-semibold tabular-nums text-ink">{startsNow ? money(q.charged) : money(0)}</dd>
              </div>
              {!startsNow && (
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-ink-soft">{fmt(b.fromDate, { date: date(trialEnd) })}</dt>
                  <dd className="font-semibold tabular-nums text-ink">{money(q.charged)}</dd>
                </div>
              )}
            </dl>
          )}

          {data.status !== "exempt" && data.canManage && (
            <div className="mt-6 space-y-3">
              {!running && q.fits && (
                <Button className="w-full min-h-14 text-[15px]" onClick={checkout} loading={busy === "checkout"} disabled={!canAct || (busy !== null && busy !== "checkout")} data-billing-action="checkout">
                  {startsNow ? b.activate : b.addCard}
                </Button>
              )}
              {!running && !q.fits && (
                <a href={TEAM_HREF} className="ui-button inline-flex min-h-14 w-full items-center justify-center rounded-full bg-brand-600 px-5 text-[15px] font-semibold text-white transition duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600" data-billing-action="team">
                  {b.teamCta}
                </a>
              )}
              {running && phase === "past_due" && (
                <Button className="w-full min-h-14 text-[15px]" onClick={portal("payment_method_update")} loading={busy === "portal"} disabled={!canAct} data-billing-action="update-card">
                  {b.updateCard}
                </Button>
              )}
              {changed && (
                <Button className="w-full min-h-14 text-[15px]" onClick={apply} loading={busy === "apply"} disabled={!canAct} data-billing-action="apply">
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
              {!running && quoted && <p className="text-center text-xs leading-relaxed text-ink-soft">{startsNow ? b.reassureNow : fmt(b.reassure, { date: date(trialEnd) })}</p>}
              <p className="flex items-start justify-center gap-1.5 text-center text-[11px] leading-relaxed text-ink-soft">
                <Icon name="lock" size={13} className="mt-0.5 shrink-0" aria-hidden />
                {b.secure}
              </p>
            </div>
          )}
          {error && <p role="alert" className="mt-4 text-sm font-medium text-red-700">{error}</p>}
        </Card>

        {(phase === "trial" || phase === "trial_card") && quoted && (
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
                <span>{fmt(b.timelineCharge, { amount: money(running && sub ? sub.charged : q.charged) })}</span>
              </li>
            </ol>
            {phase === "trial" && <p className="mt-5 text-xs leading-relaxed text-ink-soft">{b.timelineNoCard}</p>}
          </Card>
        )}
      </aside>

      <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-start-2">
        {quoted && (
          <Card className="crm-panel p-5 sm:p-7" data-billing-breakdown>
            <h2 className="mb-2 font-display text-lg font-bold text-ink">{b.breakdownTitle}</h2>
            <ul className="divide-y divide-sand-100">
              {q.lines.map((line) => (
                <li key={`${line.band}-${line.offPct}`} className="flex items-start justify-between gap-4 py-3 text-sm">
                  <span className="min-w-0">
                    <span className="block font-medium text-ink">{fmt(b.lineLots, { lots: lotsLabel(b, locale, line.count), band: bandLabel(b, locale, line.band) })}</span>
                    <span className="mt-0.5 block text-xs text-ink-soft">{line.offPct ? fmt(b.lineOff, { pct: pctOff(line.offPct, locale) }) : b.fullPrice}</span>
                  </span>
                  <span className="shrink-0 text-right tabular-nums">
                    <span className="block font-semibold text-ink">{money(line.perLot * line.count)}</span>
                    <span className="block text-xs text-ink-soft">{fmt(b.perLotEach, { amount: money(line.perLot) })}</span>
                  </span>
                </li>
              ))}
            </ul>
            <dl className="mt-1 space-y-2 border-t border-sand-100 pt-3 text-sm tabular-nums">
              {q.monthly !== q.shownMonthly && (
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-soft">{b.monthlyTotal}</dt>
                  <dd className="font-medium text-ink">{money(q.monthly)}</dd>
                </div>
              )}
              {q.monthly - afterOffer > 0 && (
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-soft">{fmt(b.yearRow, { months: freeMonths })}</dt>
                  <dd className="font-medium text-brand-700">{"−"}{money(q.monthly - afterOffer)}</dd>
                </div>
              )}
              {afterOffer - q.shownMonthly > 0 && (
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-soft">{fmt(b.loyaltyRow, { pct: pctOff(q.loyaltyPct, locale) })}</dt>
                  <dd className="font-medium text-brand-700">{"−"}{money(afterOffer - q.shownMonthly)}</dd>
                </div>
              )}
              <div className={`flex justify-between gap-4${q.monthly !== q.shownMonthly ? " border-t border-sand-100 pt-2" : ""}`}>
                <dt className="font-semibold text-ink">{b.yourPrice}</dt>
                <dd className="font-semibold text-ink">{money(q.shownMonthly)}</dd>
              </div>
            </dl>
            {q.lots === 0 && <p className="mt-4 rounded-2xl bg-sand-50 px-4 py-3 text-sm text-ink">{b.minimumNote}</p>}
            <p className="mt-4 text-xs leading-relaxed text-ink-soft">{b.countNote} {b.vatIncluded}.</p>
          </Card>
        )}

        <Card className="crm-panel p-5 sm:p-7">
          <h2 className="mb-5 font-display text-lg font-bold text-ink">{b.lowerTitle}</h2>
          <h3 className="text-[15px] font-semibold text-ink">{b.volumeTitle}</h3>
          <ol className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label={b.volumeTitle}>
            {VOLUME.map((bracket) => (
              <li key={bracket.from} className="billing-tier" data-reached={(!custom && q.lots >= bracket.from) || undefined} data-current={(!custom && q.lots >= bracket.from && (q.lots <= bracket.to || bracket.to === MAX_LOTS)) || undefined}>
                <span className="block text-xs">{fmt(b.tierRange, { from: bracket.from, to: bracket.to })}</span>
                <span className="mt-0.5 block text-sm font-semibold tabular-nums">{bracket.offPct ? pctOff(bracket.offPct, locale) : b.fullPrice}</span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs leading-relaxed text-ink-soft">{b.volumeBody}</p>
          <div className="mt-6 border-t border-sand-100 pt-5">
            <h3 className="text-[15px] font-semibold text-ink">{b.loyaltyTitle}</h3>
            <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-soft">
              {LOYALTY_PCT.map((pct, index) => {
                // A subscription priced here sees the year it is in.
                const current = running && !custom && Math.min(year, LOYALTY_PCT.length) === index + 1;
                return (
                  <li key={pct} className={`flex items-center gap-2${current ? " font-semibold text-ink" : ""}`} data-current={current || undefined}>
                    {b.loyaltyYears[index]}
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${current ? "bg-brand-600 text-white" : "bg-brand-50 text-brand-800"}`}>{pct ? pctOff(pct, locale) : b.fullPrice}</span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-xs leading-relaxed text-ink-soft">{b.loyaltyBody}</p>
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-sand-100 pt-5">
            <p className="text-sm font-semibold text-ink">{fmt(b.teamTitle, { max: MAX_LOTS })}</p>
            <a href={TEAM_HREF} className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-700 underline underline-offset-4 hover:no-underline">{b.teamCta}</a>
          </div>
        </Card>

        <Card className="crm-panel p-5 sm:p-7">
          <h2 className="mb-4 font-display text-lg font-bold text-ink">{b.includedTitle}</h2>
          <ul className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {b.included.map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-sm text-ink">
                <Icon name="check" size={18} className="mt-0.5 shrink-0 text-brand-600" aria-hidden />
                {item}
              </li>
            ))}
          </ul>
        </Card>

        <Card className="crm-panel p-5 sm:p-7">
          <h2 className="mb-2 font-display text-lg font-bold text-ink">{b.faqTitle}</h2>
          {[
            [b.faqEndQ, b.faqEndA],
            [b.faqCancelQ, b.faqCancelA],
            [b.faqLotQ, b.faqLotA],
            [b.faqPriceQ, fmt(b.faqPriceA, { min: money(RENT_BANDS[0].perLot), max: money(RENT_BANDS[RENT_BANDS.length - 1].perLot) })],
          ].map(([question, answer]) => (
            <details key={question} className="billing-faq group border-b border-sand-100 last:border-b-0">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 py-3 text-sm font-semibold text-ink">
                {question}
                <Icon name="chevron-down" size={18} className="shrink-0 text-ink-soft transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
              </summary>
              <p className="pb-4 text-sm leading-relaxed text-ink-soft">{answer}</p>
            </details>
          ))}
        </Card>

        {prelaunch && <p className="px-1 text-center text-xs leading-relaxed text-ink-soft">{b.hypothesis}</p>}
      </div>
    </div>
  );
}
