import Link from "next/link";
import { Card, PageHeader } from "@/components/pro/ui";
import { MetaBadge } from "@/components/gestion/bits";
import { LEASES, leaseTenantNames, leaseUnitLabel } from "@/lib/demo/data";
import { LEASE_STATUS_META, LEASE_TYPE_META, euros, formatDate } from "@/lib/types";

export default function BauxPage() {
  const active = LEASES.filter((l) => l.status !== "ended");
  return (
    <div>
      <PageHeader
        title="Baux"
        subtitle="Chaque bail porte son pack de règles : habitation ou commercial, plafonds de garantie, calendrier de préavis, régime TVA — rien n'est cosmétique."
      />

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sand-100 bg-sand-50/60 text-left text-[11px] uppercase tracking-wide text-ink-soft/70">
                <th className="px-4 py-2.5 font-semibold">Logement · Locataires</th>
                <th className="px-3 py-2.5 font-semibold">Type</th>
                <th className="px-3 py-2.5 text-right font-semibold">Loyer</th>
                <th className="px-3 py-2.5 text-right font-semibold">Charges</th>
                <th className="px-3 py-2.5 text-right font-semibold">Début</th>
                <th className="px-3 py-2.5 text-right font-semibold">Garantie</th>
                <th className="px-4 py-2.5 text-right font-semibold">Statut</th>
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
                      {l.colocation && " · colocation (pacte signé)"}
                    </p>
                  </td>
                  <td className="px-3 py-3">
                    <MetaBadge meta={LEASE_TYPE_META[l.type]} />
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-ink">{euros(l.rentCents)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-ink-soft">{euros(l.chargesCents)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-ink-soft">{formatDate(l.startDate)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-ink-soft">{l.depositMonths} mois</td>
                  <td className="px-4 py-3 text-right">
                    <MetaBadge meta={LEASE_STATUS_META[l.status]} />
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
