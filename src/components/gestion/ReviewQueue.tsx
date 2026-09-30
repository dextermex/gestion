"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Button, Select } from "@/components/pro/ui";
import { Icon } from "@/components/pro/icons";
import { fmt } from "@/lib/i18n/config";

export interface ReviewCandidate {
  leaseId: string;
  label: string;
  /** The engine's fuzzy score for this lease, 0 to 1. */
  score: number;
}

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
  candidates: ReviewCandidate[];
}

export interface LeaseOption {
  id: string;
  label: string;
}

export interface ReviewLabels {
  assign: string;
  pick: string;
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

export type RowState = { status: "open" | "busy" | "matched" | "ignored"; leaseId: string; learn: boolean; error: string | null; matchedLabel: string | null; bound: boolean };

/** The score from which the engine itself offers to remember a payer's IBAN (matching.ts, suggestBinding). */
export const BIND_SUGGESTION_SCORE = 0.45;

/**
 * Where a row starts: on the engine's best candidate when the engine would
 * bind on it itself, with the payer's IBAN offered for that lease; on
 * nothing otherwise, the weaker candidates only listed. The queue never
 * guesses a lease on the manager's behalf.
 */
export function initialRowState(row: Pick<ReviewRow, "candidates" | "payerIban">): RowState {
  const best = row.candidates[0];
  const strong = best !== undefined && best.score >= BIND_SUGGESTION_SCORE;
  return {
    status: "open",
    leaseId: strong ? best.leaseId : "",
    learn: strong && row.payerIban !== null,
    error: null,
    matchedLabel: null,
    bound: false,
  };
}

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
}: {
  rows: ReviewRow[];
  leases: LeaseOption[];
  labels: ReviewLabels;
  writable: boolean;
}) {
  const router = useRouter();
  const reduced = useReducedMotion();
  const [state, setState] = useState<Record<string, RowState>>(() => Object.fromEntries(rows.map((r) => [r.id, initialRowState(r)])));
  const patch = (id: string, next: Partial<RowState>) => setState((v) => ({ ...v, [id]: { ...v[id], ...next } }));
  const labelOf = (leaseId: string) => leases.find((l) => l.id === leaseId)?.label ?? leaseId;

  const act = async (row: ReviewRow, action: "match" | "ignore" | "reopen") => {
    const s = state[row.id];
    if (action === "match" && !s.leaseId) return;
    if (!writable) {
      // The sample cabinet plays the outcome and writes nothing.
      patch(row.id, { status: action === "reopen" ? "open" : action === "match" ? "matched" : "ignored", matchedLabel: labelOf(s.leaseId), bound: s.learn && row.payerIban !== null });
      return;
    }
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
    <ul className="crm-review">
      <AnimatePresence initial={false}>
        {rows.map((t) => {
          const s = state[t.id];
          const busy = s.status === "busy";
          const others = leases.filter((l) => !t.candidates.some((c) => c.leaseId === l.id));
          return (
            <motion.li
              key={t.id}
              layout={!reduced}
              initial={false}
              exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
              data-operation={t.id}
              className={"crm-review-row" + (s.status === "matched" ? " is-matched" : s.status === "ignored" ? " is-ignored" : "")}
            >
              <span className="crm-symbol" aria-hidden>
                <Icon name={s.status === "matched" ? "check" : "euro"} size={22} />
              </span>
              <div className="crm-review-body">
                <div className="crm-review-head">
                  <div className="min-w-0">
                    <p className="crm-review-title">{t.counterparty}</p>
                    <p className="crm-review-sub">
                      {t.remittance} · {t.dateLabel}
                    </p>
                  </div>
                  <span className="crm-review-amount">{t.amountLabel}</span>
                </div>

                {s.status === "matched" && (
                  <p role="status" className="crm-review-status is-good">
                    {writable ? fmt(labels.matchedWith, { lease: s.matchedLabel ?? "" }) : labels.matched}
                    {s.bound && <span className="mt-1 block font-medium">{labels.boundNote}</span>}
                  </p>
                )}
                {s.status === "ignored" && (
                  <p role="status" className="crm-review-status">
                    {labels.ignored}{" "}
                    <button type="button" onClick={() => act(t, "reopen")} className="font-semibold text-brand-700 hover:underline max-sm:inline-flex max-sm:min-h-10 max-sm:items-center">
                      {labels.reopen}
                    </button>
                  </p>
                )}

                {(s.status === "open" || busy) && (
                  <>
                    {t.explain && <p className="crm-review-explain">{t.explain}</p>}
                    {leases.length === 0 ? (
                      <p className="crm-review-status">{labels.noLeases}</p>
                    ) : (
                      <div className="crm-review-decision">
                        {/* A definite width for the select: Safari sizes a select by its widest
                            option when its container's width is not settled, and these options
                            name a lot, a tenant and a score. A grid track of minmax(0, 1fr)
                            settles it, whatever the options say. */}
                        <label className="grid min-w-0 grid-cols-[minmax(0,1fr)]">
                          <span className="mb-2 block text-sm font-medium text-ink">{labels.assign}</span>
                          <Select value={s.leaseId} onChange={(e) => patch(t.id, { leaseId: e.target.value })} disabled={busy} aria-label={labels.assign} className="min-w-0 max-w-full">
                            <option value="">{labels.pick}</option>
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
                        <div className="crm-review-actions">
                          <Button type="button" onClick={() => act(t, "match")} disabled={!s.leaseId} loading={busy}>
                            {labels.match}
                          </Button>
                          <Button type="button" variant="ghost" onClick={() => act(t, "ignore")} disabled={busy}>
                            {labels.ignore}
                          </Button>
                        </div>
                      </div>
                    )}
                    {t.payerIban && leases.length > 0 && (
                      <label className="crm-review-bind">
                        <input type="checkbox" checked={s.learn} onChange={(e) => patch(t.id, { learn: e.target.checked })} disabled={busy} />
                        <span>{fmt(labels.bind, { iban: t.payerIban })}</span>
                      </label>
                    )}
                    {s.error && (
                      <p role="alert" className="mt-3 text-sm font-semibold text-red-700">
                        {s.error}
                      </p>
                    )}
                  </>
                )}
              </div>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}
