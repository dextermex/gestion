import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Icon } from "@/components/pro/icons";
import PropertyPhoto from "@/components/gestion/PropertyPhoto";
import ModifyMenu from "@/components/gestion/ModifyMenu";
import { propertyMenu } from "@/lib/gestion/property-menu";
import { dossierOf } from "@/lib/gestion/dossier";
import { getDatasetId, getDemo } from "@/lib/demo";
import { buildPortfolio, findCard } from "@/lib/gestion/portfolio";
import { euros, eurosWhole, formatDate, rentStatusMeta } from "@/lib/types";
import { getI18n } from "@/lib/i18n";
import { fmt, plural } from "@/lib/i18n/config";
import BuildingSheet, { BUILDING_TABS } from "./building";
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
} from "./sheet";

/**
 * The property sheet: everything about one building or one home, in the
 * place an owner already has in mind.
 *
 * A home (one lettable lot) is read as one sheet: its tenancy, its rent,
 * its inventory are facts about it. A building is read as a whole, and its
 * lots open as sheets of their own (`./lots/[unitId]`): the hierarchy stays
 * Biens, then the building, then the lot, then the tenancy. Both are lenses
 * on the same rows the dedicated registers read; nothing is copied.
 */

// No generateStaticParams: the page reads the locale cookie, so it must be
// request-rendered — a build-time prerender would bake one language in.

const HOME_TABS: readonly Tab[] = ["apercu", "location", "technique", "interventions", "documents", "historique"];

/* ---------------------------------- page ---------------------------------- */

export default async function BienDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ onglet?: string; lot?: string }>;
}) {
  const [{ id }, { onglet, lot }] = await Promise.all([params, searchParams]);
  const { locale, d } = await getI18n();
  const [demo, datasetId] = await Promise.all([getDemo({ propertyId: id }), getDatasetId()]);
  const real = datasetId === "real";
  const card = findCard(buildPortfolio(demo), id);
  if (!card) notFound();

  const p = card.property;
  const single = card.single;

  // A building: its tenancies live on its lots. A link that asks the
  // building for "Location" is sent to the lot it names, or to the lots.
  if (!single) {
    if (onglet === "location") {
      const unit = lot ? demo.UNITS.find((u) => u.id === lot && u.propertyId === p.id) : undefined;
      redirect(unit ? `/app/biens/${p.id}/lots/${unit.id}?onglet=location` : `/app/biens/${p.id}?onglet=lots`);
    }
    const tab: Tab = (BUILDING_TABS as readonly string[]).includes(onglet ?? "") ? (onglet as Tab) : "apercu";
    const sampleNote = real ? null : fmt(d.shell.sampleBanner, { cabinet: demo.ORG.shortName });
    return <BuildingSheet card={card} demo={demo} d={d} locale={locale} real={real} tab={tab} sampleNote={sampleNote} />;
  }

  const menu = propertyMenu(card, demo, d, locale);
  // A single lot that is free but has a dossier in preparation says how far it got.
  const singleDraft = single.vacant && single.drafts.length > 0 ? dossierOf(demo, single.drafts[single.drafts.length - 1]) : null;
  const visible = HOME_TABS;
  const tab: Tab = (visible as readonly string[]).includes(onglet ?? "") ? (onglet as Tab) : "apercu";

  const headline = [
    single.unit.areaSqm > 0 ? fmt(d.biens.sqm, { n: single.unit.areaSqm }) : "",
    single.unit.rooms > 0 ? plural(locale, single.unit.rooms, d.biens.roomOne, d.biens.roomMany) : "",
    single.unit.bedrooms ? plural(locale, single.unit.bedrooms, d.biens.bedroomOne, d.biens.bedroomMany) : "",
    single.unit.floor && single.unit.floor !== "—" ? single.unit.floor : "",
  ].filter(Boolean);

  return (
    <div>
      <div className="mb-3">
        <Link href="/app/biens" className="text-sm font-semibold text-brand-700 hover:underline max-sm:inline-flex max-sm:min-h-10 max-sm:items-center">
          {d.biens.backToList}
        </Link>
      </div>

      {/* The hero: the photograph, the name, and the four facts that decide
          whether this property needs attention today. */}
      <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,22rem)_1fr]">
        <div className="aspect-[4/3] w-full overflow-hidden rounded-2xl">
          <PropertyPhoto
            url={p.photoUrl}
            kind={card.kind}
            alt={fmt(d.biens.photoAlt, { property: p.name })}
            rounded="rounded-2xl"
          />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">{p.name}</h1>
              <OccupancyPill card={card} d={d} />
            </div>
            {/* One button for every change this property can take. */}
            <ModifyMenu groups={menu.groups} labels={modifyLabels(d)} />
          </div>
          <p className="mt-1.5 flex items-center gap-1.5 text-sm text-ink-soft">
            <Icon name="pin" size={15} className="shrink-0" />
            {p.address}
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

          <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
            <HeroStat
              icon="user"
              label={d.bien.tenant}
              value={single.vacant ? d.biens.noTenant : single.tenantNames.join(", ")}
              sub={
                single.vacant
                  ? singleDraft
                    ? fmt(d.biens.draftProgress, { done: singleDraft.done, total: singleDraft.total })
                    : undefined
                  : fmt(d.bien.tenantSince, { date: formatDate(single.lease!.startDate, locale) })
              }
            />
            <HeroStat
              icon="euro"
              label={d.bien.monthlyTotal}
              value={fmt(d.biens.perMonth, { amount: eurosWhole(card.monthlyCents, locale) })}
              sub={!single.vacant ? `${euros(single.lease!.rentCents, locale)} + ${euros(single.lease!.chargesCents, locale)}` : undefined}
            />
            <HeroStat
              icon="calendar"
              label={d.bien.thisMonth}
              value={single.status ? rentStatusMeta(d)[single.status].label : d.common.none}
            />
            <HeroStat icon="clock" label={d.bien.nextDue} value={card.nextDue ? formatDate(card.nextDue, locale) : d.common.none} />
          </div>
        </div>
      </div>

      <TabBar base={`/app/biens/${p.id}`} visible={visible} tab={tab} d={d} />

      {tab === "apercu" && <Overview card={card} demo={demo} d={d} locale={locale} real={real} />}
      {tab === "location" && <Rental card={card} demo={demo} d={d} locale={locale} real={real} />}
      {tab === "technique" && <Technical card={card} demo={demo} d={d} locale={locale} />}
      {tab === "interventions" && <Interventions card={card} demo={demo} d={d} locale={locale} />}
      {tab === "documents" && <Documents card={card} demo={demo} d={d} locale={locale} />}
      {tab === "historique" && <History card={card} demo={demo} d={d} locale={locale} />}
    </div>
  );
}

