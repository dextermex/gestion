import Link from "next/link";
import { Badge, Card } from "@/components/pro/ui";
import { LinkRow, MetaBadge, Panel } from "@/components/gestion/bits";
import TenantEmpty from "@/components/gestion/TenantEmpty";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";
import { getTenantView } from "@/lib/portal/space";
import { paymentsOf } from "@/lib/portal/tenant-space";
import { alertsFor, rentSituation } from "@/lib/portal/view";
import { euros, formatDate, leaseStatusMeta, requestStateMeta } from "@/lib/types";

/**
 * "Mon logement": the home, the rent at a glance, what is worth knowing,
 * the three doors, the open requests and who to write to. Every figure is
 * derived from the space; nothing is typed in here.
 */
export default async function TenantHomePage() {
  const { locale, d } = await getI18n();
  const view = await getTenantView();
  if (view.kind === "signed_out") return null;
  const { space } = view;
  const lease = space.current ?? space.past[0];
  if (!lease) return <TenantEmpty d={d} manage={view.canManage} />;
  const ended = space.current === null;
  const payments = space.payments ?? paymentsOf(lease, space.today);
  const situation = rentSituation(space.payments);
  const alerts = ended ? [] : alertsFor(lease, space.payments, space.today);
  const open = space.requests.filter((r) => r.leaseId === lease.id && r.state !== "resolved");
  const stateMeta = requestStateMeta(d);
  const leaseMeta = leaseStatusMeta(d);
  const situationLabel = { ok: d.tenant.rentOk, pending: d.tenant.rentPending, partial: d.tenant.rentPartial, late: d.tenant.rentLate }[situation];
  const situationColor = {
    ok: "bg-emerald-100 text-emerald-800",
    pending: "bg-sand-100 text-ink-soft",
    partial: "bg-amber-100 text-amber-800",
    late: "bg-red-100 text-red-700",
  }[situation];
  const home = `${lease.unit.label} · ${lease.property.name}`;

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink">{fmt(d.tenant.hello, { name: space.me.firstName || space.me.name })}</h1>
        <p className="mt-1 text-sm text-ink-soft">{fmt(d.tenant.homeSub, { unit: home })}</p>
      </div>

      {ended && (
        <Card className="mb-5 p-5">
          <p className="font-display text-lg font-bold text-ink">{d.tenant.endedTitle}</p>
          <p className="mt-1 text-sm text-ink-soft">{d.tenant.endedBody}</p>
        </Card>
      )}

      <div className="stagger-rise grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card className="overflow-hidden">
          {lease.property.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={lease.property.photoUrl} alt="" className="aspect-[16/9] w-full object-cover" />
          ) : (
            <div className="flex aspect-[16/9] w-full items-center justify-center bg-sand-100 text-ink-soft" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-8 w-8">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 11.2 12 4l9 7.2M5.5 9.6V20h13V9.6" />
              </svg>
            </div>
          )}
          <div className="p-5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{d.tenant.unitTitle}</p>
            <p className="mt-1 font-display text-lg font-bold text-ink">{lease.unit.label}</p>
            <p className="text-sm text-ink-soft">{lease.property.name}</p>
            <p className="text-xs text-ink-soft">{lease.property.address}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {lease.unit.areaSqm > 0 && <Badge>{fmt(d.tenant.area, { m: lease.unit.areaSqm })}</Badge>}
              {lease.unit.rooms > 0 && <Badge>{fmt(d.tenant.rooms, { n: lease.unit.rooms })}</Badge>}
              {lease.unit.floor && <Badge>{fmt(d.tenant.floorLabel, { f: lease.unit.floor })}</Badge>}
            </div>
            <p className="mt-3 text-xs text-ink-soft">{fmt(d.tenant.since, { date: formatDate(lease.startDate, locale) })}</p>
            {lease.endDate && <p className="text-xs text-ink-soft">{fmt(d.tenant.until, { date: formatDate(lease.endDate, locale) })}</p>}
          </div>
        </Card>

        {!ended && (
          <Card className="p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{d.tenant.rentTitle}</p>
              <Badge className={situationColor}>{situationLabel}</Badge>
            </div>
            <p className="mt-1 text-sm text-ink-soft">{fmt(d.tenant.rentTotal, { amount: euros(lease.rentCents + lease.chargesCents, locale) })}</p>
            {payments.outstandingCents > 0 && (
              <p className="mt-1 text-sm font-semibold text-red-700">{fmt(d.tenant.rentOutstanding, { amount: euros(payments.outstandingCents, locale) })}</p>
            )}
            <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{d.tenant.nextRentTitle}</p>
            {payments.nextDueOn ? (
              <>
                <p className="mt-1 font-display text-2xl font-bold tracking-tight tabular-nums text-ink">{euros(payments.nextDueCents, locale)}</p>
                <p className="text-xs text-ink-soft">{fmt(d.tenant.nextRentDue, { date: formatDate(payments.nextDueOn, locale) })}</p>
              </>
            ) : (
              <p className="mt-2 text-sm text-emerald-700">{d.tenant.nextRentNone}</p>
            )}
            {lease.rfReference && (
              <>
                <p className="mt-3 text-[11px] font-semibold text-ink-soft">{d.tenant.nextRentRef}</p>
                <code className="mt-1 inline-block rounded-md bg-sand-50 px-2 py-1 text-[11px] font-semibold tabular-nums text-brand-800">{lease.rfReference}</code>
              </>
            )}
          </Card>
        )}
      </div>

      {!ended && (
        <Panel title={d.tenant.alertsTitle} className="mt-5">
          {alerts.length === 0 ? (
            <p className="text-sm text-emerald-700">{d.tenant.alertsNone}</p>
          ) : (
            <ul className="space-y-2">
              {alerts.map((a, i) => (
                <li key={i} className={"rounded-xl px-3.5 py-2.5 text-sm " + (a.kind === "late" ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-900")}>
                  {a.kind === "late" && fmt(d.tenant.alertLate, { amount: euros(a.amountCents, locale) })}
                  {a.kind === "notice" && fmt(d.tenant.alertNotice, { date: formatDate(a.date, locale) })}
                  {a.kind === "insurance_missing" && d.tenant.alertInsuranceMissing}
                  {a.kind === "insurance_expiring" && fmt(d.tenant.alertInsuranceExpiring, { date: formatDate(a.date, locale) })}
                  {a.kind === "edl" && d.tenant.alertEdl}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      <Panel title={d.tenant.quickTitle} className="mt-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            { href: ended ? "/locataire/demandes" : "/locataire/demandes?nouvelle=1", title: d.tenant.quickRequest, sub: d.tenant.quickRequestSub },
            { href: "/locataire/bail", title: d.tenant.quickLease, sub: d.tenant.quickLeaseSub },
            { href: "/locataire/paiements", title: d.tenant.quickPayments, sub: d.tenant.quickPaymentsSub },
          ].map((q) => (
            <Link key={q.href} href={q.href} className="tactile rounded-xl border border-transparent bg-sand-50 p-4 transition hover:border-brand-200 hover:bg-sand-100">
              <p className="font-display text-sm font-bold text-ink">{q.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-soft">{q.sub}</p>
            </Link>
          ))}
        </div>
      </Panel>

      <div className="mt-5 grid grid-cols-1 items-start gap-5 sm:grid-cols-2">
        <Panel
          title={d.tenant.openRequests}
          action={
            <Link href="/locataire/demandes" className="text-sm font-semibold text-brand-700 hover:underline">
              {d.tenant.seeAll}
            </Link>
          }
        >
          {open.length === 0 ? (
            <p className="text-sm text-ink-soft">{d.tenant.noRequests}</p>
          ) : (
            <ul className="divide-y divide-sand-100">
              {open.map((r) => (
                <li key={r.id}>
                  <LinkRow href={`/locataire/demandes/${r.id}`} title={r.title} sub={`${r.ref} · ${formatDate(r.createdAt, locale)}`} right={<MetaBadge meta={stateMeta[r.state]} />} />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={d.tenant.managerTitle}>
          {space.managers.length === 0 ? (
            <p className="text-sm text-ink-soft">{d.common.none}</p>
          ) : (
            <ul className="space-y-3">
              {space.managers.map((m) => (
                <li key={m.orgId}>
                  <p className="font-display text-sm font-bold text-ink">{m.name}</p>
                  {m.email && <p className="text-xs text-ink-soft">{m.email}</p>}
                  {m.phone && <p className="text-xs text-ink-soft">{m.phone}</p>}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {m.email && (
                      <a href={`mailto:${m.email}`} className="inline-block rounded-xl border border-sand-200 px-3.5 py-2 text-sm font-semibold text-brand-700 transition hover:border-brand-300">
                        {d.tenant.managerWrite}
                      </a>
                    )}
                    {m.phone && (
                      <a href={`tel:${m.phone.replace(/\s/g, "")}`} className="inline-block rounded-xl border border-sand-200 px-3.5 py-2 text-sm font-semibold text-brand-700 transition hover:border-brand-300">
                        {d.tenant.managerCall}
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {space.others.length > 0 && (
        <Panel title={d.tenant.othersTitle} className="mt-5">
          <ul className="divide-y divide-sand-100">
            {space.others.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{`${o.unit.label} · ${o.property.name}`}</p>
                  <p className="text-xs text-ink-soft">{fmt(d.tenant.pastRange, { from: formatDate(o.startDate, locale), to: o.endDate ? formatDate(o.endDate, locale) : d.tenant.leaseEndOpen })}</p>
                </div>
                <MetaBadge meta={leaseMeta[o.status as keyof typeof leaseMeta] ?? leaseMeta.active} />
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {space.past.length > 0 && !ended && (
        <Panel title={d.tenant.pastTitle} className="mt-5">
          <ul className="divide-y divide-sand-100">
            {space.past.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{`${p.unit.label} · ${p.property.name}`}</p>
                  <p className="text-xs text-ink-soft">{fmt(d.tenant.pastRange, { from: formatDate(p.startDate, locale), to: p.endDate ? formatDate(p.endDate, locale) : d.common.none })}</p>
                </div>
                <Badge>{d.tenant.currentEnded}</Badge>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
