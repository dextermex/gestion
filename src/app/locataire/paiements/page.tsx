import { Card, PageHeader } from "@/components/pro/ui";
import { DemoAction } from "@/components/gestion/DemoAction";
import { MetaBadge } from "@/components/gestion/bits";
import { getDemo } from "@/lib/demo";
import { tenantPersona } from "@/lib/demo/tenant";
import TenantEmpty from "@/components/gestion/TenantEmpty";
import { euros, formatDate, formatMonth, rentStatusMeta } from "@/lib/types";
import { getI18n } from "@/lib/i18n";

export default async function TenantPaymentsPage() {
  const { locale, d } = await getI18n();
  const demo = await getDemo();
  const persona = tenantPersona(demo);
  if (!persona) return <TenantEmpty d={d} />;
  const { lease } = persona;
  const rentMeta = rentStatusMeta(d);
  const account = demo.BANK_ACCOUNTS[0];

  const periods = demo.RENT_PERIODS.filter((rp) => rp.leaseId === lease.id).sort((a, b) =>
    a.period < b.period ? 1 : -1,
  );

  return (
    <div>
      <PageHeader title={d.tenant.payTitle} subtitle={d.tenant.paySub} />

      <Card className="mb-5 p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{d.tenant.payTo}</p>
            <p className="mt-1 text-sm font-semibold text-ink">{account.holderNameVerbatim}</p>
            <p className="text-sm tabular-nums text-ink-soft">{account.iban}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{d.tenant.payRef}</p>
            <code className="mt-1 inline-block rounded-md bg-sand-50 px-2 py-1 text-xs font-semibold tabular-nums text-brand-800">
              {lease.rfReference}
            </code>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sand-100 bg-sand-50/60 text-left text-[11px] uppercase tracking-wide text-ink-soft">
                <th className="px-4 py-2.5 font-semibold">{d.tenant.payMonth}</th>
                <th className="px-3 py-2.5 text-right font-semibold">{d.tenant.payAmount}</th>
                <th className="px-3 py-2.5 text-right font-semibold">{d.tenant.payStatus}</th>
                <th className="px-4 py-2.5 text-right font-semibold">{d.tenant.payReceipt}</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((rp) => (
                <tr key={rp.id} className="border-b border-sand-50 last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-ink">{formatMonth(rp.period, locale)}</p>
                    <p className="text-xs text-ink-soft">{formatDate(rp.dueDate, locale)}</p>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-ink">{euros(rp.totalCents, locale)}</td>
                  <td className="px-3 py-3 text-right">
                    <MetaBadge meta={rentMeta[rp.status]} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {rp.status === "paid" ? (
                      <DemoAction
                        label={d.tenant.receiptDownload}
                        doneMessage={d.tenant.receiptDone}
                        variant="secondary"
                      />
                    ) : (
                      <span className="text-xs text-ink-soft">{d.common.none}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
