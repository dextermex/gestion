"use client";

import { useState } from "react";
import { Button } from "@/components/pro/ui";
import GestionLogo from "@/components/gestion/GestionLogo";
import { fmt } from "@/lib/i18n/config";
import type { Dict } from "@/lib/i18n/fr";
import { TEAM_EMAIL } from "@/lib/constants";
import type { LockReason } from "@/domain/billing/trial";
import type { Offer } from "@/lib/signup/offer";

/**
 * The one screen of a workspace whose subscription does not run (the
 * iPhone app's app/locked.tsx, for the web): why it is locked, the one button
 * that fixes it, that nothing was deleted, the account's address, signing
 * out and asking for the account's deletion. The layout renders it in place
 * of the whole space, on every page under /app; the tenant space is never
 * locked. Deletion is asked of the team by e-mail, as the account page's own
 * request is completed by the team.
 */
export interface LockedProps {
  reason: LockReason;
  email: string;
  /** The owner and admins may subscribe; other members are told whom to ask. */
  canManage: boolean;
  /** The offer the sign-up recorded (`morada_mobile.offer`), resumed as it was. */
  offer: Offer | null;
  trialDays: number;
  copy: Dict["billing"]["lock"];
  errGeneric: string;
  signOut: string;
}

/** Without a recorded offer, resuming quotes one lot in the first band, by the year: the least a subscription bills. */
const DEFAULT_OFFER: Offer = { units: 1, band: 0, billing: "year" };

export default function Locked({ reason, email, canManage, offer, trialDays, copy, errGeneric, signOut }: LockedProps) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const leaveFor = async (path: string, body: object) => {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = (await res.json().catch(() => ({}))) as { url?: unknown; error?: unknown };
      if (res.ok && typeof json.url === "string") {
        window.location.assign(json.url);
        return;
      }
      // Subscribed meanwhile (another tab, the iPhone app): the space opens on a fresh read.
      if (json.error === "already_subscribed") {
        window.location.reload();
        return;
      }
    } catch {
      /* said below */
    }
    setFailed(true);
    setBusy(false);
  };

  const leave = async () => {
    setLeaving(true);
    // The browser client is loaded when it is needed, not with every page.
    const { signOutEverywhere } = await import("@/lib/supabase/browser");
    await signOutEverywhere();
    window.location.assign("/connexion");
  };

  const title = reason === "payment" ? copy.paymentTitle : reason === "ended" ? copy.endedTitle : copy.noTrialTitle;
  const body = reason === "payment" ? copy.paymentBody : reason === "ended" ? copy.endedBody : fmt(copy.noTrialBody, { days: trialDays });
  const deletion = `mailto:${TEAM_EMAIL}?subject=${encodeURIComponent(copy.deleteSubject)}`;
  const primary = "ui-button inline-flex min-h-12 items-center justify-center rounded-full bg-brand-600 px-6 text-[15px] font-semibold text-white transition duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600";

  return (
    <main data-locked={reason} className="flex min-h-dvh flex-col items-center justify-center bg-sky-50 px-safe-4 pb-[max(3rem,calc(var(--safe-bottom)+1.5rem))] pt-[max(3rem,calc(var(--safe-top)+1.5rem))] text-center">
      <GestionLogo />
      <section aria-labelledby="locked-title" className="mt-8 w-full max-w-md rounded-[1.75rem] bg-white/95 p-6 shadow-sm sm:p-8">
        <h1 id="locked-title" className="text-balance font-display text-2xl font-bold tracking-tight text-ink">{title}</h1>
        <p className="mx-auto mt-3 max-w-sm text-[15px] leading-relaxed text-ink-soft">{body}</p>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-ink-soft">{copy.kept}</p>
        <div className="mt-7 flex flex-col items-center gap-3">
          {!canManage ? (
            <p className="text-sm font-medium text-ink">{copy.ownerOnly}</p>
          ) : reason === "no_trial" ? (
            <a href="/inscription?etape=offre" className={primary} data-locked-action="start">{fmt(copy.start, { days: trialDays })}</a>
          ) : reason === "ended" ? (
            <Button className="min-h-12 px-6 text-[15px]" loading={busy} onClick={() => leaveFor("/api/abonnement/checkout", { source: "resume", ...(offer ?? DEFAULT_OFFER) })} data-locked-action="resume">
              {copy.resume}
            </Button>
          ) : (
            <Button className="min-h-12 px-6 text-[15px]" loading={busy} onClick={() => leaveFor("/api/abonnement/portail", { flow: "payment_method_update" })} data-locked-action="update-card">
              {copy.updateCard}
            </Button>
          )}
          {failed && <p role="alert" className="max-w-sm text-xs leading-relaxed text-red-700">{errGeneric}</p>}
        </div>
      </section>
      <div className="mt-6 flex flex-col items-center gap-2 text-sm">
        <p className="text-xs font-semibold text-ink-soft">{fmt(copy.signedInAs, { email })}</p>
        <button type="button" onClick={leave} disabled={leaving} className="min-h-10 px-2 font-semibold text-brand-700 hover:underline disabled:opacity-50">
          {signOut}
        </button>
        <a href={deletion} className="inline-flex min-h-10 items-center px-2 text-xs text-ink-soft underline underline-offset-4 hover:no-underline">{copy.deleteAccount}</a>
      </div>
    </main>
  );
}
