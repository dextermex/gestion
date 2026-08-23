import { Badge, Card, PageHeader } from "@/components/pro/ui";
import { LegalNote, Panel } from "@/components/gestion/bits";
import { METERS, propertyById, unitById } from "@/lib/demo/data";
import { METER_UNITS, formatDate, formatNumber } from "@/lib/types";
import { getI18n } from "@/lib/i18n";

export default async function CompteursPage() {
  const { locale, d } = await getI18n();
  const withoutReading = METERS.filter((m) => !m.lastReading);
  const pendingAck = METERS.filter(
    (m) => m.lastReading && (!m.lastReading.tenantAck || !m.lastReading.managerAck),
  );

  const sourceLabel = (source: string) =>
    source === "photo_ocr"
      ? d.compteurs.srcPhoto
      : source === "edl"
        ? d.compteurs.srcEdl
        : source === "import"
          ? d.compteurs.srcImport
          : d.compteurs.srcManual;

  return (
    <div>
      <PageHeader title={d.compteurs.title} subtitle={d.compteurs.subtitle} />

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{d.compteurs.kpiTracked}</p>
          <p className="mt-1 font-display text-2xl font-bold tracking-tight tabular-nums text-ink">{METERS.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
            {d.compteurs.kpiPendingAck}
          </p>
          <p className="mt-1 font-display text-2xl font-bold tracking-tight tabular-nums text-amber-700">
            {pendingAck.length}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{d.compteurs.kpiNoReading}</p>
          <p className="mt-1 font-display text-2xl font-bold tracking-tight tabular-nums text-red-700">
            {withoutReading.length}
          </p>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sand-100 bg-sand-50/60 text-left text-[11px] uppercase tracking-wide text-ink-soft">
                <th className="px-4 py-2.5 font-semibold">{d.compteurs.colMeter}</th>
                <th className="px-3 py-2.5 font-semibold">{d.compteurs.colSupplier}</th>
                <th className="px-3 py-2.5 text-right font-semibold">{d.compteurs.colLastReading}</th>
                <th className="px-3 py-2.5 text-right font-semibold">{d.compteurs.colSource}</th>
                <th className="px-4 py-2.5 text-right font-semibold">{d.compteurs.colAcks}</th>
              </tr>
            </thead>
            <tbody>
              {METERS.map((m) => {
                const unit = m.unitId ? unitById(m.unitId) : null;
                const property = propertyById(m.propertyId);
                return (
                  <tr key={m.id} className="border-b border-sand-50 last:border-0 hover:bg-sand-50/50">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-ink">
                        {d.status.meter[m.kind]} · {m.serial}
                      </p>
                      <p className="text-xs text-ink-soft">
                        {unit ? `${unit.label} — ` : `${d.biens.metersCommon} — `}
                        {property.name}
                      </p>
                    </td>
                    <td className="px-3 py-3 text-xs text-ink-soft">{m.supplier}</td>
                    <td className="px-3 py-3 text-right">
                      {m.lastReading ? (
                        <>
                          <p className="tabular-nums text-ink">
                            {formatNumber(m.lastReading.value, locale)} {METER_UNITS[m.kind]}
                          </p>
                          <p className="text-[11px] text-ink-soft">{formatDate(m.lastReading.date, locale)}</p>
                        </>
                      ) : (
                        <span className="text-xs text-ink-soft">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {m.lastReading ? (
                        <Badge className="bg-sand-100 text-ink-soft">{sourceLabel(m.lastReading.source)}</Badge>
                      ) : (
                        <Badge className="bg-red-100 text-red-700">{d.compteurs.toRead}</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {m.lastReading ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <Badge
                            className={
                              m.lastReading.tenantAck
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-amber-100 text-amber-800"
                            }
                          >
                            {d.compteurs.ackTenant} {m.lastReading.tenantAck ? "✓" : "…"}
                          </Badge>
                          <Badge
                            className={
                              m.lastReading.managerAck
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-amber-100 text-amber-800"
                            }
                          >
                            {d.compteurs.ackManager} {m.lastReading.managerAck ? "✓" : "…"}
                          </Badge>
                        </div>
                      ) : (
                        <span className="text-xs text-ink-soft">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel title={d.compteurs.edlTitle}>
          <p className="text-sm leading-relaxed text-ink-soft">{d.compteurs.edlBody}</p>
          <LegalNote>{d.compteurs.edlLegal}</LegalNote>
        </Panel>
        <Panel title={d.compteurs.istaTitle}>
          <p className="text-sm leading-relaxed text-ink-soft">{d.compteurs.istaBody}</p>
          <div className="mt-3 rounded-xl border border-sand-200 bg-sand-50/60 p-3.5 text-xs text-ink-soft">
            {d.compteurs.istaLast} <span className="font-semibold text-ink">{d.compteurs.istaLastDetail}</span> ·{" "}
            {d.compteurs.istaLastMeta}
          </div>
        </Panel>
      </div>
    </div>
  );
}
