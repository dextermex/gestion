"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Button, Field, Input } from "@/components/pro/ui";
import GestionLogo from "@/components/gestion/GestionLogo";
import { useDismiss } from "@/lib/useDismiss";
import { getSupabase, signOutEverywhere } from "@/lib/supabase/browser";
import { MORADA_URL, WELCOME_URL } from "@/lib/constants";
import type { Dict } from "@/lib/i18n/fr";

/**
 * First entry into Morada Gestion: the signed-in Morada account belongs to no
 * management space yet, so instead of a dead end it gets the two real ways
 * in. "Create" calls `gestion_onboard`, the SECURITY DEFINER function already
 * deployed in production: it creates the `agencies` row (kind owner/manager,
 * private) and enrols the caller as its owner in `crm_members`. Same account,
 * same identity, no parallel sign-up.
 */

function FeatureIcon({ path }: { path: string }) {
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
        <path d={path} />
      </svg>
    </span>
  );
}

const FEATURE_ICONS = [
  "M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 21V9h4a1 1 0 0 1 1 1v11M4 21h17M7.5 8h3M7.5 12h3M7.5 16h3",
  "M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM21 19v-1a4 4 0 0 0-2.5-3.7M15.5 3.3A3.5 3.5 0 0 1 15.5 10",
  "M17 8.5A5.5 5.5 0 1 0 17 15.5M4 10.5h8M4 13.5h8",
  "M6 3h8l4 4v14H6ZM14 3v4h4M9 12h6M9 16h6",
  "M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM19 8v6M22 11h-6",
];

function UserMenu({ d, name, email }: { d: Dict; name: string; email: string }) {
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const signOut = async () => {
    setLeaving(true);
    await signOutEverywhere();
    window.location.assign("/connexion");
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 hover:bg-sand-50"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-800">
          {initials}
        </span>
        <span className="hidden max-w-40 truncate text-sm font-semibold text-ink sm:block">{name}</span>
        <svg className="h-4 w-4 text-ink-soft" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-60 rounded-xl border border-sand-100 bg-white p-1.5 shadow-lg">
          <div className="border-b border-sand-100 px-3 py-2">
            <p className="truncate text-sm font-semibold text-ink">{name}</p>
            <p className="truncate text-xs text-ink-soft">{email}</p>
          </div>
          <a href={MORADA_URL} className="block rounded-lg px-3 py-2 text-sm text-ink hover:bg-sand-50">
            {d.shell.moradaAccount}
          </a>
          <a href={WELCOME_URL} className="block rounded-lg px-3 py-2 text-sm text-ink hover:bg-sand-50">
            {d.shell.switchSpace}
          </a>
          <div className="mt-1 border-t border-sand-100 pt-1">
            <button
              onClick={signOut}
              disabled={leaving}
              className="block w-full rounded-lg px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              {d.shell.signOut}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SpaceOnboarding({
  d,
  name,
  email,
}: {
  d: Dict;
  name: string;
  email: string;
}) {
  const reduced = useReducedMotion();
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [spaceName, setSpaceName] = useState("");
  const [kind, setKind] = useState<"owner" | "manager">("owner");
  const [state, setState] = useState<"idle" | "working" | "failed">("idle");
  const [errorText, setErrorText] = useState("");

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (spaceName.trim() === "" || state === "working") return;
    setState("working");
    try {
      const { error } = await getSupabase().rpc("gestion_onboard", {
        p_name: spaceName.trim(),
        p_kind: kind,
      });
      if (error) {
        setErrorText(error.message || d.firstRun.createFailed);
        setState("failed");
        return;
      }
      // Full reload: the server re-reads crm_members and lands on the
      // dashboard of the space that now exists.
      window.location.assign("/app");
    } catch {
      setErrorText(d.firstRun.createFailed);
      setState("failed");
    }
  };

  const reveal = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.15 } }
    : {
        initial: { opacity: 0, height: 0 },
        animate: { opacity: 1, height: "auto" },
        exit: { opacity: 0, height: 0 },
        transition: { duration: 0.25, ease: [0.22, 1, 0.36, 1] as const },
      };

  const features = [
    { t: d.firstRun.feat1, b: d.firstRun.feat1Body },
    { t: d.firstRun.feat2, b: d.firstRun.feat2Body },
    { t: d.firstRun.feat3, b: d.firstRun.feat3Body },
    { t: d.firstRun.feat4, b: d.firstRun.feat4Body },
    { t: d.firstRun.feat5, b: d.firstRun.feat5Body },
  ];

  return (
    <div className="min-h-dvh bg-sand-50">
      <header className="border-b border-sand-100 bg-white">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
          <a href={WELCOME_URL} aria-label="Morada">
            <GestionLogo />
          </a>
          <UserMenu d={d} name={name} email={email} />
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
        <h1 className="text-balance font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">
          {d.firstRun.title}
        </h1>
        <p className="mt-2 max-w-xl text-base text-ink-soft">{d.firstRun.sub}</p>

        <div className="mt-8 grid grid-cols-1 items-start gap-5 lg:grid-cols-[1fr_1fr_minmax(280px,0.9fr)]">
          {/* ------------------------------- create ------------------------------- */}
          <div className="flex h-full flex-col rounded-2xl border-2 border-brand-200 bg-white p-7 text-center shadow-sm">
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand-700 text-white">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-7 w-7" aria-hidden>
                <path strokeLinecap="round" d="M12 5v14M5 12h14" />
              </svg>
            </span>
            <h2 className="mt-5 font-display text-xl font-bold text-ink">{d.firstRun.createTitle}</h2>
            <p className="mx-auto mt-2 max-w-xs flex-1 text-sm leading-relaxed text-ink-soft">
              {d.firstRun.createBody}
            </p>

            <AnimatePresence initial={false} mode="wait">
              {creating ? (
                <motion.form key="form" {...reveal} onSubmit={create} className="mt-5 space-y-3 overflow-hidden text-left">
                  <Field label={d.firstRun.nameLabel} hint={d.firstRun.nameHint}>
                    <Input
                      required
                      autoFocus
                      maxLength={80}
                      value={spaceName}
                      onChange={(e) => setSpaceName(e.target.value)}
                    />
                  </Field>
                  <div>
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                      {d.firstRun.kindLabel}
                    </p>
                    <div role="radiogroup" aria-label={d.firstRun.kindLabel} className="grid grid-cols-2 gap-1 rounded-xl border border-sand-200 bg-sand-50 p-1">
                      {(["owner", "manager"] as const).map((k) => (
                        <button
                          key={k}
                          type="button"
                          role="radio"
                          aria-checked={kind === k}
                          onClick={() => setKind(k)}
                          className={
                            "rounded-lg px-2 py-1.5 text-xs font-semibold transition " +
                            (kind === k ? "bg-white text-brand-800 shadow-sm" : "text-ink-soft hover:text-ink")
                          }
                        >
                          {k === "owner" ? d.firstRun.kindOwner : d.firstRun.kindManager}
                        </button>
                      ))}
                    </div>
                  </div>
                  {state === "failed" && (
                    <p role="alert" className="text-xs font-semibold text-red-700">
                      {errorText}
                    </p>
                  )}
                  <Button type="submit" className="w-full" disabled={state === "working" || spaceName.trim() === ""}>
                    {state === "working" ? d.firstRun.creating : d.firstRun.createSubmit}
                  </Button>
                </motion.form>
              ) : (
                <motion.div key="cta" {...reveal} className="mt-5">
                  <Button className="w-full" onClick={() => setCreating(true)}>
                    {d.firstRun.createCta}
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>

            <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-ink-soft">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5" aria-hidden>
                <rect x="5" y="11" width="14" height="9" rx="2" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
              {d.firstRun.createPrivate}
            </p>
          </div>

          {/* -------------------------------- join -------------------------------- */}
          <div className="flex h-full flex-col rounded-2xl border border-sand-200 bg-white p-7 text-center shadow-sm">
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-sand-100 text-ink-soft">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7" aria-hidden>
                <path d="M15 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M8.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM17 8a3 3 0 1 0 5 2.2M22 19v-.8a3.8 3.8 0 0 0-2.6-3.6" />
              </svg>
            </span>
            <h2 className="mt-5 font-display text-xl font-bold text-ink">{d.firstRun.joinTitle}</h2>
            <p className="mx-auto mt-2 max-w-xs flex-1 text-sm leading-relaxed text-ink-soft">{d.firstRun.joinBody}</p>

            <AnimatePresence initial={false} mode="wait">
              {joining ? (
                <motion.div key="how" {...reveal} className="mt-5 overflow-hidden">
                  <p className="rounded-xl border border-sand-200 bg-sand-50 px-4 py-3 text-left text-xs leading-relaxed text-ink-soft">
                    {d.firstRun.joinHow}
                  </p>
                </motion.div>
              ) : (
                <motion.div key="cta" {...reveal} className="mt-5">
                  <Button variant="secondary" className="w-full" onClick={() => setJoining(true)}>
                    {d.firstRun.joinCta}
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>

            <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-ink-soft">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3 4 6v6c0 4.4 3.4 8.2 8 9 4.6-.8 8-4.6 8-9V6ZM9 12l2 2 4-4" />
              </svg>
              {d.firstRun.joinSecure}
            </p>
          </div>

          {/* ----------------------------- feature panel ----------------------------- */}
          <aside className="rounded-2xl border border-sand-200 bg-gradient-to-b from-white to-sand-50 p-6">
            <h2 className="text-balance font-display text-lg font-bold leading-snug text-ink">
              {d.firstRun.featTitle}
            </h2>
            <ul className="mt-4">
              {features.map((f, i) => (
                <li key={f.t} className="flex gap-3 border-b border-sand-100 py-3.5 last:border-0">
                  <FeatureIcon path={FEATURE_ICONS[i]} />
                  <div>
                    <p className="text-sm font-semibold text-ink">{f.t}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">{f.b}</p>
                  </div>
                </li>
              ))}
            </ul>
          </aside>
        </div>

        {/* -------------------------------- help bar -------------------------------- */}
        <div className="mt-8 flex flex-wrap items-center gap-4 rounded-2xl border border-sand-200 bg-white px-6 py-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-sand-100 text-ink-soft">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
              <path d="M4 13a8 8 0 0 1 16 0M3 15.5A2.5 2.5 0 0 1 5.5 13H6v5h-.5A2.5 2.5 0 0 1 3 15.5ZM21 15.5A2.5 2.5 0 0 0 18.5 13H18v5h.5a2.5 2.5 0 0 0 2.5-2.5ZM18 18v.5a2.5 2.5 0 0 1-2.5 2.5H13" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">{d.firstRun.helpTitle}</p>
            <p className="text-xs text-ink-soft">{d.firstRun.helpBody}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={MORADA_URL}
              className="tactile rounded-xl border border-brand-200 bg-white px-4 py-2 text-sm font-semibold text-brand-700 hover:border-brand-300"
            >
              {d.firstRun.helpCenter}
            </a>
            <a
              href="mailto:contact@morada.lu"
              className="tactile rounded-xl border border-sand-200 bg-white px-4 py-2 text-sm font-semibold text-ink-soft hover:border-brand-200 hover:text-brand-700"
            >
              {d.firstRun.helpContact}
            </a>
          </div>
        </div>

        <p className="mt-8 text-center text-xs text-ink-soft/80">{d.firstRun.footer}</p>
      </main>
    </div>
  );
}
