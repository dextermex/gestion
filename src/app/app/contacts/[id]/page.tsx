import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/pro/ui";
import { LegalNote, MetaBadge, Panel, Timeline } from "@/components/gestion/bits";
import { CONTACTS, DEPOSITS, LEASES, TICKETS, leaseTenantNames, leaseUnitLabel } from "@/lib/demo/data";
import {
  AML_TIER_META,
  CONTACT_ROLE_META,
  LEASE_STATUS_META,
  RISK_BAND_META,
  euros,
  formatDate,
  initials,
} from "@/lib/types";

export function generateStaticParams() {
  return CONTACTS.map((c) => ({ id: c.id }));
}

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const contact = CONTACTS.find((c) => c.id === id);
  if (!contact) notFound();
  const c = contact!;

  const leases = LEASES.filter((l) => l.tenantContactIds.includes(c.id));
  const tickets = TICKETS.filter((t) => t.artisanContactId === c.id);
  const isOwner = c.roles.includes("owner");

  const timeline = [
    ...(c.id === "c-muller"
      ? [
          { kind: "payment", label: "Virement août reçu à l'ancien montant — INDEXATION_LAG", sub: "Reliquat 70,00 € ouvert, courrier prêt", at: "3 août" },
          { kind: "ticket", label: "Demande chaudière INT-2026-0141 (urgent)", sub: "SLA 25 août — artisan planifié", at: "19 août" },
        ]
      : []),
    ...(c.id === "c-sci-bealieu"
      ? [
          { kind: "document", label: "CDD complète — RBE consulté, registre des associés archivé", sub: "UBO : Marie Faber 60 %, Pierre Faber 40 %", at: "10 févr." },
          { kind: "payment", label: "Décompte de gérance juillet envoyé", sub: "5 loyers · honoraires 4 % + TVA", at: "5 août" },
        ]
      : []),
    ...(c.id === "c-lambert"
      ? [
          { kind: "document", label: "Pack fiscal 2025 exporté (LU + cadre III belge)", sub: "Amortissement isolé — jamais reporté dans la déclaration belge", at: "12 juin" },
          { kind: "system", label: "Revue AML périodique planifiée", sub: "Bande moyenne → revue à 24 mois", at: "10 févr." },
        ]
      : []),
    { kind: "system", label: "Fiche créée", sub: "Source : saisie manuelle", at: "2025" },
  ];

  return (
    <div>
      <div className="mb-2">
        <Link href="/app/contacts" className="text-sm font-semibold text-brand-700 hover:underline">← Contacts</Link>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-4">
        <span
          className={
            "flex h-14 w-14 items-center justify-center rounded-full text-lg font-bold " +
            (c.kind === "legal" ? "bg-violet-100 text-violet-800" : "bg-brand-100 text-brand-800")
          }
        >
          {initials(c.name)}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-bold text-ink">{c.name}</h1>
          <p className="mt-0.5 text-sm text-ink-soft">
            {c.email ?? "—"} · {c.phone ?? "—"} · langue : {c.language.toUpperCase()}
            {c.residency === "non_resident" && ` · non-résident (${c.country})`}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {c.roles.map((r) => (
            <MetaBadge key={r} meta={CONTACT_ROLE_META[r]} />
          ))}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2 flex flex-col gap-5">
          {leases.length > 0 && (
            <Panel title="Baux">
              <ul className="divide-y divide-sand-100">
                {leases.map((l) => (
                  <li key={l.id} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <Link href={`/app/baux/${l.id}`} className="block truncate text-sm font-semibold text-ink hover:text-brand-700">
                        {leaseUnitLabel(l)}
                      </Link>
                      <p className="text-xs text-ink-soft">
                        {euros(l.rentCents)}/mois · depuis {formatDate(l.startDate)}
                        {l.colocation && ` · colocation avec ${leaseTenantNames(l).filter((n) => n !== c.name).join(", ")}`}
                      </p>
                    </div>
                    <MetaBadge meta={LEASE_STATUS_META[l.status]} />
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {tickets.length > 0 && (
            <Panel title="Interventions confiées">
              <ul className="divide-y divide-sand-100">
                {tickets.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 py-2.5 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-ink">{t.ref} — {t.title}</p>
                      <p className="text-xs text-ink-soft">{t.unitLabel}</p>
                    </div>
                    {t.amountCents && <span className="tabular-nums text-ink">{euros(t.amountCents)}</span>}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-ink-soft">
                Portail artisan par lien magique — aucun compte requis : accepter/refuser, proposer
                des créneaux, photos de fin, facture.
              </p>
            </Panel>
          )}

          {isOwner && (
            <Panel title="Mandat & patrimoine">
              <p className="text-sm leading-relaxed text-ink">{c.notes ?? "Mandat de gérance actif."}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href="/app/finance" className="rounded-xl border border-sand-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink-soft transition hover:border-brand-300 hover:text-brand-700">
                  Décomptes de gérance
                </Link>
                <Link href="/app/fiscalite" className="rounded-xl border border-sand-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink-soft transition hover:border-brand-300 hover:text-brand-700">
                  Pack fiscal
                </Link>
              </div>
            </Panel>
          )}

          <Panel title="Activité">
            <Timeline entries={timeline} />
          </Panel>
        </div>

        <div className="flex flex-col gap-5">
          <Panel title="Coordonnées bancaires">
            {DEPOSITS.some((d) => LEASES.find((l) => l.id === d.leaseId)?.tenantContactIds.includes(c.id)) || c.iban ? (
              <ul className="space-y-2 text-sm">
                <li className="flex justify-between gap-3">
                  <span className="text-ink-soft">IBAN</span>
                  <span className="font-semibold tabular-nums text-ink">{c.iban ?? "capturé au bail"}</span>
                </li>
              </ul>
            ) : (
              <p className="text-sm text-ink-soft">Aucun IBAN enregistré.</p>
            )}
            <LegalNote>
              Les IBAN payeurs observés se lient au bail (niveau 2 du rapprochement) — y compris les
              tiers payeurs comme un parent ou une aide au logement.
            </LegalNote>
          </Panel>

          {(c.amlTier || c.riskBand) && (
            <Panel title="AML / KYC">
              <ul className="space-y-2.5 text-sm">
                {c.amlTier && (
                  <li className="flex items-center justify-between gap-3">
                    <span className="text-ink-soft">Niveau de diligence</span>
                    <MetaBadge meta={AML_TIER_META[c.amlTier]} />
                  </li>
                )}
                {c.riskBand && (
                  <li className="flex items-center justify-between gap-3">
                    <span className="text-ink-soft">Classification</span>
                    <MetaBadge meta={RISK_BAND_META[c.riskBand]} />
                  </li>
                )}
                {c.kind === "legal" && (
                  <li className="flex items-center justify-between gap-3">
                    <span className="text-ink-soft">UBO &gt; 25 %</span>
                    <Badge className="bg-emerald-100 text-emerald-800">Résolus · RBE vérifié</Badge>
                  </li>
                )}
              </ul>
              <Link href="/app/aml" className="mt-3 block text-sm font-semibold text-brand-700 hover:underline">
                Dossier AML complet →
              </Link>
            </Panel>
          )}

          <Panel title="Conservation">
            <p className="text-xs leading-relaxed text-ink-soft">
              Horloges par classe de document : comptable 10 ans · AML 5 ans à compter de la fin de
              relation · candidats non retenus purgés à 3 mois. Jamais une politique unique au niveau
              du compte.
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
