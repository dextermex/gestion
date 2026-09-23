"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Badge, Card } from "@/components/pro/ui";
import { Icon } from "@/components/pro/icons";
import PropertyPhoto from "@/components/gestion/PropertyPhoto";
import type { PropertyKind } from "@/lib/gestion/portfolio";
import type { LotFamily } from "@/lib/gestion/building";

/**
 * The lots of a building, photograph first, the way Biens shows properties.
 * Each card says what an owner wants to know before opening the lot: who
 * lives there, what it brings in, whether this month's rent arrived. The
 * filters, the search and the grid or list choice are the viewer's own and
 * never leave the browser; every figure on a card was computed on the server
 * from the same rows the lot's sheet reads.
 */
export interface LotCardView {
  id: string;
  href: string;
  label: string;
  family: LotFamily;
  kindLabel: string;
  kind: PropertyKind;
  photoUrl: string | null;
  floor: string;
  areaLabel: string;
  bedroomsLabel: string;
  /** Everyone on the lease; empty when the lot is free. */
  tenant: string;
  /** "Dossier en préparation · 3/9 étapes" on a free lot with a dossier. */
  draftLabel: string;
  rentLabel: string;
  /** This month's rent status on a let lot; null when nothing is let. */
  status: { label: string; color: string } | null;
  /** A parking or a cellar is listed, never let: no vacancy badge. */
  lettable: boolean;
}

export interface LotGridLabels {
  title: string;
  filters: Record<"all" | LotFamily, string>;
  viewAria: string;
  viewGrid: string;
  viewList: string;
  search: string;
  noMatch: string;
  vacant: string;
  colLot: string;
  colTenant: string;
  colRent: string;
  colStatus: string;
  open: string;
}

const VIEW_KEY = "morada_lots_view";
const FAMILIES: readonly ("all" | LotFamily)[] = ["all", "apartments", "commercial", "parking", "other"];

/** Accent-insensitive, case-insensitive matching, so "Muller" finds "Müller". */
function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export default function LotGrid({
  lots,
  counts,
  labels,
  action,
}: {
  lots: LotCardView[];
  counts: Record<LotFamily, number>;
  labels: LotGridLabels;
  action?: React.ReactNode;
}) {
  const [family, setFamily] = useState<"all" | LotFamily>("all");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(VIEW_KEY);
      if (stored === "list" || stored === "grid") setView(stored);
    } catch {
      /* private browsing: the default stands */
    }
  }, []);
  const pick = (v: "grid" | "list") => {
    setView(v);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  };

  const shown = useMemo(() => {
    const q = fold(query.trim());
    return lots.filter((l) => (family === "all" || l.family === family) && (q === "" || fold(`${l.label} ${l.tenant} ${l.draftLabel}`).includes(q)));
  }, [lots, family, query]);
  const countOf = (f: "all" | LotFamily) => (f === "all" ? lots.length : counts[f]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="font-display text-xl font-bold tracking-tight text-ink">{labels.title}</h2>
        <div className="scroll-x flex gap-2">
          {FAMILIES.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFamily(f)}
              aria-pressed={family === f}
              className={
                "tactile flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm font-semibold transition " +
                (family === f ? "border-brand-400 bg-brand-50 text-brand-800 ring-1 ring-brand-200" : "border-sand-200 bg-white text-ink-soft hover:border-brand-200 hover:text-ink")
              }
            >
              {labels.filters[f]}
              <span className={"rounded-full px-1.5 text-[11px] tabular-nums " + (family === f ? "bg-brand-600 text-white" : "bg-sand-100 text-ink-soft")}>{countOf(f)}</span>
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="relative block">
            <span className="sr-only">{labels.search}</span>
            <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={labels.search}
              className="min-h-9 w-56 rounded-xl border border-sand-200 bg-white pl-9 pr-3 text-sm text-ink max-sm:min-h-11 max-sm:w-full max-sm:text-base placeholder:text-ink-soft focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 max-sm:w-full"
            />
          </label>
          <div role="group" aria-label={labels.viewAria} className="flex rounded-xl border border-sand-200 bg-sand-50 p-1">
            {(["grid", "list"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => pick(v)}
                aria-pressed={view === v}
                className={
                  "flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition " +
                  (view === v ? "bg-white text-brand-800 shadow-sm" : "text-ink-soft hover:text-ink")
                }
              >
                {v === "grid" ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5" aria-hidden>
                    <rect x="4" y="4" width="6" height="6" rx="1.5" /><rect x="14" y="4" width="6" height="6" rx="1.5" /><rect x="4" y="14" width="6" height="6" rx="1.5" /><rect x="14" y="14" width="6" height="6" rx="1.5" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-3.5 w-3.5" aria-hidden>
                    <path d="M5 7h14M5 12h14M5 17h14" />
                  </svg>
                )}
                {v === "grid" ? labels.viewGrid : labels.viewList}
              </button>
            ))}
          </div>
          {action}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-sand-200 bg-sand-50/50 px-6 py-12 text-center text-sm text-ink-soft">{labels.noMatch}</div>
      ) : view === "grid" ? (
        <ul className="stagger-rise grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {shown.map((l) => (
            <li key={l.id}>
              <Link href={l.href} className="group block h-full">
                <Card className="flex h-full flex-col overflow-hidden p-0 transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-translate-y-0.5 group-hover:border-brand-100 group-hover:shadow-md motion-reduce:group-hover:translate-y-0">
                  <div className="relative aspect-[16/10] w-full overflow-hidden">
                    <PropertyPhoto url={l.photoUrl} kind={l.kind} alt={l.label} rounded="" />
                    {l.status ? (
                      <Badge className={`absolute right-2.5 top-2.5 shadow-sm ${l.status.color}`}>{l.status.label}</Badge>
                    ) : l.lettable ? (
                      <Badge className="absolute right-2.5 top-2.5 bg-white text-ink shadow-sm">{labels.vacant}</Badge>
                    ) : null}
                  </div>
                  <div className="flex flex-1 flex-col p-4">
                    <h3 className="truncate font-display text-base font-bold text-ink group-hover:text-brand-700">{l.label}</h3>
                    <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft">
                      {l.floor && (
                        <span className="flex items-center gap-1">
                          <Icon name="trending-up" size={13} />
                          {l.floor}
                        </span>
                      )}
                      {l.areaLabel && (
                        <span className="flex items-center gap-1">
                          <Icon name="properties" size={13} />
                          {l.areaLabel}
                        </span>
                      )}
                      {l.bedroomsLabel && (
                        <span className="flex items-center gap-1">
                          <Icon name="key" size={13} />
                          {l.bedroomsLabel}
                        </span>
                      )}
                    </p>
                    <p className="mt-3 flex items-center gap-1.5 truncate text-sm text-ink">
                      <Icon name="user" size={14} className="shrink-0 text-ink-soft" />
                      <span className="truncate">{l.tenant || l.draftLabel || "—"}</span>
                    </p>
                    <p className="mt-1.5 flex items-center gap-1.5 text-sm tabular-nums text-ink">
                      <Icon name="calendar" size={14} className="shrink-0 text-ink-soft" />
                      {l.rentLabel || "—"}
                    </p>
                    <div className="mt-auto flex items-center justify-between pt-3">
                      <span className="rounded-lg bg-sand-100 px-2 py-0.5 text-[11px] font-semibold text-ink-soft">{l.kindLabel}</span>
                      <Icon name="chevron-right" size={16} className="text-ink-soft transition group-hover:translate-x-0.5 group-hover:text-brand-700" />
                    </div>
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Card className="overflow-hidden">
          <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_1.5rem] gap-3 border-b border-sand-100 bg-sand-50/60 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft sm:grid">
            <span>{labels.colLot}</span>
            <span>{labels.colTenant}</span>
            <span className="text-right">{labels.colRent}</span>
            <span className="text-right">{labels.colStatus}</span>
            <span />
          </div>
          <ul className="divide-y divide-sand-100">
            {shown.map((l) => (
              <li key={l.id}>
                <Link href={l.href} className="tactile grid grid-cols-[minmax(0,1fr)_1.5rem] items-center gap-3 px-4 py-3 transition hover:bg-sand-50 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_1.5rem]">
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="h-12 w-16 shrink-0 overflow-hidden rounded-lg">
                      <PropertyPhoto url={l.photoUrl} kind={l.kind} alt="" rounded="rounded-lg" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-ink">{l.label}</span>
                      <span className="block truncate text-xs text-ink-soft">{[l.kindLabel, l.floor, l.areaLabel, l.bedroomsLabel].filter(Boolean).join(" · ")}</span>
                    </span>
                  </span>
                  <span className="hidden min-w-0 truncate text-sm text-ink sm:block">{l.tenant || l.draftLabel || "—"}</span>
                  <span className="hidden text-right text-sm tabular-nums text-ink sm:block">{l.rentLabel || "—"}</span>
                  <span className="hidden justify-end sm:flex">
                    {l.status ? <Badge className={l.status.color}>{l.status.label}</Badge> : l.lettable ? <Badge className="bg-sand-100 text-ink-soft">{labels.vacant}</Badge> : null}
                  </span>
                  <Icon name="chevron-right" size={16} className="text-ink-soft" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
