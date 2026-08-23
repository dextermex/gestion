import { Badge, PageHeader } from "@/components/pro/ui";
import { LegalNote, MetaBadge, Panel } from "@/components/gestion/bits";
import { ORG, PROPERTIES, TODAY, UNITS } from "@/lib/demo/data";
import { DEADLINE_STATUS_META, formatDate } from "@/lib/types";
import {
  agConvocationDeadline,
  communeArrivalDeadline,
  cpeExpiryDeadline,
  deadlineStatus,
  defectWindowEnd,
  licenceExpiryDeadline,
  syndicMandateDeadline,
  vacancyClock,
  type Deadline,
} from "@/domain/compliance/deadlines";
import { paramsInForce } from "@/domain/legal/params";

export default function ConformitePage() {
  // The calendar is GENERATED from data — every deadline is an engine output.
  const deadlines: Array<{ d: Deadline; done?: string | null }> = [
    { d: licenceExpiryDeadline(ORG.name, ORG.piInsuranceExpiry, "Assurance RC professionnelle") },
    { d: licenceExpiryDeadline(ORG.name, ORG.autorisationExpiry, "Autorisation d'établissement (administrateur de biens)") },
    ...PROPERTIES.map((p) => ({ d: cpeExpiryDeadline(p.name, p.cpeIssuedOn) })),
    ...PROPERTIES.filter((p) => p.syndicMandateStart).map((p) => ({
      d: syndicMandateDeadline(`${p.name} — ${p.syndicName}`, p.syndicMandateStart!),
    })),
    ...PROPERTIES.filter((p) => p.nextAgDate).map((p) => ({
      d: agConvocationDeadline(p.name, p.nextAgDate!, false),
    })),
    { d: communeArrivalDeadline("Lucas Weber (Apt 2A)", "2026-08-18") },
    { d: defectWindowEnd("Maison Bertrange", "2026-12-01") },
  ];

  const sorted = deadlines
    .map((x) => ({ ...x, status: deadlineStatus(x.d, TODAY, x.done) }))
    .sort((a, b) => (a.d.dueAt < b.d.dueAt ? -1 : 1));

  const vacantUnits = UNITS.filter((u) => u.vacantSince).map((u) => ({
    unit: u,
    clock: vacancyClock(u.label, u.vacantSince!, TODAY),
  }));

  const params = paramsInForce(TODAY);
  const uncertain = params.filter((p) => p.status === "uncertain");

  return (
    <div>
      <PageHeader
        title="Conformité"
        subtitle="Le calendrier se génère depuis les données — jamais saisi à la main. Chaque échéance cite sa base légale."
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Panel title="Calendrier des échéances">
            <ul className="divide-y divide-sand-100">
              {sorted.map(({ d, status }) => (
                <li key={`${d.kind}-${d.relatedLabel}-${d.dueAt}`} className="flex items-start gap-3 py-3">
                  <div
                    className={
                      "mt-1 h-2 w-2 shrink-0 rounded-full " +
                      (status === "overdue" ? "bg-red-500" : status === "due_soon" ? "bg-amber-500" : status === "done" ? "bg-emerald-500" : "bg-sand-300")
                    }
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink">{d.label}</p>
                    <p className="text-xs text-ink-soft">
                      {d.relatedLabel} · {d.legalBasis}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="tabular-nums text-sm font-semibold text-ink">{formatDate(d.dueAt)}</p>
                    <MetaBadge meta={DEADLINE_STATUS_META[status]} />
                  </div>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Horloge de vacance (INOL)" className="mt-5">
            {vacantUnits.map(({ unit, clock }) => (
              <div key={unit.id} className="rounded-xl border border-red-200 bg-red-50/60 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-ink">
                    {clock.unitLabel} — vacant depuis le {formatDate(clock.vacantSince)} ({clock.monthsVacant} mois)
                  </p>
                  <Badge className="bg-red-100 text-red-700">Seuil 6 mois franchi</Badge>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">
                  Si la réforme INOL est adoptée : {clock.projectedTaxYear1Eur.toLocaleString("fr-LU")} € la
                  1re année, +900 €/an jusqu&apos;à 7 500 €. Statut d&apos;adoption non confirmé [incertain] —
                  le dossier de défense (annonces publiées, travaux, offres reçues) se constitue dès
                  maintenant, à toutes fins utiles.
                </p>
              </div>
            ))}
          </Panel>
        </div>

        <div className="flex flex-col gap-5">
          <Panel title="Cabinet — périmètre réglementaire">
            <ul className="space-y-2.5 text-sm">
              <li className="flex items-center justify-between gap-3">
                <span className="text-ink-soft">Autorisation d&apos;établissement</span>
                <span className="font-semibold tabular-nums text-ink">{ORG.autorisationNumber}</span>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span className="text-ink-soft">Échéance</span>
                <span className="font-semibold tabular-nums text-ink">{formatDate(ORG.autorisationExpiry)}</span>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span className="text-ink-soft">RC professionnelle</span>
                <span className="font-semibold text-ink">{ORG.piInsuranceProvider}</span>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span className="text-ink-soft">Échéance RC pro</span>
                <Badge className="bg-amber-100 text-amber-800">{formatDate(ORG.piInsuranceExpiry)}</Badge>
              </li>
            </ul>
            <LegalNote>
              Administrateur de biens : autorisation du Ministère de l&apos;Économie (loi du 2.9.2011),
              House of Training ou 3 ans d&apos;expérience de direction, RC pro obligatoire. Alarmes
              croissantes à l&apos;approche des échéances.
            </LegalNote>
          </Panel>

          <Panel title={`Paramètres légaux — ${params.length} en vigueur`}>
            <p className="text-sm leading-relaxed text-ink-soft">
              Chaque constante légale est une DONNÉE datée et sourcée — jamais du code. Un changement
              législatif est une mise à jour de table avec file de validation, pas une release.
            </p>
            <div className="mt-3 rounded-xl bg-sand-50 p-3.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                {uncertain.length} paramètres marqués [incertain]
              </p>
              <ul className="mt-2 space-y-1.5">
                {uncertain.slice(0, 5).map((p) => (
                  <li key={p.key} className="text-xs text-ink-soft">
                    <code className="rounded bg-white px-1.5 py-0.5 text-[11px] text-accent-700">{p.key}</code>
                    {p.note && <span className="ml-1.5">{p.note}</span>}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-ink-soft/70">
                Les moteurs qui consomment un paramètre incertain le signalent à l&apos;opérateur —
                registre d&apos;incertitudes du brief fiscal.
              </p>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
