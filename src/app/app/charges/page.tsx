import { Badge, PageHeader } from "@/components/pro/ui";
import { LegalNote, Panel } from "@/components/gestion/bits";
import {
  LEASE_TANTIEMES,
  RENT_PERIODS,
  SYNDIC_DECOMPTE_2025,
  leaseById,
  leaseTenantNames,
  leaseUnitLabel,
} from "@/lib/demo/data";
import { euros } from "@/lib/types";
import { mapSyndicDecompte } from "@/domain/charges/recharge";

export default function ChargesPage() {
  // Map the AG-approved syndic décompte through the recharge engine for Apt 3B.
  const showcaseLeaseId = "l-3b";
  const tantiemes = LEASE_TANTIEMES[showcaseLeaseId];
  const mapped = mapSyndicDecompte(
    SYNDIC_DECOMPTE_2025.lines.map((l) => ({
      label: l.label,
      category: l.category,
      totalBuilding: l.totalBuilding,
      tantiemes,
      tantiemesTotal: SYNDIC_DECOMPTE_2025.tantiemesTotal,
    })),
    "residential",
  );
  const lease = leaseById(showcaseLeaseId);
  const advances2025 = lease.chargesCents * 12;
  const balance = mapped.totalRecoverable - advances2025;

  const chargeRegimes = RENT_PERIODS.filter((rp) => rp.period === "2026-08");

  return (
    <div>
      <PageHeader
        title="Charges"
        subtitle="Seules les dépenses réellement engagées, justifiées par facture et au bénéfice du locataire sont récupérables. Les blocages légaux ne sont pas contournables."
      />

      <div className="grid gap-5 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Panel title={`Décompte 2025 — ${leaseUnitLabel(lease)} (import syndic)`}>
            <p className="mb-3 text-xs text-ink-soft">
              Décompte de copropriété approuvé en AG (présomption de justification) · lot {tantiemes}/{SYNDIC_DECOMPTE_2025.tantiemesTotal} millièmes ·
              locataire : {leaseTenantNames(lease).join(", ")}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-sand-100 bg-sand-50/60 text-left text-[11px] uppercase tracking-wide text-ink-soft/70">
                    <th className="px-3 py-2.5 font-semibold">Poste</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Immeuble</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Quote-part lot</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Récupérable</th>
                  </tr>
                </thead>
                <tbody>
                  {mapped.lines.map((line) => (
                    <tr key={line.label} className="border-b border-sand-50 last:border-0">
                      <td className="px-3 py-2.5">
                        <p className={line.blocked ? "text-ink-soft line-through decoration-red-300" : "text-ink"}>
                          {line.label}
                        </p>
                        {line.blocked && (
                          <p className="text-[11px] text-red-600">{line.blockReason}</p>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-soft">
                        {euros(SYNDIC_DECOMPTE_2025.lines.find((l) => l.label === line.label)!.totalBuilding)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-soft">{euros(line.lotShare)}</td>
                      <td className={"px-3 py-2.5 text-right tabular-nums " + (line.blocked ? "text-red-600" : "font-semibold text-ink")}>
                        {line.blocked ? "0,00 €" : euros(line.tenantRecoverable)}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-sand-50/60">
                    <td className="px-3 py-2.5 font-bold text-ink">Total récupérable</td>
                    <td className="px-3 py-2.5" />
                    <td className="px-3 py-2.5 text-right tabular-nums text-red-600">
                      − {euros(mapped.totalBlocked)} bloqués
                    </td>
                    <td className="px-3 py-2.5 text-right font-display font-bold tabular-nums text-ink">
                      {euros(mapped.totalRecoverable)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3">
              <div className="rounded-xl bg-sand-50 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft/70">Provisions 2025</p>
                <p className="mt-0.5 font-display text-lg font-bold tabular-nums text-ink">{euros(advances2025)}</p>
              </div>
              <div className="rounded-xl bg-sand-50 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft/70">Réel récupérable</p>
                <p className="mt-0.5 font-display text-lg font-bold tabular-nums text-ink">{euros(mapped.totalRecoverable)}</p>
              </div>
              <div className={"rounded-xl p-3 " + (balance > 0 ? "bg-amber-50" : "bg-emerald-50")}>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft/70">
                  {balance > 0 ? "Solde dû par le locataire" : "À rembourser au locataire"}
                </p>
                <p className={"mt-0.5 font-display text-lg font-bold tabular-nums " + (balance > 0 ? "text-amber-800" : "text-emerald-700")}>
                  {euros(Math.abs(balance))}
                </p>
              </div>
            </div>
            <LegalNote>
              Litige charges : justice de paix (jamais la commission des loyers) — le routeur encode
              la juridiction. Après décompte, le moteur propose l&apos;ajustement des provisions.
            </LegalNote>
          </Panel>
        </div>

        <div className="lg:col-span-2 flex flex-col gap-5">
          <Panel title="Blocages non négociables (habitation)">
            <ul className="space-y-2 text-sm">
              {[
                "Frais de gérance",
                "Assurance de l'immeuble",
                "Impôt foncier",
                "Passeport énergétique (CPE)",
                "Location / relevé de compteurs",
                "Grosses réparations",
                "Renouvellement pour vétusté",
              ].map((label) => (
                <li key={label} className="flex items-center justify-between gap-3 rounded-lg bg-red-50/70 px-3 py-2">
                  <span className="text-ink">{label}</span>
                  <Badge className="bg-red-100 text-red-700">Jamais</Badge>
                </li>
              ))}
            </ul>
            <LegalNote>
              Un outil étranger refacturerait ces postes sans sourciller — ici la refacturation est
              une décision moteur avec base légale, pas une case à cocher.
            </LegalNote>
          </Panel>

          <Panel title="Régimes en cours — août 2026">
            <ul className="divide-y divide-sand-100 text-sm">
              {chargeRegimes.map((rp) => {
                const l = leaseById(rp.leaseId);
                return (
                  <li key={rp.id} className="flex items-center gap-3 py-2.5">
                    <p className="min-w-0 flex-1 truncate text-ink">{leaseUnitLabel(l)}</p>
                    <span className="tabular-nums text-ink-soft">{euros(l.chargesCents)}/mois</span>
                    <Badge className={l.chargesRegime === "advances" ? "bg-sky-100 text-sky-800" : "bg-sand-100 text-ink-soft"}>
                      {l.chargesRegime === "advances" ? "Provisions" : "Forfait"}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
