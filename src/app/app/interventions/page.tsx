import { Badge, Card, EmptyState, PageHeader } from "@/components/pro/ui";
import { MetaBadge } from "@/components/gestion/bits";
import { getDemo } from "@/lib/demo";
import { formatDate, ticketSeverityMeta, ticketStatusMeta } from "@/lib/types";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";

/**
 * Interventions: every ticket of the workspace, whatever its source. New
 * ones are created from the Nouveau menu; the row data is the same
 * collection the dashboard and workflows read.
 */
export default async function InterventionsPage() {
  const { locale, d } = await getI18n();
  const { TICKETS } = await getDemo();

  if (TICKETS.length === 0)
    return <EmptyState title={fmt(d.common.emptyTitle, { section: d.hubs.interventions })} body={d.common.emptyBody} />;

  const severityMeta = ticketSeverityMeta(d);
  const statusMeta = ticketStatusMeta(d);
  const open = TICKETS.filter((t) => !["done", "closed", "cancelled"].includes(t.status));
  const urgent = open.filter((t) => t.severity === "urgent" || t.severity === "emergency");
  const pendingTenant = open.filter((t) => t.status === "pending_tenant");
  const rows = [...TICKETS].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return (
    <div>
      <PageHeader title={d.interventions.title} subtitle={d.interventions.subtitle} />

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{d.interventions.kpiOpen}</p>
          <p className="mt-1 font-display text-2xl font-bold tracking-tight tabular-nums text-ink">{open.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{d.interventions.kpiUrgent}</p>
          <p className="mt-1 font-display text-2xl font-bold tracking-tight tabular-nums text-red-700">
            {urgent.length}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
            {d.interventions.kpiPendingTenant}
          </p>
          <p className="mt-1 font-display text-2xl font-bold tracking-tight tabular-nums text-amber-700">
            {pendingTenant.length}
          </p>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sand-100 bg-sand-50/60 text-left text-[11px] uppercase tracking-wide text-ink-soft">
                <th className="px-4 py-2.5 font-semibold">{d.interventions.colTicket}</th>
                <th className="px-3 py-2.5 font-semibold">{d.interventions.colUnit}</th>
                <th className="px-3 py-2.5 text-right font-semibold">{d.interventions.colSeverity}</th>
                <th className="px-3 py-2.5 text-right font-semibold">{d.interventions.colStatus}</th>
                <th className="px-4 py-2.5 text-right font-semibold">{d.interventions.colSla}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="border-b border-sand-50 last:border-0 hover:bg-sand-50/50">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-ink">{t.title}</p>
                    <p className="text-xs tabular-nums text-ink-soft">
                      {t.ref} · {formatDate(t.createdAt, locale)}
                    </p>
                  </td>
                  <td className="px-3 py-3 text-xs text-ink-soft">{t.unitLabel || "—"}</td>
                  <td className="px-3 py-3 text-right">
                    <MetaBadge meta={severityMeta[t.severity]} />
                  </td>
                  <td className="px-3 py-3 text-right">
                    <MetaBadge meta={statusMeta[t.status]} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {t.slaDueAt ? (
                      <span className="tabular-nums text-xs text-ink">{formatDate(t.slaDueAt, locale)}</span>
                    ) : (
                      <Badge className="bg-sand-100 text-ink-soft">{d.common.none}</Badge>
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
