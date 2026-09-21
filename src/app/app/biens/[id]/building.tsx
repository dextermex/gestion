import Link from "next/link";
import { Badge, Card } from "@/components/pro/ui";
import { Icon } from "@/components/pro/icons";
import ModifyMenu from "@/components/gestion/ModifyMenu";
import PropertyPhoto from "@/components/gestion/PropertyPhoto";
import PhotoViewer from "@/components/gestion/PhotoViewer";
import LotGrid, { type LotCardView } from "@/components/gestion/LotGrid";
import LotCreate from "@/components/gestion/LotCreate";
import { propertyMenu } from "@/lib/gestion/property-menu";
import { dossierOf } from "@/lib/gestion/dossier";
import { buildingStats, lotFamilyCounts, lotFamilyOf, sortedUnits, unitComposition } from "@/lib/gestion/building";
import { isLettable, type PropertyCard } from "@/lib/gestion/portfolio";
import type { DemoData } from "@/lib/demo";
import type { Dict } from "@/lib/i18n";
import { INTL_LOCALE, fmt, plural, type Locale } from "@/lib/i18n/config";
import { eurosWhole, rentStatusMeta } from "@/lib/types";
import { Documents, History, Interventions, Overview, TabBar, Technical, modifyLabels, type Tab } from "./sheet";

/**
 * A building's page: the photograph, the name, four figures that say how
 * the building is doing, and its lots as cards. Every figure is derived
 * from the lots and their tenancies through the portfolio projection, the
 * same one the Biens cards use, so the building can never disagree with
 * its own lots. A lot opens as a sheet of its own; the tenancy lives there.
 */
export const BUILDING_TABS: readonly Tab[] = ["apercu", "lots", "technique", "interventions", "documents", "historique"];

const KIND_LABEL: Record<string, (d: Dict) => string> = {
  dwelling: (d) => d.bien.lotKindApartment,
  commercial: (d) => d.bien.lotKindCommercial,
  office: (d) => d.bien.lotKindOffice,
  parking: (d) => d.bien.lotKindParking,
  cellar: (d) => d.bien.lotKindCellar,
  other: (d) => d.bien.lotKindOther,
};

const COMPOSITION: Record<string, (d: Dict) => [string, string]> = {
  dwelling: (d) => [d.bien.unitsDwellingOne, d.bien.unitsDwellingMany],
  commercial: (d) => [d.bien.unitsCommercialOne, d.bien.unitsCommercialMany],
  office: (d) => [d.bien.unitsOfficeOne, d.bien.unitsOfficeMany],
  parking: (d) => [d.bien.unitsParkingOne, d.bien.unitsParkingMany],
  cellar: (d) => [d.bien.unitsCellarOne, d.bien.unitsCellarMany],
  other: (d) => [d.bien.unitsOtherOne, d.bien.unitsOtherMany],
};

/** The lots as the grid shows them, computed here so the client only renders. */
export function lotViews(card: PropertyCard, demo: DemoData, d: Dict, locale: Locale): LotCardView[] {
  const meta = rentStatusMeta(d);
  const lines = new Map(card.lots.map((l) => [l.unit.id, l]));
  return sortedUnits(card).map((unit) => {
    const line = lines.get(unit.id) ?? null;
    const draft = line && line.vacant ? line.drafts[line.drafts.length - 1] : undefined;
    const progress = draft ? dossierOf(demo, draft) : null;
    return {
      id: unit.id,
      href: `/app/biens/${card.property.id}/lots/${unit.id}`,
      label: unit.label,
      family: lotFamilyOf(unit),
      kindLabel: (KIND_LABEL[unit.kind] ?? KIND_LABEL.other)(d),
      kind: unit.kind === "commercial" || unit.kind === "office" ? "commercial" : "apartment",
      photoUrl: unit.photoUrl ?? card.property.photoUrl ?? null,
      floor: unit.floor && unit.floor !== "—" ? unit.floor : "",
      areaLabel: unit.areaSqm > 0 ? fmt(d.biens.sqm, { n: unit.areaSqm }) : "",
      bedroomsLabel: unit.bedrooms ? plural(locale, unit.bedrooms, d.biens.bedroomOne, d.biens.bedroomMany) : "",
      tenant: line ? line.tenantNames.join(", ") : "",
      draftLabel: progress ? fmt(d.biens.draftProgress, { done: progress.done, total: progress.total }) : "",
      rentLabel: line && line.lease ? fmt(d.biens.perMonth, { amount: eurosWhole(line.monthlyCents, locale) }) : "",
      status: line?.status ? { label: meta[line.status].label, color: meta[line.status].color } : null,
      lettable: isLettable(unit),
    };
  });
}

function KpiTile({ icon, value, label, tone = "brand" }: { icon: React.ReactNode; value: string; label: string; tone?: "brand" | "bad" }) {
  return (
    <Card className="flex items-center gap-3 p-3.5">
      <span className={"flex h-9 w-9 shrink-0 items-center justify-center rounded-xl " + (tone === "bad" ? "bg-red-100 text-red-700" : "bg-brand-50 text-brand-700")}>{icon}</span>
      <div className="min-w-0">
        <p className="truncate font-display text-lg font-bold tabular-nums leading-tight text-ink">{value}</p>
        <p className="text-xs leading-snug text-ink-soft">{label}</p>
      </div>
    </Card>
  );
}

export default function BuildingSheet({
  card,
  demo,
  d,
  locale,
  real,
  tab,
  sampleNote,
}: {
  card: PropertyCard;
  demo: DemoData;
  d: Dict;
  locale: Locale;
  real: boolean;
  tab: Tab;
  sampleNote: string | null;
}) {
  const p = card.property;
  const stats = buildingStats(card);
  const menu = propertyMenu(card, demo, d, locale);
  const parts = unitComposition(card).map(({ kind, n }) => {
    const [one, many] = (COMPOSITION[kind] ?? COMPOSITION.other)(d);
    return plural(locale, n, one, many);
  });
  const summary = parts.length > 0 ? fmt(d.bien.buildingSummary, { lots: plural(locale, stats.lots, d.biens.lotOne, d.biens.lotMany), parts: parts.join(", ") }) : "";
  const rate = stats.occupancyRate === null ? d.common.none : new Intl.NumberFormat(INTL_LOCALE[locale], { style: "percent", maximumFractionDigits: 0 }).format(stats.occupancyRate);

  return (
    <div>
      <div className="mb-3">
        <Link href="/app/biens" className="text-sm font-semibold text-brand-700 hover:underline">
          {d.biens.backToList}
        </Link>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,22rem)_1fr]">
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl">
          <PropertyPhoto url={p.photoUrl} kind="building" alt={fmt(d.biens.photoAlt, { property: p.name })} rounded="rounded-2xl" />
          {p.photoUrl && <PhotoViewer url={p.photoUrl} title={p.name} label={d.bien.viewPhotos} closeLabel={d.common.close} />}
        </div>
        <div className="min-w-0">
          <Badge className="bg-brand-100 text-brand-800">
            <Icon name="properties" size={12} />
            {d.bien.badgeBuilding}
          </Badge>
          <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
            <h1 className="min-w-0 font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">{p.name}</h1>
            <ModifyMenu groups={menu.groups} labels={modifyLabels(d)} />
          </div>
          <p className="mt-1.5 flex items-center gap-1.5 text-sm text-ink-soft">
            <Icon name="pin" size={15} className="shrink-0" />
            {p.address}
          </p>
          {summary && <p className="mt-2 text-sm leading-relaxed text-ink-soft">{summary}</p>}

          <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
            <KpiTile
              icon={<Icon name="properties" size={18} />}
              value={plural(locale, stats.lots, d.biens.lotOne, d.biens.lotMany)}
              label={`${plural(locale, stats.occupied, d.biens.occupiedOneN, d.biens.occupiedManyN)} · ${plural(locale, stats.vacant, d.biens.vacantOneN, d.biens.vacantManyN)}`}
            />
            <KpiTile icon={<Icon name="team" size={18} />} value={rate} label={d.bien.kpiOccupancyRate} />
            <KpiTile icon={<Icon name="euro" size={18} />} value={eurosWhole(stats.monthlyCents, locale)} label={d.bien.kpiMonthlyRent} />
            <KpiTile
              icon={<Icon name="alert" size={18} />}
              value={String(stats.late)}
              label={plural(locale, stats.late, d.bien.kpiLateOne, d.bien.kpiLateMany)}
              tone={stats.late > 0 ? "bad" : "brand"}
            />
          </div>
        </div>
      </div>

      <TabBar base={`/app/biens/${p.id}`} visible={BUILDING_TABS} tab={tab} d={d} />

      {tab === "apercu" && <Overview card={card} demo={demo} d={d} locale={locale} real={real} />}
      {tab === "lots" && (
        <LotGrid
          lots={lotViews(card, demo, d, locale)}
          counts={lotFamilyCounts(card)}
          labels={{
            title: fmt(d.bien.lotsTitle, { n: stats.lots }),
            filters: {
              all: d.bien.lotFilterAll,
              apartments: d.bien.lotFilterApartments,
              commercial: d.bien.lotFilterCommercial,
              parking: d.bien.lotFilterParking,
              other: d.bien.lotFilterOther,
            },
            viewAria: d.bien.viewAria,
            viewGrid: d.bien.viewGrid,
            viewList: d.bien.viewList,
            search: d.bien.searchLots,
            noMatch: d.bien.noLotMatch,
            vacant: d.biens.vacantLabel,
            colLot: d.bien.colLot,
            colTenant: d.bien.colTenant,
            colRent: d.bien.colRent,
            colStatus: d.bien.colStatus,
            open: d.bien.openLot,
          }}
          action={
            <LotCreate
              propertyId={p.id}
              sampleNote={sampleNote}
              labels={{
                open: d.bien.addLot,
                title: d.bien.addLotTitle,
                label: d.biens.wizUnitLabel,
                kind: d.biens.wizUnitKind,
                kinds: {
                  dwelling: d.bien.lotKindApartment,
                  commercial: d.bien.lotKindCommercial,
                  office: d.bien.lotKindOffice,
                  parking: d.bien.lotKindParking,
                  cellar: d.bien.lotKindCellar,
                  other: d.bien.lotKindOther,
                },
                floor: d.biens.wizFloor,
                area: d.biens.wizSurface,
                rooms: d.biens.wizRooms,
                bedrooms: d.biens.wizBedrooms,
                furnished: d.modify.furnished,
                save: d.common.save,
                cancel: d.common.cancel,
                failed: d.bien.addLotFailed,
              }}
            />
          }
        />
      )}
      {tab === "technique" && <Technical card={card} demo={demo} d={d} locale={locale} />}
      {tab === "interventions" && <Interventions card={card} demo={demo} d={d} locale={locale} />}
      {tab === "documents" && <Documents card={card} demo={demo} d={d} locale={locale} />}
      {tab === "historique" && <History card={card} demo={demo} d={d} locale={locale} />}
    </div>
  );
}
