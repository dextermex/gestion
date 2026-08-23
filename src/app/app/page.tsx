import Link from "next/link";
import { Badge, Card } from "@/components/pro/ui";
import { Kpi, LinkRow, MetaBadge, Panel, Timeline } from "@/components/gestion/bits";
import {
  BANK_ACCOUNTS,
  BANK_TXS,
  DEPOSITS,
  EDLS,
  LEASES,
  RENT_PERIODS,
  TICKETS,
  TODAY,
  UNITS,
  WORKFLOWS,
  leaseTenantNames,
  leaseUnitLabel,

} from "@/lib/demo/data";
import { euros, eurosWhole, formatDate, RENT_STATUS_META } from "@/lib/types";
import { vacancyClock } from "@/domain/compliance/deadlines";
import { computeSettlement } from "@/domain/deposits/settlement";
import { ENDED_LEASES } from "@/lib/demo/data";

export default function DashboardPage() {
  // ── KPIs computed from the ledger, never hand-written ──
  const august = RENT_PERIODS.filter((rp) => rp.period === "2026-08");
  const expected = august.reduce((a, rp) => a + rp.totalCents, 0);
  const collected = august.reduce((a, rp) => a + rp.allocatedCents, 0);
  const lateAmount = RENT_PERIODS.filter((rp) => rp.status === "late" || rp.status === "partial")
    .filter((rp) => rp.period <= "2026-08")
    .reduce((a, rp) => a + (rp.totalCents - rp.allocatedCents), 0);

  const lettable = UNITS.filter((u) => u.kind !== "parking");
  const occupied = new Set(
    LEASES.filter((l) => l.status === "active" || l.status === "notice").map((l) => l.unitId),
  );
  const occupancyPct = Math.round((100 * lettable.filter((u) => occupied.has(u.id)).length) / lettable.length);

  const openTickets = TICKETS.filter((t) => !["done", "closed", "cancelled"].includes(t.status));
  const reviewQueue = BANK_TXS.filter((t) => t.status === "review");

  // ── Engine-derived alerts ──
  const gareUnit = UNITS.find((u) => u.id === "u-gare")!;
  const gareVacancy = vacancyClock("Studio 4A", gareUnit.vacantSince!, TODAY);

  const settlementDeposit = DEPOSITS.find((d) => d.id === "dep-gare")!;
  const settlement = computeSettlement({
    depositAmount: settlementDeposit.amountCents,
    depositForm: settlementDeposit.form,
    monthlyRent: ENDED_LEASES[0].rentCents,
    keyHandoverDate: settlementDeposit.keyHandoverOn!,
    decompteIssuedAt: settlementDeposit.decompteIssuedOn ?? null,
    entryEdlExists: settlementDeposit.entryEdlExists,
    deductions: settlementDeposit.deductions.map((d) => ({
      id: d.id,
      kind: d.kind,
      label: d.label,
      amount: d.amountCents,
      justificationDocRef: d.justificationDocRef,
      justifiedAt: d.justifiedAt,
    })),
    miseEnDemeureArDate: settlementDeposit.miseEnDemeureArOn ?? null,
    releasedFirstTranche: settlementDeposit.releasedFirstTrancheCents,
    releasedBalance: settlementDeposit.releasedBalanceCents,
    asOf: TODAY,
  });

  const consentAccount = BANK_ACCOUNTS.find((b) => b.consentExpiresAt);

  const todo: Array<{ href: string; title: string; sub: string; badge: { label: string; color: string } }> = [
    {
      href: "/app/banque",
      title: `${reviewQueue.length} paiements à vérifier dans la file de rapprochement`,
      sub: "Dont un tiers payeur (aide au logement CNAP) — lier l'IBAN automatise les mois suivants.",
      badge: { label: "Banque", color: "bg-amber-100 text-amber-800" },
    },
    {
      href: "/app/indexation",
      title: "Ordre permanent non mis à jour — Apt 3B (écart 70,00 €/mois)",
      sub: "Paiement d'août reçu à l'ancien loyer. Courrier pré-rempli prêt à envoyer.",
      badge: { label: "Indexation", color: "bg-sky-100 text-sky-800" },
    },
    {
      href: "/app/loyers",
      title: "Apt 2A — juillet impayé : mise en demeure à confirmer (J+24)",
      sub: "Lettre recommandée avec AR — confirmation gestionnaire requise, jamais d'envoi automatique.",
      badge: { label: "Impayés", color: "bg-red-100 text-red-700" },
    },
    {
      href: "/app/garanties",
      title: "Restitution Studio 4A — 1 déduction sans justificatif",
      sub: settlement.warnings[0] ?? "Justificatif à joindre avant l'expiration du délai d'un mois.",
      badge: { label: "Garantie", color: "bg-orange-100 text-orange-800" },
    },
    {
      href: "/app/banque",
      title: `Consentement bancaire BGL expire le ${formatDate(consentAccount?.consentExpiresAt ?? null)}`,
      sub: "Échelle de relance T-14/7/2/0 — renouveler pour éviter la coupure du flux.",
      badge: { label: "Connexion", color: "bg-sand-100 text-ink-soft" },
    },
    {
      href: "/app/conformite",
      title: "AG Résidence Beaulieu du 20 oct. — convocations à envoyer avant le 5 oct.",
      sub: "Délai légal : 15 jours avant l'assemblée (RGD 13.6.1975, art. 3).",
      badge: { label: "Syndic", color: "bg-violet-100 text-violet-800" },
    },
  ];

  const endingLeases = LEASES.filter((l) => l.status === "notice");

  const activity = [
    { kind: "payment", label: "Loyer Kirchberg encaissé — 9 009,00 € (TVA 17 % incluse)", sub: "Rapprochement automatique · IBAN lié", at: "5 août" },
    { kind: "letter", label: "Mise en demeure Apt 2A — AR reçu", sub: "Le délai légal court depuis la date de l'AR", at: "12 août" },
    { kind: "ticket", label: "INT-2026-0141 chaudière — créneau accepté par Krier & Fils", sub: "Vendredi 8 h–10 h", at: "21 août" },
    { kind: "document", label: "Attestation de logement générée (Apt 2A)", sub: "Libre-service locataire · QR de vérification", at: "20 août" },
    { kind: "lease", label: "Préavis reçu — Apt 1A (Claire Dubois)", sub: "Fin licite calculée : 14 nov. 2026 (date AR + 3 mois)", at: "14 août" },
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-ink">Bonjour Alex</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Voici l&apos;état de Cabinet Reuter aujourd&apos;hui — samedi 23 août 2026.
        </p>
      </div>

      <div className="stagger-rise grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi
          label="Encaissé — août"
          value={eurosWhole(collected)}
          sub={`sur ${eurosWhole(expected)} attendus`}
          tone={collected >= expected ? "good" : "default"}
        />
        <Kpi label="Taux d'occupation" value={`${occupancyPct} %`} sub={`${lettable.filter((u) => occupied.has(u.id)).length} lots sur ${lettable.length}`} />
        <Kpi label="Solde en retard" value={euros(lateAmount)} sub="2 baux concernés" tone={lateAmount > 0 ? "bad" : "good"} />
        <Kpi label="Interventions ouvertes" value={String(openTickets.length)} sub="dont 1 urgente" />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Panel title="À faire aujourd'hui" className="lg:col-span-2">
          <ul className="divide-y divide-sand-100">
            {todo.map((t) => (
              <li key={t.title}>
                <LinkRow href={t.href} title={t.title} sub={t.sub} right={<Badge className={t.badge.color}>{t.badge.label}</Badge>} />
              </li>
            ))}
          </ul>
        </Panel>

        <div className="flex flex-col gap-5">
          <Panel title="Activité récente">
            <Timeline entries={activity} />
          </Panel>
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Panel title="Loyers du mois" action={<Link href="/app/loyers" className="text-sm font-semibold text-brand-700 hover:underline">Tout voir</Link>}>
          <ul className="divide-y divide-sand-100">
            {august.slice(0, 5).map((rp) => {
              const l = LEASES.find((x) => x.id === rp.leaseId)!;
              return (
                <li key={rp.id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{leaseUnitLabel(l)}</p>
                    <p className="truncate text-xs text-ink-soft">{leaseTenantNames(l).join(", ")}</p>
                  </div>
                  <p className="tabular-nums text-sm text-ink">{euros(rp.totalCents)}</p>
                  <MetaBadge meta={RENT_STATUS_META[rp.status]} />
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel title="Fins de bail & sorties">
          {endingLeases.length === 0 ? (
            <p className="text-sm text-ink-soft">Aucun préavis en cours.</p>
          ) : (
            <ul className="divide-y divide-sand-100">
              {endingLeases.map((l) => (
                <li key={l.id}>
                  <LinkRow
                    href={`/app/baux/${l.id}`}
                    title={leaseUnitLabel(l)}
                    sub={`Préavis ${l.noticeInfo?.direction === "tenant" ? "locataire" : "bailleur"} — fin licite le ${formatDate(l.noticeInfo?.earliestEnd ?? null)}`}
                    right={<Badge className="bg-orange-100 text-orange-800">Préavis</Badge>}
                  />
                </li>
              ))}
              <li>
                <LinkRow
                  href="/app/garanties"
                  title="Studio 4A — restitution de garantie en cours"
                  sub={`50 % versés · solde ${euros(settlement.balanceAmount)} après décompte`}
                  right={<Badge className="bg-amber-100 text-amber-800">En cours</Badge>}
                />
              </li>
            </ul>
          )}
        </Panel>

        <Panel title="Vigilance Luxembourg">
          <ul className="space-y-3 text-sm">
            <li className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-ink">Vacance Studio 4A — {gareVacancy.monthsVacant} mois</p>
                <p className="text-xs text-ink-soft">
                  Seuil INOL (6 mois) franchi — le dossier de défense (annonces, travaux, offres) se
                  constitue automatiquement. Réforme non votée [incertain].
                </p>
              </div>
              <Badge className="bg-red-100 text-red-700">INOL</Badge>
            </li>
            <li className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-ink">CPE Résidence Beaulieu</p>
                <p className="text-xs text-ink-soft">Expire le 1 mars 2027 — classe obligatoire dans toute annonce.</p>
              </div>
              <Badge className="bg-amber-100 text-amber-800">CPE</Badge>
            </li>
            <li className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-ink">Assurance RC pro du cabinet</p>
                <p className="text-xs text-ink-soft">Échéance 30 nov. 2026 — obligatoire pour l&apos;autorisation d&apos;établissement.</p>
              </div>
              <Badge className="bg-amber-100 text-amber-800">RC pro</Badge>
            </li>
            <li className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-ink">Détecteurs de fumée — Studio 4A</p>
                <p className="text-xs text-ink-soft">Pose à confirmer avant relocation (obligatoire depuis le 1.1.2023).</p>
              </div>
              <Badge className="bg-red-100 text-red-700">À poser</Badge>
            </li>
          </ul>
          <Link href="/app/conformite" className="mt-4 block text-sm font-semibold text-brand-700 hover:underline">
            Ouvrir le calendrier de conformité →
          </Link>
        </Panel>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel title="Workflows en cours" action={<Link href="/app/workflows" className="text-sm font-semibold text-brand-700 hover:underline">Tout voir</Link>}>
          <ul className="divide-y divide-sand-100">
            {WORKFLOWS.slice(0, 4).map((w) => (
              <li key={w.id}>
                <LinkRow
                  href="/app/workflows"
                  title={w.label}
                  sub={w.blockedReason ?? `Étape : ${w.currentState}`}
                  right={
                    w.blockedReason ? (
                      <Badge className="bg-amber-100 text-amber-800">Bloqué</Badge>
                    ) : (
                      <Badge className="bg-sky-100 text-sky-800">{w.currentState}</Badge>
                    )
                  }
                />
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="États des lieux à venir">
          <ul className="divide-y divide-sand-100">
            {EDLS.filter((e) => e.status === "draft").map((e) => (
              <li key={e.id}>
                <LinkRow
                  href="/app/workflows"
                  title={`EDL ${e.kind === "entry" ? "d'entrée" : e.kind === "exit" ? "de sortie" : "intermédiaire"} — ${e.unitLabel}`}
                  sub={`Prévu le ${formatDate(e.scheduledAt)} · remise des clés bloquée tant que l'EDL contradictoire n'est pas signé`}
                  right={<Badge className="bg-sand-100 text-ink-soft">Planifié</Badge>}
                />
              </li>
            ))}
          </ul>
          <Card className="mt-3 border-dashed bg-sand-50/50 p-3">
            <p className="text-xs leading-relaxed text-ink-soft">
              Sans EDL d&apos;entrée, la garantie ne peut couvrir aucun dégât — le parcours de remise des
              clés est verrouillé en conséquence (impossible par construction).
            </p>
          </Card>
        </Panel>
      </div>
    </div>
  );
}
