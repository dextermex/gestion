import { Badge, PageHeader, EmptyState } from "@/components/pro/ui";
import { MetaBadge, Panel } from "@/components/gestion/bits";
import { getDemo } from "@/lib/demo";
import { deadlineStatusMeta, formatDate, formatNumber } from "@/lib/types";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";
import type { Dict } from "@/lib/i18n/fr";
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
import { getParamValue } from "@/domain/legal/params";

/** Deadline label from its stable kind — never from the engine's English label. */
function deadlineLabel(d: Dict, dl: Deadline, today: string, what?: string): string {
  switch (dl.kind) {
    case "cpe_expiry":
      return d.legal.deadlineKind.cpe_expiry;
    case "commune_arrival_declaration":
      return fmt(d.legal.deadlineKind.commune_arrival_declaration, {
        days: getParamValue("compliance.commune_arrival_declaration_days", today),
      });
    case "syndic_mandate_expiry":
      return fmt(d.legal.deadlineKind.syndic_mandate_expiry, {
        years: getParamValue("syndic.mandate_max_years", today),
      });
    case "ag_convocation":
      return fmt(d.legal.deadlineKind.ag_convocation, {
        days: getParamValue("syndic.ag_convocation_min_days", today),
        repeat: "",
      });
    case "defect_window_end":
      return fmt(d.legal.deadlineKind.defect_window_end, {
        days: getParamValue("compliance.defect_window_default_days", today),
      });
    case "licence_expiry":
      return fmt(d.legal.deadlineKind.licence_expiry, { what: what ?? dl.relatedLabel });
    default:
      return dl.label;
  }
}

/** Second line of a calendar row: the legal basis, translated from the stable
 *  kind — the engine's English `legalBasis` never reaches the screen. Kinds
 *  without a statute to cite return "", and the row simply shows who/where. */
function deadlineBasis(d: Dict, dl: Deadline, today: string): string {
  const basis = (d.legal.basis as Partial<Record<Deadline["kind"], string>>)[dl.kind] ?? "";
  if (dl.kind === "cpe_expiry") {
    return fmt(basis, { years: getParamValue("compliance.cpe_validity_years", today) });
  }
  return basis;
}

export default async function ConformitePage() {
  const { locale, d } = await getI18n();
  const demo = await getDemo();

  // A real account with nothing in it: say so rather than reach for a
  // showcase record that no longer exists.
  if (demo.PROPERTIES.length === 0)
    return (
      <div>
        <EmptyState title={fmt(d.common.emptyTitle, { section: d.nav.compliance })} body={d.common.emptyBody} />
      </div>
    );
  const { ORG, PROPERTIES, TODAY, UNITS } = demo;
  const statusMeta = deadlineStatusMeta(d);

  // The calendar is GENERATED from data — every deadline is an engine output.
  const deadlines: Array<{ dl: Deadline; what?: string; done?: string | null }> = [
    ...(ORG.piInsuranceExpiry
      ? [
          {
            dl: licenceExpiryDeadline(ORG.name, ORG.piInsuranceExpiry, d.legal.deadlineKind.pi_insurance),
            what: d.legal.deadlineKind.pi_insurance,
          },
        ]
      : []),
    ...(ORG.autorisationExpiry
      ? [
          {
            dl: licenceExpiryDeadline(ORG.name, ORG.autorisationExpiry, d.legal.deadlineKind.autorisation),
            what: d.legal.deadlineKind.autorisation,
          },
        ]
      : []),
    ...PROPERTIES.filter((p) => p.cpeIssuedOn).map((p) => ({ dl: cpeExpiryDeadline(p.name, p.cpeIssuedOn) })),
    ...PROPERTIES.filter((p) => p.syndicMandateStart).map((p) => ({
      dl: syndicMandateDeadline(`${p.name} · ${p.syndicName}`, p.syndicMandateStart!),
    })),
    ...PROPERTIES.filter((p) => p.nextAgDate).map((p) => ({
      dl: agConvocationDeadline(p.name, p.nextAgDate!, false),
    })),
    // Two sample events (a tenant arrival, a defect window) exist only in
    // the demonstration cabinets; a real account generates these from its
    // own lease moves.
    ...(demo.CONTACTS.some((c) => c.id === "c-weber") && demo.UNITS.some((u) => u.id === "u-b-2a")
      ? [
          {
            dl: communeArrivalDeadline(
              `${demo.contactById("c-weber").name} (${demo.unitById("u-b-2a").label})`,
              "2026-08-18",
            ),
          },
        ]
      : []),
    ...(demo.PROPERTIES.some((p) => p.id === "p-bertrange")
      ? [{ dl: defectWindowEnd(demo.propertyById("p-bertrange").name, "2026-12-01") }]
      : []),
  ];

  const sorted = deadlines
    .map((x) => ({ ...x, status: deadlineStatus(x.dl, TODAY, x.done) }))
    .sort((a, b) => (a.dl.dueAt < b.dl.dueAt ? -1 : 1));

  const vacantUnits = UNITS.filter((u) => u.vacantSince).map((u) => ({
    unit: u,
    clock: vacancyClock(u.label, u.vacantSince!, TODAY),
  }));

  // The workspace profile and the parameters registry moved to Réglages:
  // this screen is the full calendar Aujourd'hui opens, nothing else.
  return (
    <div>
      <PageHeader title={d.conformite.title} subtitle={d.conformite.subtitle} />

      <div className="mx-auto max-w-3xl">
          <Panel title={d.conformite.calendarTitle}>
            {sorted.length === 0 && <p className="text-sm text-ink-soft">{d.conformite.calendarEmpty}</p>}
            <ul className="divide-y divide-sand-100">
              {sorted.map(({ dl, what, status }) => (
                <li key={`${dl.kind}-${dl.relatedLabel}-${dl.dueAt}`} className="flex items-start gap-3 py-3">
                  <div
                    className={
                      "mt-1 h-2 w-2 shrink-0 rounded-full " +
                      (status === "overdue"
                        ? "bg-red-500"
                        : status === "due_soon"
                          ? "bg-amber-500"
                          : status === "done"
                            ? "bg-emerald-500"
                            : "bg-sand-300")
                    }
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink">{deadlineLabel(d, dl, TODAY, what)}</p>
                    <p className="text-xs text-ink-soft">
                      {dl.relatedLabel}
                      {deadlineBasis(d, dl, TODAY) && ` · ${deadlineBasis(d, dl, TODAY)}`}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="tabular-nums text-sm font-semibold text-ink">{formatDate(dl.dueAt, locale)}</p>
                    <MetaBadge meta={statusMeta[status]} />
                  </div>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title={d.conformite.vacancyTitle} className="mt-5">
            {vacantUnits.map(({ unit, clock }) => (
              <div key={unit.id} className="rounded-xl border border-red-200 bg-red-50/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-ink">
                    {fmt(d.conformite.vacancyRow, {
                      unit: clock.unitLabel,
                      date: formatDate(clock.vacantSince, locale),
                      months: clock.monthsVacant,
                    })}
                  </p>
                  <Badge className="bg-red-100 text-red-700">{d.conformite.vacancyBadge}</Badge>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">
                  {fmt(d.conformite.vacancyBody, { y1: formatNumber(clock.projectedTaxYear1Eur, locale) })}
                </p>
              </div>
            ))}
          </Panel>
      </div>
    </div>
  );
}
