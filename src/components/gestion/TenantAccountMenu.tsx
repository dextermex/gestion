"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/pro/icons";
import { Avatar } from "@/components/pro/ui";
import { signOutEverywhere } from "@/lib/supabase/browser";
import { useDismiss } from "@/lib/useDismiss";

/**
 * The tenant's account, behind their name and avatar: the profile, the
 * settings and signing out, the way the management space's own menu reads.
 * One button on every screen (the name beside the avatar from `sm`), a
 * menu that closes on Escape or a press outside, rows a thumb can hit.
 * Signing out leaves every Morada space: one session, one cookie. On a
 * sample cabinet there is no session to end, and the menu says so.
 */
export default function TenantAccountMenu({
  name,
  email,
  signedIn,
  labels,
}: {
  name: string;
  email: string;
  signedIn: boolean;
  labels: { menu: string; profile: string; settings: string; signOut: string; sampleNotice: string };
}) {
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [note, setNote] = useState(false);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));

  const leave = async () => {
    if (!signedIn) {
      setNote(true);
      return;
    }
    setLeaving(true);
    await signOutEverywhere();
    window.location.assign("/connexion?next=/locataire");
  };

  const row = "tactile flex min-h-11 items-center gap-3 rounded-xl px-2.5 text-sm font-semibold transition focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600";
  const tile = "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${labels.menu} · ${name}`}
        className="tactile inline-flex min-h-11 items-center gap-2 rounded-full border border-sand-200 bg-white py-1 pl-1.5 pr-2 shadow-sm transition hover:border-brand-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 sm:pl-3.5"
      >
        <span className="hidden max-w-[14rem] truncate text-sm font-semibold text-ink sm:block">{name}</span>
        <Avatar name={name} size={32} />
        <Icon name="chevron-down" size={16} className="shrink-0 text-ink-soft" />
      </button>
      {open && (
        <div role="menu" aria-label={labels.menu} className="crm-dropdown absolute right-0 top-[calc(100%+0.5rem)] z-40 w-68 max-w-[calc(100vw-1.5rem)] rounded-2xl border border-sand-200 bg-white p-1.5 shadow-lg">
          <div className="mb-1 border-b border-sand-100 px-2.5 pb-2.5 pt-2">
            <p className="truncate text-sm font-semibold text-ink">{name}</p>
            {email && <p className="truncate text-xs text-ink-soft">{email}</p>}
          </div>
          <Link role="menuitem" href="/locataire/profil" onClick={() => setOpen(false)} className={`${row} text-ink hover:bg-sand-50`}>
            <span className={`${tile} bg-brand-50 text-brand-700`}><Icon name="user" size={16} /></span>
            {labels.profile}
          </Link>
          <Link role="menuitem" href="/locataire/parametres" onClick={() => setOpen(false)} className={`${row} text-ink hover:bg-sand-50`}>
            <span className={`${tile} bg-brand-50 text-brand-700`}><Icon name="settings" size={16} /></span>
            {labels.settings}
          </Link>
          <div className="mt-1 border-t border-sand-100 pt-1">
            {note ? (
              <p role="status" className="rounded-xl px-2.5 py-2 text-xs font-semibold text-emerald-800">{labels.sampleNotice}</p>
            ) : (
              <button role="menuitem" type="button" onClick={leave} disabled={leaving} className={`${row} w-full text-left text-red-700 hover:bg-red-50 disabled:opacity-50`}>
                <span className={`${tile} bg-red-50 text-red-700`}><Icon name="logout" size={16} /></span>
                {labels.signOut}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
