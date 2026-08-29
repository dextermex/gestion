import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader } from "@/components/pro/ui";
import { MetaBadge } from "@/components/gestion/bits";
import { getDemo } from "@/lib/demo";
import { edlStatusMeta, formatDate } from "@/lib/types";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";

/**
 * États des lieux: every EDL session of the workspace, entry to exit. Each
 * row opens its lease sheet, where the EDL lives next to the notice and the
 * key handover — an EDL is a fact about a lease, never a floating record.
 */
export default async function EdlPage() {
  const { locale, d } = await getI18n();
  const { EDLS } = await getDemo();

  if (EDLS.length === 0)
    return <EmptyState title={fmt(d.common.emptyTitle, { section: d.hubs.edl })} body={d.common.emptyBody} />;

  const statusMeta = edlStatusMeta(d);
  const KIND: Record<string, string> = {
    entry: d.baux.edlKindEntry,
    intermediate: d.baux.edlKindIntermediate,
    exit: d.baux.edlKindExit,
  };
  const rows = [...EDLS].sort((a, b) =>
    (a.completedAt ?? a.scheduledAt ?? "") < (b.completedAt ?? b.scheduledAt ?? "") ? 1 : -1,
  );

  return (
    <div>
      <PageHeader title={d.edl.title} subtitle={d.edl.subtitle} />

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sand-100 bg-sand-50/60 text-left text-[11px] uppercase tracking-wide text-ink-soft">
                <th className="px-4 py-2.5 font-semibold">{d.edl.colUnit}</th>
                <th className="px-3 py-2.5 font-semibold">{d.edl.colKind}</th>
                <th className="px-3 py-2.5 text-right font-semibold">{d.edl.colDate}</th>
                <th className="px-3 py-2.5 text-right font-semibold">{d.edl.colContent}</th>
                <th className="px-4 py-2.5 text-right font-semibold">{d.edl.colStatus}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="border-b border-sand-50 last:border-0 hover:bg-sand-50/50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/app/baux/${e.leaseId}?onglet=edl`}
                      className="font-semibold text-ink hover:text-brand-700"
                    >
                      {e.unitLabel || "—"}
                    </Link>
                  </td>
                  <td className="px-3 py-3 text-xs text-ink-soft">{KIND[e.kind]}</td>
                  <td className="px-3 py-3 text-right text-xs tabular-nums text-ink">
                    {e.completedAt
                      ? formatDate(e.completedAt, locale)
                      : e.scheduledAt
                        ? fmt(d.baux.edlScheduled, { date: formatDate(e.scheduledAt, locale) })
                        : "—"}
                  </td>
                  <td className="px-3 py-3 text-right text-xs tabular-nums text-ink-soft">
                    {e.itemsCount > 0 ? fmt(d.baux.edlItems, { items: e.itemsCount, photos: e.photosCount }) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="inline-flex items-center gap-1.5">
                      {e.hashSealed && <Badge className="bg-brand-50 text-brand-800">{d.baux.edlSealed}</Badge>}
                      <MetaBadge meta={statusMeta[e.status]} />
                    </span>
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
