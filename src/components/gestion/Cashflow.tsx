import type { CashflowMonth } from "@/domain/finance/cashflow";
import { eurosWhole, formatMonth } from "@/lib/types";
import type { Locale } from "@/lib/i18n/config";

/**
 * The one wide chart of the dashboard: expected vs collected per month.
 * Two series only — collected in brand teal, expected as the sand track
 * behind it (same column, progress-style), so the gap IS the open balance.
 * Server-rendered SVG; per-month <title> carries the exact figures.
 */

const W = 720;
const H = 190;
const PAD_X = 10;
const BOTTOM = 26;
const TOP = 14;

export function CashflowChart({
  data,
  locale,
  currentMonth,
  legendExpected,
  legendCollected,
  ariaLabel,
}: {
  data: CashflowMonth[];
  locale: Locale;
  /** The month being lived right now — the one bar whose figure reads loud. */
  currentMonth?: string;
  legendExpected: string;
  legendCollected: string;
  ariaLabel: string;
}) {
  const max = Math.max(1, ...data.map((m) => m.expectedCents)) * 1.05;
  const innerH = H - BOTTOM - TOP;
  const slot = (W - 2 * PAD_X) / data.length;
  const barW = Math.min(46, slot * 0.42);
  const y = (cents: number) => TOP + innerH * (1 - cents / max);

  const gridLines = [0.25, 0.5, 0.75, 1].map((f) => ({
    v: max * f,
    yy: y(max * f),
  }));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-ink-soft">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[4px] bg-brand-600" aria-hidden />
          {legendCollected}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[4px] border border-sand-300 bg-sand-100" aria-hidden />
          {legendExpected}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label={ariaLabel}>
        {gridLines.map((g) => (
          <g key={g.yy}>
            <line x1={PAD_X} x2={W - PAD_X} y1={g.yy} y2={g.yy} className="stroke-sand-100" strokeWidth="1" />
          </g>
        ))}
        {data.map((m, i) => {
          const cx = PAD_X + slot * i + slot / 2;
          const expH = TOP + innerH - y(m.expectedCents);
          const colH = TOP + innerH - y(m.collectedCents);
          return (
            <g key={m.month}>
              <title>
                {`${formatMonth(m.month, locale)} · ${legendExpected}: ${eurosWhole(m.expectedCents, locale)} · ${legendCollected}: ${eurosWhole(m.collectedCents, locale)}`}
              </title>
              {/* Expected track */}
              <rect
                x={cx - barW / 2}
                y={y(m.expectedCents)}
                width={barW}
                height={Math.max(0, expH)}
                rx="6"
                className="fill-sand-100 stroke-sand-200"
                strokeWidth="1"
              />
              {/* Collected fill */}
              {m.collectedCents > 0 && (
                <rect
                  x={cx - barW / 2}
                  y={y(m.collectedCents)}
                  width={barW}
                  height={Math.max(0, colH)}
                  rx="6"
                  className="fill-brand-600"
                />
              )}
              <text
                x={cx}
                y={H - 8}
                textAnchor="middle"
                className={
                  m.month === currentMonth
                    ? "fill-ink text-[11px] font-semibold"
                    : "fill-ink-soft text-[11px]"
                }
              >
                {formatMonth(m.month, locale).split(" ")[0]}
              </text>
              {/* One loud figure (the live month); the rest whisper, and an
                  empty bar says nothing — the tooltip keeps the exact values. */}
              {m.collectedCents > 0 && (
                <text
                  x={cx}
                  y={y(Math.max(m.expectedCents, m.collectedCents)) - 6}
                  textAnchor="middle"
                  className={
                    "tabular-nums " +
                    (m.month === currentMonth
                      ? "fill-ink text-[11px] font-semibold"
                      : "fill-ink-soft text-[10px] font-medium")
                  }
                >
                  {eurosWhole(m.collectedCents, locale)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
