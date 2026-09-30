"use client";

import { useMemo, useState } from "react";
import { Badge, EmptyState, Select } from "@/components/pro/ui";
import { Icon } from "@/components/pro/icons";
import { LegalNote, MetaBadge, Panel } from "@/components/gestion/bits";
import { ReviewQueue, type LeaseOption, type ReviewLabels, type ReviewRow } from "@/components/gestion/ReviewQueue";
import type { BankTxStatus, Meta } from "@/lib/types";
import { BANK_VIEWS, type BankView } from "@/lib/banking/views";
import { fmt } from "@/lib/i18n/config";

/**
 * The operations workspace: the review queue first (the decisions waiting on
 * the manager), then every operation behind one segmented filter, a search
 * and a period. Everything here is presentation; amounts, dates and match
 * verdicts arrive precomputed and already translated.
 */

export interface TxRow {
  id: string;
  status: BankTxStatus;
  counterparty: string;
  remittance: string;
  explain: string;
  amountLabel: string;
  negative: boolean;
  bookedAt: string; // ISO, for the period filter
  dateLabel: string;
  tier: Meta | null;
  statusMeta: Meta;
}

export type { LeaseOption, ReviewRow } from "@/components/gestion/ReviewQueue";

type View = BankView;
type Period = "all" | "1m" | "3m" | "6m";

export interface WorkspaceLabels {
  views: Record<View, string>;
  search: string;
  period: string;
  periods: Record<Period, string>;
  reset: string;
  reviewTitle: string;
  reviewCount: string;
  reviewLegal: string;
  opsTitle: string;
  emptyTitle: string;
  emptyBody: string;
  filteredTitle: string;
  filteredBody: string;
  colOperation: string;
  colDate: string;
  colStatus: string;
  colAmount: string;
  countShown: string;
  review: ReviewLabels;
}

function monthsBack(todayISO: string, months: number): string {
  const [y, m, day] = todayISO.split("-").map(Number);
  const total = y * 12 + (m - 1) - months;
  const yy = Math.floor(total / 12);
  const mm = total - yy * 12 + 1;
  return `${yy}-${String(mm).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export default function BankWorkspace({
  labels,
  rows,
  review,
  leases,
  todayISO,
  sample,
  sampleNote,
  initialView = "all",
}: {
  labels: WorkspaceLabels;
  rows: TxRow[];
  review: ReviewRow[];
  /** The live leases a reviewed operation can be assigned to. */
  leases: LeaseOption[];
  todayISO: string;
  /** On sample data decisions are played, not written. */
  sample?: boolean;
  sampleNote?: string | null;
  /** The filter the page opened on (`?vue=`), so a link can land on one view. */
  initialView?: View;
}) {
  const [view, setView] = useState<View>(initialView);
  const [q, setQ] = useState("");
  const [period, setPeriod] = useState<Period>("all");

  const counts: Record<View, number> = useMemo(
    () => ({
      all: rows.length,
      review: rows.filter((t) => t.status === "review").length,
      auto: rows.filter((t) => t.status === "auto" || t.status === "manual").length,
      ignored: rows.filter((t) => t.status === "ignored").length,
    }),
    [rows],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const since = period === "all" ? null : monthsBack(todayISO, period === "1m" ? 1 : period === "3m" ? 3 : 6);
    return rows.filter((t) => {
      if (view === "review" && t.status !== "review") return false;
      if (view === "auto" && t.status !== "auto" && t.status !== "manual") return false;
      if (view === "ignored" && t.status !== "ignored") return false;
      if (since && t.bookedAt < since) return false;
      if (needle && !`${t.counterparty} ${t.remittance}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [rows, view, q, period, todayISO]);

  const isFiltering = view !== "all" || q.trim() !== "" || period !== "all";
  const reset = () => {
    setView("all");
    setQ("");
    setPeriod("all");
  };

  return (
    <div className="crm-bank-main">
      {/* The decisions waiting on the manager come first, under "all" and "to check". */}
      {review.length > 0 && (view === "all" || view === "review") && (
        <section id="a-verifier" className="scroll-mt-24">
          <Panel title={labels.reviewTitle} action={<Badge className="bg-brand-50 text-brand-700">{fmt(labels.reviewCount, { n: review.length })}</Badge>}>
            {sample && sampleNote && <p className="-mt-2 mb-4 text-sm text-ink-soft">{sampleNote}</p>}
            <ReviewQueue rows={review} leases={leases} labels={labels.review} writable={!sample} />
            <LegalNote>{labels.reviewLegal}</LegalNote>
          </Panel>
        </section>
      )}

      <Panel
        title={labels.opsTitle}
        action={
          rows.length > 0 ? (
            <div className="crm-segmented" role="group" aria-label={labels.opsTitle}>
              {BANK_VIEWS.map((v) => (
                <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v}>
                  {labels.views[v]}
                  <span>{counts[v]}</span>
                </button>
              ))}
            </div>
          ) : undefined
        }
      >
        {rows.length === 0 ? (
          <EmptyState icon="bank" title={labels.emptyTitle} body={labels.emptyBody} />
        ) : (
          <>
            <div className="crm-bank-toolbar">
              <div className="crm-bank-search">
                <Icon name="search" size={16} />
                <input
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={labels.search}
                  aria-label={labels.search}
                  enterKeyHint="search"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="ui-field crm-filter w-full rounded-full border border-sand-300 bg-white py-2 pl-10 pr-4 text-sm text-ink placeholder:text-ink-soft max-sm:min-h-11 max-sm:text-base focus:outline-none"
                />
              </div>
              <Select value={period} onChange={(e) => setPeriod(e.target.value as Period)} aria-label={labels.period} className="crm-filter crm-bank-period">
                {(Object.keys(labels.periods) as Period[]).map((p) => (
                  <option key={p} value={p}>
                    {labels.periods[p]}
                  </option>
                ))}
              </Select>
              {isFiltering && (
                <button type="button" onClick={reset} className="inline-flex min-h-10 items-center text-sm font-semibold text-brand-700 hover:underline">
                  {labels.reset}
                </button>
              )}
            </div>

            {filtered.length === 0 ? (
              <EmptyState
                title={labels.filteredTitle}
                body={labels.filteredBody}
                action={
                  <button type="button" onClick={reset} className="inline-flex min-h-10 items-center text-sm font-semibold text-brand-700 hover:underline">
                    {labels.reset}
                  </button>
                }
              />
            ) : (
              <>
                <div className="table-scroll crm-bank-table">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-sand-100 text-left text-ink-soft">
                        <th className="px-4 py-2.5 font-semibold">{labels.colOperation}</th>
                        <th className="px-3 py-2.5 font-semibold max-sm:hidden">{labels.colDate}</th>
                        <th className="px-3 py-2.5 font-semibold max-sm:hidden">{labels.colStatus}</th>
                        <th className="px-4 py-2.5 text-right font-semibold">{labels.colAmount}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((t) => (
                        <tr key={t.id} className="border-b border-sand-100 last:border-0">
                          <td className="max-w-lg px-4 py-3">
                            <p className="font-semibold text-ink">{t.counterparty}</p>
                            <p className="mt-0.5 text-xs leading-relaxed text-ink-soft" title={t.explain || undefined}>
                              {t.remittance}
                              <span className="sm:hidden"> · {t.dateLabel}</span>
                            </p>
                            <div className="mt-2 sm:hidden">
                              <MetaBadge meta={t.statusMeta} />
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 tabular-nums text-ink-soft max-sm:hidden">{t.dateLabel}</td>
                          <td className="px-3 py-3 max-sm:hidden">
                            <MetaBadge meta={t.statusMeta} />
                            {t.tier && <span className="mt-1 block text-xs text-ink-soft">{t.tier.label}</span>}
                          </td>
                          <td className={"whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums " + (t.negative ? "text-ink-soft" : "text-ink")}>{t.amountLabel}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="crm-bank-count">{fmt(labels.countShown, { shown: filtered.length, total: rows.length })}</p>
              </>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}
