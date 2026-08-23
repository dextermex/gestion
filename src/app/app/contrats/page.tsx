import Link from "next/link";
import { Badge, Card, PageHeader } from "@/components/pro/ui";
import { LegalNote, MetaBadge, Panel } from "@/components/gestion/bits";
import { LEASES, TODAY, leaseTenantNames, leaseUnitLabel } from "@/lib/demo/data";
import { LEASE_STATUS_META, LEASE_TYPE_META, euros, formatDate } from "@/lib/types";
import { RESIDENTIAL_MANDATORY_MENTIONS, validateLeaseDraft } from "@/domain/lease/rules";
import { cents } from "@/domain/money";

const MENTION_LABELS: Record<(typeof RESIDENTIAL_MANDATORY_MENTIONS)[number], string> = {
  parties_identity: "Identité des parties",
  property_designation: "Désignation du logement",
  lease_start_date: "Date de début",
  duration_or_indefinite: "Durée (ou durée indéterminée)",
  rent_amount: "Montant du loyer",
  charges_regime: "Régime des charges",
  deposit_terms: "Modalités de la garantie",
  capital_investi_declaration: "Déclaration du capital investi",
};

export default function ContratsPage() {
  // A deliberately non-compliant draft: the generator refuses it, live.
  const badDraft = validateLeaseDraft(
    {
      type: "residential",
      startDate: "2026-10-01",
      endDate: null,
      monthlyRent: cents(2400),
      monthlyCharges: cents(300),
      depositMonths: 3,
      depositForm: "cash",
      mentions: {
        parties_identity: "ok",
        property_designation: "ok",
        lease_start_date: "ok",
        duration_or_indefinite: "ok",
        rent_amount: "ok",
        charges_regime: "ok",
        deposit_terms: "ok",
        // capital_investi_declaration missing
      },
      hasCpiEscalationClause: true,
      furnished: false,
      colocation: false,
    },
    TODAY,
  );

  return (
    <div>
      <PageHeader
        title="Contrats de bail"
        subtitle="Le générateur refuse d'émettre un bail signable tant qu'une règle d'ordre public n'est pas satisfaite — la nullité devient impossible par construction."
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Registre des contrats">
          <ul className="divide-y divide-sand-100">
            {LEASES.map((l) => (
              <li key={l.id} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <Link href={`/app/baux/${l.id}`} className="block truncate text-sm font-semibold text-ink hover:text-brand-700">
                    {leaseUnitLabel(l)}
                  </Link>
                  <p className="truncate text-xs text-ink-soft">
                    {leaseTenantNames(l).join(", ")} · {euros(l.rentCents)}/mois · signé{" "}
                    {l.status === "draft" ? "— brouillon" : `AES, ${formatDate(l.startDate)}`}
                  </p>
                </div>
                <MetaBadge meta={LEASE_TYPE_META[l.type]} />
                <MetaBadge meta={LEASE_STATUS_META[l.status]} />
              </li>
            ))}
          </ul>
          <LegalNote>
            Signature électronique avancée (AES) avec piste d&apos;audit PAdES-LTV + horodatage qualifié ;
            QES (LuxTrust) en option. Les cautions de garants consommateurs sont exclues de la
            signature simple — parcours papier ou QES.
          </LegalNote>
        </Panel>

        <Panel title="Portique de conformité — démonstration en direct">
          <p className="mb-3 text-sm text-ink-soft">
            Brouillon volontairement fautif (garantie 3 mois, clause CPI, mention manquante) — le
            moteur bloque et cite la base légale :
          </p>
          <ul className="space-y-2">
            {badDraft.map((i) => (
              <li key={i.code} className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                <p className="text-sm font-semibold text-red-700">{i.message}</p>
                <p className="mt-0.5 text-xs text-red-700/70">{i.legalBasis}</p>
              </li>
            ))}
          </ul>
          <div className="mt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">
              Les 8 mentions obligatoires (à peine de nullité)
            </p>
            <div className="flex flex-wrap gap-1.5">
              {RESIDENTIAL_MANDATORY_MENTIONS.map((m) => (
                <Badge key={m} className="bg-sand-100 text-ink-soft">{MENTION_LABELS[m]}</Badge>
              ))}
            </div>
          </div>
        </Panel>
      </div>

      <Card className="mt-5 p-5">
        <h2 className="font-display text-lg font-bold text-ink">Ce que le générateur applique d&apos;office</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Garantie plafonnée", "2 mois (habitation, depuis le 1.8.2024) · 6 mois (commercial). Les 5 formes légales sont acceptées — le bailleur ne peut pas refuser la forme choisie."],
            ["Frais d'agence 50/50", "Partage de plein droit depuis le 1.8.2024 — la clause est verrouillée dans le modèle."],
            ["Clause CPI interdite", "Nullité relative en habitation : le moteur refuse de la créer. L'ajustement passe par le calendrier légal (24 mois, +10 %, plafond 5 %)."],
            ["Meublé encadré", "Supplément ≤ 1,5 %/mois des factures de meubles < 10 ans, inventaire chiffré à peine de nullité — calculette avec vieillissement automatique des factures."],
            ["Vente ≠ motif de congé", "« Le bailleur vend » n'est pas un motif : bloqué dans le produit. Besoin personnel : art. 12(3) reproduit mot pour mot (partiel verrouillé)."],
            ["Colocation 2024", "Bail unique + pacte de colocation écrit dans la même enveloppe de signature, solidarité, préavis de départ 3 mois, EDL intermédiaire."],
            ["Enregistrement optionnel", "Depuis 2017 l'enregistrement AED n'est plus obligatoire — proposé en un clic pour la date certaine et l'opposabilité aux tiers."],
            ["Prorogation légale", "Un CDD non dénoncé pour son terme exact se proroge indéfiniment — garde-fous de dates sur chaque échéance."],
          ].map(([title, body]) => (
            <div key={title} className="rounded-2xl border border-sand-200 p-4">
              <p className="text-sm font-bold text-ink">{title}</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-soft">{body}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
