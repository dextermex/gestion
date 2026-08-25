import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, PageHeader } from "@/components/pro/ui";
import { LegalNote, MetaBadge, Panel } from "@/components/gestion/bits";
import { getDemo } from "@/lib/demo";
import { METER_UNITS, euros, formatDate, formatNumber, leaseStatusMeta } from "@/lib/types";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";
import {
  cpeExpiryDeadline,
  deadlineStatus,
  syndicMandateDeadline,
  vacancyClock,
} from "@/domain/compliance/deadlines";

// No generateStaticParams: the page reads the locale cookie, so it must be
// request-rendered — a build-time prerender would bake one language in.

export default async function BienDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { locale, d } = await getI18n();
  const { LEASES, METERS, PROPERTIES, TODAY, UNITS, leaseTenantNames } = await getDemo();
  const property = PROPERTIES.find((p) => p.id === id);
  if (!property) notFound();
  const p = property!;
  const units = UNITS.filter((u) => u.propertyId === p.id);
  const meters = METERS.filter((m) => m.propertyId === p.id);
  const statusMeta = leaseStatusMeta(d);

  const cpe = cpeExpiryDeadline(p.name, p.cpeIssuedOn);
  const cpeStatus = deadlineStatus(cpe, TODAY);
  const syndic = p.syndicMandateStart
    ? syndicMandateDeadline(p.syndicName ?? "Syndic", p.syndicMandateStart)
    : null;

  return (
    <div>
      <div className="mb-2">
        <Link href="/app/biens" className="text-sm font-semibold text-brand-700 hover:underline">
          {d.biens.backToList}
        </Link>
      </div>
      <PageHeader
        title={p.name}
        subtitle={`${p.address} · ${p.cadastralRef}`}
        actions={
          <Badge
            className={
              cpeStatus === "overdue"
                ? "bg-red-100 text-red-700"
                : cpeStatus === "due_soon"
                  ? "bg-amber-100 text-amber-800"
                  : "bg-emerald-100 text-emerald-800"
            }
          >
            {fmt(d.biens.cpeBadge, { cls: p.energyClass, date: formatDate(cpe.dueAt, locale) })}
          </Badge>
        }
      />

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Panel title={d.biens.unitsTitle}>
            <ul className="divide-y divide-sand-100">
              {units.map((u) => {
                const lease = LEASES.find(
                  (l) => l.unitId === u.id && (l.status === "active" || l.status === "notice"),
                );
                const vacancy = u.vacantSince ? vacancyClock(u.label, u.vacantSince, TODAY) : null;
                return (
                  <li key={u.id} className="flex items-center gap-3 py-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-xs font-bold text-brand-700">
                      {u.label.slice(0, 3)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-ink">
                        {u.label}
                        <span className="ml-2 text-xs font-normal text-ink-soft">
                          {fmt(d.biens.unitMeta, { floor: u.floor, area: u.areaSqm })}
                          {u.rooms > 0 ? fmt(d.biens.unitRooms, { n: u.rooms }) : ""}
                          {u.furnished ? d.biens.unitFurnished : ""}
                        </span>
                      </p>
                      {lease ? (
                        <Link href={`/app/baux/${lease.id}`} className="text-xs text-ink-soft hover:text-brand-700">
                          {leaseTenantNames(lease).join(", ")} · {euros(lease.rentCents, locale)}
                          {d.common.perMonth}
                        </Link>
                      ) : vacancy ? (
                        <p className="text-xs text-red-700">
                          {fmt(d.biens.unitVacantSince, {
                            date: formatDate(u.vacantSince ?? null, locale),
                            months: vacancy.monthsVacant,
                          })}
                          {vacancy.triggered ? d.biens.unitVacantInol : ""}
                        </p>
                      ) : (
                        <p className="text-xs text-ink-soft">{d.biens.unitFree}</p>
                      )}
                    </div>
                    {lease ? (
                      <MetaBadge meta={statusMeta[lease.status]} />
                    ) : u.kind === "parking" ? (
                      <Badge className="bg-sand-100 text-ink-soft">{d.biens.unitParking}</Badge>
                    ) : (
                      <Badge className="bg-amber-100 text-amber-800">{d.biens.unitVacantBadge}</Badge>
                    )}
                  </li>
                );
              })}
            </ul>
          </Panel>

          <Panel title={d.biens.metersTitle} className="mt-5">
            {meters.length === 0 ? (
              <p className="text-sm text-ink-soft">{d.biens.metersNone}</p>
            ) : (
              <ul className="divide-y divide-sand-100">
                {meters.map((m) => {
                  const unit = m.unitId ? units.find((u) => u.id === m.unitId) : null;
                  return (
                    <li key={m.id} className="flex items-center gap-3 py-2.5 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-ink">
                          {d.status.meter[m.kind]}{" "}
                          <span className="text-xs font-normal text-ink-soft">
                            · {m.serial}
                            {unit ? ` · ${unit.label}` : ` · ${d.biens.metersCommon}`}
                          </span>
                        </p>
                        <p className="text-xs text-ink-soft">{m.supplier}</p>
                      </div>
                      {m.lastReading ? (
                        <div className="text-right">
                          <p className="tabular-nums text-ink">
                            {formatNumber(m.lastReading.value, locale)} {METER_UNITS[m.kind]}
                          </p>
                          <p className="text-[11px] text-ink-soft">{formatDate(m.lastReading.date, locale)}</p>
                        </div>
                      ) : (
                        <Badge className="bg-amber-100 text-amber-800">{d.compteurs.kpiNoReading}</Badge>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>

        <div className="flex flex-col gap-5">
          <Panel title={d.biens.ownershipTitle}>
            <p className="text-sm leading-relaxed text-ink">{p.ownershipNote}</p>
            <ul className="mt-3 space-y-2 text-sm">
              <li className="flex justify-between gap-3">
                <span className="text-ink-soft">{d.biens.construction}</span>
                <span className="font-semibold tabular-nums text-ink">{p.constructionYear}</span>
              </li>
              <li className="flex justify-between gap-3">
                <span className="text-ink-soft">{d.biens.completion}</span>
                <span className="font-semibold tabular-nums text-ink">{formatDate(p.completionDate, locale)}</span>
              </li>
              <li className="flex justify-between gap-3">
                <span className="text-ink-soft">{d.biens.type}</span>
                <span className="font-semibold text-ink">{p.type}</span>
              </li>
            </ul>
            <LegalNote>{d.biens.ownershipLegal}</LegalNote>
          </Panel>

          {p.isCopropriete && (
            <Panel title={d.biens.coproTitle}>
              <ul className="space-y-2 text-sm">
                <li className="flex justify-between gap-3">
                  <span className="text-ink-soft">{d.biens.syndic}</span>
                  <span className="font-semibold text-ink">{p.syndicName}</span>
                </li>
                {syndic && (
                  <li className="flex justify-between gap-3">
                    <span className="text-ink-soft">{d.biens.mandateEnd}</span>
                    <span className="font-semibold tabular-nums text-ink">{formatDate(syndic.dueAt, locale)}</span>
                  </li>
                )}
                {p.nextAgDate && (
                  <li className="flex justify-between gap-3">
                    <span className="text-ink-soft">{d.biens.nextAg}</span>
                    <span className="font-semibold tabular-nums text-ink">{formatDate(p.nextAgDate, locale)}</span>
                  </li>
                )}
              </ul>
              <LegalNote>{d.biens.coproLegal}</LegalNote>
            </Panel>
          )}

          <Panel title={d.biens.complianceTitle}>
            <ul className="space-y-2.5 text-sm">
              <li className="flex items-center justify-between gap-3">
                <span className="text-ink-soft">{d.biens.cpeRow}</span>
                <Badge
                  className={
                    cpeStatus === "due_soon"
                      ? "bg-amber-100 text-amber-800"
                      : cpeStatus === "overdue"
                        ? "bg-red-100 text-red-700"
                        : "bg-emerald-100 text-emerald-800"
                  }
                >
                  {formatDate(cpe.dueAt, locale)}
                </Badge>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span className="text-ink-soft">{d.biens.smokeRow}</span>
                <Badge
                  className={
                    p.smokeDetectorsConfirmed ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-700"
                  }
                >
                  {p.smokeDetectorsConfirmed ? d.biens.smokeOk : d.biens.smokeKo}
                </Badge>
              </li>
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
