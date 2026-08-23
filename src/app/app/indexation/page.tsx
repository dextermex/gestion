import Link from "next/link";
import { Badge, PageHeader } from "@/components/pro/ui";
import { LegalNote, Panel } from "@/components/gestion/bits";
import { LEASES, TODAY, leaseTenantNames, leaseUnitLabel } from "@/lib/demo/data";
import { euros, formatDate } from "@/lib/types";
import {
  applyCommercialIndexation,
  computeCapitalInvesti,
  proposeResidentialAdjustment,
} from "@/domain/indexation/engine";

export default function IndexationPage() {
  const residential = LEASES.filter(
    (l) => l.type === "residential" && (l.status === "active" || l.status === "notice") && l.capitalComponents.length > 0,
  );

  const proposals = residential.map((l) => {
    const capital = computeCapitalInvesti(l.capitalComponents, TODAY);
    const proposal = proposeResidentialAdjustment({
      currentMonthlyRent: l.rentCents,
      lastAdjustmentDate: l.lastAdjustmentOn,
      leaseStartDate: l.startDate,
      proposedDate: TODAY,
      capital,
    });
    return { l, capital, proposal };
  });

  const commercial = LEASES.find((l) => l.id === "l-k01")!;
  const commercialNow = applyCommercialIndexation({
    currentMonthlyRent: commercial.rentCents,
    baseIndexValue: commercial.indexationClause!.baseIndexValue,
    minMonthsBetweenAdjustments: commercial.indexationClause!.minMonthsBetween,
    lastAdjustmentDate: commercial.lastAdjustmentOn,
    leaseStartDate: commercial.startDate,
    proposedDate: TODAY,
    latestIndex: { month: "2026-07", value: 934.1 },
  });

  return (
    <div>
      <PageHeader
        title="Indexation & ajustements"
        subtitle="Habitation : le calendrier légal (24 mois, +10 % par palier, plafond 5 % du capital investi réévalué). Commercial : la clause contractuelle IPC STATEC. Jamais l'inverse."
      />

      <Panel title="Ajustements résidentiels — calculés par le moteur">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sand-100 bg-sand-50/60 text-left text-[11px] uppercase tracking-wide text-ink-soft/70">
                <th className="px-4 py-2.5 font-semibold">Bail</th>
                <th className="px-3 py-2.5 text-right font-semibold">Loyer actuel</th>
                <th className="px-3 py-2.5 text-right font-semibold">Plafond 5 %</th>
                <th className="px-3 py-2.5 text-right font-semibold">Proposition</th>
                <th className="px-4 py-2.5 text-right font-semibold">Décision du moteur</th>
              </tr>
            </thead>
            <tbody>
              {proposals.map(({ l, proposal }) => (
                <tr key={l.id} className="border-b border-sand-50 last:border-0 hover:bg-sand-50/50">
                  <td className="px-4 py-3">
                    <Link href={`/app/baux/${l.id}`} className="font-semibold text-ink hover:text-brand-700">
                      {leaseUnitLabel(l)}
                    </Link>
                    <p className="text-xs text-ink-soft">
                      {leaseTenantNames(l).join(", ")}
                      {l.lastAdjustmentOn ? ` · dernier ajustement ${formatDate(l.lastAdjustmentOn)}` : " · jamais ajusté"}
                    </p>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-ink">{euros(l.rentCents)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-ink-soft">{euros(proposal.caps.ceilingMonthly)}</td>
                  <td className="px-3 py-3 text-right tabular-nums font-semibold text-ink">
                    {proposal.allowed ? euros(proposal.proposedMonthlyRent) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {proposal.allowed ? (
                      <Badge className="bg-emerald-100 text-emerald-800">
                        {proposal.bindingConstraint === "ceiling" ? "Possible — borné au plafond" : "Possible — borné à +10 %"}
                      </Badge>
                    ) : proposal.nextAllowedDate ? (
                      <Badge className="bg-sand-100 text-ink-soft">Verrouillé — dès le {formatDate(proposal.nextAllowedDate)}</Badge>
                    ) : (
                      <Badge className="bg-amber-100 text-amber-800">Au plafond légal</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <LegalNote>
          Chaque proposition embarque son instantané de calcul (capital réévalué, décote de vétusté
          −2 %/2 ans au-delà de 15 ans sur la construction, plafond, palier) et part en notice
          motivée par lettre recommandée. Contestation : commission des loyers de la commune —
          irrecevable les 6 premiers mois du bail, fenêtre de négociation d&apos;1 mois.
        </LegalNote>
      </Panel>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel title="INDEXATION_LAG — récupération de revenus">
          <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3">
            <p className="text-sm font-semibold text-sky-800">Apt 3B — Jean Muller</p>
            <p className="mt-1 text-xs leading-relaxed text-sky-800/90">
              Loyer ajusté à 1 520,00 € au 1er avril ; le virement d&apos;août est arrivé à 1 450,00 € —
              exactement l&apos;ancien montant. Le rapprochement a auto-validé à l&apos;ancien montant, ouvert
              un reliquat de 70,00 € et préparé le courrier « mettez à jour votre ordre permanent ».
            </p>
            <div className="mt-2.5 flex gap-2">
              <button className="tactile rounded-xl bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700">
                Envoyer le courrier pré-rempli
              </button>
              <Link href="/app/banque" className="rounded-xl border border-sand-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink-soft hover:border-brand-300 hover:text-brand-700">
                Voir le rapprochement
              </Link>
            </div>
          </div>
          <LegalNote>
            La culture de paiement luxembourgeoise repose sur l&apos;ordre permanent : après chaque
            ajustement, le moteur guette les paiements figés à l&apos;ancien montant. Une fonctionnalité
            de récupération de revenus qu&apos;aucun concurrent n&apos;offre.
          </LegalNote>
        </Panel>

        <Panel title="Indexation commerciale — clause IPC">
          <div className="rounded-xl border border-sand-200 p-4">
            <p className="text-sm font-semibold text-ink">{leaseUnitLabel(commercial)} — Boulangerie Bock</p>
            <ul className="mt-2 space-y-1.5 text-sm">
              <li className="flex justify-between gap-3">
                <span className="text-ink-soft">Série contractuelle</span>
                <span className="font-semibold text-ink">{commercial.indexationClause!.series}</span>
              </li>
              <li className="flex justify-between gap-3">
                <span className="text-ink-soft">Indice de base / actuel</span>
                <span className="font-semibold tabular-nums text-ink">
                  {commercial.indexationClause!.baseIndexValue} → 934,1
                </span>
              </li>
              <li className="flex justify-between gap-3">
                <span className="text-ink-soft">Fréquence de la clause</span>
                <span className="font-semibold text-ink">12 mois (dernier : {formatDate(commercial.lastAdjustmentOn)})</span>
              </li>
              <li className="flex justify-between gap-3">
                <span className="text-ink-soft">Décision</span>
                <span className="font-semibold text-ink">
                  {commercialNow.allowed
                    ? `Nouveau loyer ${euros(commercialNow.newMonthlyRent)}`
                    : `Verrouillé par la clause`}
                </span>
              </li>
            </ul>
            {!commercialNow.allowed && (
              <p className="mt-2 rounded-lg bg-sand-50 px-3 py-2 text-xs text-ink-soft">{commercialNow.blockedReason}</p>
            )}
          </div>
          <LegalNote>
            Aucune indexation légale automatique en bail commercial : seule la clause expresse
            s&apos;applique, indexée en pratique sur l&apos;IPC STATEC (pas d&apos;équivalent des ILC/ILAT
            français). Le loyer commercial est libre — aucun plafond.
          </LegalNote>
        </Panel>
      </div>
    </div>
  );
}
