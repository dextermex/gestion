import { Badge, Card, PageHeader } from "@/components/pro/ui";
import { LegalNote, MetaBadge, Panel } from "@/components/gestion/bits";
import { CONTACTS, TODAY } from "@/lib/demo/data";
import { AML_TIER_META, RISK_BAND_META, initials } from "@/lib/types";
import { resolveCddTier, resolveUbo } from "@/domain/aml/engine";
import { cents } from "@/domain/money";

export default function AmlPage() {
  // Live trigger demo: an ordinary tenancy stays light; the SCI goes full CDD.
  const tenantTier = resolveCddTier({
    relationship: "tenancy",
    monthlyRent: cents(1850),
    counterpartyIsLegalEntity: false,
    cashMovements: [],
    onDate: TODAY,
  });
  const sciTier = resolveCddTier({
    relationship: "letting_mandate",
    monthlyRent: null,
    counterpartyIsLegalEntity: true,
    cashMovements: [],
    onDate: TODAY,
  });

  const sciUbo = resolveUbo(
    [
      {
        name: "SCI Beaulieu",
        sharePct: 100,
        isNaturalPerson: false,
        children: [
          { name: "Marie Faber", sharePct: 60, isNaturalPerson: true },
          { name: "Pierre Faber", sharePct: 40, isNaturalPerson: true },
        ],
      },
    ],
    TODAY,
  );

  const parties = CONTACTS.filter((c) => c.amlTier);

  return (
    <div>
      <PageHeader
        title="AML / KYC"
        subtitle="Onboarding à deux vitesses : parcours allégé pour la masse des locataires, CDD complète auto-déclenchée sur les seuils. Le vrai risque est côté propriétaires, pas locataires."
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Déclencheurs — calculés en direct">
          <div className="space-y-3">
            <div className="rounded-xl border border-sand-200 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-ink">Location ordinaire — 1 850 €/mois, personne physique</p>
                <MetaBadge meta={AML_TIER_META[tenantTier.tier]} />
              </div>
              <p className="mt-1 text-xs text-ink-soft">
                Aucun déclencheur : sous le seuil de 10 000 €/mois, pas d&apos;espèces, personne physique.
              </p>
            </div>
            <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-ink">Mandat SCI Beaulieu — personne morale</p>
                <MetaBadge meta={AML_TIER_META[sciTier.tier]} />
              </div>
              <ul className="mt-1.5 space-y-1">
                {sciTier.triggers.map((t) => (
                  <li key={t} className="text-xs text-ink-soft">• {t}</li>
                ))}
              </ul>
            </div>
          </div>
          <LegalNote>
            Seuils AED (loi 12.11.2004) : intermédiation locative ≥ 10 000 €/mois · espèces
            ≥ 10 000 € (opération unique ou liées) · mandats de vente · toute contrepartie personne
            morale. Le périmètre des purs gestionnaires/syndics est [incertain] — le niveau par
            défaut est configurable pour que le conseil tranche.
          </LegalNote>
        </Panel>

        <Panel title="Résolution UBO — SCI Beaulieu">
          <div className="rounded-xl border border-sand-200 p-4">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-100 text-sm font-bold text-violet-800">
                SB
              </span>
              <div>
                <p className="text-sm font-semibold text-ink">SCI Beaulieu</p>
                <p className="text-xs text-ink-soft">Société civile — transparente · RCS · RBE vérifié</p>
              </div>
              <Badge className="ml-auto bg-emerald-100 text-emerald-800">Chaîne complète</Badge>
            </div>
            <div className="mt-3 space-y-2 border-l-2 border-sand-200 pl-4">
              {sciUbo.ubos.map((u) => (
                <div key={u.name} className="flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-800">
                    {initials(u.name)}
                  </span>
                  <p className="min-w-0 flex-1 text-sm text-ink">{u.name}</p>
                  <Badge className="bg-brand-100 text-brand-800">UBO — {u.effectivePct} %</Badge>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-ink-soft/80">
              Seuil bénéficiaire effectif : &gt; {sciUbo.thresholdPct} % — parts multipliées le long de la
              chaîne, personnes physiques uniquement. Chaîne incomplète = dossier bloqué avec la
              pièce à obtenir.
            </p>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-center">
            <div className="rounded-xl bg-sand-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft/70">Screening PEP</p>
              <Badge className="mt-1.5 bg-emerald-100 text-emerald-800">Aucune alerte</Badge>
            </div>
            <div className="rounded-xl bg-sand-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft/70">Sanctions</p>
              <Badge className="mt-1.5 bg-emerald-100 text-emerald-800">Aucune alerte</Badge>
            </div>
          </div>
        </Panel>
      </div>

      <Panel title="Dossiers de vigilance" className="mt-5">
        <ul className="divide-y divide-sand-100">
          {parties.map((c) => (
            <li key={c.id} className="flex items-center gap-3 py-3">
              <span
                className={
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold " +
                  (c.kind === "legal" ? "bg-violet-100 text-violet-800" : "bg-brand-100 text-brand-800")
                }
              >
                {initials(c.name)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{c.name}</p>
                <p className="truncate text-xs text-ink-soft">
                  {c.kind === "legal" ? "Personne morale" : "Personne physique"}
                  {c.residency === "non_resident" && ` · non-résident (${c.country}) — vigilance renforcée`}
                </p>
              </div>
              {c.riskBand && <MetaBadge meta={RISK_BAND_META[c.riskBand]} />}
              <MetaBadge meta={AML_TIER_META[c.amlTier!]} />
              <span className="text-[11px] tabular-nums text-ink-soft/70">
                revue {c.riskBand === "high" ? "12" : c.riskBand === "medium" ? "24" : "36"} mois
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Card className="border-dashed bg-sand-50/50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Déclarations CRF</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-soft">
              Dépôt goAML avec référence — accès strictement cloisonné, aucune exposition dans les
              portails (interdiction de tipping-off).
            </p>
          </Card>
          <Card className="border-dashed bg-sand-50/50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Conservation</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-soft">
              5 ans à compter de la FIN de la relation d&apos;affaires — l&apos;horloge démarre à la clôture,
              pas à l&apos;ouverture.
            </p>
          </Card>
          <Card className="border-dashed bg-sand-50/50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Protection produit</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-soft">
              Jamais de relevés bancaires ni de casier judiciaire dans un dossier locataire — le
              classifieur rejette avant persistance. Pas de score de risque locatif transverse
              (art. 22 RGPD).
            </p>
          </Card>
        </div>
      </Panel>
    </div>
  );
}
