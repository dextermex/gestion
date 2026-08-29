import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, PageHeader } from "@/components/pro/ui";
import { LegalNote, MetaBadge, Panel } from "@/components/gestion/bits";
import TenantInvite from "@/components/gestion/TenantInvite";
import { getDemo, isSampleData } from "@/lib/demo";
import {
  depositFormLabels,
  depositStatusMeta,
  edlStatusMeta,
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
import { leaseIssueText, settlementNotes } from "@/lib/i18n/engine";
import { commercialRenewalCalendar, validateLeaseDraft } from "@/domain/lease/rules";
import { computeCapitalInvesti, checkRentCeiling } from "@/domain/indexation/engine";
import { computeSettlement } from "@/domain/deposits/settlement";
import { rentVat } from "@/domain/fiscal/vat";
import { getParamValue } from "@/domain/legal/params";

// No generateStaticParams: the page reads the locale cookie, so it must be
// request-rendered — a build-time prerender would bake one language in.

/**
 * The lease sheet: the hero screen of the product. One object, one door —
 * the rent ledger, the contract pack, the deposit, the indexation clock,
 * the EDLs and the tenant's threads are walls of the same room, not pages
 * scattered across the app. The header and vital signs stay put; the tabs
 * switch what is under them.
 */

const TABS = ["loyer", "contrat", "garantie", "indexation", "edl", "messages"] as const;
type Tab = (typeof TABS)[number];

export default async function BailDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ onglet?: string }>;
}) {
  const [{ id }, { onglet }] = await Promise.all([params, searchParams]);
  const sample = await isSampleData();
  const tab: Tab = (TABS as readonly string[]).includes(onglet ?? "") ? (onglet as Tab) : "loyer";
  const { locale, d } = await getI18n();
  const {
    CONVERSATIONS,
    DEPOSITS,
    DOCUMENTS,
    EDLS,
    LEASES,
    RENT_PERIODS,
    TODAY,
    contactById,
    leaseById,
    leaseTenantNames,
    leaseUnitLabel,
    propertyById,
    unitById,
  } = await getDemo();
  const lease = LEASES.find((l) => l.id === id);
  if (!lease) notFound();
  const l = leaseById(id);
  const unit = unitById(l.unitId);
  const property = propertyById(unit.propertyId);
  const unitLabel = leaseUnitLabel(l);
  const unitShort = unitLabel.split(" · ")[0];

  const deposit = DEPOSITS.find((x) => x.leaseId === l.id);
  const periods = RENT_PERIODS.filter((rp) => rp.leaseId === l.id).slice(-12).reverse();
  const edls = EDLS.filter((e) => e.leaseId === l.id);
  const docs = DOCUMENTS.filter((doc) => doc.relatedLabel !== "" && unitLabel.includes(doc.relatedLabel));
  // Threads carry a human scope label, not a foreign key: the lease claims
  // the ones naming its unit. A miss only means the tab shows its empty state.
  const threads = CONVERSATIONS.filter((c) => unitShort.length >= 3 && c.scopeLabel.includes(unitShort));

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

  // ── Deposit settlement, when a restitution is running ──
  const settlementInput =
    deposit && deposit.status !== "held"
      ? {
          depositAmount: deposit.amountCents,
          depositForm: deposit.form,
          monthlyRent: l.rentCents,
          keyHandoverDate: deposit.keyHandoverOn ?? TODAY,
          decompteIssuedAt: deposit.decompteIssuedOn ?? null,
          entryEdlExists: deposit.entryEdlExists,
          deductions: deposit.deductions.map((x) => ({
            id: x.id,
            kind: x.kind,
            label: x.label,
            amount: x.amountCents,
            justificationDocRef: x.justificationDocRef,
            justifiedAt: x.justifiedAt,
            edlItemRef: x.edlItemRef,
          })),
          miseEnDemeureArDate: deposit.miseEnDemeureArOn ?? null,
          releasedFirstTranche: deposit.releasedFirstTrancheCents,
          releasedBalance: deposit.releasedBalanceCents,
          asOf: TODAY,
        }
      : null;
  const settlement = settlementInput ? computeSettlement(settlementInput) : null;
  const settlementWarnings =
    settlementInput && settlement ? settlementNotes(d, locale, settlementInput, settlement) : [];

  const LINE_STATUS: Record<string, { label: string; color: string }> = {
    justified: { label: d.garanties.lineJustified, color: "bg-emerald-100 text-emerald-800" },
    pending: { label: d.garanties.linePending, color: "bg-amber-100 text-amber-800" },
    expired_forfeited: { label: d.garanties.lineForfeited, color: "bg-red-100 text-red-700" },
    blocked_no_entry_edl: { label: d.garanties.lineBlocked, color: "bg-red-100 text-red-700" },
  };

  const EDL_KIND: Record<string, string> = {
    entry: d.baux.edlKindEntry,
    intermediate: d.baux.edlKindIntermediate,
    exit: d.baux.edlKindExit,
  };
  const edlMeta = edlStatusMeta(d);
  const depositMeta = depositStatusMeta(d);

  const tabHref = (t: Tab) => (t === "loyer" ? `/app/baux/${l.id}` : `/app/baux/${l.id}?onglet=${t}`);
  const tabLabels: Record<Tab, string> = {
    loyer: d.baux.tabLoyer,
    contrat: d.baux.tabContrat,
    garantie: d.baux.tabGarantie,
    indexation: d.baux.tabIndexation,
    edl: d.baux.tabEdl,
    messages: d.baux.tabMessages,
  };

  return (
    <div>
      <div className="mb-2">
        <Link href="/app/baux" className="text-sm font-semibold text-brand-700 hover:underline">
          {d.baux.backToList}
        </Link>
      </div>
      <PageHeader
        title={unitLabel}
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

      {/* The vital signs stay put; the tabs below switch the detail. */}
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

      <nav
        aria-label={d.baux.tabsAria}
        className="no-scrollbar mt-6 mb-5 flex gap-0.5 overflow-x-auto border-b border-sand-200"
      >
        {TABS.map((t) => (
          <Link
            key={t}
            href={tabHref(t)}
            aria-current={t === tab ? "page" : undefined}
            className={
              "tactile -mb-px inline-flex items-center whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600 max-sm:min-h-11 " +
              (t === tab
                ? "border-brand-600 font-semibold text-brand-800"
                : "border-transparent font-medium text-ink-soft hover:border-sand-300 hover:text-ink")
            }
          >
            {tabLabels[t]}
          </Link>
        ))}
      </nav>

      {/* ── Loyer & paiements ── */}
      {tab === "loyer" && (
        <div className="grid grid-cols-1 items-start gap-5">
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
      )}

      {/* ── Contrat & documents ── */}
      {tab === "contrat" && (
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
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
              </ul>
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

            <Panel
              title={d.baux.docsTitle}
              action={
                <Link href="/app/documents" className="text-sm font-semibold text-brand-700 hover:underline">
                  {d.hubs.library}
                </Link>
              }
            >
              {docs.length === 0 ? (
                <p className="text-sm text-ink-soft">{d.baux.docsNone}</p>
              ) : (
                <ul className="divide-y divide-sand-100">
                  {docs.map((doc) => (
                    <li key={doc.id} className="flex items-center gap-3 py-2.5 text-sm">
                      <p className="min-w-0 flex-1 truncate text-ink" title={doc.name}>
                        {doc.name}
                      </p>
                      {doc.sealed && (
                        <Badge className="bg-brand-50 text-brand-800">{d.baux.edlSealed}</Badge>
                      )}
                      <p className="shrink-0 text-xs tabular-nums text-ink-soft">
                        {formatDate(doc.createdAt, locale)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      )}

      {/* ── Garantie ── */}
      {tab === "garantie" && (
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
          {!deposit ? (
            <Panel title={d.baux.tabGarantie}>
              <p className="text-sm text-ink-soft">{d.baux.garantieNone}</p>
            </Panel>
          ) : (
            <Panel title={d.garanties.deposit}>
              <ul className="space-y-2.5 text-sm">
                <li className="flex items-center justify-between gap-3">
                  <span className="text-ink-soft">{d.garanties.deposit}</span>
                  <span className="font-semibold tabular-nums text-ink">
                    {depositForms[deposit.form]} · {euros(deposit.amountCents, locale)}
                  </span>
                </li>
                <li className="flex items-center justify-between gap-3">
                  <span className="text-ink-soft">{d.baux.colStatus}</span>
                  <MetaBadge meta={depositMeta[deposit.status]} />
                </li>
                {deposit.keyHandoverOn && (
                  <li className="flex items-center justify-between gap-3">
                    <span className="text-ink-soft">
                      {fmt(d.garanties.keysReturned, { date: formatDate(deposit.keyHandoverOn, locale) })}
                    </span>
                  </li>
                )}
              </ul>
              {settlement && (
                <ul className="mt-4 space-y-2.5 border-t border-sand-100 pt-4 text-sm">
                  <li className="flex items-center justify-between gap-3">
                    <span className="text-ink-soft">{d.garanties.validRetentions}</span>
                    <span className="font-semibold tabular-nums text-ink">
                      {euros(settlement.totalRetained, locale)}
                    </span>
                  </li>
                  <li className="flex items-center justify-between gap-3">
                    <span className="text-ink-soft">{d.garanties.dueToTenant}</span>
                    <span className="font-semibold tabular-nums text-brand-800">
                      {euros(settlement.outstandingToTenant, locale)}
                    </span>
                  </li>
                </ul>
              )}
              <LegalNote>{d.garanties.legal}</LegalNote>
            </Panel>
          )}

          {deposit && settlement && (
            <Panel title={fmt(d.garanties.settlementTitle, { label: unitShort })}>
              <ul className="space-y-2">
                {settlement.lines.map((line) => (
                  <li key={line.id} className="rounded-xl border border-sand-200 px-4 py-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <p className="min-w-0 flex-1 font-semibold text-ink">{line.label}</p>
                      <p className="tabular-nums text-ink">{euros(line.amount, locale)}</p>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-3">
                      <p className="text-xs text-ink-soft">
                        {line.justificationDocRef
                          ? fmt(d.garanties.lineDoc, { ref: line.justificationDocRef })
                          : d.garanties.linePending}
                      </p>
                      {LINE_STATUS[line.status] && (
                        <Badge className={LINE_STATUS[line.status].color}>{LINE_STATUS[line.status].label}</Badge>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              {settlementWarnings.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {settlementWarnings.map((w) => (
                    <li key={w} className="rounded-xl bg-amber-50 px-4 py-2.5 text-xs leading-relaxed text-amber-800">
                      {w}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
        </div>
      )}

      {/* ── Indexation ── */}
      {tab === "indexation" && (
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
          <Panel title={d.baux.tabIndexation}>
            {ceiling && (
              <ul className="space-y-2.5 text-sm">
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
              </ul>
            )}
            {l.type === "commercial" && (
              <p className="text-sm leading-relaxed text-ink-soft">
                {l.indexationClause ? d.baux.indexClauseCommercial : d.baux.indexClauseNone}
              </p>
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
            {!ceiling && l.type === "residential" && (
              <p className="text-sm text-ink-soft">{d.baux.indexNoCapital}</p>
            )}
          </Panel>
          <Panel title={d.hubs.indexation}>
            <Link
              href="/app/indexation"
              className="tactile block rounded-xl border border-sand-200 p-4 transition duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:border-brand-200 hover:bg-sand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              <p className="text-sm font-semibold text-brand-700">{d.baux.indexAllLink}</p>
            </Link>
          </Panel>
        </div>
      )}

      {/* ── EDL & entrées/sorties ── */}
      {tab === "edl" && (
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
          <Panel title={d.baux.edlTitle}>
            {edls.length === 0 ? (
              <p className="text-sm text-ink-soft">{d.baux.edlNone}</p>
            ) : (
              <ul className="divide-y divide-sand-100">
                {edls.map((e) => (
                  <li key={e.id} className="py-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-ink">{EDL_KIND[e.kind]}</p>
                      <MetaBadge meta={edlMeta[e.status]} />
                    </div>
                    <p className="mt-1 text-xs text-ink-soft">
                      {e.completedAt
                        ? fmt(d.baux.edlDone, { date: formatDate(e.completedAt, locale) })
                        : e.scheduledAt
                          ? fmt(d.baux.edlScheduled, { date: formatDate(e.scheduledAt, locale) })
                          : "—"}
                      {e.itemsCount > 0 &&
                        ` · ${fmt(d.baux.edlItems, { items: e.itemsCount, photos: e.photosCount })}`}
                    </p>
                    {e.hashSealed && (
                      <Badge className="mt-2 bg-brand-50 text-brand-800">{d.baux.edlSealed}</Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {l.noticeInfo && (
            <Panel title={d.baux.moveTitle}>
              <div className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-3">
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
            </Panel>
          )}
        </div>
      )}

      {/* ── Messages du locataire ── */}
      {tab === "messages" && (
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
          <Panel
            title={d.baux.tabMessages}
            action={
              <Link href="/app/messages" className="text-sm font-semibold text-brand-700 hover:underline">
                {d.baux.msgsOpen}
              </Link>
            }
          >
            {threads.length === 0 ? (
              <p className="text-sm text-ink-soft">{d.baux.msgsNone}</p>
            ) : (
              <ul className="divide-y divide-sand-100">
                {threads.map((c) => {
                  const last = c.messages[c.messages.length - 1];
                  return (
                    <li key={c.id} className="py-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{c.subject}</p>
                        {c.unread > 0 && (
                          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-600 px-1.5 text-[10px] font-bold tabular-nums text-white">
                            {c.unread}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-ink-soft">
                        {last.from} : {last.body}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          {/* The tenant portal invitation flow is demonstrated on the sample
              cabinets; the real token-based onboarding is not live yet, so a
              real account gets no pretend send button. */}
          {sample && (
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
          )}
        </div>
      )}
    </div>
  );
}
