import { Badge, Card, PageHeader } from "@/components/pro/ui";
import { LegalNote, Panel } from "@/components/gestion/bits";
import { TICKETS, WORKFLOWS } from "@/lib/demo/data";
import { TICKET_SEVERITY_META, TICKET_STATUS_META, WORKFLOW_KIND_META, euros, formatDate } from "@/lib/types";
import { MetaBadge } from "@/components/gestion/bits";

const STATE_LABELS: Record<string, string> = {
  DRAFT: "Préparation",
  MARKETING: "Commercialisation",
  SCREENING: "Candidatures",
  LEASE: "Bail",
  PRE_MOVE_IN: "Avant entrée",
  EDL: "État des lieux",
  DEFECT_WINDOW: "Fenêtre défauts",
  SETTLED: "Installé",
  NOTICE: "Préavis",
  PRE_EXIT: "Pré-visite",
  SETTLEMENT: "Restitution",
  CLOSE_OUT: "Clôture",
};

function Stepper({ states, current }: { states: string[]; current: string }) {
  const idx = states.indexOf(current);
  return (
    <ol className="mt-3 flex items-center gap-1" aria-label="Étapes">
      {states.map((s, i) => (
        <li key={s} className="flex min-w-0 flex-1 flex-col gap-1" aria-current={i === idx ? "step" : undefined}>
          <span
            className={
              "h-1 rounded-full " +
              (i < idx ? "bg-brand-300" : i === idx ? "bg-brand-600" : "bg-sand-200")
            }
          />
          <span
            className={
              "truncate text-[10px] " +
              (i === idx ? "font-bold text-brand-800" : "text-ink-soft/60")
            }
            title={STATE_LABELS[s] ?? s}
          >
            {STATE_LABELS[s] ?? s}
          </span>
        </li>
      ))}
    </ol>
  );
}

export default function WorkflowsPage() {
  const moveIns = WORKFLOWS.filter((w) => w.kind === "move_in");
  const moveOuts = WORKFLOWS.filter((w) => w.kind === "move_out");
  const openTickets = TICKETS.filter((t) => !["done", "closed", "cancelled"].includes(t.status));

  return (
    <div>
      <PageHeader
        title="Workflows"
        subtitle="Les quatre machines à états du cycle locatif — chaque blocage est une règle légale rendue impossible à contourner, pas un oubli."
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Mise en location — annonce → installation">
          <ul className="space-y-4">
            {moveIns.map((w) => (
              <li key={w.id} className="rounded-xl border border-sand-200 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="min-w-0 truncate text-sm font-semibold text-ink">{w.label}</p>
                  {w.blockedReason ? (
                    <Badge className="bg-amber-100 text-amber-800">Bloqué</Badge>
                  ) : (
                    <Badge className="bg-sky-100 text-sky-800">{STATE_LABELS[w.currentState]}</Badge>
                  )}
                </div>
                <Stepper states={WORKFLOW_KIND_META.move_in.states} current={w.currentState} />
                {w.blockedReason && (
                  <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{w.blockedReason}</p>
                )}
              </li>
            ))}
          </ul>
          <LegalNote>
            Les clés sont structurellement bloquées tant que l&apos;EDL contradictoire n&apos;est pas signé —
            le chemin légalement fatal (clés sans EDL → garantie inutilisable pour les dégâts) est
            impossible par construction. Publication d&apos;annonce : classe CPE obligatoire, le flux
            échoue fermé.
          </LegalNote>
        </Panel>

        <Panel title="Sortie — préavis → clôture">
          <ul className="space-y-4">
            {moveOuts.map((w) => (
              <li key={w.id} className="rounded-xl border border-sand-200 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="min-w-0 truncate text-sm font-semibold text-ink">{w.label}</p>
                  {w.blockedReason ? (
                    <Badge className="bg-amber-100 text-amber-800">Attention</Badge>
                  ) : (
                    <Badge className="bg-sky-100 text-sky-800">{STATE_LABELS[w.currentState]}</Badge>
                  )}
                </div>
                <Stepper states={WORKFLOW_KIND_META.move_out.states} current={w.currentState} />
                {w.blockedReason && (
                  <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{w.blockedReason}</p>
                )}
              </li>
            ))}
          </ul>
          <LegalNote>
            Pré-visite de courtoisie à J−35 : la punch-list non contraignante transforme les retenues
            probables en réparations faites par le locataire — le meilleur réducteur de litiges du
            marché. Restitution : 50 % à M+1 des clés, solde à M+1 du décompte, pénalité 10 %/mois
            entamé après mise en demeure.
          </LegalNote>
        </Panel>
      </div>

      <Panel title="Vie du bail — interventions en cours" className="mt-5">
        <Card className="overflow-hidden border-0 shadow-none">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-sand-100 bg-sand-50/60 text-left text-[11px] uppercase tracking-wide text-ink-soft/70">
                  <th className="px-4 py-2.5 font-semibold">Référence · Demande</th>
                  <th className="px-3 py-2.5 font-semibold">Logement</th>
                  <th className="px-3 py-2.5 text-right font-semibold">SLA</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Gravité</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Statut</th>
                </tr>
              </thead>
              <tbody>
                {openTickets.map((t) => (
                  <tr key={t.id} className="border-b border-sand-50 last:border-0 hover:bg-sand-50/50">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-ink">{t.ref}</p>
                      <p className="text-xs text-ink-soft">{t.title}</p>
                    </td>
                    <td className="px-3 py-3 text-xs text-ink-soft">{t.unitLabel}</td>
                    <td className="px-3 py-3 text-right text-xs tabular-nums text-ink-soft">
                      {t.slaDueAt ? formatDate(t.slaDueAt) : "—"}
                    </td>
                    <td className="px-3 py-3 text-right"><MetaBadge meta={TICKET_SEVERITY_META[t.severity]} /></td>
                    <td className="px-4 py-3 text-right"><MetaBadge meta={TICKET_STATUS_META[t.status]} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {TICKETS.filter((t) => t.rechargeDecision).map((t) => (
            <div key={t.id} className="rounded-xl border border-sand-200 p-3.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{t.ref}{t.amountCents ? ` · ${euros(t.amountCents)}` : ""}</p>
              <p className="mt-1 text-sm font-semibold text-ink">
                Refacturation : {t.rechargeDecision!.decision === "owner" ? "propriétaire" : t.rechargeDecision!.decision === "tenant" ? "locataire" : "partagée"}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-ink-soft">{t.rechargeDecision!.note}</p>
            </div>
          ))}
        </div>
        <LegalNote>
          Dépannage sans logiciel côté artisan : offre par lien magique (premier accepté gagne,
          escalade auto à expiration), créneaux négociés avec le locataire, photos de fin et facture
          OCR. Urgence gaz : court-circuit vers les numéros d&apos;urgence avant même la fin de la saisie.
        </LegalNote>
      </Panel>
    </div>
  );
}
