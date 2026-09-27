import type { CashflowMonth } from "@/domain/finance/cashflow";
import { euros, formatMonth } from "@/lib/types";
import type { Locale } from "@/lib/i18n/config";

/** Two adjacent series make expected and received amounts independently visible.
 * Exact amounts are also available as a native, keyboard-accessible table. */
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
  const maximum = Math.max(1, ...data.flatMap((month) => [month.expectedCents, month.collectedCents]));
  const step = Math.pow(10, Math.floor(Math.log10(maximum)));
  const max = Math.ceil(maximum / step) * step;
  const axis = new Intl.NumberFormat(locale === "lu" ? "fr-LU" : locale, { notation: "compact", maximumFractionDigits: 0, style: "currency", currency: "EUR" });

  return <div className="crm-cashflow">
    <div className="mb-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-ink-soft">
      <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-brand-600" aria-hidden />{legendCollected}</span>
      <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm border border-brand-600 bg-brand-100" aria-hidden />{legendExpected}</span>
    </div>
    <div className="crm-chart" role="img" aria-label={ariaLabel}>
      <div className="crm-chart-plot" aria-hidden>
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => <div key={fraction} className="crm-chart-gridline" style={{ bottom: `${fraction * 100}%` }}>
          <span>{axis.format(max * fraction / 100)}</span>
        </div>)}
        <div className="crm-chart-columns" style={{ gridTemplateColumns: `repeat(${Math.max(1, data.length)}, minmax(0, 1fr))` }}>
          {data.map((month) => <div key={month.month} className="crm-chart-column" title={`${formatMonth(month.month, locale)}: ${legendCollected} ${euros(month.collectedCents, locale)}, ${legendExpected} ${euros(month.expectedCents, locale)}`}>
            <div className="crm-chart-bars">
              <div className="crm-chart-received" style={{ height: `${Math.max(0, month.collectedCents / max * 100)}%` }} />
              <div className="crm-chart-expected" style={{ height: `${Math.max(0, month.expectedCents / max * 100)}%` }} />
            </div>
            <span className={`crm-chart-month ${month.month === currentMonth ? "font-semibold text-ink" : "text-ink-soft"}`}>
              {new Intl.DateTimeFormat(locale === "lu" ? "fr-LU" : locale, { month: "short", timeZone: "UTC" }).format(new Date(`${month.month}-15T12:00:00Z`))}
            </span>
          </div>)}
        </div>
      </div>
    </div>
    <details className="mt-3 border-t border-sand-100 pt-3">
      <summary className="w-fit cursor-pointer rounded text-xs font-medium text-brand-700">{detailsLabel}</summary>
      <div className="table-scroll mt-3">
        <table className="w-full text-left text-xs tabular-nums">
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
