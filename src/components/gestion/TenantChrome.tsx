"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOutEverywhere } from "@/lib/supabase/browser";

/** Leaving the tenant space signs out of every Morada space: one session, one cookie. */
export function TenantSignOut({ label }: { label: string }) {
  const [leaving, setLeaving] = useState(false);
  const signOut = async () => {
    setLeaving(true);
    await signOutEverywhere();
    window.location.assign("/connexion?next=/locataire");
  };
  return (
    <button
      type="button"
      onClick={signOut}
      disabled={leaving}
      className="rounded-lg px-2 py-1 text-xs font-semibold text-ink-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-50"
    >
      {label}
    </button>
  );
}

/** The same amber line as the management space: sample data says so on every screen. */
export function TenantSampleBanner({ text, back }: { text: string; back: string }) {
  const router = useRouter();
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs font-semibold text-amber-900"
    >
      <span>{text}</span>
      <button
        type="button"
        onClick={() => {
          document.cookie = "morada_dataset=real; path=/; max-age=31536000; samesite=lax";
          router.refresh();
        }}
        className="rounded underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      >
        {back}
      </button>
    </div>
  );
}

/**
 * A tenant account opening a management space of its own, on purpose: the
 * same silent provisioning every other account gets on first entry, made
 * explicit here because this account came in through an invitation.
 */
export function TenantBecomeOwner({ label, failed }: { label: string; failed: string }) {
  const [state, setState] = useState<"idle" | "working" | "failed">("idle");
  const create = async () => {
    setState("working");
    try {
      const res = await fetch("/api/espace/creer", { method: "POST" });
      if (res.ok) {
        window.location.assign("/app");
        return;
      }
    } catch {
      // fall through
    }
    setState("failed");
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" onClick={create} disabled={state === "working"} className="text-[11px] font-semibold text-brand-700 hover:underline disabled:opacity-50">
        {label}
      </button>
      {state === "failed" && <span className="text-[11px] font-semibold text-red-700">{failed}</span>}
    </span>
  );
}
