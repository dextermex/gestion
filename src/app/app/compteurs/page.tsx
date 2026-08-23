import { Badge, Card, PageHeader } from "@/components/pro/ui";
import { LegalNote, Panel } from "@/components/gestion/bits";
import { METERS, propertyById, unitById } from "@/lib/demo/data";
import { METER_KIND_META, formatDate } from "@/lib/types";

export default function CompteursPage() {
  const withoutReading = METERS.filter((m) => !m.lastReading);
  const pendingAck = METERS.filter((m) => m.lastReading && (!m.lastReading.tenantAck || !m.lastReading.managerAck));

  return (
    <div>
      <PageHeader
        title="Compteurs"
        subtitle="Aucune API compteurs n'existe au Luxembourg — la confiance vient du double acquittement : photo horodatée, OCR, puis validation locataire ET gestionnaire."
      />

      <div className="mb-5 grid grid-cols-3 gap-4">
        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft/70">Compteurs suivis</p>
          <p className="mt-1 font-display text-2xl font-bold tabular-nums text-ink">{METERS.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft/70">Acquittement en attente</p>
          <p className="mt-1 font-display text-2xl font-bold tabular-nums text-amber-700">{pendingAck.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft/70">Sans relevé</p>
          <p className="mt-1 font-display text-2xl font-bold tabular-nums text-red-600">{withoutReading.length}</p>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sand-100 bg-sand-50/60 text-left text-[11px] uppercase tracking-wide text-ink-soft/70">
                <th className="px-4 py-2.5 font-semibold">Compteur · Localisation</th>
                <th className="px-3 py-2.5 font-semibold">Fournisseur</th>
                <th className="px-3 py-2.5 text-right font-semibold">Dernier relevé</th>
                <th className="px-3 py-2.5 text-right font-semibold">Source</th>
                <th className="px-4 py-2.5 text-right font-semibold">Acquittements</th>
              </tr>
            </thead>
            <tbody>
              {METERS.map((m) => {
                const meta = METER_KIND_META[m.kind];
                const unit = m.unitId ? unitById(m.unitId) : null;
                const property = propertyById(m.propertyId);
                return (
                  <tr key={m.id} className="border-b border-sand-50 last:border-0 hover:bg-sand-50/50">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-ink">{meta.label} · {m.serial}</p>
                      <p className="text-xs text-ink-soft">{unit ? `${unit.label} — ` : "Communs — "}{property.name}</p>
                    </td>
                    <td className="px-3 py-3 text-xs text-ink-soft">{m.supplier}</td>
                    <td className="px-3 py-3 text-right">
                      {m.lastReading ? (
                        <>
                          <p className="tabular-nums text-ink">{m.lastReading.value.toLocaleString("fr-LU")} {meta.unit}</p>
                          <p className="text-[11px] text-ink-soft/70">{formatDate(m.lastReading.date)}</p>
                        </>
                      ) : (
                        <span className="text-xs text-ink-soft/60">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {m.lastReading ? (
                        <Badge className="bg-sand-100 text-ink-soft">
                          {m.lastReading.source === "photo_ocr" ? "Photo + OCR" : m.lastReading.source === "edl" ? "EDL" : m.lastReading.source === "import" ? "Import ista" : "Manuel"}
                        </Badge>
                      ) : (
                        <Badge className="bg-red-100 text-red-700">À relever</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {m.lastReading ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <Badge className={m.lastReading.tenantAck ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}>
                            Locataire {m.lastReading.tenantAck ? "✓" : "…"}
                          </Badge>
                          <Badge className={m.lastReading.managerAck ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}>
                            Gestion {m.lastReading.managerAck ? "✓" : "…"}
                          </Badge>
                        </div>
                      ) : (
                        <span className="text-xs text-ink-soft/60">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel title="Relevés d'EDL — première classe">
          <p className="text-sm leading-relaxed text-ink-soft">
            À chaque état des lieux, les compteurs sont des objets de première classe : photo
            horodatée et géolocalisée, valeur OCR proposée, acquittement des deux parties d&apos;un
            geste. Le pack de transfert fournisseur (Enovos, Sudgaz, Ville) se génère automatiquement
            à l&apos;entrée comme à la sortie.
          </p>
          <LegalNote>
            Location de compteur et frais de relevé : jamais refacturables au locataire résidentiel
            (blocage légal dans le moteur de charges).
          </LegalNote>
        </Panel>
        <Panel title="Répartition ista / Techem">
          <p className="text-sm leading-relaxed text-ink-soft">
            Les décomptes de chauffage collectif (ista, Techem) sont ingérés en PDF : découpage,
            extraction, correspondance par lot — chaque locataire ne voit que sa page. Les valeurs
            alimentent directement le décompte de charges annuel avec provenance ligne à ligne.
          </p>
          <div className="mt-3 rounded-xl border border-sand-200 bg-sand-50/60 p-3.5 text-xs text-ink-soft">
            Dernier import : <span className="font-semibold text-ink">ista — Résidence Beaulieu, répartition 2025</span> ·
            6 lots rapprochés · intégré au décompte 2025 (voir Charges).
          </div>
        </Panel>
      </div>
    </div>
  );
}
