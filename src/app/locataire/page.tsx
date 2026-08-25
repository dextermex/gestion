import Link from "next/link";
import { Badge, Card } from "@/components/pro/ui";
import { LinkRow, MetaBadge, Panel } from "@/components/gestion/bits";
import { getDemo } from "@/lib/demo";
import { tenantPersona } from "@/lib/demo/tenant";
import TenantEmpty from "@/components/gestion/TenantEmpty";
import { euros, formatDate, ticketStatusMeta } from "@/lib/types";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";

export default async function TenantHomePage() {
  const { locale, d } = await getI18n();
  const demo = await getDemo();
  const persona = tenantPersona(demo);
  if (!persona) return <TenantEmpty d={d} />;
  const { lease, tenant, unit, property, unitLabel } = persona;
  const ticketMeta = ticketStatusMeta(d);

  const nextPeriod = demo.RENT_PERIODS.filter(
    (rp) => rp.leaseId === lease.id && rp.allocatedCents < rp.totalCents,
  ).sort((a, b) => (a.period < b.period ? -1 : 1))[0];

  const myTickets = demo.TICKETS.filter(
    (t) => t.leaseId === lease.id && !["done", "closed", "cancelled"].includes(t.status),
  );

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink">
          {fmt(d.tenant.hello, { name: tenant.name.split(" ")[0] })}
        </h1>
        <p className="mt-1 text-sm text-ink-soft">{fmt(d.tenant.homeSub, { unit: unitLabel })}</p>
      </div>

      <div className="stagger-rise grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card className="p-5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{d.tenant.unitTitle}</p>
          <p className="mt-1 font-display text-lg font-bold text-ink">{unit.label}</p>
          <p className="text-sm text-ink-soft">{property.name}</p>
          <p className="text-xs text-ink-soft">{property.address}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Badge>{fmt(d.tenant.area, { m: unit.areaSqm })}</Badge>
            {unit.rooms > 0 && <Badge>{fmt(d.tenant.rooms, { n: unit.rooms })}</Badge>}
            <Badge>{fmt(d.tenant.floorLabel, { f: unit.floor })}</Badge>
          </div>
        </Card>

        <Card className="p-5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
            {d.tenant.nextRentTitle}
          </p>
          {nextPeriod ? (
            <>
              <p className="mt-1 font-display text-2xl font-bold tracking-tight tabular-nums text-ink">
                {euros(nextPeriod.totalCents, locale)}
              </p>
              <p className="text-xs text-ink-soft">
                {fmt(d.tenant.nextRentDue, { date: formatDate(nextPeriod.dueDate, locale) })}
              </p>
              <p className="mt-3 text-[11px] font-semibold text-ink-soft">{d.tenant.nextRentRef}</p>
              <code className="mt-1 inline-block rounded-md bg-sand-50 px-2 py-1 text-[11px] font-semibold tabular-nums text-brand-800">
                {lease.rfReference}
              </code>
            </>
          ) : (
            <p className="mt-2 text-sm text-emerald-700">{d.tenant.nextRentNone}</p>
          )}
        </Card>
      </div>

      <Panel title={d.tenant.quickTitle} className="mt-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Link
            href="/locataire/demandes?nouvelle=technique"
            className="tactile rounded-xl border border-sand-200 p-4 transition hover:border-brand-200 hover:shadow-sm"
          >
            <p className="font-display text-sm font-bold text-ink">{d.tenant.quickTech}</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-soft">{d.tenant.quickTechSub}</p>
          </Link>
          <Link
            href="/locataire/demandes?nouvelle=administrative"
            className="tactile rounded-xl border border-sand-200 p-4 transition hover:border-brand-200 hover:shadow-sm"
          >
            <p className="font-display text-sm font-bold text-ink">{d.tenant.quickAdmin}</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-soft">{d.tenant.quickAdminSub}</p>
          </Link>
        </div>
      </Panel>

      <div className="mt-5 grid grid-cols-1 items-start gap-5 sm:grid-cols-2">
        <Panel title={d.tenant.openRequests}>
          {myTickets.length === 0 ? (
            <p className="text-sm text-ink-soft">{d.common.none}</p>
          ) : (
            <ul className="divide-y divide-sand-100">
              {myTickets.map((t) => (
                <li key={t.id}>
                  <LinkRow
                    href="/locataire/demandes"
                    title={t.title}
                    sub={t.ref}
                    right={<MetaBadge meta={ticketMeta[t.status]} />}
                  />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={d.tenant.managerTitle}>
          <p className="font-display text-sm font-bold text-ink">{demo.ORG.shortName}</p>
          <p className="text-xs text-ink-soft">{demo.ORG.managerEmail}</p>
          <a
            href={`mailto:${demo.ORG.managerEmail}`}
            className="mt-3 inline-block rounded-xl border border-sand-200 px-3.5 py-2 text-sm font-semibold text-brand-700 transition hover:border-brand-300"
          >
            {d.tenant.managerWrite}
          </a>
        </Panel>
      </div>
    </div>
  );
}
