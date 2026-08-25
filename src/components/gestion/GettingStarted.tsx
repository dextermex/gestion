"use client";

/**
 * "Getting started" checklist for fresh accounts (immocloud-style): progress
 * bar, one row per setup task linking into its module, Help, and Ignore-all.
 * Purely client-side: ticks and dismissal live in localStorage, so the demo
 * shows the not-yet-onboarded state until the visitor works through it.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/pro/ui";
import { fmt } from "@/lib/i18n/config";

const STORE_KEY = "morada_gestion_getting_started_v1";

export interface GettingStartedTask {
  id: string;
  href: string;
  label: string;
  sub: string;
}

export interface GettingStartedStrings {
  title: string;
  subtitle: string;
  progress: string;
  help: string;
  ignoreAll: string;
  doneAria: string;
}

interface Stored {
  done: string[];
  dismissed: boolean;
}

function load(): Stored {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Stored>;
      return { done: Array.isArray(parsed.done) ? parsed.done : [], dismissed: Boolean(parsed.dismissed) };
    }
  } catch {
    /* first visit or blocked storage */
  }
  return { done: [], dismissed: false };
}

export function GettingStarted({
  tasks,
  strings,
}: {
  tasks: GettingStartedTask[];
  strings: GettingStartedStrings;
}) {
  const [state, setState] = useState<Stored | null>(null);

  useEffect(() => {
    setState(load());
  }, []);

  if (!state || state.dismissed) return null;
  const doneCount = tasks.filter((t) => state.done.includes(t.id)).length;
  if (doneCount === tasks.length) return null;
  const pct = Math.round((doneCount / tasks.length) * 100);

  const save = (next: Stored) => {
    setState(next);
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable: state stays in memory */
    }
  };

  const toggle = (id: string) =>
    save({
      ...state,
      done: state.done.includes(id) ? state.done.filter((x) => x !== id) : [...state.done, id],
    });

  return (
    <Card className="mb-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-ink">{strings.title}</h2>
          <p className="mt-0.5 text-sm text-ink-soft">{strings.subtitle}</p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <a href="mailto:support@morada.lu" className="font-semibold text-brand-700 hover:underline">
            {strings.help}
          </a>
          <button
            type="button"
            onClick={() => save({ ...state, dismissed: true })}
            className="font-semibold text-ink-soft hover:text-ink hover:underline"
          >
            {strings.ignoreAll}
          </button>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-sand-100">
          <div
            className="h-full rounded-full bg-brand-500 transition-all duration-500"
            style={{ width: `${Math.max(pct, 2)}%` }}
          />
        </div>
        <p className="shrink-0 text-xs font-semibold tabular-nums text-ink-soft">
          {fmt(strings.progress, { done: doneCount, total: tasks.length })} · {pct}%
        </p>
      </div>

      <ul className="mt-4 grid grid-cols-1 gap-x-6 md:grid-cols-2">
        {tasks.map((t) => {
          const done = state.done.includes(t.id);
          return (
            <li key={t.id} className="flex items-start gap-3 border-b border-sand-100 py-2.5 last:border-b-0 md:[&:nth-last-child(2)]:border-b-0">
              <button
                type="button"
                aria-label={fmt(strings.doneAria, { task: t.label })}
                aria-pressed={done}
                onClick={() => toggle(t.id)}
                className={
                  "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition " +
                  (done
                    ? "border-brand-500 bg-brand-500 text-white"
                    : "border-sand-300 bg-white text-transparent hover:border-brand-400")
                }
              >
                <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" aria-hidden>
                  <path d="M2.5 6.5 5 9l4.5-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <Link href={t.href} className="group min-w-0 flex-1">
                <p
                  className={
                    "text-sm font-semibold group-hover:text-brand-700 " +
                    (done ? "text-ink-soft line-through" : "text-ink")
                  }
                >
                  {t.label}
                </p>
                <p className="text-xs text-ink-soft">{t.sub}</p>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
