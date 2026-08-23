import { Badge, Card, PageHeader } from "@/components/pro/ui";
import { LegalNote, MetaBadge, Panel } from "@/components/gestion/bits";
import { BANK_ACCOUNTS, BANK_TXS, TODAY } from "@/lib/demo/data";
import { BANK_TX_STATUS_META, MATCH_TIER_META, euros, formatDate } from "@/lib/types";
import { diffDays } from "@/domain/dates";
import { vopNameCheck } from "@/domain/banking/rf";

export default function BanquePage() {
  const autoCount = BANK_TXS.filter((t) => t.status === "auto").length;
  const inCount = BANK_TXS.filter((t) => t.amount > 0).length;
  const autoRate = Math.round((100 * autoCount) / inCount);
  const review = BANK_TXS.filter((t) => t.status === "review");

  return (
    <div>
      <PageHeader
        title="Banque"
        subtitle="Rapprochement automatique des loyers — en lecture seule sur les fonds : reconnaissance, jamais encaissement (pas de licence CSSF requise)."
      />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft/70">Taux de reconnaissance</p>
          <p className="mt-1 font-display text-2xl font-bold tabular-nums text-emerald-700">{autoRate} %</p>
          <p className="mt-0.5 text-xs text-ink-soft">objectif ≥ 90 % en régime établi</p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft/70">À vérifier</p>
          <p className="mt-1 font-display text-2xl font-bold tabular-nums text-ink">{review.length}</p>
          <p className="mt-0.5 text-xs text-ink-soft">file clavier-d&apos;abord</p>
        </Card>
        {BANK_ACCOUNTS.map((b) => (
          <Card key={b.id} className="p-4">
            <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-ink-soft/70">{b.label}</p>
            <p className="mt-1 font-display text-2xl font-bold tabular-nums text-ink">{euros(b.balanceCents)}</p>
            {b.consentExpiresAt ? (
              <p className={"mt-0.5 text-xs " + (diffDays(TODAY, b.consentExpiresAt) <= 21 ? "font-semibold text-amber-700" : "text-ink-soft")}>
                Consentement expire le {formatDate(b.consentExpiresAt)} (J−{diffDays(TODAY, b.consentExpiresAt)})
              </p>
            ) : (
              <p className="mt-0.5 text-xs text-ink-soft">Import CAMT.053 — toujours disponible</p>
            )}
          </Card>
        ))}
      </div>

      {review.length > 0 && (
        <Panel title="File de vérification" className="mb-5">
          <ul className="space-y-3">
            {review.map((t) => (
              <li key={t.id} className="rounded-xl border border-amber-200 bg-amber-50/50 p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">
                      {t.counterpartyName} — <span className="tabular-nums">{euros(t.amount)}</span>
                    </p>
                    <p className="text-xs text-ink-soft">« {t.remittanceInfo} » · {formatDate(t.bookedAt)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="tactile rounded-xl bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700">
                      Rapprocher + lier l&apos;IBAN
                    </button>
                    <button className="rounded-xl border border-sand-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink-soft hover:border-brand-300 hover:text-brand-700">
                      Ignorer
                    </button>
                  </div>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-ink-soft">{t.matchExplain}</p>
              </li>
            ))}
          </ul>
          <LegalNote>
            Chaque rapprochement manuel propose en une touche la liaison IBAN payeur → bail : la
            correction d&apos;aujourd&apos;hui devient l&apos;automatisation permanente de demain (niveau 2 de la
            cascade — le seul qui capte les tiers payeurs : parents, employeurs, aides au logement).
          </LegalNote>
        </Panel>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sand-100 bg-sand-50/60 text-left text-[11px] uppercase tracking-wide text-ink-soft/70">
                <th className="px-4 py-2.5 font-semibold">Contrepartie · Libellé</th>
                <th className="px-3 py-2.5 text-right font-semibold">Montant</th>
                <th className="px-3 py-2.5 text-right font-semibold">Date</th>
                <th className="px-3 py-2.5 text-right font-semibold">Niveau</th>
                <th className="px-4 py-2.5 text-right font-semibold">Statut</th>
              </tr>
            </thead>
            <tbody>
              {BANK_TXS.map((t) => (
                <tr key={t.id} className="border-b border-sand-50 last:border-0 hover:bg-sand-50/50">
                  <td className="max-w-md px-4 py-3">
                    <p className="font-semibold text-ink">{t.counterpartyName}</p>
                    <p className="truncate text-xs text-ink-soft" title={t.matchExplain}>
                      « {t.remittanceInfo} »
                    </p>
                  </td>
                  <td className={"px-3 py-3 text-right tabular-nums " + (t.amount < 0 ? "text-ink-soft" : "text-ink")}>
                    {euros(t.amount)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-ink-soft">{formatDate(t.bookedAt)}</td>
                  <td className="px-3 py-3 text-right">
                    {t.matchTier ? <MetaBadge meta={MATCH_TIER_META[t.matchTier]} /> : <span className="text-xs text-ink-soft/60">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <MetaBadge meta={BANK_TX_STATUS_META[t.status]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel title="Cascade de rapprochement">
          <ol className="space-y-3 text-sm">
            {[
              ["Pré-classification", "Contreparties hors loyers · INDEXATION_LAG · somme exacte multi-factures (≤ 6)."],
              ["Niveau 1 — Référence RF", "Déterministe : référence ISO 11649 validée par somme de contrôle, retrouvée même dans le libellé libre."],
              ["Niveau 2 — IBAN lié", "Liaisons apprises payeur → bail. Capte les tiers payeurs. Allocation FIFO, reliquat ouvert."],
              ["Niveau 3 — Score pondéré", "IBAN 0,45 · montant 0,25/0,20/0,12 · jetons du libellé 0,20 · nom (Jaro-Winkler) 0,15 · date 0,10. Auto ≥ 0,85 avec marge ≥ 0,15 sur le second candidat — la règle de marge qui distingue deux studios identiques à 1 450 €."],
            ].map(([title, body], i) => (
              <li key={title} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-700">
                  {i}
                </span>
                <div>
                  <p className="font-semibold text-ink">{title}</p>
                  <p className="text-xs leading-relaxed text-ink-soft">{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel title="VoP — vérification du bénéficiaire">
          {BANK_ACCOUNTS.map((b) => {
            const check = vopNameCheck(b.holderNameVerbatim, b.holderNameVerbatim);
            return (
              <div key={b.id} className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-sand-200 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{b.iban}</p>
                  <p className="truncate text-xs text-ink-soft">Nom vérifié : « {b.holderNameVerbatim} »</p>
                </div>
                <Badge className={check.ok ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-700"}>
                  {check.ok ? "Conforme" : "Divergent"}
                </Badge>
              </div>
            );
          })}
          <LegalNote>
            Depuis octobre 2025, chaque IBAN affiché est vérifié par la banque du payeur (Verification
            of Payee). Le nom du titulaire est capturé mot pour mot à l&apos;ouverture ; toute divergence
            bloque l&apos;émission de l&apos;avis et du QR EPC.
          </LegalNote>
        </Panel>
      </div>
    </div>
  );
}
