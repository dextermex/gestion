import { Panel } from "@/components/gestion/bits";
import { MetaBadge } from "@/components/gestion/bits";
import { getDemo } from "@/lib/demo";
import { tenantPersona } from "@/lib/demo/tenant";
import { euros, formatDate, leaseTypeMeta } from "@/lib/types";
import { getI18n } from "@/lib/i18n";

export default async function TenantLeasePage() {
  const { locale, d } = await getI18n();
  const demo = await getDemo();
  const { lease, unit } = tenantPersona(demo);
  const typeMeta = leaseTypeMeta(d);

  const rows: Array<[string, React.ReactNode]> = [
    [d.tenant.leaseType, <MetaBadge key="t" meta={typeMeta[lease.type]} />],
    [d.tenant.leaseStart, formatDate(lease.startDate, locale)],
    [d.tenant.leaseRent, euros(lease.rentCents, locale)],
    [d.tenant.leaseCharges, euros(lease.chargesCents, locale)],
    [d.tenant.leaseDeposit, `${lease.depositMonths} ${d.common.months} · ${d.status.depositForm[lease.depositForm]}`],
    [
      d.tenant.leaseRef,
      <code key="rf" className="rounded-md bg-sand-50 px-2 py-1 text-[11px] font-semibold tabular-nums text-brand-800">
        {lease.rfReference}
      </code>,
    ],
  ];

  const myDocs = demo.DOCUMENTS.filter((doc) => doc.relatedLabel === unit.label);

  return (
    <div className="space-y-5">
      <Panel title={d.tenant.leaseTitle}>
        <dl className="divide-y divide-sand-100">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-4 py-2.5">
              <dt className="text-sm text-ink-soft">{label}</dt>
              <dd className="text-sm font-semibold text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </Panel>

      <Panel title={d.tenant.docsTitle}>
        <ul className="divide-y divide-sand-100">
          {myDocs.map((doc) => (
            <li key={doc.id} className="flex items-center gap-3 py-2.5">
              <svg className="h-4 w-4 shrink-0 text-ink-soft" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14 3v5h5M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
              </svg>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{doc.name}</p>
                <p className="text-xs text-ink-soft">{formatDate(doc.createdAt, locale)}</p>
              </div>
            </li>
          ))}
          <li className="flex items-center gap-3 py-2.5">
            <svg className="h-4 w-4 shrink-0 text-ink-soft" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M14 3v5h5M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
            </svg>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">{d.tenant.docReceipts}</p>
              <p className="text-xs text-ink-soft">{d.tenant.docReceiptsSub}</p>
            </div>
          </li>
        </ul>
      </Panel>
    </div>
  );
}
