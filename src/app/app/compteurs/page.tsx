import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader } from "@/components/pro/ui";
import { LegalNote, Panel } from "@/components/gestion/bits";
import { ChipLink } from "@/components/gestion/filters";
import MeterCreate from "@/components/gestion/MeterSheet";
import { getDemo } from "@/lib/demo";
import { METER_UNITS, formatDate, formatNumber, type MeterKind } from "@/lib/types";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";

const KIND_SLUGS: Array<{ slug: string; kind: MeterKind }> = [
  { slug: "electricite", kind: "electricity" },
  { slug: "gaz", kind: "gas" },
  { slug: "eau-froide", kind: "water_cold" },
  { slug: "eau-chaude", kind: "water_hot" },
  { slug: "chaleur", kind: "heat" },
];

export default async function CompteursPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const params = await searchParams;
  const { locale, d } = await getI18n();
  const { METERS, PROPERTIES, propertyById, unitById } = await getDemo();
  const withoutReading = METERS.filter((m) => !m.lastReading);
  const pendingAck = METERS.filter(
    (m) => m.lastReading && (!m.lastReading.tenantAck || !m.lastReading.managerAck),
  );

  const kindFilter = KIND_SLUGS.find((k) => k.slug === params.type)?.kind;
  const rows = kindFilter ? METERS.filter((m) => m.kind === kindFilter) : METERS;

  // Property/unit options for the create sheet — units first, then the
  // per-property "common areas" rows (dataset-aware labels).
  const sheetOptions = [
    ...METERS.filter((m) => m.unitId)
      .map((m) => m.unitId!)
      .filter((v, i, a) => a.indexOf(v) === i)
      .map((id) => {
        const u = unitById(id);
        return { id, label: `${u.label} · ${propertyById(u.propertyId).name}` };
      }),
    ...PROPERTIES.map((p) => ({
      id: `common-${p.id}`,
      label: fmt(d.compteurs.sheetCommonOption, { property: p.name }),
    })),
  ];

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
      <PageHeader
        title={d.compteurs.title}
        subtitle={d.compteurs.subtitle}
        actions={<MeterCreate d={d} options={sheetOptions} />}
      />

      <div className="no-scrollbar mb-4 flex gap-2 overflow-x-auto">
        <ChipLink href="/app/compteurs" active={!kindFilter}>
          {d.compteurs.filterAll}
        </ChipLink>
        {KIND_SLUGS.map((k) => (
          <ChipLink key={k.slug} href={`/app/compteurs?type=${k.slug}`} active={params.type === k.slug}>
            {d.status.meter[k.kind]}
          </ChipLink>
        ))}
      </div>

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

      {rows.length === 0 ? (
        <EmptyState
          title={d.compteurs.emptyTitle}
          body={d.compteurs.emptyBody}
          action={
            <Link href="/app/compteurs" className="text-sm font-semibold text-brand-700 hover:underline">
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
                <th className="px-4 py-2.5 font-semibold">{d.compteurs.colMeter}</th>
                <th className="px-3 py-2.5 font-semibold">{d.compteurs.colSupplier}</th>
                <th className="px-3 py-2.5 text-right font-semibold">{d.compteurs.colLastReading}</th>
                <th className="px-3 py-2.5 text-right font-semibold">{d.compteurs.colSource}</th>
                <th className="px-4 py-2.5 text-right font-semibold">{d.compteurs.colAcks}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const unit = m.unitId ? unitById(m.unitId) : null;
                const property = propertyById(m.propertyId);
                return (
                  <tr key={m.id} className="border-b border-sand-50 last:border-0 hover:bg-sand-50/50">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-ink">
                        {d.status.meter[m.kind]} · {m.serial}
                      </p>
                      <p className="text-xs text-ink-soft">
                        {unit ? `${unit.label} · ` : `${d.biens.metersCommon} · `}
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
      )}

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel title={d.compteurs.edlTitle}>
          <p className="text-sm leading-relaxed text-ink-soft">{d.compteurs.edlBody}</p>
          <LegalNote>{d.compteurs.edlLegal}</LegalNote>
        </Panel>
        <Panel title={d.compteurs.istaTitle}>
          <p className="text-sm leading-relaxed text-ink-soft">{d.compteurs.istaBody}</p>
          <div className="mt-3 rounded-xl border border-sand-200 bg-sand-50/60 p-3.5 text-xs text-ink-soft">
            {d.compteurs.istaLast}{" "}
            <span className="font-semibold text-ink">
              {fmt(d.compteurs.istaLastDetail, { property: propertyById("p-beaulieu").name })}
            </span>{" "}
            ·{" "}
            {d.compteurs.istaLastMeta}
          </div>
        </Panel>
      </div>
    </div>
  );
}
