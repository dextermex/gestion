"use client";

import { useState } from "react";
import { Button } from "@/components/pro/ui";
import GestionLogo from "@/components/gestion/GestionLogo";
import { signOutEverywhere } from "@/lib/supabase/browser";
import type { Dict } from "@/lib/i18n/fr";
import { TEAM_EMAIL } from "@/lib/constants";

/**
 * Shown in place of the management space when the account cannot be given
 * one: the silent first-run provisioning could not create it, or (`refused`)
 * the account is a member of a space whose role does not open the
 * properties to it. Rendered in place rather than redirecting: bouncing a
 * signed-in visitor to the sign-in page would come straight back here and
 * loop.
 */
export default function ProvisionError({ d, email, refused = false }: { d: Dict; email: string; /** A membership exists and the database refuses it: nothing to prepare, someone has to open the space. */ refused?: boolean }) {
  const [leaving, setLeaving] = useState(false);

  const signOut = async () => {
    setLeaving(true);
    await signOutEverywhere();
    window.location.assign("/connexion");
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-sand-50 px-safe-4 pb-[max(3rem,calc(var(--safe-bottom)+1.5rem))] pt-[max(3rem,calc(var(--safe-top)+1.5rem))] text-center">
      <GestionLogo />
      <h1 className="mt-7 text-balance font-display text-2xl font-bold tracking-tight text-ink">
        {refused ? d.auth.noAccessTitle : d.auth.provisionFailedTitle}
      </h1>
      <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-ink-soft">{refused ? d.auth.noAccessBody : d.auth.provisionFailedBody}</p>
      {refused && (
        <a href={`mailto:${TEAM_EMAIL}`} className="mt-3 inline-flex min-h-10 items-center text-sm font-semibold text-brand-700 hover:underline">
          {TEAM_EMAIL}
        </a>
      )}
      <p className="mt-4 text-xs font-semibold text-ink-soft">{email}</p>
      <div className="mt-7 flex flex-col items-center gap-3">
        <Button onClick={() => window.location.reload()}>{d.auth.provisionRetry}</Button>
        <button
          onClick={signOut}
          disabled={leaving}
          className="text-sm font-semibold text-red-700 hover:underline disabled:opacity-50"
        >
          {d.shell.signOut}
        </button>
      </div>
    </div>
  );
}
