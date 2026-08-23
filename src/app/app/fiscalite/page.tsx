import { Badge, PageHeader } from "@/components/pro/ui";
import { LegalNote, Panel } from "@/components/gestion/bits";
import { LAMBERT_PORTFOLIO, SCI_BEAULIEU_PORTFOLIO } from "@/lib/demo/data";
import { euros, eurosWhole } from "@/lib/types";
import { planTaxpayerYear } from "@/domain/fiscal/amortisation";
import { buildTaxPack } from "@/domain/fiscal/taxpack";
import { cents } from "@/domain/money";

export default function FiscalitePage() {
  // Taxpayer-level amortisation plans — the max-2-buildings rule in action.
  const lambertPlan = planTaxpayerYear(LAMBERT_PORTFOLIO, 2026, { jointlyTaxed: false });
  const faberPlan = planTaxpayerYear(SCI_BEAULIEU_PORTFOLIO, 2026, { jointlyTaxed: true });

  // Modèle 190/210 pack for Bureaux Kirchberg (Sophie Lambert, non-resident).
  const kirchbergAmort = lambertPlan.rows.find((r) => r.propertyId === "p-kirchberg")!;
  const pack = buildTaxPack({
    taxYear: 2026,
    propertyLabel: "Bureaux Kirchberg — Plateau 1er",
    cadastralRef: "Luxembourg / Section EiB / n° 501/2231",
    buildingCompletedOn: "2015-11-01",
    monthsLet: 12,
    vacancyMonths: 0,
    receipts: Array.from({ length: 12 }, (_, i) => ({
      period: `2026-${String(i + 1).padStart(2, "0")}`,
      category: "dwelling" as const,
      amount: cents(6800),
    })),
    expenses: [
      { date: "2026-03-10", bucket: "maintenance_repairs", label: "Reprise étanchéité terrasse", amount: cents(9_400), rechargedToTenant: false },
      { date: "2026-01-15", bucket: "debt_interest", label: "Intérêts prêt BGL (certificat)", amount: cents(31_200), rechargedToTenant: false },
      { date: "2026-02-01", bucket: "impot_foncier", label: "Impôt foncier", amount: cents(1_450), rechargedToTenant: false },
      { date: "2026-12-31", bucket: "management_fees", label: "Honoraires Cabinet Reuter", amount: cents(3_260), rechargedToTenant: false },
      { date: "2026-06-30", bucket: "insurance", label: "Assurance propriétaire", amount: cents(2_050), rechargedToTenant: false },
    ],
    electedSpreadYears: null,
    priorSpreads: [],
    amortisation: kirchbergAmort.result,
    ownerShare: 1,
    ownerResidency: "non_resident",
    socialRentalManagement: false,
  });

  const REGIME_LABEL: Record<string, string> = {
    normal_2: "2 % normal",
    accelerated_4: "4 % accéléré",
    grandfathered_6: "6 % transitoire",
    vefa2024_6: "6 % VEFA 2024",
    energy_renovation: "Rénovation énergétique",
  };

  return (
    <div>
      <PageHeader
        title="Fiscalité"
        subtitle="Le pack de fin d'année, par bien, par propriétaire — exactement le jeu de données du modèle 190/210, avec l'amortissement arbitré au niveau du contribuable."
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Amortissement 2026 — Sophie Lambert (contribuable)">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-sand-100 bg-sand-50/60 text-left text-[11px] uppercase tracking-wide text-ink-soft/70">
                  <th className="px-3 py-2.5 font-semibold">Bien</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Régime</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Base</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Annuité</th>
                </tr>
              </thead>
              <tbody>
                {lambertPlan.rows.map((r) => (
                  <tr key={r.propertyId} className="border-b border-sand-50 last:border-0 align-top">
                    <td className="px-3 py-2.5">
                      <p className="font-semibold text-ink">{r.label}</p>
                      <p className="text-[11px] leading-snug text-ink-soft">{r.result.regime.note}</p>
                      {r.result.energy.applicable && (
                        <p className="text-[11px] leading-snug text-emerald-700">{r.result.energy.note}</p>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Badge className={r.result.regime.regime === "vefa2024_6" ? "bg-violet-100 text-violet-800" : r.result.regime.regime === "accelerated_4" ? "bg-emerald-100 text-emerald-800" : "bg-sand-100 text-ink-soft"}>
                        {REGIME_LABEL[r.result.regime.regime]}
                        {r.result.energy.applicable ? ` + ${r.result.energy.ratePct} %` : ""}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink-soft">{eurosWhole(r.result.regime.cappedBase)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-ink">{euros(r.result.totalAmount)}</td>
                  </tr>
                ))}
                <tr className="bg-sand-50/60">
                  <td className="px-3 py-2.5 font-bold text-ink" colSpan={3}>Total amortissement</td>
                  <td className="px-3 py-2.5 text-right font-display font-bold tabular-nums text-ink">
                    {euros(lambertPlan.totalAmortisation)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <LegalNote>
            Studio Gare : cohorte fermée VEFA 2024 — 6 % sur base plafonnée à 250 000 €/an pendant
            6 ans, le moteur continue de la calculer après la fin du régime. Kirchberg : rénovation
            énergétique à 10 % depuis l&apos;exercice 2026 (6 % avant), Klimabonus déduit de la base,
            fenêtre de 9 ans.
          </LegalNote>
        </Panel>

        <Panel title="Amortissement 2026 — Marie Faber (via SCI + biens propres)">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge className="bg-emerald-100 text-emerald-800">
              {faberPlan.acceleratedSlotsUsed}/2 créneaux 4 % utilisés
            </Badge>
            {faberPlan.slotWaitlist.length > 0 && (
              <Badge className="bg-amber-100 text-amber-800">
                {faberPlan.slotWaitlist.length} bien éligible au-delà du plafond → retombe à 2 %
              </Badge>
            )}
            <Badge className="bg-sand-100 text-ink-soft">Imposition collective — abattement ×2</Badge>
          </div>
          <ul className="space-y-2.5">
            {faberPlan.rows.map((r) => (
              <li key={r.propertyId} className="rounded-xl border border-sand-200 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="min-w-0 truncate text-sm font-semibold text-ink">{r.label}</p>
                  <Badge className={r.result.regime.regime === "accelerated_4" ? "bg-emerald-100 text-emerald-800" : "bg-sand-100 text-ink-soft"}>
                    {REGIME_LABEL[r.result.regime.regime]}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-ink-soft">{r.result.regime.note}</p>
                <div className="mt-1.5 flex items-center justify-between text-xs">
                  <span className="text-ink-soft">
                    Part contribuable {Math.round((r.taxpayerShareAmount / (r.result.totalAmount || 1)) * 100)} %
                  </span>
                  <span className="tabular-nums font-semibold text-ink">{euros(r.taxpayerShareAmount)}</span>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center justify-between rounded-xl bg-brand-50 px-4 py-3">
            <p className="text-sm font-semibold text-brand-800">Abattement immobilier spécial (1 % de la base à 4 %)</p>
            <p className="font-display text-lg font-bold tabular-nums text-brand-800">{euros(faberPlan.totalAbattement)}</p>
          </div>
          <LegalNote>
            La règle des 2 immeubles au 4 % et l&apos;abattement (plafond 10 000 €/contribuable, 20 000 €
            en imposition collective) mordent AU NIVEAU DU CONTRIBUABLE, à travers toutes les SCI et
            biens propres — le graphe de propriété descend jusqu&apos;aux personnes physiques. Le
            moteur attribue les créneaux aux bases les plus élevées (arbitrage optimal). SCI
            transparente : modèle 200 commun, allocation aux associés sur leur modèle 100.
          </LegalNote>
        </Panel>
      </div>

      <Panel title="Modèle 190/210 — Bureaux Kirchberg · Sophie Lambert · exercice 2026" className="mt-5">
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl bg-sand-50 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft/70">Loyers bruts</p>
                <p className="mt-0.5 font-display text-lg font-bold tabular-nums text-ink">{euros(pack.grossRents.totalTaxable)}</p>
                <p className="text-[11px] text-ink-soft/70">{pack.monthsLet} mois loués</p>
              </div>
              <div className="rounded-xl bg-sand-50 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft/70">Frais d&apos;obtention</p>
                <p className="mt-0.5 font-display text-lg font-bold tabular-nums text-ink">
                  {euros(pack.grossRents.totalTaxable - pack.netResult)}
                </p>
                <p className="text-[11px] text-ink-soft/70">itemisés (§A–§F)</p>
              </div>
              <div className="rounded-xl bg-sand-50 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft/70">Revenu net</p>
                <p className="mt-0.5 font-display text-lg font-bold tabular-nums text-ink">{euros(pack.netResult)}</p>
                <p className="text-[11px] text-ink-soft/70">reporté au modèle 100</p>
              </div>
            </div>

            <table className="mt-4 w-full text-sm">
              <tbody>
                {pack.sections.map((s) => (
                  <tr key={s.code} className="border-b border-sand-50 last:border-0">
                    <td className="py-2 pr-3">
                      <span className="mr-2 inline-flex h-6 w-8 items-center justify-center rounded-md bg-brand-50 text-xs font-bold text-brand-700">
                        §{s.code}
                      </span>
                      <span className="text-ink">{s.label}</span>
                    </td>
                    <td className="py-2 text-right tabular-nums font-semibold text-ink">{euros(s.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {pack.warnings.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {pack.warnings.map((w) => (
                  <p key={w} className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{w}</p>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-4">
            <div className="rounded-2xl border border-sand-200 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Forfait 35 % / 2 700 €</p>
              {pack.flatComparison.eligible ? (
                <>
                  <p className="mt-1.5 text-sm text-ink">
                    Forfait {euros(pack.flatComparison.flatAmount)} vs itemisé{" "}
                    {euros(pack.flatComparison.itemisedReplaceable)}
                  </p>
                  <Badge className={"mt-2 " + (pack.flatComparison.recommendation === "itemise" ? "bg-emerald-100 text-emerald-800" : "bg-sky-100 text-sky-800")}>
                    Recommandation : {pack.flatComparison.recommendation === "itemise" ? "itemiser" : "forfait"} (+{euros(pack.flatComparison.savings)})
                  </Badge>
                </>
              ) : (
                <p className="mt-1.5 text-xs text-ink-soft">{pack.flatComparison.ineligibleReason}</p>
              )}
              <p className="mt-2 text-[11px] leading-relaxed text-ink-soft/80">
                Intérêts, impôt foncier et frais de gérance restent déductibles en sus du forfait.
              </p>
            </div>

            {pack.nonResidentExport && (
              <div className="rounded-2xl border border-violet-200 bg-violet-50/50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-violet-800">Pack non-résident (BE)</p>
                <ul className="mt-2 space-y-1 text-xs text-ink">
                  <li className="flex justify-between"><span>Loyers bruts</span><span className="tabular-nums font-semibold">{euros(pack.nonResidentExport.grossRents)}</span></li>
                  <li className="flex justify-between"><span>Frais (hors amort.)</span><span className="tabular-nums font-semibold">{euros(pack.nonResidentExport.deductibleExpensesExclAmort)}</span></li>
                  <li className="flex justify-between"><span>Intérêts d&apos;emprunt</span><span className="tabular-nums font-semibold">{euros(pack.nonResidentExport.debtInterest)}</span></li>
                  <li className="flex justify-between text-violet-800"><span>Amortissement (LU uniquement)</span><span className="tabular-nums font-semibold">{euros(pack.nonResidentExport.luxembourgOnlyAmortisation)}</span></li>
                </ul>
                <p className="mt-2 text-[11px] leading-relaxed text-violet-800/80">
                  Pas de retenue à la source au Luxembourg — imposition par voie d&apos;assiette
                  (modèle 100, 31.12 N+1). L&apos;État de résidence exonère avec progression (BE/DE) ou
                  crédite l&apos;impôt luxembourgeois (FR). L&apos;amortissement est isolé pour ne jamais
                  polluer la déclaration belge.
                </p>
              </div>
            )}
          </div>
        </div>
      </Panel>
    </div>
  );
}
