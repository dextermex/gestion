"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Modal } from "@/components/pro/ui";
import type { Dict } from "@/lib/i18n/fr";
import { fmt, type Locale } from "@/lib/i18n/config";
import { TRIAL_NUDGE_COLORS, billingPhaseMeta, formatDate } from "@/lib/types";
import { dayOf, daysLabel, leasesLabel, lotsLabel } from "@/lib/billing/format";
import type { BillingPhase, Nudge } from "@/domain/billing/trial";

/**
 * The subscription as the shell carries it on every screen: a chip in the
 * top bar while the trial runs, a banner in its last week and after it, the
 * paywall when a change is refused once it is over, and on the dashboard a
 * one-time invitation to add the card once the portfolio is in.
 */
export interface ShellBilling {
  phase: BillingPhase;
  daysLeft: number;
  nudge: Nudge;
  /** Unix seconds. */
  trialEnd: number;
  canManage: boolean;
  canExtend: boolean;
  /** What the account holds, for the paywall's sentence. */
  lots: number;
  leases: number;
}

const PAGE = "/app/abonnement";

/** The top bar's word on the trial: the days left while it runs, what is wrong when something is; nothing once a subscription runs. */
export function TrialChip({ billing, d }: { billing: ShellBilling; d: Dict }) {
  const b = d.billing;
  const meta = billingPhaseMeta(d)[billing.phase];
  let label: string | null = null;
  let color = meta.color;
  if (billing.phase === "trial") {
    label = billing.daysLeft <= 1 ? b.chipLastDay : fmt(b.chipTrial, { days: billing.daysLeft });
    color = TRIAL_NUDGE_COLORS[billing.nudge === "soon" || billing.nudge === "urgent" ? billing.nudge : "quiet"];
  } else if (billing.phase === "expired" || billing.phase === "past_due" || billing.phase === "ended") {
    label = meta.label;
  }
  if (!label) return null;
  return (
    <Link
      href={PAGE}
      aria-label={`${label}. ${b.chipAria}`}
      data-billing-chip={billing.phase}
      className={`crm-trial-chip inline-flex min-h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-semibold transition-[filter] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${color}`}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </Link>
  );
}

/** The banner under the bar: the trial's last week, a failed payment, a trial or subscription that has ended. */
export function BillingBanner({ billing, d, locale }: { billing: ShellBilling; d: Dict; locale: Locale }) {
  const b = d.billing;
  const date = formatDate(dayOf(billing.trialEnd), locale);
  let text: string | null = null;
  let cta = b.choosePlan;
  let tone = "border-amber-200 bg-amber-50 text-amber-900";
  if (billing.phase === "trial" && (billing.nudge === "soon" || billing.nudge === "urgent")) {
    text = billing.daysLeft <= 1 ? b.bannerLastDay : fmt(b.bannerSoon, { days: daysLabel(b, locale, billing.daysLeft), date });
    if (billing.nudge === "urgent") tone = "border-red-200 bg-red-50 text-red-800";
  } else if (billing.phase === "past_due") {
    text = b.bannerPastDue;
    cta = b.updateCard;
    tone = "border-red-200 bg-red-50 text-red-800";
  } else if (billing.phase === "expired" || billing.phase === "ended") {
    text = billing.phase === "expired" ? b.bannerExpired : b.bannerEnded;
    cta = b.activate;
  }
  if (!text) return null;
  return (
    <div role="status" data-billing-banner={billing.phase} className={`crm-billing-banner flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b px-safe-4 py-2 text-center text-xs font-semibold max-lg:[html[data-phone-chat]_&]:hidden ${tone}`}>
      <span>{text}</span>
      {billing.canManage ? (
        <Link href={PAGE} className="inline-flex min-h-8 items-center rounded px-1 underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">
          {cta}
        </Link>
      ) : (
        <span className="font-medium">{b.bannerOwner}</span>
      )}
    </div>
  );
}

/**
 * The paywall, opened when the server refuses a change because the trial is
 * over (402 `subscription_required`): whatever the screen, the answer is the
 * same, so it is read once here rather than in every form. Only that answer
 * is looked at; every other response passes through untouched.
 */
export function Paywall({ billing, d, locale, initiallyOpen = false }: { billing: ShellBilling; d: Dict; locale: Locale; initiallyOpen?: boolean }) {
  const b = d.billing;
  const router = useRouter();
  const [open, setOpen] = useState(initiallyOpen);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const original = window.fetch;
    const watched: typeof fetch = async (...args) => {
      const response = await original(...args);
      if (response.status === 402) {
        try {
          const body = (await response.clone().json()) as { error?: string };
          if (body?.error === "subscription_required") setOpen(true);
        } catch {
          /* Not this app's answer: nothing to show. */
        }
      }
      return response;
    };
    window.fetch = watched;
    return () => {
      if (window.fetch === watched) window.fetch = original;
    };
  }, []);

  const extend = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/abonnement/prolonger", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!res.ok) throw new Error(String(res.status));
      setOpen(false);
      router.refresh();
    } catch {
      setError(b.errGeneric);
    } finally {
      setBusy(false);
    }
  };

  const body = billing.lots > 0
    ? fmt(b.paywallBody, { lots: lotsLabel(b, locale, billing.lots), leases: leasesLabel(b, locale, billing.leases) })
    : b.paywallBodyEmpty;

  return (
    <Modal open={open} onClose={() => setOpen(false)} title={billing.phase === "ended" ? b.paywallTitleEnded : b.paywallTitle} closeLabel={d.common.close}>
      <div data-paywall className="space-y-5">
        <p className="text-[15px] leading-relaxed text-ink-soft">{body}</p>
        {billing.canManage ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Link href={PAGE} onClick={() => setOpen(false)} className="ui-button inline-flex min-h-12 items-center justify-center rounded-full bg-brand-600 px-5 text-sm font-semibold text-white transition duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">
              {b.activate}
            </Link>
            <Button variant="ghost" onClick={() => setOpen(false)}>{b.paywallLater}</Button>
          </div>
        ) : (
          <p className="text-sm font-medium text-ink">{b.bannerOwner}</p>
        )}
        {billing.canManage && billing.canExtend && (
          <button type="button" onClick={extend} disabled={busy} className="min-h-11 text-sm font-medium text-brand-700 underline underline-offset-4 hover:no-underline disabled:opacity-50">
            {b.extend}
          </button>
        )}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      </div>
    </Modal>
  );
}

const PROMPT_KEY = "morada_trial_prompt";
const PROMPT_REST = 7 * 86_400_000;

/**
 * On the dashboard, once the portfolio holds a lot: the invitation to add
 * the card while nothing is due, at the moment the trial has shown its use.
 * "Later" rests it for a week; the banner takes over in the last week.
 */
export function TrialPrompt({ billing, d, locale }: { billing: ShellBilling; d: Dict; locale: Locale }) {
  const b = d.billing;
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let rested = false;
    try {
      rested = Date.now() - Number(window.localStorage.getItem(PROMPT_KEY) ?? 0) < PROMPT_REST;
    } catch {
      /* Storage refused: show it, as for a first visit. */
    }
    setVisible(!rested);
  }, []);
  if (!visible || billing.phase !== "trial" || billing.nudge !== "quiet" || !billing.canManage || billing.lots < 1) return null;
  const later = () => {
    try {
      window.localStorage.setItem(PROMPT_KEY, String(Date.now()));
    } catch {
      /* Not remembered: it comes back next visit. */
    }
    setVisible(false);
  };
  const date = formatDate(dayOf(billing.trialEnd), locale);
  return (
    <section aria-labelledby="trial-prompt-title" data-trial-prompt className="crm-trial-prompt mb-6 flex flex-col gap-4 rounded-[1.75rem] border border-brand-100 bg-white/95 p-5 shadow-sm sm:flex-row sm:items-center sm:p-6">
      <div className="min-w-0 flex-1">
        <h2 id="trial-prompt-title" className="font-display text-lg font-bold text-ink">{b.promptTitle}</h2>
        <p className="mt-1 text-sm leading-relaxed text-ink-soft">{fmt(b.promptBody, { date, lots: lotsLabel(b, locale, billing.lots) })}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Link href={PAGE} className="ui-button inline-flex min-h-11 items-center justify-center rounded-full bg-brand-600 px-5 text-sm font-semibold text-white transition duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">
          {b.addCard}
        </Link>
        <Button variant="ghost" onClick={later}>{b.promptLater}</Button>
      </div>
    </section>
  );
}
