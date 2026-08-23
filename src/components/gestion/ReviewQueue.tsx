"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

export interface ReviewRow {
  id: string;
  counterparty: string;
  amountLabel: string;
  remittance: string;
  dateLabel: string;
  explain: string;
}

/**
 * The matching review queue as a live client island: confirming a row
 * resolves it in place (with the IBAN-binding side effect named), ignoring
 * removes it — the keyboard-first queue the product promises.
 */
export function ReviewQueue({
  rows,
  labels,
}: {
  rows: ReviewRow[];
  labels: { match: string; ignore: string; matched: string; ignored: string };
}) {
  const [state, setState] = useState<Record<string, "open" | "matched" | "ignored">>(
    Object.fromEntries(rows.map((r) => [r.id, "open"])),
  );
  const reduced = useReducedMotion();

  return (
    <ul className="space-y-3">
      <AnimatePresence initial={false}>
        {rows.map((t) => {
          const s = state[t.id];
          return (
            <motion.li
              key={t.id}
              layout={!reduced}
              initial={false}
              exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
              className={
                "rounded-xl border p-3.5 " +
                (s === "open"
                  ? "border-amber-200 bg-amber-50/50"
                  : s === "matched"
                    ? "border-emerald-200 bg-emerald-50/60"
                    : "border-sand-200 bg-sand-50/60")
              }
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">
                    {t.counterparty} — <span className="tabular-nums">{t.amountLabel}</span>
                  </p>
                  <p className="text-xs text-ink-soft">« {t.remittance} » · {t.dateLabel}</p>
                </div>
                {s === "open" ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setState((v) => ({ ...v, [t.id]: "matched" }))}
                      className="tactile rounded-xl bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
                    >
                      {labels.match}
                    </button>
                    <button
                      onClick={() => setState((v) => ({ ...v, [t.id]: "ignored" }))}
                      className="tactile rounded-xl border border-sand-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink-soft hover:border-brand-300 hover:text-brand-700"
                    >
                      {labels.ignore}
                    </button>
                  </div>
                ) : (
                  <p role="status" className={"text-xs font-semibold " + (s === "matched" ? "text-emerald-800" : "text-ink-soft")}>
                    {s === "matched" ? labels.matched : labels.ignored}
                  </p>
                )}
              </div>
              {s === "open" && <p className="mt-2 text-xs leading-relaxed text-ink-soft">{t.explain}</p>}
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}
