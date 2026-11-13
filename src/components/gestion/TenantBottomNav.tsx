"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Modal } from "@/components/pro/ui";
import { Icon, type IconName } from "@/components/pro/icons";
import { signOutEverywhere } from "@/lib/supabase/browser";

/**
 * The tenant space's navigation on a phone: a bar fixed at the foot of the
 * screen, the four destinations a tenant uses most (home, payments,
 * requests, messages) and "Plus" for the rest (the lease, the documents,
 * the profile, the settings, the owner's space when the account has one,
 * signing out), the way a phone's apps are laid out. A destination may
 * carry a count (unread messages); a row behind "Plus" may carry a note
 * (something to send), and "Plus" then shows a dot so it is not missed. Fixed, so it is one thumb away at any scroll depth;
 * clear of the home indicator; packed flat when the phone is held sideways.
 * Above `lg` the space keeps its tabs under the logo and this bar is not
 * on the screen at all. The pages keep their foot clear of it through the
 * `--nav-b` variable the space declares (globals.css). A conversation open
 * over the phone's screen (`html[data-phone-chat]`) has the foot too.
 */

export interface TenantNavItem {
  href: string;
  label: string;
  icon: IconName;
  /** A count shown on the icon (unread messages), with the words a screen reader says for it. */
  badge?: { count: number; label: string };
  /** A short note shown on a row behind "Plus" ("1 à envoyer"). */
  note?: string;
  /** A line under a row behind "Plus", saying what is there. */
  desc?: string;
  /** A row that points at a destination of the bar (help, to messages): it does not light "Plus". */
  shortcut?: boolean;
  /** Other sections this row stands for (the account row, for the settings). */
  covers?: string[];
}

export default function TenantBottomNav({
  items,
  more,
  label,
  closeLabel,
  signOut,
}: {
  items: TenantNavItem[];
  /** "Plus": its label, and what it opens. */
  more: { label: string; entries: TenantNavItem[] };
  label: string;
  closeLabel: string;
  /** The sign-out row's label; null without a session (a sample cabinet). */
  signOut: string | null;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const isActive = (href: string) => (href === "/locataire" ? pathname === "/locataire" : pathname.startsWith(href));
  // A section that lives behind "Plus" lights "Plus" up while it is open.
  const moreActive = more.entries.some((e) => !e.shortcut && e.href.startsWith("/locataire") && (isActive(e.href) || (e.covers ?? []).some(isActive)));
  const moreNoted = more.entries.some((e) => Boolean(e.note));

  const leave = async () => {
    setLeaving(true);
    await signOutEverywhere();
    window.location.assign("/connexion?next=/locataire");
  };

  const itemClass = (active: boolean) =>
    "tactile flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1 text-[11px] font-semibold leading-none transition duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600 short-landscape:flex-row short-landscape:gap-1.5 " +
    (active ? "text-brand-700" : "text-ink-soft hover:text-ink");

  return (
    <>
      {/* A tab bar, not text: a long press neither selects a label nor raises the link menu.
          It steps aside while the keyboard is up, instead of riding up over the field. */}
      <nav
        aria-label={label}
        className="tenant-bottom-nav chrome-material fixed inset-x-0 bottom-0 z-30 select-none border-t border-sand-100 bg-white pb-(--safe-bottom) [-webkit-touch-callout:none] typing:hidden supports-[backdrop-filter]:bg-white/90 supports-[backdrop-filter]:backdrop-blur-xl supports-[backdrop-filter]:backdrop-saturate-150 max-lg:[html[data-phone-chat]_&]:hidden lg:hidden"
      >
        <ul className="mx-auto flex h-14 max-w-3xl items-stretch gap-0.5 px-safe-4 short-landscape:h-11">
          {items.map((it) => {
            const active = isActive(it.href);
            return (
              <li key={it.href} className="flex min-w-0 flex-1">
                <Link href={it.href} aria-current={active ? "page" : undefined} className={itemClass(active) + " relative"}>
                  <Icon name={it.icon} size={22} className="shrink-0" />
                  <span className="max-w-full truncate">{it.label}</span>
                  {it.badge && it.badge.count > 0 && (
                    <span className="absolute left-1/2 top-0.5 ml-1 inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-accent-600 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white short-landscape:static short-landscape:ml-0" aria-label={it.badge.label}>
                      {it.badge.count > 9 ? "9+" : it.badge.count}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
          <li className="flex min-w-0 flex-1">
            <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open} className={itemClass(moreActive || open) + " relative"}>
              <Icon name="more" size={22} className="shrink-0" />
              <span className="max-w-full truncate">{more.label}</span>
              {moreNoted && <span aria-hidden className="absolute left-1/2 top-1.5 ml-2 h-2 w-2 rounded-full bg-accent-600 ring-2 ring-white short-landscape:hidden" />}
            </button>
          </li>
        </ul>
      </nav>

      <Modal open={open} onClose={() => setOpen(false)} title={more.label} closeLabel={closeLabel}>
        <ul className="divide-y divide-sand-100">
          {more.entries.map((e) => (
            <li key={e.href}>
              <Link
                href={e.href}
                onClick={() => setOpen(false)}
                aria-current={!e.shortcut && e.href.startsWith("/locataire") && isActive(e.href) ? "page" : undefined}
                className="tactile flex min-h-14 items-center gap-3 rounded-xl px-2 py-2.5 text-sm font-semibold text-ink transition hover:bg-sand-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                  <Icon name={e.icon} size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{e.label}</span>
                  {e.desc && <span className="block text-xs font-normal leading-snug text-ink-soft">{e.desc}</span>}
                </span>
                {e.note && <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">{e.note}</span>}
                <svg className="h-4 w-4 shrink-0 text-ink-soft" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
                </svg>
              </Link>
            </li>
          ))}
          {signOut && (
            <li>
              <button
                type="button"
                onClick={leave}
                disabled={leaving}
                className="tactile flex min-h-14 w-full items-center gap-3 rounded-xl px-2 text-left text-sm font-semibold text-red-700 transition hover:bg-red-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-50"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-700">
                  <Icon name="logout" size={18} />
                </span>
                {signOut}
              </button>
            </li>
          )}
        </ul>
      </Modal>
    </>
  );
}
