import Link from "next/link";

/**
 * Rents by month as bars: the pale bar is what was expected, the teal one
 * inside it what came in. A month that has not begun has no bar at all, so
 * the chart never ends on a fall that is only the calendar. Each month is
 * the way to that month; the exact amounts stay in a table for a reader
 * that does not see the bars.
 */
export interface MonthBar {
  month: string;
  label: string;
  expectedCents: number;
  collectedCents: number;
  future: boolean;
  href: string | null;
  expected: string;
  collected: string;
}

export default function MonthBars({ bars, selected, legendCollected, legendExpected, monthHeading, ariaLabel }: { bars: MonthBar[]; selected: string; legendCollected: string; legendExpected: string; monthHeading: string; ariaLabel: string }) {
  const max = Math.max(1, ...bars.map((b) => Math.max(b.expectedCents, b.collectedCents)));
  return (
    <div className="rounded-3xl border border-sand-200/80 bg-white/75 px-4 pb-4 pt-5 sm:px-6">
      <div className="mb-5 flex items-center gap-5 text-[13px] font-medium text-ink-soft">
        <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-brand-700" />{legendCollected}</span>
        <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-brand-100 ring-1 ring-brand-200" />{legendExpected}</span>
      </div>
      <div className="grid grid-flow-col auto-cols-fr items-end gap-2 sm:gap-4" role="img" aria-label={ariaLabel}>
        {bars.map((b) => {
          const on = b.month === selected;
          const column = (
            <>
              <span className="flex h-40 items-end justify-center">
                {b.future || b.expectedCents === 0 ? (
                  <span className="h-px w-full max-w-14 border-t border-dashed border-sand-300" />
                ) : (
                  <span className={"relative w-full max-w-14 overflow-hidden rounded-xl bg-brand-100 " + (on ? "ring-2 ring-brand-700 ring-offset-2 ring-offset-white" : "")} style={{ height: `${Math.max(6, (b.expectedCents / max) * 100)}%` }}>
                    <span className="absolute inset-x-0 bottom-0 rounded-t-md bg-brand-700" style={{ height: `${Math.min(100, (b.collectedCents / Math.max(1, b.expectedCents)) * 100)}%` }} />
                  </span>
                )}
              </span>
              <span className={"mt-2 block truncate text-center text-xs capitalize " + (on ? "font-bold text-ink" : b.future ? "text-ink-soft/60" : "font-medium text-ink-soft")}>{b.label}</span>
            </>
          );
          return b.href ? (
            <Link key={b.month} href={b.href} scroll={false} aria-current={on ? "true" : undefined} className="tactile block min-w-0 rounded-xl pb-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">{column}</Link>
          ) : (
            <span key={b.month} className="block min-w-0 pb-1">{column}</span>
          );
        })}
      </div>
      <table className="sr-only">
        <thead><tr><th>{monthHeading}</th><th>{legendCollected}</th><th>{legendExpected}</th></tr></thead>
        <tbody>{bars.filter((b) => !b.future).map((b) => (<tr key={b.month}><td>{b.label}</td><td>{b.collected}</td><td>{b.expected}</td></tr>))}</tbody>
      </table>
    </div>
  );
}
