"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Select } from "@/components/pro/ui";
import { fmt } from "@/lib/i18n/config";

export interface ReviewRow {
  id: string;
  counterparty: string;
  amountLabel: string;
  remittance: string;
  dateLabel: string;
  explain: string;
  /** The payer's IBAN, when the bank gave one: what a binding would remember. */
  payerIban: string | null;
  /** The leases the engine scored closest, best first, already labelled. */
  candidates: Array<{ leaseId: string; label: string }>;
}

export interface LeaseOption {
  id: string;
  label: string;
}

export interface ReviewLabels {
  assign: string;
  suggested: string;
  others: string;
  bind: string;
  match: string;
  ignore: string;
  matched: string;
  matchedWith: string;
  boundNote: string;
  ignored: string;
  reopen: string;
  failed: string;
  already: string;
  noLeases: string;
}

type RowState = { status: "open" | "busy" | "matched" | "ignored"; leaseId: string; learn: boolean; error: string | null; matchedLabel: string | null; bound: boolean };

/**
 * The matching review queue, live: each row names the lease the operation
 * belongs to (the engine's suggestions first, every live lease after), says
 * whether to remember the payer's IBAN for that lease, and one keystroke
 * makes it a payment with its allocations. On a real account the decision
 * is written and the page re-reads it; on a sample cabinet the row plays
 * the outcome and nothing is written.
 */
export function ReviewQueue({
  rows,
  leases,
  labels,
  writable,
  sampleNote,
}: {
  rows: ReviewRow[];
  leases: LeaseOption[];
  labels: ReviewLabels;
  writable: boolean;
  sampleNote: string | null;
}) {
  const router = useRouter();
  const reduced = useReducedMotion();
  const [state, setState] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(rows.map((r) => [r.id, { status: "open", leaseId: r.candidates[0]?.leaseId ?? leases[0]?.id ?? "", learn: r.payerIban !== null, error: null, matchedLabel: null, bound: false }])),
  );
  const patch = (id: string, next: Partial<RowState>) => setState((v) => ({ ...v, [id]: { ...v[id], ...next } }));
  const labelOf = (leaseId: string) => leases.find((l) => l.id === leaseId)?.label ?? leaseId;

  const act = async (row: ReviewRow, action: "match" | "ignore" | "reopen") => {
    const s = state[row.id];
    if (!writable) {
      // The sample cabinet plays the outcome and writes nothing.
      patch(row.id, { status: action === "reopen" ? "open" : action === "match" ? "matched" : "ignored", matchedLabel: labelOf(s.leaseId), bound: s.learn && row.payerIban !== null });
      return;
    }
    if (action === "match" && !s.leaseId) return;
    patch(row.id, { status: "busy", error: null });
    try {
      const res = await fetch(`/api/banque/operations/${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "match" ? { action, leaseId: s.leaseId, learnIban: s.learn && row.payerIban !== null } : { action }),
      });
      if (res.status === 401) {
        window.location.assign("/connexion?next=/app/banque");
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string; bound?: boolean };
      if (!res.ok) {
        patch(row.id, { status: action === "reopen" ? "ignored" : "open", error: body.error === "already_matched" ? labels.already : labels.failed });
        return;
      }
      patch(row.id, { status: action === "reopen" ? "open" : action === "match" ? "matched" : "ignored", matchedLabel: labelOf(s.leaseId), bound: body.bound === true });
      router.refresh();
    } catch {
      patch(row.id, { status: action === "reopen" ? "ignored" : "open", error: labels.failed });
    }
  };

  return (
    <ul className="space-y-3">
      <AnimatePresence initial={false}>
        {rows.map((t) => {
          const s = state[t.id];
          const others = leases.filter((l) => !t.candidates.some((c) => c.leaseId === l.id));
          return (
            <motion.li
              key={t.id}
              layout={!reduced}
              initial={false}
              exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
              data-operation={t.id}
              className={
                "rounded-xl border p-3.5 " +
                (s.status === "matched" ? "border-emerald-200 bg-emerald-50/60" : s.status === "ignored" ? "border-sand-200 bg-sand-50/60" : "border-amber-200 bg-amber-50/50")
              }
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">
                    {t.counterparty} · <span className="tabular-nums">{t.amountLabel}</span>
                  </p>
                  <p className="text-xs text-ink-soft">« {t.remittance} » · {t.dateLabel}</p>
                </div>
                {s.status === "matched" && (
                  <p role="status" className="text-xs font-semibold text-emerald-800">
                    {writable ? fmt(labels.matchedWith, { lease: s.matchedLabel ?? "" }) : labels.matched}
                    {s.bound && <span className="mt-0.5 block font-medium text-emerald-800/90">{labels.boundNote}</span>}
                  </p>
                )}
                {s.status === "ignored" && (
                  <p role="status" className="text-xs font-semibold text-ink-soft">
                    {labels.ignored}{" "}
                    <button type="button" onClick={() => act(t, "reopen")} className="ml-1 font-semibold text-brand-700 hover:underline max-sm:inline-flex max-sm:min-h-10 max-sm:items-center">
                      {labels.reopen}
                    </button>
                  </p>
                )}
              </div>

              {(s.status === "open" || s.status === "busy") && (
                <>
                  {t.explain && <p className="mt-2 text-xs leading-relaxed text-ink-soft">{t.explain}</p>}
                  {leases.length === 0 ? (
                    <p className="mt-2 text-xs font-semibold text-ink-soft">{labels.noLeases}</p>
                  ) : (
                    <div className="mt-3 flex flex-col gap-2.5 sm:flex-row sm:items-end sm:gap-3">
                      {/* A definite width for the select: Safari sizes a select by its widest
                          option when its container's width is not settled, and these options
                          name a lot, a tenant and a score. A grid track of minmax(0, 1fr)
                          settles it, whatever the options say. */}
                      <label className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)] sm:flex-1">
                        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{labels.assign}</span>
                        <Select value={s.leaseId} onChange={(e) => patch(t.id, { leaseId: e.target.value })} disabled={s.status === "busy"} aria-label={labels.assign} className="max-w-full min-w-0">
                          {t.candidates.length > 0 && (
                            <optgroup label={labels.suggested}>
                              {t.candidates.map((c) => (
                                <option key={c.leaseId} value={c.leaseId}>
                                  {c.label}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          {others.length > 0 && (
                            <optgroup label={t.candidates.length > 0 ? labels.others : labels.assign}>
                              {others.map((l) => (
                                <option key={l.id} value={l.id}>
                                  {l.label}
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </Select>
                      </label>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={() => act(t, "match")}
                          disabled={s.status === "busy" || !s.leaseId}
                          aria-busy={s.status === "busy" || undefined}
                          className="tactile inline-flex min-h-10 items-center rounded-xl bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50 max-sm:min-h-11"
                        >
                          {labels.match}
                        </button>
                        <button
                          type="button"
                          onClick={() => act(t, "ignore")}
                          disabled={s.status === "busy"}
                          className="tactile inline-flex min-h-10 items-center rounded-xl border border-sand-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink-soft hover:border-brand-300 hover:text-brand-700 disabled:opacity-50 max-sm:min-h-11"
                        >
                          {labels.ignore}
                        </button>
                      </div>
                    </div>
                  )}
                  {t.payerIban && leases.length > 0 && (
                    <label className="mt-2.5 flex min-h-10 cursor-pointer items-center gap-2 text-xs text-ink">
                      <input type="checkbox" checked={s.learn} onChange={(e) => patch(t.id, { learn: e.target.checked })} disabled={s.status === "busy"} className="h-4 w-4 rounded border-sand-300 text-brand-600 focus:ring-brand-200" />
                      <span>{fmt(labels.bind, { iban: t.payerIban })}</span>
                    </label>
                  )}
                  {s.error && (
                    <p role="alert" className="mt-2 text-xs font-semibold text-red-700">
                      {s.error}
                    </p>
                  )}
                  {!writable && sampleNote && <p className="mt-2 text-[11px] text-amber-900/80">{sampleNote}</p>}
                </>
              )}
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}
