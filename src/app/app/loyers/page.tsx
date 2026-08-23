import Link from "next/link";
import { Badge, Card, PageHeader } from "@/components/pro/ui";
import { LegalNote, MetaBadge, Panel } from "@/components/gestion/bits";
import {
  LEASES,
  RENT_PERIODS,
  TODAY,
  leaseById,
  leaseTenantNames,
  leaseUnitLabel,
} from "@/lib/demo/data";
import { RENT_STATUS_META, euros, formatMonth } from "@/lib/types";
import { assessArrears } from "@/domain/arrears/ladder";

const MONTHS = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];

export default async function LoyersPage({
  searchParams,
}: {
  searchParams: Promise<{ mois?: string }>;
}) {
  const params = await searchParams;
  const month = MONTHS.includes(params.mois ?? "") ? params.mois! : "2026-08";
  const rows = RENT_PERIODS.filter((rp) => rp.period === month);
  const expected = rows.reduce((a, r) => a + r.totalCents, 0);
  const collected = rows.reduce((a, r) => a + r.allocatedCents, 0);

  // Arrears ladder — the engine drives every relance, aligned with law.
  const arrearsCases = RENT_PERIODS.filter(
    (rp) => (rp.status === "late" || rp.status === "partial") && rp.period <= "2026-08",
  ).map((rp) => {
    const executedByPeriod: Record<string, Partial<Record<"friendly" | "formal" | "mise_en_demeure" | "justice_dossier", string>>> = {
      "rp-l-2a-2026-07": { friendly: "2026-07-07", formal: "2026-07-14" },
      "rp-l-2a-2026-08": {},
      "rp-l-3b-2026-08": {},
      "rp-l-1a-2026-08": {},
    };
    const assessment = assessArrears(
      {
        invoiceId: rp.id,
        dueDate: rp.dueDate,
        openAmount: rp.totalCents - rp.allocatedCents,
        paymentPlanActive: false,
        executed: executedByPeriod[rp.id] ?? {},
        miseEnDemeureArDate: rp.id === "rp-l-2a-2026-07" ? "2026-08-12" : null,
      },
      TODAY,
    );
    return { rp, assessment };
  });

  return (
    <div>
      <PageHeader
        title="Loyers"
        subtitle="Le rent roll du mois — chaque échéance, son statut et son solde. Le statut est toujours dérivé du registre d'allocations, jamais saisi à la main."
      />

      <div className="no-scrollbar mb-4 flex gap-2 overflow-x-auto">
        {MONTHS.map((m) => (
          <Link
            key={m}
            href={`/app/loyers?mois=${m}`}
            aria-current={m === month ? "page" : undefined}
            className={
              "shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition " +
              (m === month
                ? "bg-brand-700 text-white"
                : "bg-white text-ink-soft border border-sand-200 hover:border-brand-200 hover:text-brand-700")
            }
          >
            {formatMonth(m)}
          </Link>
        ))}
      </div>

      <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft/70">Attendu</p>
          <p className="mt-1 font-display text-2xl font-bold tabular-nums text-ink">{euros(expected)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft/70">Encaissé</p>
          <p className="mt-1 font-display text-2xl font-bold tabular-nums text-emerald-700">{euros(collected)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft/70">Solde ouvert</p>
          <p className={"mt-1 font-display text-2xl font-bold tabular-nums " + (expected - collected > 0 ? "text-red-600" : "text-ink")}>
            {euros(expected - collected)}
          </p>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sand-100 bg-sand-50/60 text-left text-[11px] uppercase tracking-wide text-ink-soft/70">
                <th className="px-4 py-2.5 font-semibold">Logement · Locataire</th>
                <th className="px-3 py-2.5 text-right font-semibold">Attendu</th>
                <th className="px-3 py-2.5 text-right font-semibold">Encaissé</th>
                <th className="px-3 py-2.5 text-right font-semibold">Solde</th>
                <th className="px-3 py-2.5 text-right font-semibold">Échéance</th>
                <th className="px-4 py-2.5 text-right font-semibold">Statut</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((rp) => {
                const l = leaseById(rp.leaseId);
                const open = rp.totalCents - rp.allocatedCents;
                return (
                  <tr key={rp.id} className="border-b border-sand-50 last:border-0 hover:bg-sand-50/50">
                    <td className="px-4 py-3">
                      <Link href={`/app/baux/${l.id}`} className="font-semibold text-ink hover:text-brand-700">
                        {leaseUnitLabel(l)}
                      </Link>
                      <p className="text-xs text-ink-soft">{leaseTenantNames(l).join(", ")}</p>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-ink">{euros(rp.totalCents)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-ink">{euros(rp.allocatedCents)}</td>
                    <td className={"px-3 py-3 text-right tabular-nums " + (open > 0 ? "font-semibold text-red-600" : "text-ink-soft")}>
                      {euros(open)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-ink-soft">{rp.dueDate.slice(8)}/{rp.dueDate.slice(5, 7)}</td>
                    <td className="px-4 py-3 text-right">
                      <MetaBadge meta={RENT_STATUS_META[rp.status]} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel title="Échelle de relance (impayés)">
          <ul className="space-y-4">
            {arrearsCases.map(({ rp, assessment }) => {
              const l = leaseById(rp.leaseId);
              return (
                <li key={rp.id} className="rounded-xl border border-sand-200 p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">
                        {leaseUnitLabel(l)} — {formatMonth(rp.period)}
                      </p>
                      <p className="text-xs text-ink-soft">
                        {euros(rp.totalCents - rp.allocatedCents)} ouverts · {assessment.daysOverdue} j de retard
                      </p>
                    </div>
                    {assessment.currentStage !== "none" && (
                      <Badge className="bg-orange-100 text-orange-800">
                        {assessment.currentStage === "mise_en_demeure" ? "Mise en demeure" : assessment.currentStage === "formal" ? "Relance formelle" : assessment.currentStage === "friendly" ? "Relance amiable" : "Dossier justice"}
                      </Badge>
                    )}
                  </div>
                  {assessment.nextStep && (
                    <div className="mt-2.5 flex items-center justify-between gap-3 rounded-lg bg-sand-50 px-3 py-2">
                      <p className="text-xs text-ink-soft">
                        <span className="font-semibold text-ink">Prochaine étape :</span> {assessment.nextStep.description}
                      </p>
                      {assessment.nextStep.requiresRegisteredLetter && (
                        <Badge className="bg-accent-50 text-accent-700">LRAR</Badge>
                      )}
                    </div>
                  )}
                  {assessment.notes.map((n) => (
                    <p key={n} className="mt-1.5 text-[11px] text-ink-soft/80">{n}</p>
                  ))}
                </li>
              );
            })}
          </ul>
          <LegalNote>
            J+3 amiable → J+10 formelle → J+24 mise en demeure (LRAR, confirmée par le gestionnaire —
            l&apos;effet légal court de la date de l&apos;AR) → J+45 export du dossier justice de paix. Un plan
            de paiement suspend l&apos;échelle. Aucune coupure de service n&apos;existe dans le produit — c&apos;est illégal.
          </LegalNote>
        </Panel>

        <Panel title="Références & avis d'échéance">
          <ul className="divide-y divide-sand-100 text-sm">
            {LEASES.filter((l) => l.status === "active" || l.status === "notice").map((l) => (
              <li key={l.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink">{leaseUnitLabel(l)}</p>
                  <p className="text-xs text-ink-soft">Avis mensuel avec QR EPC — IBAN, nom VoP, montant et référence pré-remplis</p>
                </div>
                <code className="rounded-md bg-sand-50 px-2 py-1 text-[11px] font-semibold tabular-nums text-brand-800">
                  {l.rfReference}
                </code>
              </li>
            ))}
          </ul>
          <LegalNote>
            Référence créancier RF permanente par bail (ISO 11649). Les apps bancaires
            luxembourgeoises n&apos;ont pas de champ structuré : le moteur retrouve la référence dans le
            libellé libre, somme de contrôle vérifiée.
          </LegalNote>
        </Panel>
      </div>
    </div>
  );
}
