import { Badge, Card, PageHeader } from "@/components/pro/ui";
import { LegalNote, Panel } from "@/components/gestion/bits";
import { DOCUMENTS } from "@/lib/demo/data";
import { formatDate } from "@/lib/types";

const CLASS_META: Record<string, { label: string; color: string }> = {
  lease: { label: "Bail", color: "bg-brand-100 text-brand-800" },
  edl: { label: "EDL", color: "bg-sky-100 text-sky-800" },
  invoice: { label: "Facture", color: "bg-amber-100 text-amber-800" },
  deed: { label: "Acte", color: "bg-violet-100 text-violet-800" },
  tax: { label: "Fiscal", color: "bg-emerald-100 text-emerald-800" },
  registered_letter: { label: "LRAR", color: "bg-accent-50 text-accent-700" },
  id_document: { label: "KYC", color: "bg-violet-100 text-violet-800" },
  decompte: { label: "Décompte", color: "bg-sky-100 text-sky-800" },
  other: { label: "Autre", color: "bg-sand-100 text-ink-soft" },
};

const RETENTION_META: Record<string, { label: string; color: string }> = {
  accounting_10y: { label: "Comptable — 10 ans", color: "bg-sand-100 text-ink-soft" },
  aml_5y_from_end: { label: "AML — 5 ans après fin de relation", color: "bg-violet-100 text-violet-800" },
  applicant_3m: { label: "Candidat — purge à 3 mois", color: "bg-red-100 text-red-700" },
  gdpr_minimised: { label: "RGPD — minimisé", color: "bg-sand-100 text-ink-soft" },
  permanent: { label: "Permanent", color: "bg-emerald-100 text-emerald-800" },
};

function sizeLabel(kb: number): string {
  return kb >= 1024 ? `${(kb / 1024).toFixed(1).replace(".", ",")} Mo` : `${kb} Ko`;
}

export default function DocumentsPage() {
  return (
    <div>
      <PageHeader
        title="Documents"
        subtitle="Le coffre-fort probatoire : chaque artefact légalement significatif est scellé par empreinte SHA-256, immuable après signature, corrigé uniquement par avenant."
      />

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sand-100 bg-sand-50/60 text-left text-[11px] uppercase tracking-wide text-ink-soft/70">
                <th className="px-4 py-2.5 font-semibold">Document</th>
                <th className="px-3 py-2.5 font-semibold">Classe</th>
                <th className="px-3 py-2.5 font-semibold">Conservation</th>
                <th className="px-3 py-2.5 text-right font-semibold">Taille</th>
                <th className="px-4 py-2.5 text-right font-semibold">Ajouté</th>
              </tr>
            </thead>
            <tbody>
              {DOCUMENTS.map((d) => {
                const cls = CLASS_META[d.klass] ?? CLASS_META.other;
                const ret = RETENTION_META[d.retentionClass];
                return (
                  <tr key={d.id} className="border-b border-sand-50 last:border-0 hover:bg-sand-50/50">
                    <td className="max-w-md px-4 py-3">
                      <p className="flex items-center gap-2 truncate font-semibold text-ink">
                        {d.sealed && (
                          <svg className="h-3.5 w-3.5 shrink-0 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-label="Scellé">
                            <rect x="5" y="10" width="14" height="10" rx="2" />
                            <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                          </svg>
                        )}
                        <span className="truncate">{d.name}</span>
                      </p>
                      <p className="truncate text-xs text-ink-soft">{d.relatedLabel}</p>
                    </td>
                    <td className="px-3 py-3">
                      <Badge className={cls.color}>{cls.label}</Badge>
                    </td>
                    <td className="px-3 py-3">
                      <Badge className={ret.color}>{ret.label}</Badge>
                      {d.retentionUntil && (
                        <p className="mt-0.5 text-[11px] text-ink-soft/70">jusqu&apos;au {formatDate(d.retentionUntil)}</p>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-ink-soft">{sizeLabel(d.sizeKb)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink-soft">{formatDate(d.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Panel title="Horloges de conservation">
          <p className="text-sm leading-relaxed text-ink-soft">
            Conflit résolu par conception : l&apos;AML dit 5 ans après la fin de relation, la
            comptabilité 10 ans, le RGPD dit effacer dès que possible. Chaque document porte SA
            classe et SON horloge — jamais une politique unique au niveau du compte.
          </p>
        </Panel>
        <Panel title="Résidence des données">
          <p className="text-sm leading-relaxed text-ink-soft">
            Les pièces comptables doivent être conservées AU LUXEMBOURG (art. 16 Code de commerce) —
            une exigence de résidence des données prise en compte dans l&apos;hébergement. La
            dématérialisation à valeur probante passe par un PSDC certifié (loi du 25.7.2015).
          </p>
        </Panel>
        <Panel title="Gel contentieux">
          <p className="text-sm leading-relaxed text-ink-soft">
            Un dossier en litige se gèle d&apos;un geste : les horloges de purge s&apos;arrêtent, l&apos;export
            justice de paix assemble bail, relevés, lettres et preuves AR en un dossier daté.
          </p>
        </Panel>
      </div>
      <LegalNote>
        Lettre recommandée avec AR : objet de première classe — empreinte du contenu, preuve de
        dépôt, scan de l&apos;AR. Les effets légaux courent de la date de l&apos;AR, jamais de la date du clic.
      </LegalNote>
    </div>
  );
}
