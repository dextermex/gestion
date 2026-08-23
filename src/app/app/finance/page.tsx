import { Badge, PageHeader } from "@/components/pro/ui";
import { LegalNote, Panel } from "@/components/gestion/bits";
import { RENT_PERIODS, leaseById, leaseUnitLabel } from "@/lib/demo/data";
import { euros } from "@/lib/types";
import { managementFeeVat } from "@/domain/fiscal/vat";
import { splitExact } from "@/domain/money";

export default function FinancePage() {
  // Décompte de gérance — juillet 2026, mandat SCI Beaulieu (engine-computed).
  const july = RENT_PERIODS.filter((rp) => rp.period === "2026-07");
  const beaulieuLeases = ["l-3b", "l-3c", "l-2a", "l-1a", "l-rdc"];
  const collectedRows = july
    .filter((rp) => beaulieuLeases.includes(rp.leaseId))
    .map((rp) => ({ rp, lease: leaseById(rp.leaseId) }));
  const collected = collectedRows.reduce((a, r) => a + r.rp.allocatedCents, 0);

  const feeNet = Math.round(collected * 0.04);
  const fee = managementFeeVat(feeNet, "2026-07-31");
  const krierInvoice = 124_000; // boiler repair, owner charge
  const netToOwner = collected - fee.gross - krierInvoice;

  // Co-owner split through the SCI (60/40) — exact to the cent.
  const [faberShare, pierreShare] = splitExact(netToOwner, [60, 40]);

  return (
    <div>
      <PageHeader
        title="Finance"
        subtitle="Comptes rendus de gérance, honoraires et reversements — l'argent des propriétaires sans jamais y toucher : fichiers pain.001 que le gestionnaire dépose dans sa propre banque."
      />

      <div className="grid gap-5 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Panel title="Décompte de gérance — juillet 2026 · Mandat SCI Beaulieu">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-sand-100 bg-sand-50/60 text-left text-[11px] uppercase tracking-wide text-ink-soft/70">
                    <th className="px-3 py-2.5 font-semibold">Écriture</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {collectedRows.map(({ rp, lease }) => (
                    <tr key={rp.id} className="border-b border-sand-50">
                      <td className="px-3 py-2.5 text-ink">
                        Loyer encaissé — {leaseUnitLabel(lease)}
                        {rp.allocatedCents === 0 && (
                          <span className="ml-2 text-xs text-red-600">(impayé — relance en cours)</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink">{euros(rp.allocatedCents)}</td>
                    </tr>
                  ))}
                  <tr className="border-b border-sand-50">
                    <td className="px-3 py-2.5 text-ink">
                      Honoraires de gérance 4 %
                      <span className="ml-2 text-xs text-ink-soft">({euros(fee.net)} + TVA 17 % {euros(fee.vat)})</span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-red-600">− {euros(fee.gross)}</td>
                  </tr>
                  <tr className="border-b border-sand-50">
                    <td className="px-3 py-2.5 text-ink">
                      Facture Krier & Fils — chaudière Apt 3B
                      <span className="ml-2 text-xs text-ink-soft">(grosse réparation — charge propriétaire)</span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-red-600">− {euros(krierInvoice)}</td>
                  </tr>
                  <tr className="bg-sand-50/60">
                    <td className="px-3 py-2.5 font-bold text-ink">Net reversé au mandant</td>
                    <td className="px-3 py-2.5 text-right font-display font-bold tabular-nums text-emerald-700">
                      {euros(netToOwner)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-sand-200 p-3.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft/70">
                  Répartition SCI (transparente, art. 175 LIR)
                </p>
                <ul className="mt-2 space-y-1.5 text-sm">
                  <li className="flex justify-between">
                    <span className="text-ink-soft">Marie Faber — 60 %</span>
                    <span className="font-semibold tabular-nums text-ink">{euros(faberShare)}</span>
                  </li>
                  <li className="flex justify-between">
                    <span className="text-ink-soft">Pierre Faber — 40 %</span>
                    <span className="font-semibold tabular-nums text-ink">{euros(pierreShare)}</span>
                  </li>
                </ul>
                <p className="mt-2 text-[11px] text-ink-soft/70">
                  Répartition exacte au centime (méthode du plus fort reste) — un registre ne perd
                  jamais un centime d&apos;arrondi.
                </p>
              </div>
              <div className="rounded-xl border border-sand-200 p-3.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft/70">Reversement</p>
                <p className="mt-2 text-sm text-ink">
                  Fichier <span className="font-semibold">pain.001</span> généré le 5 août — déposé
                  par le gestionnaire dans son e-banking, rapproché au retour sur le relevé sortant.
                </p>
                <Badge className="mt-2 bg-emerald-100 text-emerald-800">Rapproché</Badge>
              </div>
            </div>

            <LegalNote>
              Les honoraires de gérance sont TOUJOURS facturés + 17 % de TVA — la prestation du
              gérant est taxable même quand la location est exonérée. Pour un bailleur résidentiel
              sans droit à déduction, cette TVA est un coût sec, déductible seulement comme frais
              d&apos;obtention. Période verrouillée après émission du décompte.
            </LegalNote>
          </Panel>
        </div>

        <div className="lg:col-span-2 flex flex-col gap-5">
          <Panel title="Comptes de tiers">
            <ul className="space-y-2.5 text-sm">
              <li className="flex items-center justify-between gap-3">
                <span className="text-ink-soft">Compte de réception dédié (fonds de tiers)</span>
                <Badge className="bg-emerald-100 text-emerald-800">Actif</Badge>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span className="text-ink-soft">Comptes par syndicat (jamais de pool)</span>
                <Badge className="bg-sand-100 text-ink-soft">RGD 1975 art. 28</Badge>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span className="text-ink-soft">Grand livre par mandant</span>
                <Badge className="bg-emerald-100 text-emerald-800">Tenu</Badge>
              </li>
            </ul>
            <LegalNote>
              Aucun régime Hoguet n&apos;existe pour l&apos;argent des clients d&apos;agents locatifs [incertain —
              conseil juridique] : la ségrégation est ici un engagement produit et contractuel, pas
              seulement réglementaire.
            </LegalNote>
          </Panel>

          <Panel title="Exports comptables">
            <ul className="space-y-2.5 text-sm">
              <li className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-ink">FAIA (SAF-T Luxembourg, v2.01)</p>
                  <p className="text-xs text-ink-soft">L&apos;export que toute fiduciaire comprend — obligation légale.</p>
                </div>
                <Badge className="bg-brand-100 text-brand-800">Prêt</Badge>
              </li>
              <li className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-ink">Peppol / UBL (EN 16931)</p>
                  <p className="text-xs text-ink-soft">B2G obligatoire ; B2B pas encore — natif dès le premier jour.</p>
                </div>
                <Badge className="bg-brand-100 text-brand-800">Prêt</Badge>
              </li>
              <li className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-ink">Plan comptable normalisé (PCN 2019)</p>
                  <p className="text-xs text-ink-soft">Classes 2/4/6/7 alignées pour consommation fiduciaire directe.</p>
                </div>
                <Badge className="bg-sand-100 text-ink-soft">Mappé</Badge>
              </li>
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
