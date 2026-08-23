import Link from "next/link";
import { Badge, Card, PageHeader } from "@/components/pro/ui";
import { MetaBadge } from "@/components/gestion/bits";
import { CONTACTS } from "@/lib/demo/data";
import { AML_TIER_META, CONTACT_ROLE_META, type ContactRole } from "@/lib/types";
import { initials } from "@/lib/types";

const FACETS: Array<{ id: string; label: string; role: ContactRole | null }> = [
  { id: "all", label: "Tous", role: null },
  { id: "owner", label: "Propriétaires", role: "owner" },
  { id: "tenant", label: "Locataires", role: "tenant" },
  { id: "artisan", label: "Artisans", role: "artisan" },
  { id: "lead", label: "Prospects", role: "lead" },
];

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const params = await searchParams;
  const facet = FACETS.find((f) => f.id === params.role) ?? FACETS[0];
  const rows = facet.role ? CONTACTS.filter((c) => c.roles.includes(facet.role!)) : CONTACTS;

  const counts = Object.fromEntries(
    FACETS.map((f) => [f.id, f.role ? CONTACTS.filter((c) => c.roles.includes(f.role!)).length : CONTACTS.length]),
  );

  return (
    <div>
      <PageHeader
        title="Contacts"
        subtitle="Une personne, plusieurs rôles : la propriétaire du lot 3 peut être locataire du lot 7 — les rôles sont des liens datés, jamais des doublons de fiche."
      />

      <div className="no-scrollbar mb-4 flex gap-2 overflow-x-auto">
        {FACETS.map((f) => (
          <Link
            key={f.id}
            href={f.id === "all" ? "/app/contacts" : `/app/contacts?role=${f.id}`}
            aria-current={f.id === facet.id ? "page" : undefined}
            className={
              "flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition " +
              (f.id === facet.id
                ? "bg-brand-700 text-white"
                : "border border-sand-200 bg-white text-ink-soft hover:border-brand-200 hover:text-brand-700")
            }
          >
            {f.label}
            <span className={"tabular-nums text-xs " + (f.id === facet.id ? "text-white/70" : "text-ink-soft/60")}>
              {counts[f.id]}
            </span>
          </Link>
        ))}
      </div>

      <Card className="overflow-hidden">
        <ul className="divide-y divide-sand-100">
          {rows.map((c) => (
            <li key={c.id}>
              <Link href={`/app/contacts/${c.id}`} className="flex items-center gap-3 px-4 py-3 transition hover:bg-sand-50">
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
                    {c.email ?? c.phone ?? "—"}
                    {c.residency === "non_resident" && ` · non-résident (${c.country})`}
                    {c.notes && ` · ${c.notes}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {c.roles.map((r) => (
                    <MetaBadge key={r} meta={CONTACT_ROLE_META[r]} />
                  ))}
                  {c.amlTier === "full_cdd" && <MetaBadge meta={AML_TIER_META.full_cdd} />}
                </div>
                <svg className="h-4 w-4 shrink-0 text-ink-soft" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
                </svg>
              </Link>
            </li>
          ))}
        </ul>
        {rows.length === 0 && (
          <div className="px-6 py-14 text-center">
            <p className="font-display text-base font-bold text-ink">Aucun contact dans ce filtre</p>
            <p className="mt-1 text-sm text-ink-soft">Les contacts apparaissent ici dès qu&apos;un rôle correspondant leur est attribué.</p>
          </div>
        )}
      </Card>

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <Badge className="justify-start gap-2 bg-white px-4 py-3 text-ink-soft shadow-sm">
          Fiches archivées : l&apos;e-mail se libère, l&apos;actif reste dédupliqué
        </Badge>
        <Badge className="justify-start gap-2 bg-white px-4 py-3 text-ink-soft shadow-sm">
          Suppression : liste de suppression anti-résurrection (sync e-mail)
        </Badge>
        <Badge className="justify-start gap-2 bg-white px-4 py-3 text-ink-soft shadow-sm">
          Candidats non retenus : purge automatique à 3 mois (RGPD)
        </Badge>
      </div>
    </div>
  );
}
