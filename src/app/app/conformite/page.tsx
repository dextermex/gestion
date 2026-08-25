import { Badge, PageHeader } from "@/components/pro/ui";
import { LegalNote, MetaBadge, Panel } from "@/components/gestion/bits";
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
import { getParamValue, paramsInForce } from "@/domain/legal/params";

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

export default async function ConformitePage() {
  const { locale, d } = await getI18n();
  const demo = await getDemo();
  const { ORG, PROPERTIES, TODAY, UNITS } = demo;
  const statusMeta = deadlineStatusMeta(d);

  // The calendar is GENERATED from data — every deadline is an engine output.
  const deadlines: Array<{ dl: Deadline; what?: string; done?: string | null }> = [
    {
      dl: licenceExpiryDeadline(ORG.name, ORG.piInsuranceExpiry, d.legal.deadlineKind.pi_insurance),
      what: d.legal.deadlineKind.pi_insurance,
    },
    {
      dl: licenceExpiryDeadline(ORG.name, ORG.autorisationExpiry, d.legal.deadlineKind.autorisation),
      what: d.legal.deadlineKind.autorisation,
    },
    ...PROPERTIES.map((p) => ({ dl: cpeExpiryDeadline(p.name, p.cpeIssuedOn) })),
    ...PROPERTIES.filter((p) => p.syndicMandateStart).map((p) => ({
      dl: syndicMandateDeadline(`${p.name} · ${p.syndicName}`, p.syndicMandateStart!),
    })),
    ...PROPERTIES.filter((p) => p.nextAgDate).map((p) => ({
      dl: agConvocationDeadline(p.name, p.nextAgDate!, false),
    })),
    {
      dl: communeArrivalDeadline(
        `${demo.contactById("c-weber").name} (${demo.unitById("u-b-2a").label})`,
        "2026-08-18",
      ),
    },
    { dl: defectWindowEnd(demo.propertyById("p-bertrange").name, "2026-12-01") },
  ];

  const sorted = deadlines
    .map((x) => ({ ...x, status: deadlineStatus(x.dl, TODAY, x.done) }))
    .sort((a, b) => (a.dl.dueAt < b.dl.dueAt ? -1 : 1));

  const vacantUnits = UNITS.filter((u) => u.vacantSince).map((u) => ({
    unit: u,
    clock: vacancyClock(u.label, u.vacantSince!, TODAY),
  }));

  const params = paramsInForce(TODAY);
  const uncertain = params.filter((p) => p.status === "uncertain");

  return (
    <div>
      <PageHeader title={d.conformite.title} subtitle={d.conformite.subtitle} />

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Panel title={d.conformite.calendarTitle}>
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
                      {dl.relatedLabel} · {dl.legalBasis}
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

        <div className="flex flex-col gap-5">
          <Panel title={d.conformite.orgTitle}>
            <ul className="space-y-2.5 text-sm">
              <li className="flex items-center justify-between gap-3">
                <span className="text-ink-soft">{d.conformite.orgAutorisation}</span>
                <span className="font-semibold tabular-nums text-ink">{ORG.autorisationNumber}</span>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span className="text-ink-soft">{d.conformite.orgExpiry}</span>
                <span className="font-semibold tabular-nums text-ink">
                  {formatDate(ORG.autorisationExpiry, locale)}
                </span>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span className="text-ink-soft">{d.conformite.orgRc}</span>
                <span className="font-semibold text-ink">{ORG.piInsuranceProvider}</span>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span className="text-ink-soft">{d.conformite.orgRcExpiry}</span>
                <Badge className="bg-amber-100 text-amber-800">{formatDate(ORG.piInsuranceExpiry, locale)}</Badge>
              </li>
            </ul>
            <LegalNote>{d.conformite.orgLegal}</LegalNote>
          </Panel>

          <Panel title={fmt(d.conformite.paramsTitle, { n: params.length })}>
            <p className="text-sm leading-relaxed text-ink-soft">{d.conformite.paramsBody}</p>
            <div className="mt-3 rounded-xl bg-sand-50 p-3.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                {fmt(d.conformite.paramsUncertain, { n: uncertain.length })}
              </p>
              <ul className="mt-2 space-y-1.5">
                {uncertain.slice(0, 5).map((p) => (
                  <li key={p.key} className="text-xs text-ink-soft">
                    <code className="rounded bg-white px-1.5 py-0.5 text-[11px] text-accent-700">{p.key}</code>
                    {p.note && <span className="ml-1.5">{p.note}</span>}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-ink-soft">{d.conformite.paramsFoot}</p>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
