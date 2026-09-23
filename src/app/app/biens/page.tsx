import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader } from "@/components/pro/ui";
import { Icon } from "@/components/pro/icons";
import { ChipLink } from "@/components/gestion/filters";
import PropertyPhoto from "@/components/gestion/PropertyPhoto";
import { dossierOf } from "@/lib/gestion/dossier";
import { getDemo } from "@/lib/demo";
import type { DemoData } from "@/lib/demo";
import {
  buildPortfolio,
  occupancyOf,
  type PropertyCard,
  type PropertyKind,
  type UnitLine,
} from "@/lib/gestion/portfolio";
import { eurosWhole, formatDate, formatMonth, rentStatusMeta } from "@/lib/types";
import { getI18n } from "@/lib/i18n";
import { fmt, plural, type Locale } from "@/lib/i18n/config";
import type { Dict } from "@/lib/i18n";

/**
 * Biens — the portfolio, read in a few seconds.
 *
 * One card per property, photograph first, and underneath only what tells an
 * owner whether that property is fine this month: who lives there, what it
 * brings in, whether the rent arrived. Everything technical waits on the
 * property page. The figures come from the portfolio projection, so a sample
 * cabinet and a real account compute the same way.
 */

const KIND_PARAM: Record<string, PropertyKind> = {
  immeubles: "building",
  maisons: "house",
  appartements: "apartment",
  commerciaux: "commercial",
};

function kindLabel(d: Dict, kind: PropertyKind): string {
  return {
    building: d.biens.kindBuilding,
    house: d.biens.kindHouse,
    apartment: d.biens.kindApartment,
    commercial: d.biens.kindCommercial,
  }[kind];
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-lg bg-sand-100 px-2 py-0.5 text-[11px] font-semibold text-ink-soft">{children}</span>
  );
}

function OccupancyBadge({ card, d }: { card: PropertyCard; d: Dict }) {
  const state = occupancyOf(card);
  if (state === "occupied") return <Badge className="bg-emerald-100 text-emerald-800">{d.biens.occupiedOne}</Badge>;
  if (state === "vacant") return <Badge className="bg-sand-100 text-ink-soft">{d.biens.vacantLabel}</Badge>;
  return <Badge className="bg-amber-100 text-amber-800">{d.biens.partiallyOccupied}</Badge>;
}

/** The single tenancy: tenant, rent, and whether this month arrived. */
function SingleTenancy({ line, demo, d, locale }: { line: UnitLine; demo: DemoData; d: Dict; locale: Locale }) {
  const meta = rentStatusMeta(d);
  if (line.vacant) {
    // A dossier in preparation is said as such: the lot is free, and the
    // owner can see who it names and how far it got before opening the sheet.
    const draft = line.drafts[line.drafts.length - 1];
    const progress = draft ? dossierOf(demo, draft) : null;
    return (
      <div className="mt-3 border-t border-sand-100 pt-3">
        <p className="truncate text-sm text-ink-soft">{draft ? demo.leaseTenantNames(draft).join(", ") || d.common.none : d.common.none}</p>
        <p className="mt-0.5 text-sm tabular-nums text-ink-soft">
          {progress ? fmt(d.biens.draftProgress, { done: progress.done, total: progress.total }) : d.biens.noTenant}
        </p>
      </div>
    );
  }
  return (
    <div className="mt-3 space-y-1.5 border-t border-sand-100 pt-3">
      <p className="flex items-center gap-1.5 truncate text-sm text-ink">
        <Icon name="user" size={14} className="shrink-0 text-ink-soft" />
        {line.tenantNames.join(", ") || d.common.none}
      </p>
      <p className="flex items-center gap-1.5 text-sm tabular-nums text-ink">
        <Icon name="calendar" size={14} className="shrink-0 text-ink-soft" />
        {fmt(d.biens.perMonth, { amount: eurosWhole(line.monthlyCents, locale) })}
      </p>
      {line.status && (
        <p className="flex items-center gap-1.5 pt-0.5 text-sm">
          <span
            className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] font-semibold ${
              meta[line.status].color
            }`}
          >
            {line.status === "paid" && <Icon name="check" size={13} />}
            {line.status === "paid" && line.period
              ? fmt(d.biens.paidOn, { date: formatDate(line.period.dueDate, locale) })
              : meta[line.status].label}
          </span>
        </p>
      )}
    </div>
  );
}

/** A building: how the month is going across its lots, in one bar. */
function BuildingTenancy({ card, demo, d, locale }: { card: PropertyCard; demo: DemoData; d: Dict; locale: Locale }) {
  // A lot with a dossier in preparation is said as such, like a single home is.
  const drafts = card.lots.flatMap((line) => (line.vacant && line.drafts.length > 0 ? [{ line, progress: dossierOf(demo, line.drafts[line.drafts.length - 1]) }] : []));
  const segments: Array<{ key: string; n: number; label: string; bar: string; dot: string }> = [
    {
      key: "paid",
      n: card.mix.paid ?? 0,
      label: plural(locale, card.mix.paid ?? 0, d.biens.mixPaidOne, d.biens.mixPaidMany),
      bar: "bg-emerald-500",
      dot: "bg-emerald-500",
    },
    {
      key: "partial",
      n: (card.mix.partial ?? 0) + (card.mix.pending ?? 0) + (card.mix.upcoming ?? 0),
      label: plural(
        locale,
        (card.mix.partial ?? 0) + (card.mix.pending ?? 0) + (card.mix.upcoming ?? 0),
        d.biens.mixPartialOne,
        d.biens.mixPartialMany,
      ),
      bar: "bg-amber-400",
      dot: "bg-amber-400",
    },
    {
      key: "late",
      n: card.mix.late ?? 0,
      label: plural(locale, card.mix.late ?? 0, d.biens.mixLateOne, d.biens.mixLateMany),
      bar: "bg-red-500",
      dot: "bg-red-500",
    },
  ];
  const total = segments.reduce((a, s) => a + s.n, 0);

  return (
    <div className="mt-3 border-t border-sand-100 pt-3">
      <p className="text-sm tabular-nums text-ink-soft">
        {plural(locale, card.occupied, d.biens.occupiedOneN, d.biens.occupiedManyN)}
        {" \u00b7 "}
        {plural(locale, card.vacant, d.biens.vacantOneN, d.biens.vacantManyN)}
      </p>
      {drafts.map(({ line, progress }) => (
        <p key={line.unit.id} className="mt-1 truncate text-sm tabular-nums text-ink-soft">
          {line.unit.label}
          {" \u00b7 "}
          {fmt(d.biens.draftProgress, { done: progress.done, total: progress.total })}
        </p>
      ))}
      {total > 0 ? (
        <>
          <p className="mt-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
            {fmt(d.biens.rentsOf, { month: formatMonth(monthOf(card), locale) })}
          </p>
          <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-sand-200" aria-hidden>
            {segments
              .filter((s) => s.n > 0)
              .map((s) => (
                <span key={s.key} className={s.bar} style={{ width: `${(s.n / total) * 100}%` }} />
              ))}
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1">
            {segments
              .filter((s) => s.n > 0)
              .map((s) => (
                <li key={s.key} className="flex items-center gap-1.5 text-[12px] tabular-nums text-ink-soft">
                  <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden />
                  {s.label}
                </li>
              ))}
          </ul>
        </>
      ) : (
        <p className="mt-2 text-sm tabular-nums text-ink">
          {fmt(d.biens.perMonth, { amount: eurosWhole(card.monthlyCents, locale) })}
        </p>
      )}
    </div>
  );
}

/** The month the card is reporting on, taken from the periods it found. */
function monthOf(card: PropertyCard): string {
  const p = card.lots.find((l) => l.period)?.period;
  return p ? p.period : "";
}

export default async function BiensPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; occupation?: string }>;
}) {
  const params = await searchParams;
  const { locale, d } = await getI18n();
  const demo = await getDemo();
  const all = buildPortfolio(demo);

  const kindFilter = KIND_PARAM[params.type ?? ""];
  const vacantOnly = params.occupation === "vacants";
  const filtered = all
    .filter((c) => (kindFilter ? c.kind === kindFilter : true))
    .filter((c) => (vacantOnly ? c.vacant > 0 : true));

  const totals = {
    properties: all.length,
    occupied: all.reduce((a, c) => a + c.occupied, 0),
    vacant: all.reduce((a, c) => a + c.vacant, 0),
    rent: all.reduce((a, c) => a + c.monthlyCents, 0),
  };

  const countOf = (k: PropertyKind) => all.filter((c) => c.kind === k).length;
  const href = (type: string | undefined, vacant: boolean) => {
    const q = new URLSearchParams();
    if (type) q.set("type", type);
    if (vacant) q.set("occupation", "vacants");
    const s = q.toString();
    return `/app/biens${s ? `?${s}` : ""}`;
  };
  const chips: Array<{ slug?: string; label: string; value: number }> = [
    { label: d.biens.filterAll, value: all.length },
    { slug: "immeubles", label: d.biens.filterBuilding, value: countOf("building") },
    { slug: "maisons", label: d.biens.filterHouse, value: countOf("house") },
    { slug: "appartements", label: d.biens.filterApartment, value: countOf("apartment") },
    { slug: "commerciaux", label: d.biens.filterCommercial, value: countOf("commercial") },
  ];

  const addButton = (
    <Link
      href="/app/biens/nouveau"
      className="tactile flex min-h-9 items-center gap-1.5 rounded-xl bg-brand-600 px-3.5 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 max-sm:min-h-11"
    >
      <Icon name="plus" size={16} />
      {d.biens.addProperty}
    </Link>
  );

  if (all.length === 0) {
    return (
      <div>
        <PageHeader title={d.biens.title} subtitle={d.biens.subtitle} actions={addButton} />
        <EmptyState icon="properties" title={d.biens.emptyFirstTitle} body={d.biens.emptyFirstBody} action={addButton} />
      </div>
    );
  }

  const kpis: Array<{ label: string; value: string; icon: "properties" | "user" | "key" | "euro" }> = [
    { label: d.biens.kpiTotal, value: String(totals.properties), icon: "properties" },
    { label: d.biens.kpiOccupied, value: String(totals.occupied), icon: "user" },
    { label: d.biens.kpiVacant, value: String(totals.vacant), icon: "key" },
    { label: d.biens.kpiRent, value: eurosWhole(totals.rent, locale), icon: "euro" },
  ];

  return (
    <div>
      <PageHeader title={d.biens.title} subtitle={d.biens.subtitle} actions={addButton} />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label} className="flex items-center gap-3 p-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sand-100 text-ink-soft">
              <Icon name={k.icon} size={17} />
            </span>
            <div className="min-w-0">
              <p className="font-display text-xl font-bold tabular-nums leading-tight text-ink">{k.value}</p>
              <p className="truncate text-xs text-ink-soft">{k.label}</p>
            </div>
          </Card>
        ))}
      </div>

      <div className="scroll-x mb-5 flex gap-2">
        {chips.map((c) => (
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
        {(params.type || vacantOnly) && <ChipLink href="/app/biens">{d.common.resetFilters}</ChipLink>}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon="properties"
          title={d.biens.emptyTitle}
          body={d.biens.emptyBody}
          action={
            <Link href="/app/biens" className="text-sm font-semibold text-brand-700 hover:underline max-sm:inline-flex max-sm:min-h-10 max-sm:items-center">
              {d.common.resetFilters}
            </Link>
          }
        />
      ) : (
        <div className="stagger-rise grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((card) => {
            const p = card.property;
            const single = card.single;
            return (
              <Link key={p.id} href={`/app/biens/${p.id}`} className="group">
                <Card className="flex h-full flex-col overflow-hidden p-0 transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-translate-y-0.5 group-hover:border-brand-100 group-hover:shadow-md">
                  <div className="aspect-[16/10] w-full overflow-hidden">
                    <PropertyPhoto
                      url={p.photoUrl}
                      kind={card.kind}
                      alt={fmt(d.biens.photoAlt, { property: p.name })}
                      rounded=""
                    />
                  </div>
                  <div className="flex flex-1 flex-col p-4">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="min-w-0 truncate font-display text-base font-bold text-ink group-hover:text-brand-700">
                        {p.name}
                      </h2>
                      <OccupancyBadge card={card} d={d} />
                    </div>
                    <p className="mt-1 flex items-center gap-1 truncate text-xs text-ink-soft">
                      <Icon name="pin" size={13} className="shrink-0" />
                      <span className="truncate">{p.address}</span>
                    </p>
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      <Chip>{kindLabel(d, card.kind)}</Chip>
                      {single ? (
                        <>
                          {single.unit.areaSqm > 0 && <Chip>{fmt(d.biens.sqm, { n: single.unit.areaSqm })}</Chip>}
                          {single.unit.bedrooms ? (
                            <Chip>{plural(locale, single.unit.bedrooms, d.biens.bedroomOne, d.biens.bedroomMany)}</Chip>
                          ) : null}
                        </>
                      ) : (
                        <Chip>{plural(locale, card.lots.length, d.biens.lotOne, d.biens.lotMany)}</Chip>
                      )}
                    </div>

                    <div className="mt-auto">
                      {single ? (
                        <SingleTenancy line={single} demo={demo} d={d} locale={locale} />
                      ) : (
                        <BuildingTenancy card={card} demo={demo} d={d} locale={locale} />
                      )}
                    </div>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
