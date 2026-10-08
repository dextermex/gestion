"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { CashflowMonth } from "@/domain/finance/cashflow";
import { euros, formatMonth } from "@/lib/types";
import type { Locale } from "@/lib/i18n/config";

/** Monthly values are plotted directly, with a shared zero baseline. Month
 * controls work with pointer, touch and keyboard; the exact ledger stays below. */
export function CashflowChart({ data, locale, currentMonth, legendExpected, legendCollected, ariaLabel, detailsLabel, monthLabel }: {
  data: CashflowMonth[];
  locale: Locale;
  currentMonth?: string;
  legendExpected: string;
  legendCollected: string;
  ariaLabel: string;
  detailsLabel: string;
  monthLabel: string;
}) {
  const gradientId = useId().replace(/:/g, "");
  const initial = Math.max(0, data.findIndex((month) => month.month === currentMonth));
  const [selected, setSelected] = useState(initial);
  const activeIndex = Math.min(selected, Math.max(0, data.length - 1));
  // On a phone the months are a strip wider than the screen: the chosen one is brought into view.
  const months = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const strip = months.current;
    if (!strip || strip.scrollWidth <= strip.clientWidth) return;
    const button = strip.children[activeIndex] as HTMLElement | undefined;
    if (!button) return;
    strip.scrollTo({ left: Math.max(0, button.offsetLeft - (strip.clientWidth - button.offsetWidth) / 2) });
  }, [activeIndex]);
  const active = data[activeIndex];
  const maximum = Math.max(1, ...data.flatMap((month) => [month.expectedCents, month.collectedCents]));
  const magnitude = 10 ** Math.floor(Math.log10(maximum));
  const max = Math.ceil(maximum / magnitude) * magnitude;
  const axis = new Intl.NumberFormat(locale === "lu" ? "fr-LU" : locale, { notation: "compact", maximumFractionDigits: 0, style: "currency", currency: "EUR" });
  const x = (i: number) => data.length > 1 ? 24 + i / (data.length - 1) * 752 : 400;
  const y = (value: number) => 180 - Math.max(0, value) / max * 156;
  const line = (key: "expectedCents" | "collectedCents") => data.map((month, i) => `${i === 0 ? "M" : "L"}${x(i)} ${y(month[key])}`).join(" ");

  return <div className="crm-cashflow">
    {active && <div className="cashflow-summary" aria-live="polite" aria-atomic="true">
      <div><p className="cashflow-period">{formatMonth(active.month, locale)}</p><p className="cashflow-total">{euros(active.collectedCents, locale)}</p><span className="cashflow-key"><i aria-hidden />{legendCollected}</span></div>
      <div><p className="cashflow-expected-value">{euros(active.expectedCents, locale)}</p><span className="cashflow-key expected"><i aria-hidden />{legendExpected}</span></div>
    </div>}
    <div className="cashflow-graph" role="img" aria-label={ariaLabel}>
      <div className="cashflow-axis" aria-hidden>{[1, .5, 0].map(f => <span key={f}>{axis.format(max * f / 100)}</span>)}</div>
      <svg viewBox="0 0 800 200" preserveAspectRatio="none" aria-hidden>
        <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#6babcc" stopOpacity=".25"/><stop offset="1" stopColor="#6babcc" stopOpacity="0"/></linearGradient></defs>
        {[24, 102, 180].map(gridY => <line key={gridY} x1="0" x2="800" y1={gridY} y2={gridY} stroke="#dde7ef" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
        {data.length > 0 && <>
          <path d={`${line("collectedCents")} L${x(data.length - 1)} 180 L${x(0)} 180 Z`} fill={`url(#${gradientId})`} />
          <path d={line("expectedCents")} stroke="#7b8e9e" strokeWidth="2" strokeDasharray="6 6" vectorEffect="non-scaling-stroke" fill="none" />
          <path d={line("collectedCents")} stroke="#286786" strokeWidth="3" vectorEffect="non-scaling-stroke" strokeLinejoin="round" fill="none" />
        </>}
        {active && <line x1={x(activeIndex)} x2={x(activeIndex)} y1="12" y2="186" stroke="#91aaba" strokeWidth="1" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />}
      </svg>
      {active && <span className="cashflow-point" aria-hidden style={{ left: `calc(3.5rem + (100% - 3.5rem) * ${x(activeIndex) / 800})`, top: `${y(active.collectedCents) / 2}%` }} />}
    </div>
    <div className="cashflow-months" aria-label={monthLabel} ref={months}>
      {data.map((month, index) => <button key={month.month} type="button" aria-pressed={index === activeIndex} aria-label={formatMonth(month.month, locale)} onClick={() => setSelected(index)} onFocus={() => setSelected(index)}>
        {new Intl.DateTimeFormat(locale === "lu" ? "fr-LU" : locale, { month: "short", timeZone: "UTC" }).format(new Date(`${month.month}-15T12:00:00Z`))}
      </button>)}
    </div>
    <details className="cashflow-details">
      <summary>{detailsLabel}</summary>
      <div className="table-scroll mt-3">
        <table className="w-full text-left text-sm tabular-nums">
          <caption className="sr-only">{ariaLabel}</caption>
          <thead><tr><th scope="col">{monthLabel}</th><th scope="col" className="px-2 text-right">{legendCollected}</th><th scope="col" className="px-2 text-right">{legendExpected}</th></tr></thead>
          <tbody>{data.map((month) => <tr key={month.month} className="border-b border-sand-100">
            <th scope="row" className="font-medium">{formatMonth(month.month, locale)}</th>
            <td className="px-2 text-right">{euros(month.collectedCents, locale)}</td>
            <td className="px-2 text-right">{euros(month.expectedCents, locale)}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </details>
  </div>;
}
