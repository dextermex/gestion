"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/pro/ui";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/lib/i18n/config";
import { signOutEverywhere } from "@/lib/supabase/browser";

/**
 * The language of the tenant's space: the same cookie the rest of Morada
 * reads (one choice follows the account across spaces), and the profile's
 * preferred language so it is kept with the account. The page is read
 * again in the new language at once.
 */
export function TenantLanguage({ locale, label, sample }: { locale: Locale; label: string; sample: boolean }) {
  const router = useRouter();
  const [active, setActive] = useState<Locale>(locale);
  const pick = (l: Locale) => {
    if (l === active) return;
    setActive(l);
    document.cookie = `morada_locale=${l}; path=/; max-age=31536000; samesite=lax`;
    // The cookie is what the screens read; the profile row follows when there is an account to write to.
    if (!sample) void fetch("/api/locataire/profil", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "locale", locale: l }) }).catch(() => null);
    router.refresh();
  };
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-2 gap-1 rounded-2xl border border-sand-200 bg-sand-50 p-1 sm:grid-cols-4">
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          role="radio"
          aria-checked={active === l}
          lang={l === "lu" ? "lb" : l}
          onClick={() => pick(l)}
          className={
            "tactile min-h-11 rounded-xl px-2 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 " +
            (active === l ? "bg-white text-brand-700 shadow-sm" : "text-ink-soft hover:text-ink")
          }
        >
          {LOCALE_LABELS[l]}
        </button>
      ))}
    </div>
  );
}

/** Ends the session on every device (the same sign-out the space has always had), then back to the sign-in door. */
export function TenantSignOutAll({ label, signedIn, sampleNotice }: { label: string; signedIn: boolean; sampleNotice: string }) {
  const [state, setState] = useState<"idle" | "leaving" | "sample">("idle");
  const leave = async () => {
    if (!signedIn) {
      setState("sample");
      return;
    }
    setState("leaving");
    await signOutEverywhere();
    window.location.assign("/connexion?next=/locataire");
  };
  if (state === "sample") return <p role="status" className="max-w-xs text-right text-xs font-semibold text-emerald-800">{sampleNotice}</p>;
  return (
    <Button type="button" variant="secondary" className="shrink-0 rounded-xl!" loading={state === "leaving"} onClick={leave}>
      {label}
    </Button>
  );
}
