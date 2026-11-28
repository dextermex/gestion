"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { Dict } from "@/lib/i18n/fr";
import { fmt, plural, type Locale } from "@/lib/i18n/config";
import { TEAM_EMAIL } from "@/lib/constants";
import { SETUP_STEPS, setupProgress, type SetupHrefs, type SetupProgress, type SetupStep, type ShellSetup } from "@/lib/gestion/setup";

/**
 * The setup card, the iPhone app's "Terminez votre installation" (its
 * `SetupCard` and `setup-steps` sheet in one): a ring with the count, the
 * next open step as the card's one button, the five steps with their state.
 * A done step is ticked; a step that waits for another (a lease needs a
 * property, an invitation needs a lease) is greyed and says what it waits
 * for. Every tick is a fact the workspace's records attest
 * (`src/lib/gestion/setup.ts`), so the card moves on by itself as data
 * arrives. While a step is open a thin light travels round its border.
 *
 * Two placements. On Accueil (`home`) it is the first thing on the page
 * while a step is open, and once all five are done it says so there, with
 * Masquer, until hidden for good. On every other page (`float`) it is the
 * compact control it always was, folded by default so it never covers a
 * form, stepping aside while a phone's keyboard is up; a complete setup is
 * not repeated there.
 *
 * The browser remembers only browser matters (localStorage
 * `morada_getting_started`): whether the floating card is folded, and
 * whether the finished card was hidden. An unfinished setup cannot be
 * hidden: the space keeps asking for the next step until it is done.
 */

const STORE = "morada_getting_started";

interface Stored {
  collapsed: boolean;
  /** The finished card was hidden: for good, on this browser. */
  doneHidden: boolean;
}

function load(): Stored {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) {
      const v = JSON.parse(raw) as Partial<Stored>;
      return { collapsed: v.collapsed !== false, doneHidden: v.doneHidden === true };
    }
  } catch {
    // Private mode or blocked storage: start fresh each visit.
  }
  return { collapsed: true, doneHidden: false };
}

function save(s: Stored) {
  try {
    localStorage.setItem(STORE, JSON.stringify(s));
  } catch {
    // Best effort only.
  }
}

const ICON_PATHS: Record<SetupStep, string> = {
  account: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0",
  property: "M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1Z",
  lease: "M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm7 0v5h5M9 13h6M9 17h6",
  bank: "M3 10h18M5 10v8m4.67-8v8m4.66-8v8M19 10v8M3 21h18M12 3l9 5H3Z",
  invite: "M10 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 11-5.7M19 14v6m-3-3h6",
};

function StepIcon({ step, done }: { step: SetupStep; done: boolean }) {
  return (
    <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={done ? 3 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={done ? "m5 13 4 4L19 7" : ICON_PATHS[step]} />
    </svg>
  );
}

function Ring({ count, total, complete, size = 52, label }: { count: number; total: number; complete: boolean; size?: number; label: string }) {
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-sand-200)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={complete ? "var(--color-emerald-600, #059669)" : "var(--color-brand-600)"}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - count / total)}
          className="setup-ring-value"
        />
      </svg>
      <span className="absolute text-xs font-bold tabular-nums text-ink" aria-hidden>{`${count}/${total}`}</span>
    </span>
  );
}

function StepRow({ d, step, p, href }: { d: Dict; step: SetupStep; p: SetupProgress; href: string | null }) {
  const k = d.onboarding;
  const done = p.done[step];
  const locked = p.locked[step];
  const isNext = p.next === step;
  const sub = done ? k.stepDone : locked && (step === "lease" || step === "invite") ? k.stepsNeeds[step] : k.stepsSub[step];
  const body = (
    <>
      <span
        className={
          "flex h-9 w-9 shrink-0 items-center justify-center " +
          (done ? "rounded-full bg-emerald-600 text-white" : isNext ? "rounded-xl bg-brand-600 text-white" : "rounded-xl bg-brand-50 text-brand-700")
        }
      >
        <StepIcon step={step} done={done} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={"block truncate text-sm font-semibold " + (done ? "text-ink-soft" : "text-ink")}>{k.steps[step]}</span>
        <span className="block truncate text-xs text-ink-soft">{sub}</span>
      </span>
    </>
  );
  // An open step that can be done now leads to where it is done; the others are statements.
  if (!done && !locked && href) {
    return (
      <li data-setup-step={step} className="setup-step">
        <Link href={href} className="group flex min-h-14 items-center gap-3 rounded-xl px-2 py-2 hover:bg-sand-50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-600">
          {body}
          <svg className="h-4 w-4 shrink-0 text-ink-soft group-hover:text-brand-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
          </svg>
        </Link>
      </li>
    );
  }
  return (
    <li data-setup-step={step} data-state={done ? "done" : locked ? "waiting" : "open"} className={"setup-step flex min-h-14 items-center gap-3 px-2 py-2" + (locked ? " opacity-55" : "")}>
      {body}
    </li>
  );
}

/** The card's content: the ring and the title, the five steps, the next one as the button. */
export function SetupPanel({ d, locale, p, hrefs, onHide }: { d: Dict; locale: Locale; p: SetupProgress; hrefs: SetupHrefs; onHide?: () => void }) {
  const k = d.onboarding;
  const left = p.total - p.count;
  const href = (s: SetupStep): string | null => (s === "account" ? null : hrefs[s]);
  return (
    <>
      <div className="flex items-center gap-3">
        <Ring count={p.count} total={p.total} complete={p.complete} label={fmt(k.count, { count: p.count, total: p.total })} />
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-base font-bold text-ink">{p.complete ? k.done : k.title}</h2>
          <p className="text-sm text-ink-soft">{p.complete ? k.doneSub : fmt(plural(locale, left, k.stepsLeft.one, k.stepsLeft.many), { n: left })}</p>
        </div>
      </div>
      {!p.complete && (
        <>
          <p className="mt-3 text-sm text-ink-soft max-sm:hidden">{k.guideSub}</p>
          <ul className="mt-3 grid grid-cols-1 gap-0.5">
            {SETUP_STEPS.map((s) => (
              <StepRow key={s} d={d} step={s} p={p} href={href(s)} />
            ))}
          </ul>
        </>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        {p.next && p.next !== "account" ? (
          <Link
            href={hrefs[p.next]}
            data-setup-next
            className="tactile inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 max-sm:w-full"
          >
            {fmt(k.next, { step: k.steps[p.next] })}
          </Link>
        ) : onHide ? (
          <button type="button" onClick={onHide} className="tactile inline-flex min-h-10 items-center rounded-full border border-sand-200 bg-white px-4 text-sm font-semibold text-ink hover:text-brand-700">
            {k.hide}
          </button>
        ) : null}
        {!p.complete && (
          // The team's address: there is no help centre to send anyone to.
          <a href={`mailto:${TEAM_EMAIL}`} className="inline-flex min-h-10 items-center text-xs font-semibold text-brand-700 hover:underline">
            {k.help}
          </a>
        )}
      </div>
    </>
  );
}

export default function GettingStarted({ d, locale, setup, placement }: { d: Dict; locale: Locale; setup: ShellSetup; placement: "home" | "float" }) {
  const [state, setState] = useState<Stored | null>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    setState(load());
  }, []);
  const p = setupProgress(setup.facts);
  const update = (next: Stored) => {
    setState(next);
    save(next);
  };

  if (placement === "home") {
    // Rendered on the server too, so the card holds its place before the browser's memory is read.
    if (p.complete && (state === null || state.doneHidden)) return null;
    return (
      <section data-setup-card aria-label={p.complete ? d.onboarding.done : d.onboarding.title} className={"setup-card mb-6 rounded-[1.25rem] bg-white p-4 shadow-[0_1px_2px_rgb(6_34_41/0.06),0_8px_24px_-12px_rgb(6_34_41/0.18)] sm:p-5" + (p.complete ? "" : " setup-glow")}>
        <SetupPanel d={d} locale={locale} p={p} hrefs={setup.hrefs} onHide={state ? () => update({ ...state, doneHidden: true }) : undefined} />
      </section>
    );
  }

  if (!state || p.complete) return null;
  return (
    // Steps aside while a conversation fills a phone's screen (Messages sets the attribute on the document),
    // and while a phone's keyboard is up, rather than floating over the field being typed in.
    <div className="crm-onboarding fixed bottom-[max(1rem,var(--safe-bottom))] right-[max(1rem,var(--safe-right))] z-40 print:hidden typing:hidden max-lg:[html[data-phone-chat]_&]:hidden">
      <AnimatePresence initial={false} mode="wait">
        {state.collapsed ? (
          <motion.button
            key="pill"
            type="button"
            onClick={() => update({ ...state, collapsed: false })}
            className="setup-glow tactile flex min-h-11 items-center gap-2 rounded-full bg-white py-1.5 pl-1.5 pr-4 text-sm font-semibold text-ink shadow-pop"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
            transition={{ duration: reduced ? 0.15 : 0.3, ease: [0.22, 1, 0.36, 1] }}
            aria-expanded={false}
          >
            <Ring count={p.count} total={p.total} complete={false} size={32} label={fmt(d.onboarding.count, { count: p.count, total: p.total })} />
            {d.onboarding.title}
          </motion.button>
        ) : (
          <motion.section
            key="card"
            aria-label={d.onboarding.title}
            className="setup-glow w-[26rem] max-w-[calc(100vw-2rem)] rounded-[1.25rem] bg-white p-4 shadow-pop"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
            transition={{ duration: reduced ? 0.15 : 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="max-h-[60dvh] overflow-y-auto">
              <SetupPanel d={d} locale={locale} p={p} hrefs={setup.hrefs} />
            </div>
            <button
              type="button"
              onClick={() => update({ ...state, collapsed: true })}
              className="absolute right-2 top-2 flex h-10 w-10 items-center justify-center rounded-lg text-ink-soft hover:bg-sand-100 hover:text-ink"
              aria-label={d.onboarding.collapse}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
              </svg>
            </button>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}
