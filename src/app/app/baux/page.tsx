import Link from "next/link";
import { Card, PageHeader } from "@/components/pro/ui";
import { MetaBadge } from "@/components/gestion/bits";
import { LEASES, leaseTenantNames, leaseUnitLabel } from "@/lib/demo/data";
import { euros, formatDate, leaseStatusMeta, leaseTypeMeta } from "@/lib/types";
import { getI18n } from "@/lib/i18n";

export default async function BauxPage() {
  const { locale, d } = await getI18n();
  const statusMeta = leaseStatusMeta(d);
  const typeMeta = leaseTypeMeta(d);
  const active = LEASES.filter((l) => l.status !== "ended");
  return (
    <div>
      <PageHeader title={d.baux.title} subtitle={d.baux.subtitle} />

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sand-100 bg-sand-50/60 text-left text-[11px] uppercase tracking-wide text-ink-soft">
                <th className="px-4 py-2.5 font-semibold">{d.baux.colUnit}</th>
                <th className="px-3 py-2.5 font-semibold">{d.baux.colType}</th>
                <th className="px-3 py-2.5 text-right font-semibold">{d.baux.colRent}</th>
                <th className="px-3 py-2.5 text-right font-semibold">{d.baux.colCharges}</th>
                <th className="px-3 py-2.5 text-right font-semibold">{d.baux.colStart}</th>
                <th className="px-3 py-2.5 text-right font-semibold">{d.baux.colDeposit}</th>
                <th className="px-4 py-2.5 text-right font-semibold">{d.baux.colStatus}</th>
              </tr>
            </thead>
            <tbody>
              {active.map((l) => (
                <tr key={l.id} className="border-b border-sand-50 last:border-0 hover:bg-sand-50/50">
                  <td className="px-4 py-3">
                    <Link href={`/app/baux/${l.id}`} className="font-semibold text-ink hover:text-brand-700">
                      {leaseUnitLabel(l)}
                    </Link>
                    <p className="text-xs text-ink-soft">
                      {leaseTenantNames(l).join(", ")}
                      {l.colocation && ` · ${d.baux.colocationSigned}`}
                    </p>
                  </td>
                  <td className="px-3 py-3">
                    <MetaBadge meta={typeMeta[l.type]} />
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-ink">{euros(l.rentCents, locale)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-ink-soft">{euros(l.chargesCents, locale)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-ink-soft">{formatDate(l.startDate, locale)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-ink-soft">
                    {l.depositMonths} {d.common.months}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <MetaBadge meta={statusMeta[l.status]} />
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
