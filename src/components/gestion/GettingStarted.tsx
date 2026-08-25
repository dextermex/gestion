"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { Dict } from "@/lib/i18n/fr";

/**
 * The new-account journey (the immocloud "getting started" card): a floating
 * checklist with progress, one row per setup step, each linking into the
 * matching module. State is a per-browser convenience (localStorage): checked
 * steps, collapsed, or dismissed for good.
 */

const STORE = "morada_getting_started";

interface Stored {
  done: string[];
  collapsed: boolean;
  hidden: boolean;
}

function load(): Stored {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) return { done: [], collapsed: false, hidden: false, ...JSON.parse(raw) };
  } catch {
    // Private mode or blocked storage: start fresh each visit.
  }
  return { done: [], collapsed: false, hidden: false };
}

function save(s: Stored) {
  try {
    localStorage.setItem(STORE, JSON.stringify(s));
  } catch {
    // Best effort only.
  }
}

export default function GettingStarted({ d }: { d: Dict }) {
  const [state, setState] = useState<Stored | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    setState(load());
  }, []);

  if (!state || state.hidden) return null;

  const steps = [
    { id: "profile", href: "/app/conformite", title: d.onboarding.stepProfile, sub: d.onboarding.stepProfileSub },
    { id: "property", href: "/app/biens/nouveau", title: d.onboarding.stepProperty, sub: d.onboarding.stepPropertySub },
    { id: "contact", href: "/app/contacts", title: d.onboarding.stepContact, sub: d.onboarding.stepContactSub },
    { id: "lease", href: "/app/baux", title: d.onboarding.stepLease, sub: d.onboarding.stepLeaseSub },
    { id: "bank", href: "/app/banque", title: d.onboarding.stepBank, sub: d.onboarding.stepBankSub },
    { id: "rent", href: "/app/loyers", title: d.onboarding.stepRent, sub: d.onboarding.stepRentSub },
  ];
  const pct = Math.round((100 * state.done.length) / steps.length);

  const update = (next: Stored) => {
    setState(next);
    save(next);
  };
  const toggle = (id: string) =>
    update({
      ...state,
      done: state.done.includes(id) ? state.done.filter((x) => x !== id) : [...state.done, id],
    });

  return (
    <div className="fixed bottom-4 left-4 z-40 max-sm:right-4 print:hidden">
      <AnimatePresence initial={false} mode="wait">
        {state.collapsed ? (
          <motion.button
            key="pill"
            onClick={() => update({ ...state, collapsed: false })}
            className="tactile flex items-center gap-2 rounded-full border border-sand-200 bg-white py-2 pl-3 pr-4 text-sm font-semibold text-ink shadow-pop"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
            transition={reduced ? { duration: 0.15 } : { type: "spring", stiffness: 380, damping: 32 }}
            aria-label={d.onboarding.reopen}
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-[10px] font-bold text-white tabular-nums">
              {pct}%
            </span>
            {d.onboarding.title}
          </motion.button>
        ) : (
          <motion.section
            key="card"
            aria-label={d.onboarding.title}
            className="w-[26rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-sand-200 bg-white shadow-pop"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
            transition={reduced ? { duration: 0.15 } : { type: "spring", stiffness: 340, damping: 32 }}
          >
            <div className="flex items-center gap-3 bg-brand-700 px-4 py-3 text-white">
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-sm font-bold">{d.onboarding.title}</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/25">
                    <div
                      className="h-full rounded-full bg-white transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-[11px] font-bold tabular-nums">{pct}%</span>
                </div>
              </div>
              <button
                onClick={() => update({ ...state, collapsed: true })}
                className="-mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white/80 hover:bg-white/10 hover:text-white"
                aria-label={d.onboarding.collapse}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
                </svg>
              </button>
            </div>

            <ul className="max-h-[50dvh] divide-y divide-sand-100 overflow-y-auto">
              {steps.map((s) => {
                const done = state.done.includes(s.id);
                return (
                  <li key={s.id} className="flex items-center gap-3 px-4 py-2.5">
                    <button
                      onClick={() => toggle(s.id)}
                      role="checkbox"
                      aria-checked={done}
                      aria-label={done ? d.onboarding.stepDone : d.onboarding.stepTodo}
                      className={
                        "tactile flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors " +
                        (done ? "border-brand-600 bg-brand-600 text-white" : "border-sand-300 bg-white text-transparent hover:border-brand-400")
                      }
                    >
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3" aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
                      </svg>
                    </button>
                    <Link href={s.href} className="group min-w-0 flex-1">
                      <p
                        className={
                          "truncate text-sm font-semibold group-hover:text-brand-700 " +
                          (done ? "text-ink-soft line-through decoration-sand-300" : "text-ink")
                        }
                      >
                        {s.title}
                      </p>
                      {!done && <p className="truncate text-xs text-ink-soft">{s.sub}</p>}
                    </Link>
                    <svg
                      className="h-4 w-4 shrink-0 text-ink-soft"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-hidden
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
                    </svg>
                  </li>
                );
              })}
            </ul>

            <div className="flex items-center justify-between border-t border-sand-100 px-4 py-2.5">
              <a href="https://morada.lu" className="text-xs font-semibold text-brand-700 hover:underline">
                {d.onboarding.help}
              </a>
              <button
                onClick={() => update({ ...state, hidden: true })}
                className="text-xs font-medium text-ink-soft hover:text-ink"
              >
                {d.onboarding.ignore}
              </button>
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}
