"use client";

import { useState } from "react";
import { Button } from "@/components/pro/ui";
import GestionLogo from "@/components/gestion/GestionLogo";
import { signOutEverywhere } from "@/lib/supabase/browser";

/**
 * Shown to an account that had a management space and no longer belongs to
 * any: the person is told, and nothing is created for them unasked. They may
 * open a space of their own on purpose (POST /api/espace/creer) or leave.
 */
export default function NoWorkspace({ email, labels }: { email: string; labels: { title: string; body: string; create: string; failed: string; signOut: string } }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const create = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch("/api/espace/creer", { method: "POST" });
      if (res.ok) {
        window.location.assign("/app");
        return;
      }
      if (res.status === 401) {
        window.location.assign("/connexion?next=/app");
        return;
      }
    } catch {
      /* said below */
    }
    setFailed(true);
    setBusy(false);
  };

  const signOut = async () => {
    setLeaving(true);
    await signOutEverywhere();
    window.location.assign("/connexion");
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-sand-50 px-safe-4 pb-[max(3rem,calc(var(--safe-bottom)+1.5rem))] pt-[max(3rem,calc(var(--safe-top)+1.5rem))] text-center">
      <GestionLogo />
      <h1 className="mt-7 text-balance font-display text-2xl font-bold tracking-tight text-ink">{labels.title}</h1>
      <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-ink-soft">{labels.body}</p>
      <p className="mt-4 text-xs font-semibold text-ink-soft">{email}</p>
      <div className="mt-7 flex flex-col items-center gap-3">
        <Button onClick={create} loading={busy}>{labels.create}</Button>
        {failed && (
          <p role="alert" className="max-w-sm text-xs leading-relaxed text-red-700">
            {labels.failed}
          </p>
        )}
        <button onClick={signOut} disabled={leaving} className="text-sm font-semibold text-red-700 hover:underline disabled:opacity-50">
          {labels.signOut}
        </button>
      </div>
    </div>
  );
}
