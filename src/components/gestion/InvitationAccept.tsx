"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/pro/ui";
import GestionLogo from "@/components/gestion/GestionLogo";
import { fmt } from "@/lib/i18n/config";
import type { Dict } from "@/lib/i18n/fr";
import { MORADA_URL } from "@/lib/constants";
import { signOutEverywhere } from "@/lib/supabase/browser";

type InviteStrings = Dict["tenant"]["invite"];

export interface InvitePreviewView {
  state: "unknown" | "pending" | "accepted" | "expired" | "revoked";
  mine: boolean;
  firstName: string;
  email: string;
  orgName: string;
  home: string;
  address: string;
  expiresOn: string;
}

type Failure = "unknown" | "used" | "revoked" | "expired" | "wrong_account" | "linked_elsewhere" | "another_contact" | "sign_in" | "failed";

/**
 * The invitation, from the visitor's side. Signed in with the invited
 * address, the acceptance runs by itself: the database call is idempotent,
 * so a refresh or a second tab lands on the same outcome. Any other
 * situation is named plainly, with the one thing to do next.
 */
export default function InvitationAccept({
  token,
  t,
  backLabel,
  preview,
  session,
}: {
  token: string;
  t: InviteStrings;
  backLabel: string;
  preview: InvitePreviewView;
  session: { email: string } | null;
}) {
  const next = encodeURIComponent(`/invitation/${token}`);
  const matches = session !== null && preview.email !== "" && session.email.toLowerCase() === preview.email.toLowerCase();
  const [phase, setPhase] = useState<"idle" | "accepting" | "done" | "failed">("idle");
  const [failure, setFailure] = useState<Failure | null>(null);
  const [switching, setSwitching] = useState(false);

  const accept = useCallback(async () => {
    setPhase("accepting");
    setFailure(null);
    try {
      const res = await fetch("/api/portail/accepter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (res.ok) {
        setPhase("done");
        window.location.assign("/locataire");
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      const known: Failure[] = ["unknown", "used", "revoked", "expired", "wrong_account", "linked_elsewhere", "another_contact", "sign_in"];
      setFailure(known.includes(data.error as Failure) ? (data.error as Failure) : "failed");
      setPhase("failed");
    } catch {
      setFailure("failed");
      setPhase("failed");
    }
  }, [token]);

  // The zero-step path: the invited person is already signed in.
  useEffect(() => {
    if (preview.state === "pending" && matches && phase === "idle") void accept();
  }, [preview.state, matches, phase, accept]);

  const switchAccount = async () => {
    setSwitching(true);
    await signOutEverywhere();
    window.location.assign(`/connexion?next=${next}`);
  };

  const outcome = (): { title: string; body: string; actions: React.ReactNode } | null => {
    if (preview.state === "unknown") return { title: t.unknownTitle, body: t.unknownBody, actions: null };
    if (preview.state === "expired") return { title: t.expiredTitle, body: t.expiredBody, actions: null };
    if (preview.state === "revoked") return { title: t.revokedTitle, body: t.revokedBody, actions: null };
    if (preview.state === "accepted") {
      return preview.mine
        ? { title: t.acceptedTitle, body: fmt(t.acceptedBody, { home: preview.home }), actions: <a href="/locataire" className={primary}>{t.goSpace}</a> }
        : { title: t.usedTitle, body: t.usedBody, actions: <a href={`/connexion?next=${next}`} className={primary}>{t.signIn}</a> };
    }
    if (phase === "failed" && failure) {
      switch (failure) {
        case "unknown": return { title: t.unknownTitle, body: t.unknownBody, actions: null };
        case "used": return { title: t.usedTitle, body: t.usedBody, actions: null };
        case "revoked": return { title: t.revokedTitle, body: t.revokedBody, actions: null };
        case "expired": return { title: t.expiredTitle, body: t.expiredBody, actions: null };
        case "wrong_account": return { title: t.wrongAccountTitle, body: fmt(t.wrongAccountBody, { email: preview.email }), actions: switchButton };
        case "linked_elsewhere": return { title: t.linkedElsewhereTitle, body: t.linkedElsewhereBody, actions: null };
        case "another_contact": return { title: t.anotherContactTitle, body: t.anotherContactBody, actions: switchButton };
        case "sign_in": return { title: t.failedTitle, body: t.failedBody, actions: <a href={`/connexion?next=${next}`} className={primary}>{t.signIn}</a> };
        default: return { title: t.failedTitle, body: t.failedBody, actions: <Button onClick={accept}>{t.retry}</Button> };
      }
    }
    return null;
  };

  const primary = "tactile inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600";
  const secondary = "tactile inline-flex min-h-11 items-center justify-center rounded-xl border border-sand-200 bg-white px-5 py-2.5 text-sm font-semibold text-ink transition hover:border-brand-300 hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600";
  const switchButton = (
    <button type="button" onClick={switchAccount} disabled={switching} className={secondary}>
      {t.otherAccount}
    </button>
  );

  const result = outcome();
  const pending = preview.state === "pending" && result === null;

  return (
    <div className="flex min-h-dvh flex-col bg-sand-50">
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-10 sm:px-6">
        <div className="flex justify-center">
          <a href={`${MORADA_URL}/welcome`} aria-label="Morada">
            <GestionLogo />
          </a>
        </div>

        <div className="mt-8 rounded-2xl border border-sand-200 bg-white p-6 shadow-sm sm:p-8">
          {result ? (
            <div className="text-center">
              <h1 className="text-balance font-display text-2xl font-bold tracking-tight text-ink">{result.title}</h1>
              <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-ink-soft">{result.body}</p>
              {result.actions && <div className="mt-6 flex flex-col items-center gap-3">{result.actions}</div>}
            </div>
          ) : (
            <>
              <h1 className="text-balance font-display text-2xl font-bold tracking-tight text-ink">{t.pageTitle}</h1>
              <p className="mt-3 text-sm leading-relaxed text-ink-soft">
                {fmt(t.pageIntro, { org: preview.orgName, home: preview.home })}
              </p>

              <div className="mt-5 rounded-xl border border-sand-200 bg-sand-50 p-4">
                <p className="font-display text-base font-bold text-ink">{preview.home}</p>
                {preview.address && <p className="mt-0.5 text-sm text-ink-soft">{preview.address}</p>}
                <p className="mt-3 text-xs text-ink-soft">{fmt(t.pageSentTo, { email: preview.email })}</p>
                {preview.expiresOn && <p className="text-xs text-ink-soft">{fmt(t.pageExpires, { date: preview.expiresOn })}</p>}
              </div>

              <p className="mt-5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{t.pageWhat}</p>
              <ul className="mt-2 space-y-2">
                {[t.pagePoint1, t.pagePoint2, t.pagePoint3].map((p) => (
                  <li key={p} className="flex items-start gap-2.5 text-sm text-ink">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="h-3 w-3" aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
                      </svg>
                    </span>
                    {p}
                  </li>
                ))}
              </ul>

              {pending && session === null && (
                <div className="mt-7 flex flex-col gap-3">
                  <a href={`/connexion?next=${next}&onglet=inscription&email=${encodeURIComponent(preview.email)}`} className={primary}>
                    {t.create}
                  </a>
                  <p className="text-center text-xs text-ink-soft">{fmt(t.createHint, { email: preview.email })}</p>
                  <p className="mt-2 text-center text-xs font-semibold text-ink-soft">{t.haveAccount}</p>
                  <a href={`/connexion?next=${next}&email=${encodeURIComponent(preview.email)}`} className={secondary}>
                    {t.signIn}
                  </a>
                </div>
              )}

              {pending && session !== null && matches && (
                <div className="mt-7 text-center">
                  <p role="status" className="text-sm font-semibold text-ink">
                    {t.accepting}
                  </p>
                  <p className="mt-1 text-xs text-ink-soft">{fmt(t.signedInAs, { email: session.email })}</p>
                </div>
              )}

              {pending && session !== null && !matches && (
                <div className="mt-7 flex flex-col gap-3">
                  <p role="alert" className="rounded-xl bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900">
                    {fmt(t.wrongAccountBody, { email: preview.email })}
                  </p>
                  <p className="text-center text-xs text-ink-soft">{fmt(t.signedInAs, { email: session.email })}</p>
                  {switchButton}
                </div>
              )}
            </>
          )}
        </div>

        <p className="mt-4 text-center text-xs font-semibold">
          <a href={MORADA_URL} className="text-ink-soft hover:text-brand-700">
            {backLabel}
          </a>
        </p>
      </div>
    </div>
  );
}
