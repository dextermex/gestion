import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, EmptyState } from "@/components/pro/ui";
import { Icon } from "@/components/pro/icons";
import { CollapsiblePanel, LegalNote, MetaBadge, Panel } from "@/components/gestion/bits";
import PropertyPhoto from "@/components/gestion/PropertyPhoto";
import ModifyMenu from "@/components/gestion/ModifyMenu";
import InvitePanel from "@/components/gestion/InvitePanel";
import { inviteLabels, partyInvitations } from "@/lib/portal/owner";
import DraftDossierActions from "@/components/gestion/DraftDossier";
import { propertyMenu } from "@/lib/gestion/property-menu";
import { dossierOf } from "@/lib/gestion/dossier";
import { getDatasetId, getDemo } from "@/lib/demo";
import type { DemoData } from "@/lib/demo";
import { buildPortfolio, findCard, occupancyOf, type PropertyCard, type UnitLine } from "@/lib/gestion/portfolio";
import type { Dict } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n/config";
import {
  METER_UNITS,
  depositStatusMeta,
  edlStatusMeta,
  euros,
  eurosWhole,
  formatDate,
  formatMonth,
  formatNumber,
  rentStatusMeta,
  ticketSeverityMeta,
  ticketStatusMeta,
  inviteStateMeta,
} from "@/lib/types";
import { getI18n } from "@/lib/i18n";
import { fmt, ordinalDay, plural } from "@/lib/i18n/config";
import {
  cpeExpiryDeadline,
  deadlineStatus,
  syndicMandateDeadline,
  vacancyClock,
} from "@/domain/compliance/deadlines";
import { computeCapitalInvesti, proposeResidentialAdjustment } from "@/domain/indexation/engine";

/**
 * The property sheet: everything about one building or one home, in the
 * place an owner already has in mind.
 *
 * The lease, the deposit, the meters, the inventory, the insurance and the
 * indexation proposal are not modules to go and find — they are facts about
 * this property, so they are read here, from the same canonical rows the
 * dedicated registers read. Nothing is copied; a tab is a lens.
 */

const TABS = ["apercu", "lots", "location", "technique", "interventions", "documents", "historique"] as const;
type Tab = (typeof TABS)[number];

// No generateStaticParams: the page reads the locale cookie, so it must be
// request-rendered — a build-time prerender would bake one language in.

function tabLabel(d: Dict, t: Tab): string {
  return {
    apercu: d.bien.tabOverview,
    lots: d.bien.tabLots,
    location: d.bien.tabRental,
    technique: d.bien.tabTechnical,
    interventions: d.bien.tabInterventions,
    documents: d.bien.tabDocuments,
    historique: d.bien.tabHistory,
  }[t];
}

/* ------------------------------ small pieces ------------------------------ */

function Rows({ items }: { items: Array<{ k: string; v: React.ReactNode }> }) {
  return (
    <dl className="divide-y divide-sand-100">
      {items.map((r) => (
        <div key={r.k} className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
          <dt className="text-sm text-ink-soft">{r.k}</dt>
          <dd className="text-right text-sm font-semibold text-ink">{r.v}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The one thing a free lot offers, by what it holds: a dossier in
 * preparation is resumed (never doubled), a lot that had a tenant before
 * takes a new one, a lot that never had one takes its first. A lot that is
 * let offers nothing here: its tenancy has its own actions.
 */
function LotAction({ line, demo, d, className = "" }: { line: UnitLine; demo: DemoData; d: Dict; className?: string }) {
  if (!line.vacant) return null;
  const draft = line.drafts[line.drafts.length - 1];
  const hadTenant = demo.LEASES.some((l) => l.unitId === line.unit.id && l.status === "ended");
  const href = draft
    ? `/app/biens/locataire?bail=${encodeURIComponent(draft.id)}`
    : `/app/biens/locataire?lot=${encodeURIComponent(line.unit.id)}`;
  const label = draft ? d.bien.resumeDossier : hadTenant ? d.bien.addNewTenant : d.bien.addTenant;
  return (
    <Link
      href={href}
      className={`tactile inline-flex min-h-9 items-center gap-1.5 rounded-xl bg-brand-600 px-3.5 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 ${className}`}
    >
      {!draft && <Icon name="plus" size={15} />}
      {label}
    </Link>
  );
}

/**
 * Dossiers in preparation on this property. They are said as such rather
 * than hidden: the lot is free, nothing is owed, and the owner can see how
 * far each one got ("3/9 étapes"), resume it at its first incomplete step,
 * activate it once it names someone and a rent, or discard it. Nothing is
 * shown when there is none.
 */
function DraftDossiers({
  card,
  demo,
  d,
  locale,
  real,
}: {
  card: PropertyCard;
  demo: DemoData;
  d: Dict;
  locale: Locale;
  real: boolean;
}) {
  // A dossier beside a running tenancy predates the one-dossier rule: it is
  // said to be obsolete, and can only be abandoned.
  const drafts = card.lots.flatMap((line) => line.drafts.map((lease) => ({ lease, unit: line.unit, obsolete: !line.vacant })));
  if (drafts.length === 0) return null;
  return (
    <Panel title={d.bien.draftDossierTitle}>
      <p className="text-sm leading-relaxed text-ink-soft">{d.bien.draftDossierBody}</p>
      <ul className="mt-3 divide-y divide-sand-100">
        {drafts.map(({ lease, unit, obsolete }) => {
          const progress = dossierOf(demo, lease);
          return (
            <li key={lease.id} className="py-3.5 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-display text-sm font-bold text-ink">
                    {demo.leaseTenantNames(lease).join(", ") || d.common.none}
                  </p>
                  <p className="mt-0.5 text-xs tabular-nums text-ink-soft">
                    {unit.label}
                    {" \u00b7 "}
                    {fmt(d.biens.perMonth, { amount: eurosWhole(lease.rentCents + lease.chargesCents, locale) })}
                    {" \u00b7 "}
                    {d.location.startDate} {formatDate(lease.startDate, locale)}
                  </p>
                  <p className="mt-1.5 font-display text-sm font-bold tabular-nums text-amber-800">
                    {fmt(d.bien.draftProgress, { done: progress.done, total: progress.total })}
                  </p>
                </div>
                <Badge className="bg-amber-100 text-amber-800">{d.status.lease.draft}</Badge>
              </div>
              <DraftDossierActions
                leaseId={lease.id}
                propertyId={card.property.id}
                real={real}
                ready={progress.ready}
                obsolete={obsolete}
                labels={{
                  resume: d.bien.draftResume,
                  activate: d.bien.draftActivate,
                  activateIncomplete: d.bien.draftActivateIncomplete,
                  obsolete: d.bien.draftObsolete,
                  discard: d.bien.draftDiscard,
                  discardConfirm: d.bien.draftDiscardConfirm,
                  confirm: d.bien.draftConfirm,
                  cancel: d.common.cancel,
                  activateFailed: d.bien.draftActivateFailed,
                  discardBlocked: d.bien.draftDiscardBlocked,
                  failed: d.modify.failed,
                }}
              />
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/** The month's rent on one tenancy, phrased the way an owner reads it. */
function RentStatusLine({ line, d, locale }: { line: UnitLine; d: Dict; locale: Locale }) {
  const meta = rentStatusMeta(d);
  if (!line.period || !line.status) return <p className="text-sm text-ink-soft">{d.bien.noLedgerYet}</p>;
  const paid = line.status === "paid";
  return (
    <div
      className={`flex items-start gap-2.5 rounded-xl p-3.5 ${paid ? "bg-emerald-50" : "bg-sand-50"}`}
    >
      <span className={`mt-0.5 shrink-0 ${paid ? "text-emerald-600" : "text-ink-soft"}`}>
        <Icon name={paid ? "check" : "clock"} size={18} />
      </span>
      <div className="min-w-0">
        <p className="font-display text-sm font-bold text-ink">
          {fmt(d.bien.rentOfMonth, { month: formatMonth(line.period.period, locale), status: meta[line.status].label })}
        </p>
        <p className="mt-0.5 text-xs text-ink-soft">
          {paid
            ? fmt(d.biens.paidOn, { date: formatDate(line.period.dueDate, locale) })
            : fmt(d.bien.openAmount, {
                amount: euros(line.period.totalCents - line.period.allocatedCents, locale),
              })}
        </p>
      </div>
    </div>
  );
}

/* --------------------------------- tabs ---------------------------------- */

function Overview({
  card,
  demo,
  d,
  locale,
  real,
}: {
  card: PropertyCard;
  demo: DemoData;
  d: Dict;
  locale: Locale;
  real: boolean;
}) {
  const p = card.property;
  const single = card.single;
  const unit = single?.unit;
  // Everyone on the lease, not the first name standing for all.
  const tenants = single?.lease
    ? single.lease.tenantContactIds.map((id) => demo.contactById(id)).filter((c) => c !== undefined)
    : [];
  const docs = documentsFor(demo, card).slice(0, 3);
  const tickets = ticketsFor(demo, card).slice(0, 3);
  const tMeta = ticketStatusMeta(d);

  const info: Array<{ k: string; v: React.ReactNode }> = [
    { k: d.biens.type, v: p.type || d.common.none },
    ...(unit && unit.areaSqm > 0 ? [{ k: d.bien.surface, v: fmt(d.biens.sqm, { n: unit.areaSqm }) }] : []),
    ...(unit && unit.rooms > 0 ? [{ k: d.bien.rooms, v: formatNumber(unit.rooms, locale) }] : []),
    ...(unit?.bedrooms ? [{ k: d.bien.bedrooms, v: formatNumber(unit.bedrooms, locale) }] : []),
    ...(unit?.floor && unit.floor !== "—" ? [{ k: d.bien.floor, v: unit.floor }] : []),
    ...(p.constructionYear ? [{ k: d.biens.construction, v: String(p.constructionYear) }] : []),
    ...(p.cadastralRef ? [{ k: d.bien.cadastral, v: p.cadastralRef }] : []),
    { k: d.bien.address, v: p.address },
  ];

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Panel title={d.bien.mainInfo}>
        <Rows items={info} />
      </Panel>

      {single && !single.vacant ? (
        <Panel
          title={d.bien.rentStatus}
          action={
            <Link href="/app/loyers" className="text-sm font-semibold text-brand-700 hover:underline">
              {d.bien.seePayments}
            </Link>
          }
        >
          <RentStatusLine line={single} d={d} locale={locale} />
          <div className="mt-3">
            <Rows
              items={[
                { k: d.bien.rentExclCharges, v: euros(single.lease!.rentCents, locale) },
                { k: d.bien.charges, v: euros(single.lease!.chargesCents, locale) },
                {
                  k: d.bien.monthlyTotal,
                  v: <span className="font-display text-base font-bold">{euros(single.monthlyCents, locale)}</span>,
                },
                { k: d.bien.dueDay, v: fmt(d.bien.dueDayValue, { n: ordinalDay(locale, single.lease!.paymentDay) }) },
              ]}
            />
          </div>
        </Panel>
      ) : single ? (
        <Panel title={d.bien.rentStatus}>
          <div className="py-2 text-center">
            <p className="font-display text-base font-bold text-ink">{d.bien.vacantTitle}</p>
            <p className="mx-auto mt-1 max-w-xs text-sm text-ink-soft">{d.bien.vacantBody}</p>
            <LotAction line={single} demo={demo} d={d} className="mt-3.5" />
          </div>
        </Panel>
      ) : (
        // A building has no single tenancy to report: what its owner wants to
        // know is how the month is going across its lots.
        <Panel
          title={d.bien.rentStatus}
          action={
            <Link href={`/app/biens/${p.id}?onglet=lots`} className="text-sm font-semibold text-brand-700 hover:underline">
              {d.bien.tabLots}
            </Link>
          }
        >
          <Rows
            items={[
              {
                k: d.bien.occupancy,
                v: `${plural(locale, card.occupied, d.biens.occupiedOneN, d.biens.occupiedManyN)} \u00b7 ${plural(
                  locale,
                  card.vacant,
                  d.biens.vacantOneN,
                  d.biens.vacantManyN,
                )}`,
              },
              {
                k: d.bien.monthlyTotal,
                v: (
                  <span className="font-display text-base font-bold">{euros(card.monthlyCents, locale)}</span>
                ),
              },
              ...(card.mix.paid
                ? [{ k: d.status.rent.paid, v: plural(locale, card.mix.paid, d.biens.mixPaidOne, d.biens.mixPaidMany) }]
                : []),
              ...(card.mix.late
                ? [{ k: d.status.rent.late, v: plural(locale, card.mix.late, d.biens.mixLateOne, d.biens.mixLateMany) }]
                : []),
              ...(card.nextDue ? [{ k: d.bien.nextDue, v: formatDate(card.nextDue, locale) }] : []),
            ]}
          />
        </Panel>
      )}

      <DraftDossiers card={card} demo={demo} d={d} locale={locale} real={real} />

      {tenants.length > 0 && (
        <Panel
          title={tenants.length > 1 ? d.bien.currentTenants : d.bien.currentTenant}
          action={
            tenants.length === 1 ? (
              <Link
                href={`/app/contacts/${tenants[0].id}`}
                className="text-sm font-semibold text-brand-700 hover:underline"
              >
                {d.bien.seeProfile}
              </Link>
            ) : undefined
          }
        >
          <ul className="space-y-3">
            {tenants.map((tenant) => (
              <li key={tenant.id}>
                <Link href={`/app/contacts/${tenant.id}`} className="font-display text-base font-bold text-ink hover:underline">
                  {tenant.name}
                </Link>
                <ul className="mt-1.5 space-y-1 text-sm text-ink-soft">
                  {tenant.email && (
                    <li className="flex items-center gap-2">
                      <Icon name="mail" size={14} /> {tenant.email}
                    </li>
                  )}
                  {tenant.phone && (
                    <li className="flex items-center gap-2">
                      <Icon name="phone" size={14} /> {tenant.phone}
                    </li>
                  )}
                </ul>
              </li>
            ))}
          </ul>
          <ul className="mt-3 space-y-1.5 border-t border-sand-100 pt-3 text-sm text-ink-soft">
            <li className="flex items-center gap-2">
              <Icon name="calendar" size={14} />
              {fmt(d.bien.tenantSince, { date: formatDate(single!.lease!.startDate, locale) })}
            </li>
            {single!.lease!.endDate && (
              <li className="flex items-center gap-2">
                <Icon name="contract" size={14} />
                {fmt(d.bien.leaseEnds, { date: formatDate(single!.lease!.endDate, locale) })}
              </li>
            )}
          </ul>
        </Panel>
      )}

      <Panel
        title={d.bien.recentDocuments}
        action={
          <Link href="/app/documents" className="text-sm font-semibold text-brand-700 hover:underline">
            {d.bien.seeAll}
          </Link>
        }
      >
        {docs.length === 0 ? (
          <p className="text-sm text-ink-soft">{d.bien.noDocuments}</p>
        ) : (
          <ul className="divide-y divide-sand-100">
            {docs.map((doc) => (
              <li key={doc.id} className="flex items-center gap-2.5 py-2.5 first:pt-0 last:pb-0">
                <Icon name="documents" size={16} className="shrink-0 text-ink-soft" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">{doc.name}</span>
                  <span className="block text-xs text-ink-soft">{formatDate(doc.createdAt, locale)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={d.bien.recentInterventions}>
        {tickets.length === 0 ? (
          <p className="text-sm text-ink-soft">{d.bien.noInterventions}</p>
        ) : (
          <ul className="divide-y divide-sand-100">
            {tickets.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">{t.title}</span>
                  <span className="block text-xs text-ink-soft">{formatDate(t.createdAt, locale)}</span>
                </span>
                <MetaBadge meta={tMeta[t.status]} />
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function Lots({ card, demo, d, locale }: { card: PropertyCard; demo: DemoData; d: Dict; locale: Locale }) {
  const meta = rentStatusMeta(d);
  return (
    <div className="space-y-5">
      <Panel title={d.bien.tabLots}>
        <ul className="divide-y divide-sand-100">
          {card.lots.map((line) => (
            <li key={line.unit.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-sm font-bold text-ink">{line.unit.label}</p>
                <p className="truncate text-xs text-ink-soft">
                  {[
                    line.unit.floor && line.unit.floor !== "—" ? line.unit.floor : "",
                    line.unit.areaSqm > 0 ? fmt(d.biens.sqm, { n: line.unit.areaSqm }) : "",
                    line.unit.bedrooms ? plural(locale, line.unit.bedrooms, d.biens.bedroomOne, d.biens.bedroomMany) : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              {line.vacant ? (
                <>
                  <Badge className="bg-sand-100 text-ink-soft">{d.biens.vacantLabel}</Badge>
                  <LotAction line={line} demo={demo} d={d} />
                </>
              ) : (
                <>
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink">{line.tenantNames.join(", ")}</p>
                    <p className="text-xs tabular-nums text-ink-soft">
                      {fmt(d.biens.perMonth, { amount: eurosWhole(line.monthlyCents, locale) })}
                    </p>
                  </div>
                  {line.status && <MetaBadge meta={meta[line.status]} />}
                  <Link
                    href={`/app/baux/${line.lease!.id}`}
                    className="text-sm font-semibold text-brand-700 hover:underline"
                  >
                    {d.bien.openRental}
                  </Link>
                </>
              )}
            </li>
          ))}
        </ul>
      </Panel>

      {card.annexes.length > 0 && (
        <Panel title={d.bien.annexes}>
          <ul className="flex flex-wrap gap-2">
            {card.annexes.map((u) => (
              <li key={u.id} className="rounded-lg bg-sand-100 px-2.5 py-1 text-sm text-ink-soft">
                {u.label}
                {u.areaSqm > 0 ? ` · ${fmt(d.biens.sqm, { n: u.areaSqm })}` : ""}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function Rental({
  card,
  demo,
  d,
  locale,
  real,
}: {
  card: PropertyCard;
  demo: DemoData;
  d: Dict;
  locale: Locale;
  real: boolean;
}) {
  const live = card.lots.filter((l) => !l.vacant);
  if (live.length === 0) {
    const first = card.lots[0];
    return (
      <div className="space-y-5">
        <EmptyState
          icon="key"
          title={d.bien.vacantTitle}
          body={d.bien.vacantBody}
          action={first ? <LotAction line={first} demo={demo} d={d} /> : undefined}
        />
        <DraftDossiers card={card} demo={demo} d={d} locale={locale} real={real} />
      </div>
    );
  }
  const depMeta = depositStatusMeta(d);
  const edlMeta = edlStatusMeta(d);

  return (
    <div className="space-y-5">
      {live.map((line) => {
        const lease = line.lease!;
        const deposit = demo.DEPOSITS.find((x) => x.leaseId === lease.id) ?? null;
        const edls = demo.EDLS.filter((e) => e.leaseId === lease.id);
        const policies = demo.INSURANCES.filter((i) => i.leaseId === lease.id);
        const payers = demo.IBAN_BINDINGS.filter((b) => b.leaseId === lease.id);
        const periods = demo.RENT_PERIODS.filter((rp) => rp.leaseId === lease.id)
          .slice()
          .sort((a, b) => (a.period < b.period ? 1 : -1))
          .slice(0, 6);
        const meta = rentStatusMeta(d);

        // The indexation engine already knows everything it needs; the owner
        // should not have to go and ask a separate screen.
        const capital = computeCapitalInvesti(lease.capitalComponents, demo.TODAY);
        const proposal =
          lease.type === "residential" && lease.capitalComponents.length > 0
            ? proposeResidentialAdjustment({
                currentMonthlyRent: lease.rentCents,
                lastAdjustmentDate: lease.lastAdjustmentOn,
                leaseStartDate: lease.startDate,
                proposedDate: demo.TODAY,
                capital,
              })
            : null;

        return (
          <section key={lease.id} className="space-y-5">
            <Panel
              title={fmt(d.bien.rentalOf, { unit: line.unit.label })}
              action={
                <Link href={`/app/baux/${lease.id}`} className="text-sm font-semibold text-brand-700 hover:underline">
                  {d.bien.openRental}
                </Link>
              }
            >
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <div>
                  <RentStatusLine line={line} d={d} locale={locale} />
                  <div className="mt-3">
                    <Rows
                      items={[
                        { k: d.bien.tenant, v: line.tenantNames.join(", ") },
                        { k: d.bien.rentExclCharges, v: euros(lease.rentCents, locale) },
                        { k: d.bien.charges, v: euros(lease.chargesCents, locale) },
                        {
                          k: d.bien.monthlyTotal,
                          v: (
                            <span className="font-display text-base font-bold">
                              {euros(line.monthlyCents, locale)}
                            </span>
                          ),
                        },
                        { k: d.bien.dueDay, v: fmt(d.bien.dueDayValue, { n: ordinalDay(locale, lease.paymentDay) }) },
                        { k: d.bien.reference, v: lease.rfReference || d.common.none },
                      ]}
                    />
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                    {d.bien.paymentHistory}
                  </p>
                  {periods.length === 0 && <p className="mt-2 text-sm text-ink-soft">{d.bien.noLedgerYet}</p>}
                  <ul className="mt-2 divide-y divide-sand-100">
                    {periods.map((rp) => (
                      <li key={rp.id} className="flex items-center justify-between gap-3 py-2 first:pt-0">
                        <span className="text-sm text-ink">{formatMonth(rp.period, locale)}</span>
                        <span className="flex items-center gap-2.5">
                          <span className="text-sm tabular-nums text-ink-soft">{euros(rp.totalCents, locale)}</span>
                          <MetaBadge meta={meta[rp.status]} />
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              {/* Every running tenancy ends the same way: through the guided
                  departure, resumable where it stands. */}
              <div className="mt-5 flex flex-col gap-2.5 border-t border-sand-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm tabular-nums text-ink-soft">
                  {lease.departure ? fmt(d.bien.departureInProgress, { done: Math.max(0, lease.departure.step - 1), total: 7 }) : ""}
                </p>
                <Link
                  href={`/app/biens/depart?bail=${lease.id}`}
                  className="tactile inline-flex min-h-9 items-center justify-center rounded-xl border border-sand-200 bg-white px-3.5 py-1.5 text-sm font-semibold text-ink shadow-sm transition hover:border-brand-300 hover:text-brand-700"
                >
                  {lease.departure ? d.bien.departureResume : d.modify.departure}
                </Link>
              </div>
              <InvitePanel
                compact
                leaseId={lease.id}
                sample={!real}
                parties={partyInvitations(demo, lease, d, locale, !real)}
                labels={inviteLabels(d)}
                stateMeta={inviteStateMeta(d)}
              />
            </Panel>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <CollapsiblePanel title={d.bien.payerAccounts}>
                {payers.length === 0 ? (
                  <p className="text-sm text-ink-soft">{d.bien.noPayer}</p>
                ) : (
                  <ul className="space-y-1.5">
                    {payers.map((b) => (
                      <li key={b.payerIban} className="font-mono text-sm tabular-nums text-ink">
                        {b.payerIban}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-2.5 text-xs leading-relaxed text-ink-soft">{d.bien.payerHint}</p>
              </CollapsiblePanel>

              <CollapsiblePanel title={d.hubs.deposits}>
                {deposit ? (
                  <Rows
                    items={[
                      { k: d.bien.depositAmount, v: euros(deposit.amountCents, locale) },
                      { k: d.bien.depositForm, v: d.status.depositForm[deposit.form] },
                      { k: d.bien.depositState, v: <MetaBadge meta={depMeta[deposit.status]} /> },
                    ]}
                  />
                ) : (
                  <p className="text-sm text-ink-soft">{d.bien.noDeposit}</p>
                )}
              </CollapsiblePanel>

              <CollapsiblePanel title={d.hubs.indexation}>
                {proposal ? (
                  proposal.allowed ? (
                    <div className="rounded-xl bg-amber-50 p-3.5">
                      <p className="font-display text-sm font-bold text-ink">
                        {fmt(d.bien.indexationPossible, { tenant: line.tenantNames.join(", ") })}
                      </p>
                      <p className="mt-1 text-sm tabular-nums text-ink-soft">
                        {fmt(d.bien.indexationFromTo, {
                          from: euros(proposal.currentMonthlyRent, locale),
                          to: euros(proposal.proposedMonthlyRent, locale),
                        })}
                      </p>
                      <Link
                        href="/app/indexation"
                        className="mt-2 inline-block text-sm font-semibold text-brand-700 hover:underline"
                      >
                        {d.bien.indexationReview}
                      </Link>
                    </div>
                  ) : (
                    <p className="text-sm text-ink-soft">
                      {proposal.nextAllowedDate
                        ? fmt(d.indexation.decisionLocked, {
                            date: formatDate(proposal.nextAllowedDate, locale),
                          })
                        : d.bien.indexationNone}
                    </p>
                  )
                ) : (
                  <p className="text-sm text-ink-soft">{d.bien.indexationNone}</p>
                )}
              </CollapsiblePanel>

              <CollapsiblePanel title={d.hubs.edl}>
                {edls.length === 0 ? (
                  <p className="text-sm text-ink-soft">{d.bien.noEdl}</p>
                ) : (
                  <ul className="divide-y divide-sand-100">
                    {edls.map((e) => (
                      <li key={e.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                        <span className="text-sm text-ink">
                          {e.kind === "entry"
                            ? d.baux.edlKindEntry
                            : e.kind === "exit"
                              ? d.baux.edlKindExit
                              : d.baux.edlKindIntermediate}
                        </span>
                        <MetaBadge meta={edlMeta[e.status]} />
                      </li>
                    ))}
                  </ul>
                )}
              </CollapsiblePanel>

              {policies.length > 0 && (
                <CollapsiblePanel title={d.hubs.assurances}>
                  <ul className="divide-y divide-sand-100">
                    {policies.map((i) => (
                      <li key={i.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-ink">{i.provider}</span>
                          <span className="block text-xs text-ink-soft">{d.status.insuranceKind[i.kind]}</span>
                        </span>
                        <span className="text-sm tabular-nums text-ink-soft">
                          {i.expiresOn ? formatDate(i.expiresOn, locale) : d.common.none}
                        </span>
                      </li>
                    ))}
                  </ul>
                </CollapsiblePanel>
              )}
            </div>
          </section>
        );
      })}
      <DraftDossiers card={card} demo={demo} d={d} locale={locale} real={real} />
      <LegalNote>{d.bien.rentalLegal}</LegalNote>
    </div>
  );
}

function Technical({
  card,
  demo,
  d,
  locale,
}: {
  card: PropertyCard;
  demo: DemoData;
  d: Dict;
  locale: Locale;
}) {
  const p = card.property;
  const meters = demo.METERS.filter((m) => m.propertyId === p.id);
  const policies = demo.INSURANCES.filter((i) => i.propertyId === p.id);
  const cpe = cpeExpiryDeadline(p.name, p.cpeIssuedOn);
  const cpeState = deadlineStatus(cpe, demo.TODAY);
  const syndic = p.syndicMandateStart ? syndicMandateDeadline(p.syndicName ?? "", p.syndicMandateStart) : null;
  const unitLabel = (id: string | null) =>
    id ? demo.UNITS.find((u) => u.id === id)?.label ?? d.biens.metersCommon : d.biens.metersCommon;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Panel title={d.bien.energyTitle}>
        <Rows
          items={[
            {
              k: d.biens.cpeRow,
              v: p.energyClass ? (
                <Badge
                  className={
                    cpeState === "overdue"
                      ? "bg-red-100 text-red-700"
                      : cpeState === "due_soon"
                        ? "bg-amber-100 text-amber-800"
                        : "bg-emerald-100 text-emerald-800"
                  }
                >
                  {fmt(d.biens.cpeBadge, { cls: p.energyClass, date: formatDate(cpe.dueAt, locale) })}
                </Badge>
              ) : (
                d.biens.cpeMissing
              ),
            },
            {
              k: d.biens.smokeRow,
              v: p.smokeDetectorsConfirmed ? d.biens.smokeOk : d.biens.smokeKo,
            },
            ...(p.constructionYear ? [{ k: d.biens.construction, v: String(p.constructionYear) }] : []),
            ...(p.completionDate
              ? [{ k: d.biens.completion, v: formatDate(p.completionDate, locale) }]
              : []),
          ]}
        />
      </Panel>

      <Panel title={d.biens.metersTitle}>
        {meters.length === 0 ? (
          <p className="text-sm text-ink-soft">{d.biens.metersNone}</p>
        ) : (
          <ul className="divide-y divide-sand-100">
            {meters.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ink">
                    {d.status.meter[m.kind]} · {unitLabel(m.unitId)}
                  </span>
                  <span className="block truncate text-xs text-ink-soft">{m.serial}</span>
                </span>
                {m.lastReading ? (
                  <span className="shrink-0 text-right text-sm tabular-nums text-ink-soft">
                    {formatNumber(m.lastReading.value, locale)} {METER_UNITS[m.kind]}
                    <span className="block text-xs">{formatDate(m.lastReading.date, locale)}</span>
                  </span>
                ) : (
                  <span className="shrink-0 text-sm text-ink-soft">{d.compteurs.toRead}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={d.hubs.assurances}>
        {policies.length === 0 ? (
          <p className="text-sm text-ink-soft">{d.bien.noInsurance}</p>
        ) : (
          <ul className="divide-y divide-sand-100">
            {policies.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ink">{i.provider}</span>
                  <span className="block truncate text-xs text-ink-soft">
                    {d.status.insuranceKind[i.kind]}
                    {i.policyNumber ? ` · ${i.policyNumber}` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-right text-sm tabular-nums text-ink-soft">
                  {i.premiumCents > 0 ? euros(i.premiumCents, locale) : ""}
                  {i.expiresOn && <span className="block text-xs">{formatDate(i.expiresOn, locale)}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={d.bien.cadastreTitle}>
        <Rows
          items={[
            { k: d.bien.cadastral, v: p.cadastralRef || d.common.none },
            { k: d.bien.commune, v: p.commune || d.common.none },
            { k: d.biens.copro, v: p.isCopropriete ? d.common.yes : d.common.none },
            ...(p.syndicName ? [{ k: d.biens.syndic, v: p.syndicName }] : []),
            ...(syndic
              ? [{ k: d.biens.mandateEnd, v: formatDate(syndic.dueAt, locale) }]
              : []),
          ]}
        />
        {p.isCopropriete && <LegalNote>{d.biens.coproLegal}</LegalNote>}
      </Panel>
    </div>
  );
}

function Interventions({
  card,
  demo,
  d,
  locale,
}: {
  card: PropertyCard;
  demo: DemoData;
  d: Dict;
  locale: Locale;
}) {
  const tickets = ticketsFor(demo, card);
  const sMeta = ticketStatusMeta(d);
  const vMeta = ticketSeverityMeta(d);
  if (tickets.length === 0) {
    return <EmptyState icon="tasks" title={d.bien.noInterventionsTitle} body={d.bien.noInterventionsBody} />;
  }
  return (
    <Panel
      title={d.hubs.interventions}
      action={
        <Link href="/app/interventions" className="text-sm font-semibold text-brand-700 hover:underline">
          {d.bien.seeAll}
        </Link>
      }
    >
      <ul className="divide-y divide-sand-100">
        {tickets.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-ink">{t.title}</span>
              <span className="block text-xs text-ink-soft">
                {t.ref} · {formatDate(t.createdAt, locale)}
              </span>
            </span>
            <MetaBadge meta={vMeta[t.severity]} />
            <MetaBadge meta={sMeta[t.status]} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Documents({
  card,
  demo,
  d,
  locale,
}: {
  card: PropertyCard;
  demo: DemoData;
  d: Dict;
  locale: Locale;
}) {
  const docs = documentsFor(demo, card);
  if (docs.length === 0) {
    return <EmptyState icon="documents" title={d.bien.noDocumentsTitle} body={d.bien.noDocumentsBody} />;
  }
  return (
    <Panel title={d.hubs.library}>
      <ul className="divide-y divide-sand-100">
        {docs.map((doc) => (
          <li key={doc.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-3 first:pt-0 last:pb-0">
            <Icon name="documents" size={16} className="shrink-0 text-ink-soft" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-ink">{doc.name}</span>
              <span className="block truncate text-xs text-ink-soft">
                {doc.relatedLabel} · {formatDate(doc.createdAt, locale)}
              </span>
            </span>
            {doc.sealed && <Badge className="bg-sand-100 text-ink-soft">{d.documents.sealedAria}</Badge>}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function History({
  card,
  demo,
  d,
  locale,
}: {
  card: PropertyCard;
  demo: DemoData;
  d: Dict;
  locale: Locale;
}) {
  // The property's memory. Every tenancy it has ever had, numbered in the
  // order they began and shown newest first, each one whole: its own tenant,
  // its own rent, its own payments, its own inventory. Two tenancies are
  // never merged into one story, which is the point of numbering them.
  const unitIds = new Set(demo.UNITS.filter((u) => u.propertyId === card.property.id).map((u) => u.id));
  const rentals = demo.LEASES.filter((l) => unitIds.has(l.unitId) && l.status !== "draft")
    .slice()
    .sort((a, b) => (a.startDate < b.startDate ? -1 : 1))
    .map((lease, i) => {
      const periods = demo.RENT_PERIODS.filter((rp) => rp.leaseId === lease.id);
      const received = periods.reduce((a, rp) => a + rp.allocatedCents, 0);
      const open = periods.reduce((a, rp) => a + Math.max(0, rp.totalCents - rp.allocatedCents), 0);
      return {
        lease,
        number: i + 1,
        unitLabel: demo.UNITS.find((u) => u.id === lease.unitId)?.label ?? "",
        tenants: demo.leaseTenantNames(lease).join(", "),
        periods: periods.length,
        received,
        open,
        deposit: demo.DEPOSITS.find((x) => x.leaseId === lease.id) ?? null,
        edls: demo.EDLS.filter((e) => e.leaseId === lease.id).length,
        live: lease.status === "active" || lease.status === "notice",
      };
    })
    .reverse();

  const vacancies = card.lots
    .filter((l) => l.vacant && l.unit.vacantSince)
    .map((l) => ({ unit: l.unit, clock: vacancyClock(l.unit.label, l.unit.vacantSince!, demo.TODAY) }));

  if (rentals.length === 0 && vacancies.length === 0) {
    return <EmptyState icon="clock" title={d.bien.noHistoryTitle} body={d.bien.noHistoryBody} />;
  }

  return (
    <div className="space-y-5">
      {vacancies.length > 0 && (
        <Panel title={d.bien.vacancyTitle}>
          <ul className="divide-y divide-sand-100">
            {vacancies.map((v) => (
              <li key={v.unit.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <span className="text-sm font-semibold text-ink">{v.unit.label}</span>
                <span className="text-sm text-ink-soft">
                  {fmt(d.biens.unitVacantSince, {
                    date: formatDate(v.unit.vacantSince!, locale),
                    months: v.clock.monthsVacant,
                  })}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {rentals.length > 0 && (
        <Panel title={d.bien.rentalsTitle}>
          <ul className="space-y-3">
            {rentals.map((r) => (
              <li
                key={r.lease.id}
                className={
                  "rounded-xl border p-4 " +
                  (r.live ? "border-brand-100 bg-brand-50/40" : "border-sand-200 bg-white")
                }
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-display text-sm font-bold text-ink">
                      {fmt(d.bien.rentalNumber, { n: r.number })}{" \u00b7 "}{r.tenants || d.common.none}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-soft">
                      {r.unitLabel}{" \u00b7 "}{formatDate(r.lease.startDate, locale)}
                      {r.lease.endDate ? ` \u00b7 ${formatDate(r.lease.endDate, locale)}` : ""}
                    </p>
                  </div>
                  <Badge className={r.live ? "bg-emerald-100 text-emerald-800" : "bg-sand-100 text-ink-soft"}>
                    {r.live ? d.bien.rentalLive : d.bien.rentalClosed}
                  </Badge>
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
                  {[
                    { k: d.bien.monthlyTotal, v: euros(r.lease.rentCents + r.lease.chargesCents, locale) },
                    { k: d.bien.periodsCount, v: String(r.periods) },
                    { k: d.bien.received, v: euros(r.received, locale) },
                    ...(r.open > 0 ? [{ k: d.bien.stillOpen, v: euros(r.open, locale) }] : []),
                    ...(r.edls > 0 ? [{ k: d.hubs.edl, v: String(r.edls) }] : []),
                  ].map((x) => (
                    <div key={x.k}>
                      <dt className="text-[11px] uppercase tracking-wide text-ink-soft">{x.k}</dt>
                      <dd className="text-sm font-semibold tabular-nums text-ink">{x.v}</dd>
                    </div>
                  ))}
                </dl>

                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                  <Link href={`/app/baux/${r.lease.id}`} className="text-sm font-semibold text-brand-700 hover:underline">
                    {r.live ? d.bien.openRental : d.bien.consult}
                  </Link>
                  {!r.live && (
                    <Link
                      href={`/app/baux/${r.lease.id}?onglet=contrat`}
                      className="text-sm font-semibold text-ink-soft hover:text-ink hover:underline"
                    >
                      {d.bien.correct}
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <LegalNote>{d.bien.historyLegal}</LegalNote>
        </Panel>
      )}
    </div>
  );
}

/* ------------------------------ shared lookups ---------------------------- */

function ticketsFor(demo: DemoData, card: PropertyCard) {
  const unitIds = new Set(demo.UNITS.filter((u) => u.propertyId === card.property.id).map((u) => u.id));
  return demo.TICKETS.filter((t) => unitIds.has(t.unitId))
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

function documentsFor(demo: DemoData, card: PropertyCard) {
  const unitIds = new Set(demo.UNITS.filter((u) => u.propertyId === card.property.id).map((u) => u.id));
  const leaseIds = new Set(demo.LEASES.filter((l) => unitIds.has(l.unitId)).map((l) => l.id));
  const labels = new Set<string>([card.property.name]);
  for (const line of card.lots) labels.add(line.unit.label);
  return demo.DOCUMENTS.filter(
    (doc) =>
      leaseIds.has(doc.id) ||
      [...labels].some((l) => l && doc.relatedLabel.includes(l)),
  )
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/* ---------------------------------- page ---------------------------------- */

export default async function BienDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ onglet?: string }>;
}) {
  const [{ id }, { onglet }] = await Promise.all([params, searchParams]);
  const { locale, d } = await getI18n();
  const [demo, datasetId] = await Promise.all([getDemo(), getDatasetId()]);
  const real = datasetId === "real";
  const card = findCard(buildPortfolio(demo), id);
  if (!card) notFound();
  const menu = propertyMenu(card, demo, d, locale);

  const p = card.property;
  const single = card.single;
  const multi = card.lots.length > 1;
  // A single lot that is free but has a dossier in preparation says how far it got.
  const singleDraft = single?.vacant && single.drafts.length > 0 ? dossierOf(demo, single.drafts[single.drafts.length - 1]) : null;
  const visible = TABS.filter((t) => (t === "lots" ? multi : true));
  const tab: Tab = (visible as readonly string[]).includes(onglet ?? "") ? (onglet as Tab) : "apercu";
  const tabHref = (t: Tab) => (t === "apercu" ? `/app/biens/${p.id}` : `/app/biens/${p.id}?onglet=${t}`);

  const headline = [
    card.kind === "building" ? plural(locale, card.lots.length, d.biens.lotOne, d.biens.lotMany) : "",
    single && single.unit.areaSqm > 0 ? fmt(d.biens.sqm, { n: single.unit.areaSqm }) : "",
    single && single.unit.rooms > 0 ? plural(locale, single.unit.rooms, d.biens.roomOne, d.biens.roomMany) : "",
    single?.unit.bedrooms ? plural(locale, single.unit.bedrooms, d.biens.bedroomOne, d.biens.bedroomMany) : "",
    single?.unit.floor && single.unit.floor !== "—" ? single.unit.floor : "",
  ].filter(Boolean);

  return (
    <div>
      <div className="mb-3">
        <Link href="/app/biens" className="text-sm font-semibold text-brand-700 hover:underline">
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
            {single ? (
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
            ) : (
              <HeroStat
                icon="user"
                label={d.bien.occupancy}
                value={`${card.occupied}/${card.lots.length}`}
                sub={plural(locale, card.vacant, d.biens.vacantOneN, d.biens.vacantManyN)}
              />
            )}
            <HeroStat
              icon="euro"
              label={d.bien.monthlyTotal}
              value={fmt(d.biens.perMonth, { amount: eurosWhole(card.monthlyCents, locale) })}
              sub={
                single && !single.vacant
                  ? `${euros(single.lease!.rentCents, locale)} + ${euros(single.lease!.chargesCents, locale)}`
                  : undefined
              }
            />
            <HeroStat
              icon="calendar"
              label={d.bien.thisMonth}
              value={
                single?.status
                  ? rentStatusMeta(d)[single.status].label
                  : `${plural(locale, card.occupied, d.biens.occupiedOneN, d.biens.occupiedManyN)} \u00b7 ${plural(
                      locale,
                      card.vacant,
                      d.biens.vacantOneN,
                      d.biens.vacantManyN,
                    )}`
              }
            />
            <HeroStat
              icon="clock"
              label={d.bien.nextDue}
              value={card.nextDue ? formatDate(card.nextDue, locale) : d.common.none}
            />
          </div>
        </div>
      </div>

      {/* Tabs: lenses on one property, never separate records. */}
      <div className="no-scrollbar mb-5 flex gap-1 overflow-x-auto border-b border-sand-200">
        {visible.map((t) => (
          <Link
            key={t}
            href={tabHref(t)}
            aria-current={t === tab ? "page" : undefined}
            className={
              "shrink-0 border-b-2 px-3 py-2.5 text-sm font-semibold transition " +
              (t === tab
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-ink-soft hover:text-ink")
            }
          >
            {tabLabel(d, t)}
          </Link>
        ))}
      </div>

      {tab === "apercu" && <Overview card={card} demo={demo} d={d} locale={locale} real={real} />}
      {tab === "lots" && <Lots card={card} demo={demo} d={d} locale={locale} />}
      {tab === "location" && <Rental card={card} demo={demo} d={d} locale={locale} real={real} />}
      {tab === "technique" && <Technical card={card} demo={demo} d={d} locale={locale} />}
      {tab === "interventions" && <Interventions card={card} demo={demo} d={d} locale={locale} />}
      {tab === "documents" && <Documents card={card} demo={demo} d={d} locale={locale} />}
      {tab === "historique" && <History card={card} demo={demo} d={d} locale={locale} />}
    </div>
  );
}

function OccupancyPill({ card, d }: { card: PropertyCard; d: Dict }) {
  const state = occupancyOf(card);
  if (state === "occupied") return <Badge className="bg-emerald-100 text-emerald-800">{d.biens.occupiedOne}</Badge>;
  if (state === "vacant") return <Badge className="bg-sand-100 text-ink-soft">{d.biens.vacantLabel}</Badge>;
  return <Badge className="bg-amber-100 text-amber-800">{d.biens.partiallyOccupied}</Badge>;
}

function HeroStat({
  icon,
  label,
  value,
  sub,
}: {
  icon: "user" | "euro" | "calendar" | "clock";
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card className="p-3.5">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
        <Icon name={icon} size={13} />
        {label}
      </p>
      <p className="mt-1 truncate font-display text-sm font-bold text-ink">{value}</p>
      {sub && <p className="mt-0.5 truncate text-xs tabular-nums text-ink-soft">{sub}</p>}
    </Card>
  );
}

/** The handful of strings the editors own, rather than the page. */
function modifyLabels(d: Dict) {
  return {
    trigger: d.modify.trigger,
    cancel: d.common.cancel,
    save: d.common.save,
    saved: d.modify.saved,
    failed: d.modify.failed,
    emailTaken: d.modify.emailTaken,
    photoCurrent: d.modify.photoCurrent,
    photoChoose: d.modify.photoChoose,
    photoRemove: d.modify.photoRemove,
    photoNone: d.modify.photoNone,
    payerAdd: d.modify.payerAdd,
    payerIban: d.location.payerIban,
    payerNone: d.modify.payerNone,
    payerHint: d.location.payerHint,
    remove: d.modify.remove,
    indexApply: d.modify.indexApply,
    indexBlocked: d.modify.indexBlocked,
    indexFrom: d.modify.indexTo,
    indexTo: d.modify.indexTo,
    archiveConfirm: d.modify.archive,
    archiveBody: d.modify.archiveBody,
    archiveBlocked: d.modify.archiveBlocked,
    archiveDo: d.modify.archiveDo,
  };
}
