import Link from "next/link";
import HubTabs from "@/components/gestion/HubTabs";
import { Badge, Card, PageHeader } from "@/components/pro/ui";
import { MetaBadge } from "@/components/gestion/bits";
import { getDemo } from "@/lib/demo";
import { amlTierMeta, contactRoleMeta, initials, type ContactRole } from "@/lib/types";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const params = await searchParams;
  const { d } = await getI18n();
  const { CONTACTS } = await getDemo();
  const roleMeta = contactRoleMeta(d);
  const amlMeta = amlTierMeta(d);

  const facets: Array<{ id: string; label: string; role: ContactRole | null }> = [
    { id: "all", label: d.contacts.facetAll, role: null },
    { id: "owner", label: d.contacts.facetOwners, role: "owner" },
    { id: "tenant", label: d.contacts.facetTenants, role: "tenant" },
    { id: "artisan", label: d.contacts.facetArtisans, role: "artisan" },
    { id: "lead", label: d.contacts.facetLeads, role: "lead" },
  ];
  const facet = facets.find((f) => f.id === params.role) ?? facets[0];
  const rows = facet.role ? CONTACTS.filter((c) => c.roles.includes(facet.role!)) : CONTACTS;

  const counts = Object.fromEntries(
    facets.map((f) => [f.id, f.role ? CONTACTS.filter((c) => c.roles.includes(f.role!)).length : CONTACTS.length]),
  );

  return (
    <div>
      <HubTabs d={d} hub="relations" active="/app/contacts" />
      <PageHeader title={d.contacts.title} subtitle={d.contacts.subtitle} />

      <div className="no-scrollbar mb-4 flex gap-2 overflow-x-auto">
        {facets.map((f) => (
          <Link
            key={f.id}
            href={f.id === "all" ? "/app/contacts" : `/app/contacts?role=${f.id}`}
            aria-current={f.id === facet.id ? "page" : undefined}
            className={
              "flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition max-sm:min-h-11 " +
              (f.id === facet.id
                ? "bg-brand-600 text-white"
                : "border border-sand-200 bg-white text-ink-soft hover:border-brand-200 hover:text-brand-700")
            }
          >
            {f.label}
            <span className={"tabular-nums text-xs " + (f.id === facet.id ? "text-white/80" : "text-ink-soft")}>
              {counts[f.id]}
            </span>
          </Link>
        ))}
      </div>

      <Card className="overflow-hidden">
        <ul className="divide-y divide-sand-100">
          {rows.map((c) => (
            <li key={c.id}>
              <Link
                href={`/app/contacts/${c.id}`}
                className="flex items-center gap-3 px-4 py-3 transition hover:bg-sand-50"
              >
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
                    {c.residency === "non_resident" &&
                      ` · ${fmt(d.contacts.nonResident, { country: c.country ?? "—" })}`}
                    {c.notes && ` · ${c.notes}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {c.roles.map((r) => (
                    <MetaBadge key={r} meta={roleMeta[r]} />
                  ))}
                  {c.amlTier === "full_cdd" && <MetaBadge meta={amlMeta.full_cdd} />}
                </div>
                <svg
                  className="h-4 w-4 shrink-0 text-ink-soft"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
                </svg>
              </Link>
            </li>
          ))}
        </ul>
        {rows.length === 0 && (
          <div className="px-6 py-14 text-center">
            <p className="font-display text-base font-bold text-ink">{d.contacts.emptyTitle}</p>
            <p className="mt-1 text-sm text-ink-soft">{d.contacts.emptyBody}</p>
          </div>
        )}
      </Card>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Badge className="justify-start gap-2 bg-white px-4 py-3 text-ink-soft shadow-sm">
          {d.contacts.footArchive}
        </Badge>
        <Badge className="justify-start gap-2 bg-white px-4 py-3 text-ink-soft shadow-sm">
          {d.contacts.footSuppression}
        </Badge>
        <Badge className="justify-start gap-2 bg-white px-4 py-3 text-ink-soft shadow-sm">
          {d.contacts.footApplicants}
        </Badge>
      </div>
    </div>
  );
}
