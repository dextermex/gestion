"use client";

import { useMemo, useState } from "react";
import { Card, EmptyState } from "@/components/pro/ui";
import { LegalNote, MetaBadge, Panel } from "@/components/gestion/bits";
import { ReviewQueue } from "@/components/gestion/ReviewQueue";
import { DemoAction } from "@/components/gestion/DemoAction";
import type { BankTxStatus, Meta } from "@/lib/types";
import { fmt } from "@/lib/i18n/config";
import type { Dict } from "@/lib/i18n/fr";

/**
 * The transactions workspace: status pills with counts, free-text search, a
 * period filter and honest empty states, over rows the server has already
 * formatted. Everything here is presentation; amounts, dates and match
 * verdicts arrive precomputed.
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

export interface ReviewRow {
  id: string;
  counterparty: string;
  amountLabel: string;
  remittance: string;
  dateLabel: string;
  explain: string;
}

type View = "all" | "review" | "auto" | "ignored";
type Period = "all" | "1m" | "3m" | "6m";

function monthsBack(todayISO: string, months: number): string {
  const [y, m, day] = todayISO.split("-").map(Number);
  const total = y * 12 + (m - 1) - months;
  const yy = Math.floor(total / 12);
  const mm = total - yy * 12 + 1;
  return `${yy}-${String(mm).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export default function BankWorkspace({
  d,
  rows,
  review,
  todayISO,
}: {
  d: Dict;
  rows: TxRow[];
  review: ReviewRow[];
  todayISO: string;
}) {
  const [view, setView] = useState<View>("all");
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

  const views: Array<{ id: View; label: string }> = [
    { id: "all", label: d.banque.viewAll },
    { id: "review", label: d.banque.viewReview },
    { id: "auto", label: d.banque.viewAuto },
    { id: "ignored", label: d.banque.viewIgnored },
  ];

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
    <div className="min-w-0">
      {/* Status tiles with live counts (the immocloud banking grammar):
          count above, view below, selection as a border, never a fill. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {views.map((v) => (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            aria-pressed={view === v.id}
            className={
              "tactile rounded-2xl border bg-white p-3.5 text-left shadow-sm transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 " +
              (view === v.id
                ? "border-brand-400 ring-1 ring-brand-200"
                : "border-sand-200 hover:border-brand-200 hover:shadow-md")
            }
          >
            <p className="font-display text-xl font-bold tabular-nums text-ink">{counts[v.id]}</p>
            <p className="mt-0.5 text-xs font-semibold text-ink-soft">{v.label}</p>
          </button>
        ))}
      </div>

      {/* Search + period + reset, then the one action on the right */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <svg
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden
          >
            <circle cx="11" cy="11" r="7" />
            <path strokeLinecap="round" d="m20 20-3.2-3.2" />
          </svg>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={d.banque.searchPlaceholder}
            aria-label={d.banque.searchPlaceholder}
            className="w-full rounded-xl border border-sand-200 bg-white py-2 pl-9 pr-3 text-sm text-ink placeholder:text-ink-soft/70 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
          />
        </div>
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value as Period)}
          aria-label={d.banque.periodLabel}
          className="rounded-xl border border-sand-200 bg-white px-3 py-2 text-sm font-medium text-ink-soft focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
        >
          <option value="all">{d.banque.periodAll}</option>
          <option value="1m">{d.banque.period1m}</option>
          <option value="3m">{d.banque.period3m}</option>
          <option value="6m">{d.banque.period6m}</option>
        </select>
        {isFiltering && (
          <button onClick={reset} className="text-sm font-semibold text-brand-700 hover:underline">
            {d.common.resetFilters}
          </button>
        )}
        <div className="ml-auto">
          <DemoAction label={d.banque.autoAssign} doneMessage={d.banque.autoAssignDone} variant="secondary" />
        </div>
      </div>

      {/* The actionable suggestions live at the top of "all" and "review" */}
      {review.length > 0 && (view === "all" || view === "review") && (
        <Panel title={d.banque.reviewTitle} className="mt-4">
          <ReviewQueue
            rows={review}
            labels={{
              match: d.banque.reviewMatch,
              ignore: d.banque.reviewIgnore,
              matched: d.banque.reviewMatched,
              ignored: d.banque.reviewIgnored,
            }}
          />
          <LegalNote>{d.banque.reviewLegal}</LegalNote>
        </Panel>
      )}

      <div className="mt-4">
        {rows.length === 0 ? (
          <EmptyState title={d.banque.emptyTitle} body={d.banque.emptyNoAccount} />
        ) : filtered.length === 0 ? (
          <EmptyState
            title={d.banque.filteredTitle}
            body={d.banque.filteredBody}
            action={
              <button onClick={reset} className="text-sm font-semibold text-brand-700 hover:underline">
                {d.common.resetFilters}
              </button>
            }
          />
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-sand-100 bg-sand-50/60 text-left text-[11px] uppercase tracking-wide text-ink-soft">
                    <th className="px-4 py-2.5 font-semibold">{d.banque.colCounterparty}</th>
                    <th className="px-3 py-2.5 text-right font-semibold">{d.banque.colAmount}</th>
                    <th className="px-3 py-2.5 text-right font-semibold">{d.banque.colDate}</th>
                    <th className="px-3 py-2.5 text-right font-semibold">{d.banque.colTier}</th>
                    <th className="px-4 py-2.5 text-right font-semibold">{d.banque.colStatus}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t) => (
                    <tr key={t.id} className="border-b border-sand-50 last:border-0 hover:bg-sand-50/50">
                      <td className="max-w-md px-4 py-3">
                        <p className="font-semibold text-ink">{t.counterparty}</p>
                        <p className="truncate text-xs text-ink-soft" title={t.explain}>
                          « {t.remittance} »
                        </p>
                      </td>
                      <td className={"px-3 py-3 text-right tabular-nums " + (t.negative ? "text-ink-soft" : "text-ink")}>
                        {t.amountLabel}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-ink-soft">{t.dateLabel}</td>
                      <td className="px-3 py-3 text-right">
                        {t.tier ? <MetaBadge meta={t.tier} /> : <span className="text-xs text-ink-soft">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <MetaBadge meta={t.statusMeta} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-sand-100 bg-sand-50/40 px-4 py-2 text-right text-[11px] tabular-nums text-ink-soft">
              {fmt(d.banque.countShown, { shown: filtered.length, total: rows.length })}
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}
