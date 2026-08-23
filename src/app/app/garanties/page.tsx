import Link from "next/link";
import { Badge, Card, PageHeader } from "@/components/pro/ui";
import { LegalNote, MetaBadge, Panel } from "@/components/gestion/bits";
import {
  DEPOSITS,
  ENDED_LEASES,
  TODAY,
  leaseById,
  leaseTenantNames,
  leaseUnitLabel,
} from "@/lib/demo/data";
import { DEPOSIT_FORM_LABELS, DEPOSIT_STATUS_META, euros, formatDate } from "@/lib/types";
import { computeSettlement, releaseInstructions } from "@/domain/deposits/settlement";

export default function GarantiesPage() {
  const showcase = DEPOSITS.find((d) => d.id === "dep-gare")!;
  const endedLease = ENDED_LEASES[0];

  const settlement = computeSettlement({
    depositAmount: showcase.amountCents,
    depositForm: showcase.form,
    monthlyRent: endedLease.rentCents,
    keyHandoverDate: showcase.keyHandoverOn!,
    decompteIssuedAt: showcase.decompteIssuedOn ?? null,
    entryEdlExists: showcase.entryEdlExists,
    deductions: showcase.deductions.map((d) => ({
      id: d.id,
      kind: d.kind,
      label: d.label,
      amount: d.amountCents,
      justificationDocRef: d.justificationDocRef,
      justifiedAt: d.justifiedAt,
      edlItemRef: d.edlItemRef,
    })),
    miseEnDemeureArDate: showcase.miseEnDemeureArOn ?? null,
    releasedFirstTranche: showcase.releasedFirstTrancheCents,
    releasedBalance: showcase.releasedBalanceCents,
    asOf: TODAY,
  });

  const held = DEPOSITS.filter((d) => d.id !== "dep-gare");

  const LINE_STATUS: Record<string, { label: string; color: string }> = {
    justified: { label: "Justifiée", color: "bg-emerald-100 text-emerald-800" },
    pending: { label: "Justificatif attendu", color: "bg-amber-100 text-amber-800" },
    expired_forfeited: { label: "Forclose — non retenue", color: "bg-red-100 text-red-700" },
    blocked_no_entry_edl: { label: "Bloquée — pas d'EDL d'entrée", color: "bg-red-100 text-red-700" },
  };

  return (
    <div>
      <PageHeader
        title="Garanties locatives"
        subtitle="Cinq formes légales, des horloges statutaires, et un moteur de restitution versionné où chaque retenue pointe vers sa ligne d'EDL, sa photo et sa facture."
      />

      <div className="grid gap-5 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Panel title={`Restitution en cours — ${endedLease.label}`}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-orange-100 text-orange-800">Restitution en cours</Badge>
              <Badge className="bg-sand-100 text-ink-soft">{DEPOSIT_FORM_LABELS[showcase.form]}</Badge>
              <span className="text-xs text-ink-soft">
                {endedLease.tenant} · clés rendues le {formatDate(showcase.keyHandoverOn ?? null)}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3">
              <div className="rounded-xl bg-sand-50 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft/70">Garantie</p>
                <p className="mt-0.5 font-display text-lg font-bold tabular-nums text-ink">{euros(showcase.amountCents)}</p>
              </div>
              <div className="rounded-xl bg-sand-50 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft/70">Retenues valides</p>
                <p className="mt-0.5 font-display text-lg font-bold tabular-nums text-ink">{euros(settlement.totalRetained)}</p>
              </div>
              <div className="rounded-xl bg-sand-50 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft/70">Restant dû locataire</p>
                <p className="mt-0.5 font-display text-lg font-bold tabular-nums text-emerald-700">{euros(settlement.outstandingToTenant)}</p>
              </div>
            </div>

            <ul className="mt-4 space-y-2">
              {settlement.lines.map((line) => (
                <li key={line.id} className="flex items-start justify-between gap-3 rounded-xl border border-sand-200 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">{line.label}</p>
                    <p className="mt-0.5 text-xs text-ink-soft">
                      {line.kind === "damage" ? "Dégât (EDL sortie)" : line.kind === "arrears" ? "Arriérés" : "Réserve charges"} ·
                      justificatif avant le {formatDate(line.justificationDeadline)}
                      {line.justificationDocRef ? ` · pièce : ${line.justificationDocRef}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="tabular-nums text-sm font-semibold text-ink">{euros(line.retained)}</span>
                    <Badge className={LINE_STATUS[line.status].color}>{LINE_STATUS[line.status].label}</Badge>
                  </div>
                </li>
              ))}
            </ul>

            {settlement.warnings.length > 0 && (
              <div className="mt-4 space-y-1.5">
                {settlement.warnings.map((w) => (
                  <p key={w} className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{w}</p>
                ))}
              </div>
            )}

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800/80">1re tranche — 50 %</p>
                <p className="mt-0.5 text-sm font-semibold text-emerald-800">
                  {euros(showcase.releasedFirstTrancheCents)} versés le 10 juil. (échéance {formatDate(settlement.firstTrancheDueAt)})
                </p>
              </div>
              <div className="rounded-xl border border-sand-200 bg-sand-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft/70">Solde — après décompte</p>
                <p className="mt-0.5 text-sm font-semibold text-ink">
                  {euros(settlement.balanceAmount)} · {settlement.balanceDueAt ? `dû le ${formatDate(settlement.balanceDueAt)}` : "décompte charges 2026 en attente"}
                </p>
              </div>
            </div>

            <p className="mt-3 text-xs text-ink-soft">
              Restitution ({DEPOSIT_FORM_LABELS[showcase.form]}) : {releaseInstructions(showcase.form)}
            </p>

            <LegalNote>
              Loi 21.9.2006 rév. 2024 : 50 % dans le mois de la remise des clés, solde dans le mois du
              décompte ; retenues justifiées par facture ou devis dans le mois — sinon forcloses ;
              après mise en demeure, pénalité de 10 % du loyer mensuel par mois entamé. Sans EDL
              d&apos;entrée, aucune retenue pour dégâts n&apos;est possible (portique bloquant).
            </LegalNote>
          </Panel>
        </div>

        <div className="lg:col-span-2">
          <Panel title="Garanties détenues">
            <ul className="divide-y divide-sand-100">
              {held.map((d) => {
                const l = leaseById(d.leaseId);
                return (
                  <li key={d.id} className="flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <Link href={`/app/baux/${l.id}`} className="block truncate text-sm font-semibold text-ink hover:text-brand-700">
                        {leaseUnitLabel(l)}
                      </Link>
                      <p className="truncate text-xs text-ink-soft">
                        {leaseTenantNames(l).join(", ")} · {DEPOSIT_FORM_LABELS[d.form]}
                      </p>
                    </div>
                    <span className="tabular-nums text-sm font-semibold text-ink">{euros(d.amountCents)}</span>
                    <MetaBadge meta={DEPOSIT_STATUS_META[d.status]} />
                  </li>
                );
              })}
            </ul>
            <Card className="mt-4 border-dashed bg-sand-50/50 p-4">
              <p className="text-xs leading-relaxed text-ink-soft">
                Le bailleur doit accepter la forme légale choisie par le locataire : espèces,
                garantie bancaire, caution tierce, assurance ou garantie étatique. Plafond : 2 mois
                en habitation (hors charges), 6 mois en commercial.
              </p>
            </Card>
          </Panel>
        </div>
      </div>
    </div>
  );
}
