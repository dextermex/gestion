import Link from "next/link";

/**
 * Money in and money out, month by month, as two bars side by side: green
 * for what came in, a soft red for what went out. A month that has not
 * begun has no bars. Each month is the way to that month; the amounts stay
 * in a table for a reader that does not see the bars.
 */
export interface FlowBar {
  month: string;
  label: string;
  inCents: number;
  outCents: number;
  future: boolean;
  href: string | null;
  inLabel: string;
  outLabel: string;
}

export function FlowBars({ bars, selected, legendIn, legendOut, monthHeading, ariaLabel }: { bars: FlowBar[]; selected: string; legendIn: string; legendOut: string; monthHeading: string; ariaLabel: string }) {
  const max = Math.max(1, ...bars.map((b) => Math.max(b.inCents, b.outCents)));
  const h = (cents: number) => (cents <= 0 ? "3px" : `${Math.max(5, (cents / max) * 100)}%`);
  return (
    <div className="rounded-3xl border border-sand-200/80 bg-white/75 px-4 pb-4 pt-5 sm:px-6">
      <div className="mb-5 flex items-center gap-5 text-[13px] font-medium text-ink-soft">
        <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-emerald-600" />{legendIn}</span>
        <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-rose-400" />{legendOut}</span>
      </div>
      <div className="grid grid-flow-col auto-cols-fr items-end gap-1 sm:gap-2.5" role="img" aria-label={ariaLabel}>
        {bars.map((b) => {
          const on = b.month === selected;
          const column = (
            <>
              <span className={"flex h-44 items-end justify-center gap-1 rounded-xl px-0.5 " + (on ? "bg-brand-50/70 ring-1 ring-brand-200" : "")}>
                {b.future ? (
                  <span className="mb-0 h-px w-full max-w-14 border-t border-dashed border-sand-300" />
                ) : (
                  <>
                    <span className="w-full max-w-10 rounded-t-xl bg-emerald-600" style={{ height: h(b.inCents) }} />
                    <span className="w-full max-w-10 rounded-t-xl bg-rose-400" style={{ height: h(b.outCents) }} />
                  </>
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
        <thead><tr><th>{monthHeading}</th><th>{legendIn}</th><th>{legendOut}</th></tr></thead>
        <tbody>{bars.filter((b) => !b.future).map((b) => (<tr key={b.month}><td>{b.label}</td><td>{b.inLabel}</td><td>{b.outLabel}</td></tr>))}</tbody>
      </table>
    </div>
  );
}

/** Shares of a total as labelled bars, the largest first: what the expenses are made of. */
export function ShareBars({ rows }: { rows: Array<{ key: string; label: string; amount: string; share: number }> }) {
  return (
    <ul className="space-y-3.5 rounded-3xl border border-sand-200/80 bg-white/75 px-4 py-5 sm:px-6">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-semibold text-ink">{r.label}</span>
            <span className="shrink-0 tabular-nums text-ink">{r.amount}</span>
          </div>
          <div className="mt-2 h-3.5 overflow-hidden rounded-full bg-sand-100">
            <div className="h-full rounded-full bg-brand-700" style={{ width: `${Math.max(2, Math.round(r.share * 100))}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** What each property brought in and cost over the period: two bars on one scale, the net beside the name. */
export function PropertyFlows({ rows, legendIn, legendOut }: { rows: Array<{ key: string; label: string; href: string; net: string; negative: boolean; inLabel: string; outLabel: string; inShare: number; outShare: number }>; legendIn: string; legendOut: string }) {
  const w = (share: number) => `${share <= 0 ? 0 : Math.max(1.5, Math.round(share * 100))}%`;
  return (
    <ul className="divide-y divide-sand-200/80 overflow-hidden rounded-3xl border border-sand-200/80 bg-white/75">
      {rows.map((r) => (
        <li key={r.key}>
          <Link href={r.href} className="block px-5 py-4 transition hover:bg-brand-50/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600">
            <span className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-[15px] font-semibold text-ink">{r.label}</span>
              <span className={"shrink-0 text-sm font-semibold tabular-nums " + (r.negative ? "text-red-700" : "text-ink")}>{r.net}</span>
            </span>
            <span className="mt-2.5 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5">
              <span className="h-3.5 overflow-hidden rounded-full bg-sand-100"><span className="block h-full rounded-full bg-emerald-600" style={{ width: w(r.inShare) }} /></span>
              <span className="text-right text-xs tabular-nums text-ink-soft"><span className="sr-only">{legendIn} </span>{r.inLabel}</span>
              <span className="h-3.5 overflow-hidden rounded-full bg-sand-100"><span className="block h-full rounded-full bg-rose-400" style={{ width: w(r.outShare) }} /></span>
              <span className="text-right text-xs tabular-nums text-ink-soft"><span className="sr-only">{legendOut} </span>{r.outLabel}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
