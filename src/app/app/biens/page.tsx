import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader } from "@/components/pro/ui";
import { ChipLink } from "@/components/gestion/filters";
import { getDemo } from "@/lib/demo";
import type { DemoProperty, DemoUnit } from "@/lib/demo/data";
import { euros } from "@/lib/types";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";

/** Structural classification — derived from the units, never from the free-
 *  text `type` label, so it holds on every dataset. */
type PropertyKind = "building" | "house" | "apartment" | "commercial";
function kindOf(p: DemoProperty, units: DemoUnit[]): PropertyKind {
  const dwellings = units.filter((u) => u.kind === "dwelling");
  const commercial = units.filter((u) => u.kind === "commercial");
  if (commercial.length > 0 && dwellings.length === 0) return "commercial";
  if (dwellings.length === 1 && units.length === 1) return p.isCopropriete ? "apartment" : "house";
  return "building";
}

const KIND_PARAM: Record<string, PropertyKind> = {
  immeubles: "building",
  maisons: "house",
  appartements: "apartment",
  commerciaux: "commercial",
};

export default async function BiensPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; occupation?: string }>;
}) {
  const params = await searchParams;
  const { locale, d } = await getI18n();
  const { LEASES, PROPERTIES, UNITS } = await getDemo();

  const enriched = PROPERTIES.map((p) => {
    const units = UNITS.filter((u) => u.propertyId === p.id);
    const lettable = units.filter((u) => u.kind !== "parking");
    const occupied = lettable.filter((u) =>
      LEASES.some((l) => l.unitId === u.id && (l.status === "active" || l.status === "notice")),
    );
    const monthlyRent = LEASES.filter(
      (l) => (l.status === "active" || l.status === "notice") && units.some((u) => u.id === l.unitId),
    ).reduce((a, l) => a + l.rentCents, 0);
    return {
      p,
      units,
      lettable,
      occupied,
      monthlyRent,
      vacant: lettable.length - occupied.length,
      kind: kindOf(p, units),
    };
  });

  const kindFilter = KIND_PARAM[params.type ?? ""];
  const vacantOnly = params.occupation === "vacants";
  const filtered = enriched
    .filter((e) => (kindFilter ? e.kind === kindFilter : true))
    .filter((e) => (vacantOnly ? e.vacant > 0 : true));

  const countOf = (k: PropertyKind) => enriched.filter((e) => e.kind === k).length;
  const href = (type: string | undefined, vacant: boolean) => {
    const q = new URLSearchParams();
    if (type) q.set("type", type);
    if (vacant) q.set("occupation", "vacants");
    const s = q.toString();
    return `/app/biens${s ? `?${s}` : ""}`;
  };
  const cards: Array<{ slug?: string; label: string; value: number }> = [
    { label: d.biens.filterAll, value: enriched.length },
    { slug: "immeubles", label: d.biens.filterBuilding, value: countOf("building") },
    { slug: "maisons", label: d.biens.filterHouse, value: countOf("house") },
    { slug: "appartements", label: d.biens.filterApartment, value: countOf("apartment") },
    { slug: "commerciaux", label: d.biens.filterCommercial, value: countOf("commercial") },
  ];

  return (
    <div>
      <PageHeader
        title={d.biens.title}
        subtitle={d.biens.subtitle}
        actions={
          <Link
            href="/app/biens/nouveau"
            className="tactile flex min-h-9 items-center gap-1.5 rounded-xl bg-brand-600 px-3.5 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 max-sm:min-h-11"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path strokeLinecap="round" d="M12 5v14M5 12h14" />
            </svg>
            {d.biens.addProperty}
          </Link>
        }
      />

      {/* One compact filter row (the banking-page grammar): counts stay
          visible, the page leads with the portfolio itself. */}
      <div className="no-scrollbar mb-5 flex gap-2 overflow-x-auto">
        {cards.map((c) => (
          <ChipLink
            key={c.label}
            href={href(c.slug, vacantOnly)}
            active={(params.type ?? "") === (c.slug ?? "")}
            count={c.value}
          >
            {c.label}
          </ChipLink>
        ))}
        <span className="my-1 w-px shrink-0 bg-sand-200" aria-hidden />
        <ChipLink href={href(params.type, !vacantOnly)} active={vacantOnly}>
          {d.biens.filterVacant}
        </ChipLink>
        {(params.type || vacantOnly) && (
          <ChipLink href="/app/biens">{d.common.resetFilters}</ChipLink>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon="properties"
          title={d.biens.emptyTitle}
          body={d.biens.emptyBody}
          action={
            <Link href="/app/biens" className="text-sm font-semibold text-brand-700 hover:underline">
              {d.common.resetFilters}
            </Link>
          }
        />
      ) : (
        <div className="stagger-rise grid grid-cols-1 gap-5 sm:grid-cols-2">
          {filtered.map(({ p, lettable, occupied, monthlyRent, vacant }) => (
            <Link key={p.id} href={`/app/biens/${p.id}`} className="group">
              <Card className="h-full p-5 transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-translate-y-0.5 group-hover:border-brand-100 group-hover:shadow-md">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate font-display text-lg font-bold text-ink group-hover:text-brand-700">
                      {p.name}
                    </h2>
                    <p className="truncate text-xs text-ink-soft">{p.address}</p>
                  </div>
                  <span
                    className={
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold " +
                      (p.energyClass.startsWith("A")
                        ? "bg-emerald-100 text-emerald-800"
                        : p.energyClass === "B" || p.energyClass === "C"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-red-100 text-red-700")
                    }
                    role="img"
                    aria-label={fmt(d.biens.energyAria, { cls: p.energyClass })}
                    title={fmt(d.biens.energyAria, { cls: p.energyClass })}
                  >
                    {p.energyClass}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{d.biens.lots}</p>
                    <p className="mt-0.5 font-display text-lg font-bold tabular-nums text-ink">{lettable.length}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{d.biens.occupied}</p>
                    <p className="mt-0.5 font-display text-lg font-bold tabular-nums text-ink">
                      {occupied.length}/{lettable.length}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                      {d.biens.rentPerMonth}
                    </p>
                    <p className="mt-0.5 font-display text-lg font-bold tabular-nums text-ink">
                      {euros(monthlyRent, locale)}
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-1.5">
                  {p.isCopropriete && <Badge className="bg-sand-100 text-ink-soft">{d.biens.copro}</Badge>}
                  {vacant > 0 && (
                    <Badge className="bg-amber-100 text-amber-800">{fmt(d.biens.vacant, { n: vacant })}</Badge>
                  )}
                  {!p.smokeDetectorsConfirmed && (
                    <Badge className="bg-red-100 text-red-700">{d.biens.smokeMissing}</Badge>
                  )}
                </div>
                <p className="mt-3 truncate text-[11px] text-ink-soft">{p.ownershipNote}</p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
