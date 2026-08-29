import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, PageHeader } from "@/components/pro/ui";
import { LegalNote, MetaBadge, Panel } from "@/components/gestion/bits";
import TenantInvite from "@/components/gestion/TenantInvite";
import { getDemo } from "@/lib/demo";
import {
  depositFormLabels,
  euros,
  formatDate,
  formatMonth,
  initials,
  leaseStatusMeta,
  leaseTypeMeta,
  rentStatusMeta,
} from "@/lib/types";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";
import { leaseIssueText } from "@/lib/i18n/engine";
import { commercialRenewalCalendar, validateLeaseDraft } from "@/domain/lease/rules";
import { computeCapitalInvesti, checkRentCeiling } from "@/domain/indexation/engine";
import { rentVat } from "@/domain/fiscal/vat";
import { getParamValue } from "@/domain/legal/params";

// No generateStaticParams: the page reads the locale cookie, so it must be
// request-rendered — a build-time prerender would bake one language in.

export default async function BailDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { locale, d } = await getI18n();
  const { DEPOSITS, LEASES, RENT_PERIODS, TODAY, contactById, leaseById, leaseTenantNames, leaseUnitLabel, propertyById, unitById } = await getDemo();
  const lease = LEASES.find((l) => l.id === id);
  if (!lease) notFound();
  const l = leaseById(id);
  const unit = unitById(l.unitId);
  const property = propertyById(unit.propertyId);
  const deposit = DEPOSITS.find((x) => x.leaseId === l.id);
  const periods = RENT_PERIODS.filter((rp) => rp.leaseId === l.id).slice(-4).reverse();
  const rentMeta = rentStatusMeta(d);
  const depositForms = depositFormLabels(d);

  // ── Rule pack, computed live ──
  const issues = validateLeaseDraft(
    {
      type: l.type,
      startDate: l.startDate,
      endDate: l.endDate,
      monthlyRent: l.rentCents,
      monthlyCharges: l.chargesCents,
      depositMonths: l.depositMonths,
      depositForm: l.depositForm,
      mentions: {
        parties_identity: "ok",
        property_designation: "ok",
        lease_start_date: "ok",
        duration_or_indefinite: "ok",
        rent_amount: "ok",
        charges_regime: "ok",
        deposit_terms: "ok",
        capital_investi_declaration: l.capitalComponents.length > 0 || l.type === "commercial" ? "ok" : "",
      },
      hasCpiEscalationClause: l.type === "residential" ? false : Boolean(l.indexationClause),
      furnished: unit.furnished,
      furnitureSupplement: l.furnitureSupplementCents || undefined,
      furnitureInvoiceTotal: l.furnitureInvoiceTotalCents || undefined,
      colocation: l.colocation,
      pacteColocationAttached: l.colocation ? true : undefined,
    },
    TODAY,
  );
  // Superset of template vars — each issue template picks the ones it uses.
  const issueVars = {
    months: l.depositMonths,
    max: getParamValue(
      l.type === "residential" ? "residential.deposit_max_months" : "commercial.deposit_max_months",
      TODAY,
    ),
    date: l.endDate ? formatDate(l.endDate, locale) : "—",
  };

  const capital =
    l.type === "residential" && l.capitalComponents.length > 0
      ? computeCapitalInvesti(l.capitalComponents, TODAY)
      : null;
  const ceiling = capital
    ? checkRentCeiling(l.rentCents, capital, l.colocation ? { colocationCombinedRents: l.rentCents } : {})
    : null;

  const renewal =
    l.type === "commercial" && l.endDate ? commercialRenewalCalendar(l.startDate, l.endDate) : null;

  const vatLine = rentVat(
    l.rentCents + l.chargesCents,
    l.vatRegime,
    "2026-08-01",
    l.vatOption?.effectiveFrom ?? null,
  );

  return (
    <div>
      <div className="mb-2">
        <Link href="/app/baux" className="text-sm font-semibold text-brand-700 hover:underline">
          {d.baux.backToList}
        </Link>
      </div>
      <PageHeader
        title={leaseUnitLabel(l)}
        subtitle={`${leaseTenantNames(l).join(", ")} · ${fmt(d.baux.since, { date: formatDate(l.startDate, locale) })}${
          l.endDate ? ` · ${fmt(d.baux.until, { date: formatDate(l.endDate, locale) })}` : ` · ${d.baux.indefinite}`
        }`}
        actions={
          <div className="flex items-center gap-2">
            <MetaBadge meta={leaseTypeMeta(d)[l.type]} />
            <MetaBadge meta={leaseStatusMeta(d)[l.status]} />
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{d.baux.kpiRent}</p>
          <p className="mt-1 font-display text-2xl font-bold tracking-tight tabular-nums text-ink">
            {euros(l.rentCents, locale)}
          </p>
          <p className="mt-0.5 text-xs text-ink-soft">
            {fmt(d.baux.kpiRentSub, {
              amount: euros(l.chargesCents, locale),
              regime: l.chargesRegime === "advances" ? d.baux.regimeAdvances : d.baux.regimeForfait,
            })}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{d.baux.kpiVat}</p>
          <p className="mt-1 font-display text-2xl font-bold tracking-tight tabular-nums text-ink">
            {vatLine.vatRatePct > 0 ? `${vatLine.vatRatePct} %` : d.baux.vatExempt}
          </p>
          <p className="mt-0.5 truncate text-xs text-ink-soft" title={vatLine.exemptionMention ?? undefined}>
            {vatLine.vatRatePct > 0
              ? fmt(d.baux.vatAmountSub, { amount: euros(vatLine.vat, locale) })
              : d.baux.vatExemptSub}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{d.baux.kpiDeposit}</p>
          <p className="mt-1 font-display text-2xl font-bold tracking-tight tabular-nums text-ink">
            {l.depositMonths} {d.common.months}
          </p>
          <p className="mt-0.5 text-xs text-ink-soft">
            {depositForms[l.depositForm]}
            {deposit ? ` · ${euros(deposit.amountCents, locale)}` : ""}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{d.baux.kpiRf}</p>
          <p className="mt-1 break-all font-display text-lg font-bold tabular-nums text-brand-800">{l.rfReference}</p>
          <p className="mt-0.5 text-xs text-ink-soft">{d.baux.kpiRfSub}</p>
        </Card>
      </div>

      <div className="mt-5 grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <Panel title={d.baux.complianceTitle}>
          {issues.length === 0 ? (
            <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <svg className="h-5 w-5 shrink-0 text-emerald-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
              </svg>
              <p className="text-sm font-semibold text-emerald-800">
                {fmt(d.baux.compliancePass, {
                  pack: l.type === "residential" ? d.baux.packResidential : d.baux.packCommercial,
                })}
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {issues.map((i) => (
                <li
                  key={i.code}
                  className={
                    "rounded-xl border px-4 py-3 text-sm " +
                    (i.severity === "blocking"
                      ? "border-red-200 bg-red-50 text-red-700"
                      : "border-amber-200 bg-amber-50 text-amber-800")
                  }
                >
                  <p className="font-semibold">{leaseIssueText(d, i.code, issueVars, i.message)}</p>
                  <p className="mt-0.5 text-xs">{i.legalBasis}</p>
                </li>
              ))}
            </ul>
          )}

          {l.type === "residential" && (
            <ul className="mt-4 space-y-2 text-sm">
              <li className="flex items-center justify-between gap-3">
                <span className="text-ink-soft">{d.baux.checkMentions}</span>
                <Badge className="bg-emerald-100 text-emerald-800">{d.baux.checkMentionsOk}</Badge>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span className="text-ink-soft">{d.baux.checkCpi}</span>
                <Badge className="bg-emerald-100 text-emerald-800">{d.baux.checkCpiOk}</Badge>
              </li>
              {l.colocation && (
                <li className="flex items-center justify-between gap-3">
                  <span className="text-ink-soft">{d.baux.checkPacte}</span>
                  <Badge className="bg-emerald-100 text-emerald-800">{d.baux.checkPacteOk}</Badge>
                </li>
              )}
              {ceiling && (
                <li className="flex items-center justify-between gap-3">
                  <span className="text-ink-soft">
                    {d.baux.checkCeiling}
                    {l.colocation ? ` ${d.baux.checkCeilingColoc}` : ""}
                  </span>
                  <Badge className={ceiling.compliant ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-700"}>
                    {ceiling.compliant
                      ? fmt(d.baux.ceilingOk, { amount: euros(ceiling.monthlyCeiling, locale) })
                      : fmt(d.baux.ceilingOver, { amount: euros(ceiling.excess, locale) })}
                  </Badge>
                </li>
              )}
            </ul>
          )}

          {l.noticeInfo && (
            <div className="mt-4 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3">
              <p className="text-sm font-semibold text-orange-800">
                {fmt(d.baux.noticeTitle, {
                  who: l.noticeInfo.direction === "tenant" ? d.baux.noticeTenant : d.baux.noticeLandlord,
                  date: formatDate(l.noticeInfo.arReceivedOn, locale),
                })}
              </p>
              <p className="mt-0.5 text-xs text-orange-800">
                {fmt(d.baux.noticeEarliestEnd, { date: formatDate(l.noticeInfo.earliestEnd, locale) })}
              </p>
            </div>
          )}

          {capital && (
            <LegalNote>
              {fmt(d.baux.capitalLegal, {
                total: euros(capital.revaluedTotal, locale),
                monthly: euros(capital.monthlyRentCeiling, locale),
                ref: capital.tableProvenance.circularRef,
              })}
              {capital.tableProvenance.status === "uncertain" && d.baux.capitalUncertain}
            </LegalNote>
          )}
        </Panel>

        <div className="flex flex-col gap-5">
          {renewal && (
            <Panel title={d.baux.commercialTitle}>
              <ul className="space-y-2.5 text-sm">
                <li className="flex items-center justify-between gap-3">
                  <span className="text-ink-soft">{d.baux.commercialRenewal}</span>
                  <span className="font-semibold tabular-nums text-ink">
                    {fmt(d.baux.commercialRenewalBefore, { date: formatDate(renewal.renewalRequestDeadline, locale) })}
                  </span>
                </li>
                <li className="flex items-center justify-between gap-3">
                  <span className="text-ink-soft">{d.baux.commercialIndemnity}</span>
                  <span className="font-semibold tabular-nums text-ink">
                    {fmt(d.baux.commercialFrom, { date: formatDate(renewal.evictionIndemnityFrom, locale) })}
                  </span>
                </li>
                <li className="flex items-center justify-between gap-3">
                  <span className="text-ink-soft">{d.baux.commercialPreemption}</span>
                  <span className="font-semibold tabular-nums text-ink">
                    {fmt(d.baux.commercialFrom, { date: formatDate(renewal.preemptionFrom, locale) })}
                  </span>
                </li>
                <li className="flex items-center justify-between gap-3">
                  <span className="text-ink-soft">{d.baux.commercialPasDePorte}</span>
                  <Badge className="bg-emerald-100 text-emerald-800">{d.baux.commercialPasDePorteVoid}</Badge>
                </li>
              </ul>
              {l.vatOption && (
                <div className="mt-4 rounded-xl bg-sand-50 px-4 py-3 text-xs leading-relaxed text-ink-soft">
                  <p className="font-semibold text-ink">{d.baux.vatOptionTitle}</p>
                  <p className="mt-0.5">
                    {fmt(d.baux.vatOptionBody, {
                      ref: l.vatOption.aedApprovalRef,
                      decision: formatDate(l.vatOption.decisionDate, locale),
                      effective: formatDate(l.vatOption.effectiveFrom, locale),
                      ratio: l.vatOption.tenantDeductionRatioPct,
                    })}
                  </p>
                </div>
              )}
            </Panel>
          )}

          <Panel title={d.baux.partiesTitle}>
            <ul className="divide-y divide-sand-100">
              {l.tenantContactIds.map((cid) => {
                const c = contactById(cid);
                return (
                  <li key={cid} className="flex items-center gap-3 py-2.5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-800">
                      {initials(c.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/app/contacts/${c.id}`}
                        className="block truncate text-sm font-semibold text-ink hover:text-brand-700"
                      >
                        {c.name}
                      </Link>
                      <p className="truncate text-xs text-ink-soft">{c.email ?? c.phone}</p>
                    </div>
                    <Badge className="bg-sky-100 text-sky-800">
                      {l.colocation ? d.baux.partyColoc : d.baux.partyTenant}
                    </Badge>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-xs text-ink-soft">
              {property.name} · {property.address} · {fmt(d.baux.cadastralRef, { ref: property.cadastralRef })}
            </p>
          </Panel>

          <Panel title={d.baux.portalTitle}>
            <p className="mb-3 text-xs leading-relaxed text-ink-soft">{d.baux.portalBody}</p>
            <div className="space-y-3">
              {l.tenantContactIds.map((cid) => {
                const c = contactById(cid);
                return (
                  <TenantInvite
                    key={cid}
                    d={d}
                    tenantName={c.name}
                    link={`https://app.morada.lu/locataire/onboarding?bail=${l.rfReference}`}
                  />
                );
              })}
            </div>
          </Panel>

          <Panel
            title={d.baux.periodsTitle}
            action={
              <Link href="/app/loyers" className="text-sm font-semibold text-brand-700 hover:underline">
                {d.hubs.collections}
              </Link>
            }
          >
            <ul className="divide-y divide-sand-100">
              {periods.map((rp) => (
                <li key={rp.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <p className="min-w-0 flex-1 text-ink">{formatMonth(rp.period, locale)}</p>
                  <p className="tabular-nums text-ink">{euros(rp.totalCents, locale)}</p>
                  <MetaBadge meta={rentMeta[rp.status]} />
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
