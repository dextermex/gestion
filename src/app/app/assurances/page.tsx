import { Card, EmptyState, PageHeader } from "@/components/pro/ui";
import { MetaBadge } from "@/components/gestion/bits";
import AssuranceCreate from "@/components/gestion/AssuranceCreate";
import { getDatasetId, getDemo } from "@/lib/demo";
import { deadlineStatusMeta, euros, formatDate } from "@/lib/types";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";
import { deadlineStatus, licenceExpiryDeadline } from "@/domain/compliance/deadlines";

/**
 * Assurances: the workspace's insurance register. Expiry vigilance comes
 * from the same deadline engine as the compliance calendar — a policy about
 * to lapse wears the same badge language as an expiring autorisation.
 */
export default async function AssurancesPage() {
  const { locale, d } = await getI18n();
  const [{ INSURANCES, LEASES, PROPERTIES, TODAY, leaseUnitLabel, propertyById }, datasetId] = await Promise.all([
    getDemo(),
    getDatasetId(),
  ]);
  const real = datasetId === "real";
  const statusMeta = deadlineStatusMeta(d);

  const scopeOf = (propertyId: string | null, leaseId: string | null): string => {
    if (propertyId) return propertyById(propertyId)?.name ?? "";
    const lease = leaseId ? LEASES.find((l) => l.id === leaseId) : undefined;
    if (lease) return leaseUnitLabel(lease);
    return d.assurances.scopeCabinet;
  };

  const createAction = (
    <AssuranceCreate
      d={d}
      real={real}
      propertyOptions={PROPERTIES.map((p) => ({ id: p.id, label: p.name }))}
    />
  );

  return (
    <div>
      <PageHeader title={d.assurances.title} subtitle={d.assurances.subtitle} actions={createAction} />

      {INSURANCES.length === 0 ? (
        <EmptyState title={fmt(d.common.emptyTitle, { section: d.hubs.assurances })} body={d.common.emptyBody} />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-sand-100 bg-sand-50/60 text-left text-[11px] uppercase tracking-wide text-ink-soft">
                  <th className="px-4 py-2.5 font-semibold">{d.assurances.colPolicy}</th>
                  <th className="px-3 py-2.5 font-semibold">{d.assurances.colScope}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{d.assurances.colPremium}</th>
                  <th className="px-4 py-2.5 text-right font-semibold">{d.assurances.colExpiry}</th>
                </tr>
              </thead>
              <tbody>
                {INSURANCES.map((ins) => {
                  const expiry = ins.expiresOn
                    ? deadlineStatus(licenceExpiryDeadline(ins.provider, ins.expiresOn, ins.policyNumber), TODAY)
                    : null;
                  return (
                    <tr key={ins.id} className="border-b border-sand-50 last:border-0 hover:bg-sand-50/50">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-ink">{d.status.insuranceKind[ins.kind]}</p>
                        <p className="text-xs text-ink-soft">
                          {ins.provider}
                          {ins.policyNumber ? ` · ${ins.policyNumber}` : ""}
                        </p>
                      </td>
                      <td className="px-3 py-3 text-xs text-ink-soft">{scopeOf(ins.propertyId, ins.leaseId)}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-ink">
                        {ins.premiumCents > 0
                          ? fmt(d.assurances.perYear, { amount: euros(ins.premiumCents, locale) })
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {ins.expiresOn && expiry ? (
                          <span className="inline-flex items-center gap-2">
                            <span className="tabular-nums text-xs text-ink">{formatDate(ins.expiresOn, locale)}</span>
                            <MetaBadge meta={statusMeta[expiry]} />
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
