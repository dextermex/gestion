import Link from "next/link";
import CopyButton from "@/components/gestion/CopyButton";
import GlassHouse from "@/components/gestion/GlassHouse";
import { Icon, type IconName } from "@/components/pro/icons";
import { Badge, Card } from "@/components/pro/ui";
import { LinkRow, MetaBadge, Panel } from "@/components/gestion/bits";
import TenantEmpty from "@/components/gestion/TenantEmpty";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";
import { visitWhen, monthName, monthPhrase } from "@/lib/portal/format";
import { getTenantView } from "@/lib/portal/space";
import { paymentsOf } from "@/lib/portal/tenant-space";
import { rentDue, rentSituation, todoFor, upcomingFor } from "@/lib/portal/view";
import { euros, formatDate, formatMonth, leaseStatusMeta, requestStateMeta } from "@/lib/types";

/**
 * The home: what to pay and where, what to do, what is coming, the open
 * requests and who to write to. When rent is owed, the amount owed now
 * leads, with the reason the ledger itself shows; otherwise the next rent
 * does. Every figure and every date is derived from the space; nothing is
 * typed in here, and a block with nothing to say is not drawn.
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
  const due = rentDue(lease, space.today);
  const todo = ended ? [] : todoFor(lease, space.payments, space.today);
  const upcoming = ended ? [] : upcomingFor(lease, space.payments, space.requests, space.today);
  const open = space.requests.filter((r) => r.leaseId === lease.id && r.state !== "resolved" && r.state !== "refused");
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
  const instructions = space.paymentInstructions;
  const iban = instructions ? instructions.iban.replace(/(.{4})/g, "$1 ").trim() : "";
  const owed = !ended && due.lateCents > 0;
  const onlyLate = due.latePeriods.length === 1 ? due.latePeriods[0] : null;
  const total = lease.rentCents + lease.chargesCents;

  return (
    <div>
      <div className="tenant-greeting mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink">{fmt(d.tenant.hello, { name: space.me.firstName || space.me.name })}</h1>
        <p className="mt-1 text-sm text-ink-soft">{fmt(d.tenant.homeSub, { unit: home })}</p>
      </div>

      {ended && (
        <Card className="mb-5 p-5">
          <p className="font-display text-lg font-bold text-ink">{d.tenant.endedTitle}</p>
          <p className="mt-1 text-sm text-ink-soft">{d.tenant.endedBody}</p>
        </Card>
      )}

      <div className="tenant-overview">
        {!ended && (
          <Card className="tenant-rent-card p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="tenant-eyebrow text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{d.tenant.rentTitle}</p>
              <Badge className={situationColor}>{situationLabel}</Badge>
            </div>

            {owed ? (
              <>
                <p className="mt-4 text-sm font-medium text-ink-soft">{d.tenant.dueNowTitle}</p>
                <p className="tenant-next-amount mt-1 font-display text-2xl font-bold tracking-tight tabular-nums text-ink">{euros(due.lateCents, locale)}</p>
                <p className="text-sm text-ink-soft">
                  {onlyLate
                    ? onlyLate.allocatedCents > 0
                      ? fmt(d.tenant.dueOne, { month: monthPhrase(formatMonth(onlyLate.period, locale), locale), paid: euros(onlyLate.allocatedCents, locale), total: euros(onlyLate.totalCents, locale) })
                      : fmt(d.tenant.dueOneUnpaid, { month: monthPhrase(formatMonth(onlyLate.period, locale), locale), date: formatDate(onlyLate.dueDate, locale) })
                    : fmt(d.tenant.dueMany, { n: due.latePeriods.length })}
                </p>
                {due.staleOrder && (
                  <p className="mt-3 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm leading-relaxed text-amber-900">
                    {fmt(d.tenant.staleOrder, { paid: euros(due.staleOrder.paidCents, locale), total: euros(due.staleOrder.dueCents, locale) })}
                  </p>
                )}
                {payments.nextDueOn && (
                  <div className="tenant-rent-next mt-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-sand-200/70 pt-4">
                    <p className="text-sm font-medium text-ink-soft">{d.tenant.nextRentTitle}</p>
                    <p className="text-sm font-semibold tabular-nums text-ink">{fmt(d.tenant.nextRentLine, { amount: euros(payments.nextDueCents, locale), date: formatDate(payments.nextDueOn, locale) })}</p>
                  </div>
                )}
              </>
            ) : (
              <>
                <p className="mt-1 text-sm text-ink-soft">{fmt(d.tenant.rentTotal, { amount: euros(total, locale) })}</p>
                <p className="mt-6 text-sm font-medium text-ink-soft">{d.tenant.nextRentTitle}</p>
                {payments.nextDueOn ? (
                  <>
                    <p className="tenant-next-amount mt-1 font-display text-2xl font-bold tracking-tight tabular-nums text-ink">{euros(payments.nextDueCents, locale)}</p>
                    <p className="text-xs text-ink-soft">{fmt(d.tenant.nextRentDue, { date: formatDate(payments.nextDueOn, locale) })}</p>
                  </>
                ) : (
                  <p className="mt-2 text-sm text-emerald-700">{d.tenant.nextRentNone}</p>
                )}
              </>
            )}

            {(instructions || lease.rfReference) && (
              <div className="mt-5 border-t border-sand-200/70 pt-4" data-home-pay>
                <p className="tenant-eyebrow text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{d.tenant.payInstructions}</p>
                <dl className="tenant-pay-lines mt-2">
                  {instructions && (
                    <>
                      <div>
                        <dt>{d.tenant.payHolder}</dt>
                        <dd className="font-semibold text-ink">{instructions.holderName}</dd>
                      </div>
                      <div>
                        <dt>{d.tenant.payIban}</dt>
                        <dd className="font-mono text-sm font-semibold tabular-nums text-brand-800">{iban}</dd>
                        <CopyButton value={instructions.iban} label={d.tenant.copy} copiedLabel={d.tenant.copied} ariaLabel={fmt(d.tenant.copyAria, { what: d.tenant.payIban })} />
                      </div>
                    </>
                  )}
                  {lease.rfReference && (
                    <div>
                      <dt>{d.tenant.payRefShort}</dt>
                      <dd className="font-mono text-sm font-semibold tabular-nums text-brand-800">{lease.rfReference}</dd>
                      <CopyButton value={lease.rfReference} label={d.tenant.copy} copiedLabel={d.tenant.copied} ariaLabel={fmt(d.tenant.copyAria, { what: d.tenant.payRefShort })} />
                    </div>
                  )}
                </dl>
              </div>
            )}
            <Link href="/locataire/paiements" className="tenant-primary-action">{d.tenant.rentHistoryLink}<Icon name="chevron-right" size={18}/></Link>
          </Card>
        )}
        <Card className="tenant-home-card overflow-hidden">
          {lease.property.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={lease.property.photoUrl} alt="" decoding="async" className="aspect-[16/9] w-full object-cover" />
          ) : (
            <div className="tenant-house-illustration"><GlassHouse /></div>
          )}
          <div className="flex flex-1 flex-col p-5">
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
            <Link href="/locataire/bail" className="tenant-primary-action">{d.tenant.homeLeaseLink}<Icon name="chevron-right" size={18}/></Link>
          </div>
        </Card>
      </div>

      {(todo.length > 0 || upcoming.length > 0) && (
        <div className={"mt-5 grid grid-cols-1 items-start gap-5 " + (todo.length > 0 && upcoming.length > 0 ? "lg:grid-cols-2" : "")}>
          {todo.length > 0 && (
            <Panel title={d.tenant.todoTitle}>
              <ul className="space-y-2.5">
                {todo.map((a, i) => (
                  <li key={i} className="rounded-xl bg-amber-50 px-3.5 py-3 text-sm text-amber-900">
                    <p>
                      {a.kind === "notice" && fmt(d.tenant.alertNotice, { date: formatDate(a.date, locale) })}
                      {a.kind === "insurance_missing" && d.tenant.todoInsuranceMissing}
                      {a.kind === "insurance_expiring" && fmt(d.tenant.alertInsuranceExpiring, { date: formatDate(a.date, locale) })}
                      {a.kind === "edl" && d.tenant.alertEdl}
                    </p>
                    {(a.kind === "insurance_missing" || a.kind === "insurance_expiring") && (
                      <Link
                        href="/locataire/demandes?nouvelle=attestation"
                        className="tactile mt-2.5 inline-flex min-h-11 items-center gap-2 rounded-xl border border-sand-200 bg-white px-3.5 text-sm font-semibold text-brand-700 transition hover:border-brand-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                      >
                        <Icon name="upload" size={18} className="shrink-0" />
                        {d.tenant.sendCertificate}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {upcoming.length > 0 && (
            <Panel title={d.tenant.upcomingTitle}>
              <ul className="divide-y divide-sand-100">
                {upcoming.map((u, i) => {
                  const when = u.kind === "visit" ? visitWhen(u.at, locale) : null;
                  const icon: IconName = u.kind === "rent" ? "euro" : u.kind === "visit" ? "calendar" : u.kind === "edl" ? "tasks" : "contract";
                  const row = (
                    <>
                      <span className={"flex h-10 w-10 shrink-0 items-center justify-center rounded-xl " + (u.kind === "visit" ? "bg-accent-50 text-accent-700" : "bg-brand-50 text-brand-700")}>
                        <Icon name={icon} size={20} />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-ink">{when ? when.date : formatDate(u.at.slice(0, 10), locale)}</span>
                        <span className="block text-xs text-ink-soft">
                          {u.kind === "visit" && (
                            <>
                              {fmt(d.tenant.upVisit, { title: u.title })}
                              {when?.time ? ` · ${u.artisanName ? fmt(d.tenant.upVisitWith, { name: u.artisanName, time: when.time }) : fmt(d.tenant.upVisitAt, { time: when.time })}` : ""}
                            </>
                          )}
                          {u.kind === "edl" && (u.edlKind === "exit" ? d.tenant.upEdlExit : d.tenant.upEdlEntry)}
                          {u.kind === "rent" && fmt(d.tenant.upRent, { month: monthPhrase(monthName(u.at, locale), locale), amount: euros(u.amountCents, locale) })}
                          {u.kind === "lease_end" && d.tenant.upLeaseEnd}
                        </span>
                      </span>
                    </>
                  );
                  return (
                    <li key={i}>
                      {u.kind === "visit" ? (
                        <Link href={`/locataire/demandes/${u.requestId}`} className="tactile flex items-center gap-3 rounded-xl py-3 transition hover:bg-sand-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600">{row}</Link>
                      ) : (
                        <div className="flex items-center gap-3 py-3">{row}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Panel>
          )}
        </div>
      )}

      <div className="mt-5 grid grid-cols-1 items-start gap-5 sm:grid-cols-2">
        <Panel
          title={d.tenant.openRequests}
          action={
            <Link href="/locataire/demandes" className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-700 hover:underline">
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
                  <LinkRow
                    href={`/locataire/demandes/${r.id}`}
                    title={r.title}
                    sub={r.visit && r.visit.scheduledAt.slice(0, 10) >= space.today ? fmt(d.tenant.visitPlanned, { date: visitWhen(r.visit.scheduledAt, locale).date }) : `${r.ref} · ${formatDate(r.createdAt, locale)}`}
                    right={<MetaBadge meta={stateMeta[r.state]} />}
                  />
                </li>
              ))}
            </ul>
          )}
          {!ended && (
            <Link
              href="/locataire/demandes?nouvelle=1"
              className="tactile mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white transition hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              <Icon name="inbox" size={18} className="shrink-0" />
              {d.tenant.quickRequest}
            </Link>
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
                    <Link href="/locataire/messages" className="inline-flex min-h-11 items-center rounded-xl border border-sand-200 px-3.5 text-sm font-semibold text-brand-700 transition hover:border-brand-300">
                      {d.tenant.managerWrite}
                    </Link>
                    {m.phone && (
                      <a href={`tel:${m.phone.replace(/\s/g, "")}`} className="inline-flex min-h-11 items-center rounded-xl border border-sand-200 px-3.5 text-sm font-semibold text-brand-700 transition hover:border-brand-300">
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
