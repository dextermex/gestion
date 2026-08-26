"use client";

import { useState } from "react";
import { Button } from "@/components/pro/ui";
import GestionLogo from "@/components/gestion/GestionLogo";
import { signOutEverywhere } from "@/lib/supabase/browser";
import type { Dict } from "@/lib/i18n/fr";

/**
 * Shown only when the silent first-run provisioning could not create the
 * account's management space. Rendered in place rather than redirecting:
 * bouncing a signed-in visitor to the sign-in page would come straight back
 * here and loop.
 */
export default function ProvisionError({ d, email }: { d: Dict; email: string }) {
  const [leaving, setLeaving] = useState(false);

  const signOut = async () => {
    setLeaving(true);
    await signOutEverywhere();
    window.location.assign("/connexion");
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-sand-50 px-4 py-12 text-center">
      <GestionLogo />
      <h1 className="mt-7 text-balance font-display text-2xl font-bold tracking-tight text-ink">
        {d.auth.provisionFailedTitle}
      </h1>
      <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-ink-soft">{d.auth.provisionFailedBody}</p>
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
