"use client";

import { useState } from "react";
import { Button } from "@/components/pro/ui";
import GestionLogo from "@/components/gestion/GestionLogo";
import { signOutEverywhere } from "@/lib/supabase/browser";
import { WELCOME_URL } from "@/lib/constants";
import { fmt } from "@/lib/i18n/config";
import type { Dict } from "@/lib/i18n/fr";

/**
 * Signed in, but the account belongs to no firm or portfolio. An honest empty
 * screen: no figures, no sample workspace, and a real way out.
 */
export default function NoWorkspace({ d, email }: { d: Dict; email: string }) {
  const [leaving, setLeaving] = useState(false);

  const signOut = async () => {
    setLeaving(true);
    await signOutEverywhere();
    window.location.assign("/connexion");
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-sand-50 px-4 py-12">
      <div className="w-full max-w-md text-center">
        <div className="flex justify-center">
          <GestionLogo />
        </div>
        <h1 className="mt-7 text-balance font-display text-2xl font-bold tracking-tight text-ink">
          {d.auth.noWorkspaceTitle}
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-ink-soft">{d.auth.noWorkspaceBody}</p>
        <p className="mt-5 text-xs font-semibold text-ink-soft">{fmt(d.auth.signedInAs, { email })}</p>

        <div className="mt-7 flex flex-col items-center gap-3">
          <a href={WELCOME_URL} className="w-full max-w-xs">
            <Button className="w-full">{d.shell.switchSpace}</Button>
          </a>
          <button
            onClick={signOut}
            disabled={leaving}
            className="text-sm font-semibold text-red-700 hover:underline disabled:opacity-50"
          >
            {d.shell.signOut}
          </button>
        </div>
      </div>
    </div>
  );
}
