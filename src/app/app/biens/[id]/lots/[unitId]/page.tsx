import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/pro/ui";
import { Icon } from "@/components/pro/icons";
import PropertyPhoto from "@/components/gestion/PropertyPhoto";
import ModifyMenu from "@/components/gestion/ModifyMenu";
import { propertyMenu } from "@/lib/gestion/property-menu";
import { dossierOf } from "@/lib/gestion/dossier";
import { getDatasetId, getDemo } from "@/lib/demo";
import { buildPortfolio, findCard, isLettable, lotCard } from "@/lib/gestion/portfolio";
import { euros, eurosWhole, formatDate, rentStatusMeta } from "@/lib/types";
import { getI18n } from "@/lib/i18n";
import { fmt, plural } from "@/lib/i18n/config";
import {
  Documents,
  HeroStat,
  History,
  Interventions,
  OccupancyPill,
  Overview,
  Rental,
  TabBar,
  Technical,
  modifyLabels,
  type Tab,
} from "../../sheet";

/**
 * One lot of a building, as a sheet of its own: the same lenses as a home
 * (its tenancy, its rent, its inventory, its documents, its history), read
 * from the same rows, cut down to this lot. The building's page is one
 * click up; the tenancy on this lot follows the same lifecycle as anywhere
 * else, because it is the same lifecycle.
 */

const KIND_LABEL: Record<string, keyof import("@/lib/i18n").Dict["bien"]> = {
  dwelling: "lotKindApartment",
  commercial: "lotKindCommercial",
  office: "lotKindOffice",
  parking: "lotKindParking",
  cellar: "lotKindCellar",
  other: "lotKindOther",
};

export default async function LotPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; unitId: string }>;
  searchParams: Promise<{ onglet?: string }>;
}) {
  const [{ id, unitId }, { onglet }] = await Promise.all([params, searchParams]);
  const { locale, d } = await getI18n();
  const [demo, datasetId] = await Promise.all([getDemo(), getDatasetId()]);
  const real = datasetId === "real";
  const building = findCard(buildPortfolio(demo), id);
  if (!building) notFound();
  const card = lotCard(building, unitId, demo.TODAY);
  if (!card || !card.single) notFound();
  const line = card.single;
  const unit = line.unit;
  const p = card.property;
  const lettable = isLettable(unit);

  const visible: readonly Tab[] = lettable
    ? ["apercu", "location", "technique", "interventions", "documents", "historique"]
    : ["apercu", "technique", "interventions", "documents", "historique"];
  const tab: Tab = (visible as readonly string[]).includes(onglet ?? "") ? (onglet as Tab) : "apercu";
  const base = `/app/biens/${p.id}/lots/${unit.id}`;
  const menu = propertyMenu(card, demo, d, locale);
  const draft = line.vacant && line.drafts.length > 0 ? dossierOf(demo, line.drafts[line.drafts.length - 1]) : null;
  const kindLabel = d.bien[KIND_LABEL[unit.kind] ?? "lotKindOther"] as string;

  const headline = [
    unit.areaSqm > 0 ? fmt(d.biens.sqm, { n: unit.areaSqm }) : "",
    unit.rooms > 0 ? plural(locale, unit.rooms, d.biens.roomOne, d.biens.roomMany) : "",
    unit.bedrooms ? plural(locale, unit.bedrooms, d.biens.bedroomOne, d.biens.bedroomMany) : "",
    unit.floor && unit.floor !== "—" ? unit.floor : "",
  ].filter(Boolean);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold">
        <Link href="/app/biens" className="text-brand-700 hover:underline">
          {d.biens.title}
        </Link>
        <span className="text-ink-soft" aria-hidden>
          ›
        </span>
        <Link href={`/app/biens/${p.id}?onglet=lots`} className="text-brand-700 hover:underline">
          {p.name}
        </Link>
        <span className="text-ink-soft" aria-hidden>
          ›
        </span>
        <span className="text-ink">{unit.label}</span>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,22rem)_1fr]">
        <div className="aspect-[4/3] w-full overflow-hidden rounded-2xl">
          <PropertyPhoto
            url={unit.photoUrl ?? p.photoUrl}
            kind={unit.kind === "commercial" || unit.kind === "office" ? "commercial" : "apartment"}
            alt={fmt(d.biens.photoAlt, { property: `${unit.label} · ${p.name}` })}
            rounded="rounded-2xl"
          />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="bg-brand-100 text-brand-800">{d.bien.badgeLot}</Badge>
            <Badge>{kindLabel}</Badge>
            {lettable && <OccupancyPill card={card} d={d} />}
          </div>
          <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
            <h1 className="min-w-0 font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">{unit.label}</h1>
            <ModifyMenu groups={menu.groups} labels={modifyLabels(d)} />
          </div>
          <p className="mt-1.5 flex items-center gap-1.5 text-sm text-ink-soft">
            <Icon name="pin" size={15} className="shrink-0" />
            {p.name} · {p.address}
          </p>
          {headline.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {headline.map((h) => (
                <span key={h} className="rounded-lg bg-sand-100 px-2.5 py-1 text-xs font-semibold text-ink-soft">
                  {h}
                </span>
              ))}
            </div>
          )}

          {lettable && (
            <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
              <HeroStat
                icon="user"
                label={d.bien.tenant}
                value={line.vacant ? d.biens.noTenant : line.tenantNames.join(", ")}
                sub={
                  line.vacant
                    ? draft
                      ? fmt(d.biens.draftProgress, { done: draft.done, total: draft.total })
                      : undefined
                    : fmt(d.bien.tenantSince, { date: formatDate(line.lease!.startDate, locale) })
                }
              />
              <HeroStat
                icon="euro"
                label={d.bien.monthlyTotal}
                value={fmt(d.biens.perMonth, { amount: eurosWhole(line.monthlyCents, locale) })}
                sub={!line.vacant ? `${euros(line.lease!.rentCents, locale)} + ${euros(line.lease!.chargesCents, locale)}` : undefined}
              />
              <HeroStat icon="calendar" label={d.bien.thisMonth} value={line.status ? rentStatusMeta(d)[line.status].label : d.common.none} />
              <HeroStat icon="clock" label={d.bien.nextDue} value={card.nextDue ? formatDate(card.nextDue, locale) : d.common.none} />
            </div>
          )}
        </div>
      </div>

      <TabBar base={base} visible={visible} tab={tab} d={d} />

      {tab === "apercu" && <Overview card={card} demo={demo} d={d} locale={locale} real={real} />}
      {tab === "location" && lettable && <Rental card={card} demo={demo} d={d} locale={locale} real={real} />}
      {tab === "technique" && <Technical card={card} demo={demo} d={d} locale={locale} />}
      {tab === "interventions" && <Interventions card={card} demo={demo} d={d} locale={locale} />}
      {tab === "documents" && <Documents card={card} demo={demo} d={d} locale={locale} />}
      {tab === "historique" && <History card={card} demo={demo} d={d} locale={locale} />}
    </div>
  );
}
