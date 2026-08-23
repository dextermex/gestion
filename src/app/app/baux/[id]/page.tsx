import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, PageHeader } from "@/components/pro/ui";
import { LegalNote, MetaBadge, Panel } from "@/components/gestion/bits";
import {
  DEPOSITS,
  LEASES,
  RENT_PERIODS,
  TODAY,
  contactById,
  leaseById,
  leaseTenantNames,
  leaseUnitLabel,
  propertyById,
  unitById,
} from "@/lib/demo/data";
import {
  DEPOSIT_FORM_LABELS,
  LEASE_STATUS_META,
  LEASE_TYPE_META,
  RENT_STATUS_META,
  euros,
  formatDate,
  formatMonth,
} from "@/lib/types";
import { commercialRenewalCalendar, validateLeaseDraft } from "@/domain/lease/rules";
import { computeCapitalInvesti, checkRentCeiling } from "@/domain/indexation/engine";
import { rentVat } from "@/domain/fiscal/vat";

export function generateStaticParams() {
  return LEASES.map((l) => ({ id: l.id }));
}

export default async function BailDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lease = LEASES.find((l) => l.id === id);
  if (!lease) notFound();
  const l = leaseById(id);
  const unit = unitById(l.unitId);
  const property = propertyById(unit.propertyId);
  const deposit = DEPOSITS.find((d) => d.leaseId === l.id);
  const periods = RENT_PERIODS.filter((rp) => rp.leaseId === l.id).slice(-4).reverse();

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
          ← Baux
        </Link>
      </div>
      <PageHeader
        title={leaseUnitLabel(l)}
        subtitle={`${leaseTenantNames(l).join(", ")} · depuis le ${formatDate(l.startDate)}${l.endDate ? ` · terme le ${formatDate(l.endDate)}` : " · durée indéterminée"}`}
        actions={
          <div className="flex items-center gap-2">
            <MetaBadge meta={LEASE_TYPE_META[l.type]} />
            <MetaBadge meta={LEASE_STATUS_META[l.status]} />
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft/70">Loyer mensuel</p>
          <p className="mt-1 font-display text-2xl font-bold tabular-nums text-ink">{euros(l.rentCents)}</p>
          <p className="mt-0.5 text-xs text-ink-soft">+ {euros(l.chargesCents)} de {l.chargesRegime === "advances" ? "provisions" : "forfait"}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft/70">TVA</p>
          <p className="mt-1 font-display text-2xl font-bold tabular-nums text-ink">
            {vatLine.vatRatePct > 0 ? `${vatLine.vatRatePct} %` : "Exonéré"}
          </p>
          <p className="mt-0.5 truncate text-xs text-ink-soft" title={vatLine.exemptionMention ?? undefined}>
            {vatLine.vatRatePct > 0 ? `soit ${euros(vatLine.vat)} / mois` : "art. 44, §1, g) loi TVA"}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft/70">Garantie</p>
          <p className="mt-1 font-display text-2xl font-bold tabular-nums text-ink">{l.depositMonths} mois</p>
          <p className="mt-0.5 text-xs text-ink-soft">{DEPOSIT_FORM_LABELS[l.depositForm]}{deposit ? ` · ${euros(deposit.amountCents)}` : ""}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft/70">Référence RF</p>
          <p className="mt-1 font-display text-lg font-bold tabular-nums text-brand-800">{l.rfReference}</p>
          <p className="mt-0.5 text-xs text-ink-soft">permanente, sur chaque avis + QR</p>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel title="Conformité du bail">
          {issues.length === 0 ? (
            <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <svg className="h-5 w-5 text-emerald-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
              </svg>
              <p className="text-sm font-semibold text-emerald-800">
                Pack de règles {l.type === "residential" ? "habitation (loi 21.9.2006 rév. 2024)" : "commercial (loi 3.2.2018)"} — aucune non-conformité.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {issues.map((i) => (
                <li key={i.code} className={"rounded-xl border px-4 py-3 text-sm " + (i.severity === "blocking" ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-800")}>
                  <p className="font-semibold">{i.message}</p>
                  <p className="mt-0.5 text-xs opacity-80">{i.legalBasis}</p>
                </li>
              ))}
            </ul>
          )}

          {l.type === "residential" && (
            <ul className="mt-4 space-y-2 text-sm">
              <li className="flex items-center justify-between gap-3">
                <span className="text-ink-soft">8 mentions obligatoires</span>
                <Badge className="bg-emerald-100 text-emerald-800">Complètes</Badge>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span className="text-ink-soft">Clause d&apos;indexation CPI</span>
                <Badge className="bg-emerald-100 text-emerald-800">Absente (interdite)</Badge>
              </li>
              {l.colocation && (
                <li className="flex items-center justify-between gap-3">
                  <span className="text-ink-soft">Pacte de colocation</span>
                  <Badge className="bg-emerald-100 text-emerald-800">Signé avec le bail</Badge>
                </li>
              )}
              {ceiling && (
                <li className="flex items-center justify-between gap-3">
                  <span className="text-ink-soft">
                    Plafond légal — 5 % du capital investi réévalué{l.colocation ? " (loyers cumulés)" : ""}
                  </span>
                  <Badge className={ceiling.compliant ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-700"}>
                    {ceiling.compliant ? `≤ ${euros(ceiling.monthlyCeiling)}` : `Dépassement ${euros(ceiling.excess)}`}
                  </Badge>
                </li>
              )}
            </ul>
          )}

          {l.noticeInfo && (
            <div className="mt-4 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3">
              <p className="text-sm font-semibold text-orange-800">
                Préavis {l.noticeInfo.direction === "tenant" ? "du locataire" : "du bailleur"} — AR reçu le {formatDate(l.noticeInfo.arReceivedOn)}
              </p>
              <p className="mt-0.5 text-xs text-orange-800/80">
                Fin licite la plus proche : {formatDate(l.noticeInfo.earliestEnd)} (calculée depuis la
                date de l&apos;AR, jamais depuis l&apos;envoi).
              </p>
            </div>
          )}

          {capital && (
            <LegalNote>
              Capital investi réévalué : {euros(capital.revaluedTotal)} → plafond {euros(capital.monthlyRentCeiling)}/mois.
              Coefficients : {capital.tableProvenance.circularRef}
              {capital.tableProvenance.status === "uncertain" && " — valeurs d'amorçage, circulaire à ingérer."}
            </LegalNote>
          )}
        </Panel>

        <div className="flex flex-col gap-5">
          {renewal && (
            <Panel title="Calendrier commercial (loi 3.2.2018)">
              <ul className="space-y-2.5 text-sm">
                <li className="flex items-center justify-between gap-3">
                  <span className="text-ink-soft">Demande de renouvellement (LRAR, ≥ 6 mois avant terme)</span>
                  <span className="font-semibold tabular-nums text-ink">avant le {formatDate(renewal.renewalRequestDeadline)}</span>
                </li>
                <li className="flex items-center justify-between gap-3">
                  <span className="text-ink-soft">Indemnité d&apos;éviction (refus sans motif possible)</span>
                  <span className="font-semibold tabular-nums text-ink">dès le {formatDate(renewal.evictionIndemnityFrom)}</span>
                </li>
                <li className="flex items-center justify-between gap-3">
                  <span className="text-ink-soft">Droit de préemption du preneur (18 ans d&apos;occupation)</span>
                  <span className="font-semibold tabular-nums text-ink">dès le {formatDate(renewal.preemptionFrom)}</span>
                </li>
                <li className="flex items-center justify-between gap-3">
                  <span className="text-ink-soft">Pas-de-porte</span>
                  <Badge className="bg-emerald-100 text-emerald-800">Nul de plein droit</Badge>
                </li>
              </ul>
              {l.vatOption && (
                <div className="mt-4 rounded-xl bg-sand-50 px-4 py-3 text-xs leading-relaxed text-ink-soft">
                  <p className="font-semibold text-ink">Option TVA active — 17 %</p>
                  <p className="mt-0.5">
                    Agrément AED {l.vatOption.aedApprovalRef} du {formatDate(l.vatOption.decisionDate)} ·
                    effet au {formatDate(l.vatOption.effectiveFrom)} (1er jour du mois suivant, jamais
                    rétroactif) · ratio de déduction du preneur {l.vatOption.tenantDeductionRatioPct} %
                    (recertification périodique).
                  </p>
                </div>
              )}
            </Panel>
          )}

          <Panel title="Parties">
            <ul className="divide-y divide-sand-100">
              {l.tenantContactIds.map((cid) => {
                const c = contactById(cid);
                return (
                  <li key={cid} className="flex items-center gap-3 py-2.5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-800">
                      {c.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}
                    </span>
                    <div className="min-w-0 flex-1">
                      <Link href={`/app/contacts/${c.id}`} className="block truncate text-sm font-semibold text-ink hover:text-brand-700">
                        {c.name}
                      </Link>
                      <p className="truncate text-xs text-ink-soft">{c.email ?? c.phone}</p>
                    </div>
                    <Badge className="bg-sky-100 text-sky-800">
                      {l.colocation ? "Colocataire (solidaire)" : "Locataire"}
                    </Badge>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-xs text-ink-soft">
              {property.name} · {property.address} · Réf. cadastrale {property.cadastralRef}
            </p>
          </Panel>

          <Panel title="Dernières échéances" action={<Link href="/app/loyers" className="text-sm font-semibold text-brand-700 hover:underline">Loyers</Link>}>
            <ul className="divide-y divide-sand-100">
              {periods.map((rp) => (
                <li key={rp.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <p className="min-w-0 flex-1 text-ink">{formatMonth(rp.period)}</p>
                  <p className="tabular-nums text-ink">{euros(rp.totalCents)}</p>
                  <MetaBadge meta={RENT_STATUS_META[rp.status]} />
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
