"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Dict } from "@/lib/i18n/fr";
import { fmt, type Locale } from "@/lib/i18n/config";
import { TRIAL_NUDGE_COLORS, formatDate } from "@/lib/types";
import { dayOf, daysLabel, price } from "@/lib/billing/format";
import type { BillingBrief } from "@/lib/billing/view";

/**
 * The subscription as the shell carries it on every screen of an open
 * workspace: during the trial, a quiet counter in the top bar that grows
 * louder in the last week and the last two days, and a banner then that
 * says when the first charge falls. A workspace whose subscription does not
 * run never reaches the shell: the layout shows the locked screen instead.
 */
export type ShellBilling = BillingBrief;

const PAGE = "/app/abonnement";

/** The top bar's word on the trial: the days left; nothing once a subscription runs. */
export function TrialChip({ billing, d }: { billing: ShellBilling; d: Dict }) {
  const b = d.billing;
  if (billing.phase !== "trial") return null;
  const label = billing.daysLeft <= 1 ? b.chipLastDay : fmt(b.chipTrial, { days: billing.daysLeft });
  const color = TRIAL_NUDGE_COLORS[billing.nudge === "soon" || billing.nudge === "urgent" ? billing.nudge : "quiet"];
  return (
    <Link
      href={PAGE}
      aria-label={`${label}. ${b.chipAria}`}
      data-billing-chip={billing.nudge}
      className={`crm-trial-chip inline-flex min-h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-semibold transition-[filter] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${color}`}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </Link>
  );
}

/** The banner under the bar in the trial's last week: when the first charge falls, and where to manage it. */
export function BillingBanner({ billing, d, locale }: { billing: ShellBilling; d: Dict; locale: Locale }) {
  const b = d.billing;
  if (billing.phase !== "trial" || billing.firstChargeAt === null || (billing.nudge !== "soon" && billing.nudge !== "urgent")) return null;
  const values = { days: daysLabel(b, locale, billing.daysLeft), date: formatDate(dayOf(billing.firstChargeAt), locale), amount: price(billing.charged, locale) };
  const text = billing.daysLeft <= 1 ? fmt(b.bannerLastDay, values) : fmt(b.bannerSoon, values);
  const tone = billing.nudge === "urgent" ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-900";
  return (
    <div role="status" data-billing-banner={billing.nudge} className={`crm-billing-banner flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b px-safe-4 py-2 text-center text-xs font-semibold max-lg:[html[data-phone-chat]_&]:hidden ${tone}`}>
      <span>{text}</span>
      {billing.canManage ? (
        <Link href={PAGE} className="inline-flex min-h-8 items-center rounded px-1 underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">
          {b.manageShort}
        </Link>
      ) : (
        <span className="font-medium">{b.bannerOwner}</span>
      )}
    </div>
  );
}

/**
 * When the server refuses a change because the subscription stopped running
 * since the page was opened (402 `subscription_required`), the page is read
 * again: the layout then shows the locked screen. Only that answer is looked
 * at; every response, that one included, reaches its caller untouched.
 */
export function LockWatch() {
  const router = useRouter();
  useEffect(() => {
    const original = window.fetch;
    const watched: typeof fetch = async (...args) => {
      const response = await original(...args);
      if (response.status === 402) {
        try {
          const body = (await response.clone().json()) as { error?: string };
          if (body?.error === "subscription_required") router.refresh();
        } catch {
          /* Not this app's answer: nothing to do. */
        }
      }
      return response;
    };
    window.fetch = watched;
    return () => {
      if (window.fetch === watched) window.fetch = original;
    };
  }, [router]);
  return null;
}
