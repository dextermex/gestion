import Link from "next/link";
import HubTabs from "@/components/gestion/HubTabs";
import { Card, EmptyState, PageHeader } from "@/components/pro/ui";
import { MetaBadge } from "@/components/gestion/bits";
import { ChipLink } from "@/components/gestion/filters";
import { getDemo } from "@/lib/demo";
import type { LeaseStatus } from "@/lib/types";
import { euros, formatDate, leaseStatusMeta, leaseTypeMeta } from "@/lib/types";
import { getI18n } from "@/lib/i18n";

const STATUS_PARAM: Record<string, LeaseStatus> = {
  actifs: "active",
  preavis: "notice",
  brouillons: "draft",
};

export default async function BauxPage({
  searchParams,
}: {
  searchParams: Promise<{ statut?: string }>;
}) {
  const params = await searchParams;
  const { locale, d } = await getI18n();
  const { LEASES, UNITS, leaseTenantNames, leaseUnitLabel } = await getDemo();
  const statusMeta = leaseStatusMeta(d);
  const typeMeta = leaseTypeMeta(d);

  const all = LEASES.filter((l) => l.status !== "ended");
  const statusFilter = STATUS_PARAM[params.statut ?? ""];
  const rows = statusFilter ? all.filter((l) => l.status === statusFilter) : all;

  const occupied = new Set(
    LEASES.filter((l) => l.status === "active" || l.status === "notice").map((l) => l.unitId),
  );
  const vacantUnits = UNITS.filter((u) => u.kind !== "parking" && !occupied.has(u.id)).length;

  const cards: Array<{ slug?: string; label: string; value: number }> = [
    { label: d.baux.cardAll, value: all.length },
    { slug: "actifs", label: d.baux.cardActive, value: all.filter((l) => l.status === "active").length },
    { slug: "preavis", label: d.baux.cardNotice, value: all.filter((l) => l.status === "notice").length },
    { slug: "brouillons", label: d.baux.cardDraft, value: all.filter((l) => l.status === "draft").length },
  ];

  return (
    <div>
      <HubTabs d={d} hub="patrimoine" active="/app/baux" />
      <PageHeader title={d.baux.title} subtitle={d.baux.subtitle} />

      {/* Status filters as compact pills (the banking-page grammar); the
          vacant-lots pill is a cross-link into Biens, set apart by a rule. */}
      <div className="no-scrollbar mb-5 flex gap-2 overflow-x-auto">
        {cards.map((c) => (
          <ChipLink
            key={c.label}
            href={c.slug ? `/app/baux?statut=${c.slug}` : "/app/baux"}
            active={(params.statut ?? "") === (c.slug ?? "")}
            count={c.value}
          >
            {c.label}
          </ChipLink>
        ))}
        <span className="my-1 w-px shrink-0 bg-sand-200" aria-hidden />
        <ChipLink href="/app/biens?occupation=vacants" count={vacantUnits}>
          {d.baux.cardVacant}
        </ChipLink>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={d.baux.emptyTitle}
          body={d.baux.emptyBody}
          action={
            <Link href="/app/baux" className="text-sm font-semibold text-brand-700 hover:underline">
              {d.common.resetFilters}
            </Link>
          }
        />
      ) : (
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
                {rows.map((l) => (
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
      )}
    </div>
  );
}
