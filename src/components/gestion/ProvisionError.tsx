"use client";

import { useState } from "react";
import { Button } from "@/components/pro/ui";
import GestionLogo from "@/components/gestion/GestionLogo";
import { signOutEverywhere } from "@/lib/supabase/browser";
import type { Dict } from "@/lib/i18n/fr";

/**
 * Shown when the silent first-run provisioning could not create the
 * account's management space, and (with its own words) when the account's
 * spaces could not be read at all. Rendered in place rather than redirecting:
 * bouncing a signed-in visitor to the sign-in page would come straight back
 * here and loop.
 */
export default function ProvisionError({ d, email, title, body }: { d: Dict; email: string; title?: string; body?: string }) {
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
        {title ?? d.auth.provisionFailedTitle}
      </h1>
      <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-ink-soft">{body ?? d.auth.provisionFailedBody}</p>
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
