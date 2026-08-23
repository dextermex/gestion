import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, PageHeader } from "@/components/pro/ui";
import { LegalNote, MetaBadge, Panel } from "@/components/gestion/bits";
import {
  LEASES,
  METERS,
  PROPERTIES,
  TODAY,
  UNITS,
  leaseTenantNames,
} from "@/lib/demo/data";
import { LEASE_STATUS_META, METER_KIND_META, euros, formatDate } from "@/lib/types";
import { cpeExpiryDeadline, deadlineStatus, syndicMandateDeadline, vacancyClock } from "@/domain/compliance/deadlines";

export function generateStaticParams() {
  return PROPERTIES.map((p) => ({ id: p.id }));
}

export default async function BienDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const property = PROPERTIES.find((p) => p.id === id);
  if (!property) notFound();
  const p = property!;
  const units = UNITS.filter((u) => u.propertyId === p.id);
  const meters = METERS.filter((m) => m.propertyId === p.id);

  const cpe = cpeExpiryDeadline(p.name, p.cpeIssuedOn);
  const cpeStatus = deadlineStatus(cpe, TODAY);
  const syndic = p.syndicMandateStart ? syndicMandateDeadline(p.syndicName ?? "Syndic", p.syndicMandateStart) : null;

  return (
    <div>
      <div className="mb-2">
        <Link href="/app/biens" className="text-sm font-semibold text-brand-700 hover:underline">← Biens</Link>
      </div>
      <PageHeader
        title={p.name}
        subtitle={`${p.address} · ${p.cadastralRef}`}
        actions={
          <Badge className={cpeStatus === "overdue" ? "bg-red-100 text-red-700" : cpeStatus === "due_soon" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}>
            CPE {p.energyClass} — expire {formatDate(cpe.dueAt)}
          </Badge>
        }
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Panel title="Lots">
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
                          {u.floor} · {u.areaSqm} m²{u.rooms > 0 ? ` · ${u.rooms} ch.` : ""}{u.furnished ? " · meublé" : ""}
                        </span>
                      </p>
                      {lease ? (
                        <Link href={`/app/baux/${lease.id}`} className="text-xs text-ink-soft hover:text-brand-700">
                          {leaseTenantNames(lease).join(", ")} · {euros(lease.rentCents)}/mois
                        </Link>
                      ) : vacancy ? (
                        <p className="text-xs text-red-600">
                          Vacant depuis {formatDate(u.vacantSince ?? null)} — {vacancy.monthsVacant} mois
                          {vacancy.triggered ? " · seuil INOL franchi, dossier de défense actif" : ""}
                        </p>
                      ) : (
                        <p className="text-xs text-ink-soft">Libre</p>
                      )}
                    </div>
                    {lease ? (
                      <MetaBadge meta={LEASE_STATUS_META[lease.status]} />
                    ) : u.kind === "parking" ? (
                      <Badge className="bg-sand-100 text-ink-soft">Parking</Badge>
                    ) : (
                      <Badge className="bg-amber-100 text-amber-800">Vacant</Badge>
                    )}
                  </li>
                );
              })}
            </ul>
          </Panel>

          <Panel title="Compteurs du bien" className="mt-5">
            {meters.length === 0 ? (
              <p className="text-sm text-ink-soft">Aucun compteur enregistré.</p>
            ) : (
              <ul className="divide-y divide-sand-100">
                {meters.map((m) => {
                  const meta = METER_KIND_META[m.kind];
                  const unit = m.unitId ? units.find((u) => u.id === m.unitId) : null;
                  return (
                    <li key={m.id} className="flex items-center gap-3 py-2.5 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-ink">
                          {meta.label} <span className="text-xs font-normal text-ink-soft">· {m.serial}{unit ? ` · ${unit.label}` : " · communs"}</span>
                        </p>
                        <p className="text-xs text-ink-soft">{m.supplier}</p>
                      </div>
                      {m.lastReading ? (
                        <div className="text-right">
                          <p className="tabular-nums text-ink">
                            {m.lastReading.value.toLocaleString("fr-LU")} {meta.unit}
                          </p>
                          <p className="text-[11px] text-ink-soft/70">{formatDate(m.lastReading.date)}</p>
                        </div>
                      ) : (
                        <Badge className="bg-amber-100 text-amber-800">Aucun relevé</Badge>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>

        <div className="flex flex-col gap-5">
          <Panel title="Propriété">
            <p className="text-sm leading-relaxed text-ink">{p.ownershipNote}</p>
            <ul className="mt-3 space-y-2 text-sm">
              <li className="flex justify-between gap-3">
                <span className="text-ink-soft">Construction</span>
                <span className="font-semibold tabular-nums text-ink">{p.constructionYear}</span>
              </li>
              <li className="flex justify-between gap-3">
                <span className="text-ink-soft">Achèvement</span>
                <span className="font-semibold tabular-nums text-ink">{formatDate(p.completionDate)}</span>
              </li>
              <li className="flex justify-between gap-3">
                <span className="text-ink-soft">Type</span>
                <span className="font-semibold text-ink">{p.type}</span>
              </li>
            </ul>
            <LegalNote>
              Le graphe de propriété (bien → véhicule → personnes physiques, avec parts et dates)
              alimente le plafond « 2 immeubles » de l&apos;amortissement 4 % et l&apos;abattement de
              10 000 € — des règles qui mordent au niveau du contribuable, pas du bien.
            </LegalNote>
          </Panel>

          {p.isCopropriete && (
            <Panel title="Copropriété">
              <ul className="space-y-2 text-sm">
                <li className="flex justify-between gap-3">
                  <span className="text-ink-soft">Syndic</span>
                  <span className="font-semibold text-ink">{p.syndicName}</span>
                </li>
                {syndic && (
                  <li className="flex justify-between gap-3">
                    <span className="text-ink-soft">Fin de mandat (max 3 ans)</span>
                    <span className="font-semibold tabular-nums text-ink">{formatDate(syndic.dueAt)}</span>
                  </li>
                )}
                {p.nextAgDate && (
                  <li className="flex justify-between gap-3">
                    <span className="text-ink-soft">Prochaine AG</span>
                    <span className="font-semibold tabular-nums text-ink">{formatDate(p.nextAgDate)}</span>
                  </li>
                )}
              </ul>
              <LegalNote>
                RGD 13.6.1975 : fonds du syndicat versés sans délai sur un compte AU NOM du syndicat
                (art. 28) — jamais de compte commun. Convocations AG ≥ 15 jours (art. 3), 8 jours en
                seconde convocation (art. 11).
              </LegalNote>
            </Panel>
          )}

          <Panel title="Conformité du bien">
            <ul className="space-y-2.5 text-sm">
              <li className="flex items-center justify-between gap-3">
                <span className="text-ink-soft">CPE (validité 10 ans)</span>
                <Badge className={cpeStatus === "due_soon" ? "bg-amber-100 text-amber-800" : cpeStatus === "overdue" ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-800"}>
                  {formatDate(cpe.dueAt)}
                </Badge>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span className="text-ink-soft">Détecteurs de fumée</span>
                <Badge className={p.smokeDetectorsConfirmed ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-700"}>
                  {p.smokeDetectorsConfirmed ? "Confirmés" : "À poser"}
                </Badge>
              </li>
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
