import { Badge, Card } from "@/components/pro/ui";
import { MetaBadge, Panel } from "@/components/gestion/bits";
import TenantEmpty from "@/components/gestion/TenantEmpty";
import { getI18n } from "@/lib/i18n";
import { fmt, ordinalDay } from "@/lib/i18n/config";
import { getTenantView } from "@/lib/portal/space";
import { depositStatusMeta, edlStatusMeta, euros, formatDate, leaseTypeMeta } from "@/lib/types";

/**
 * "Mon bail": the dossier the owner keeps, read as the tenant may read it.
 * Same lease row, same guarantee, same inventories, same insurance, same
 * documents; nothing copied, nothing summarised by hand.
 */
export default async function TenantLeasePage() {
  const { locale, d } = await getI18n();
  const view = await getTenantView();
  if (view.kind === "signed_out") return null;
  const { space } = view;
  const lease = space.current ?? space.past[0];
  if (!lease) return <TenantEmpty d={d} manage={view.canManage} />;
  const ended = space.current === null;
  const typeMeta = leaseTypeMeta(d);
  const depMeta = depositStatusMeta(d) as Record<string, { label: string; color: string }>;
  const edlMeta = edlStatusMeta(d) as Record<string, { label: string; color: string }>;
  const depositForms = d.status.depositForm as Record<string, string>;

  const rows: Array<[string, React.ReactNode]> = [
    [d.tenant.leaseTenants, lease.parties.map((p) => p.name).join(", ")],
    [d.tenant.leaseType, <MetaBadge key="t" meta={typeMeta[lease.type]} />],
    [d.tenant.leaseStart, formatDate(lease.startDate, locale)],
    [d.tenant.leaseEnd, lease.endDate ? formatDate(lease.endDate, locale) : d.tenant.leaseEndOpen],
    [d.tenant.leaseRent, euros(lease.rentCents, locale)],
    [d.tenant.leaseCharges, euros(lease.chargesCents, locale)],
    [d.tenant.leaseTotal, <span key="tot" className="font-display text-base font-bold">{euros(lease.rentCents + lease.chargesCents, locale)}</span>],
    [d.tenant.leaseRegime, lease.chargesRegime === "forfait" ? d.tenant.regimeForfait : d.tenant.regimeAdvances],
    [d.tenant.leaseDueDay, fmt(d.tenant.leaseDueDayValue, { n: ordinalDay(locale, lease.paymentDay) })],
    [d.tenant.leaseFurnished, lease.furnished ? d.common.yes : d.common.no],
  ];
  if (lease.colocation) rows.push([d.tenant.leaseColoc, d.common.yes]);
  if (lease.rfReference) {
    rows.push([
      d.tenant.leaseRef,
      <code key="rf" className="rounded-md bg-sand-50 px-2 py-1 text-[11px] font-semibold tabular-nums text-brand-800">
        {lease.rfReference}
      </code>,
    ]);
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink">{d.tenant.leaseTitle}</h1>
        <p className="mt-1 text-sm text-ink-soft">{`${lease.unit.label} · ${lease.property.name}`}</p>
        {ended && <Badge className="mt-2">{d.tenant.currentEnded}</Badge>}
      </div>

      <Card className="p-5">
        <dl className="divide-y divide-sand-100">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-4 py-2.5">
              <dt className="text-sm text-ink-soft">{label}</dt>
              <dd className="text-right text-sm font-semibold text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Panel title={d.tenant.depositTitle}>
          {lease.deposit ? (
            <dl className="divide-y divide-sand-100">
              <div className="flex items-center justify-between gap-4 py-2">
                <dt className="text-sm text-ink-soft">{d.tenant.depositAmount}</dt>
                <dd className="text-sm font-semibold tabular-nums text-ink">{euros(lease.deposit.amountCents, locale)}</dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-2">
                <dt className="text-sm text-ink-soft">{d.tenant.depositForm}</dt>
                <dd className="text-sm font-semibold text-ink">{depositForms[lease.deposit.form] ?? lease.deposit.form}</dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-2">
                <dt className="text-sm text-ink-soft">{d.tenant.depositStatus}</dt>
                <dd>{depMeta[lease.deposit.status] ? <MetaBadge meta={depMeta[lease.deposit.status]} /> : <Badge>{lease.deposit.status}</Badge>}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-ink-soft">{d.tenant.depositNone}</p>
          )}
        </Panel>

        <Panel title={d.tenant.indexationTitle}>
          {lease.lastAdjustmentOn ? (
            <>
              <p className="text-sm text-ink">{fmt(d.tenant.indexLast, { date: formatDate(lease.lastAdjustmentOn, locale) })}</p>
              {lease.previousRentCents !== null && <p className="mt-1 text-sm text-ink-soft">{fmt(d.tenant.indexPrevious, { amount: euros(lease.previousRentCents, locale) })}</p>}
            </>
          ) : (
            <p className="text-sm text-ink">{d.tenant.indexNever}</p>
          )}
          <p className="mt-3 text-xs leading-relaxed text-ink-soft">{d.tenant.indexHint}</p>
        </Panel>

        <Panel title={d.tenant.edlTitle}>
          {lease.edls.length === 0 ? (
            <p className="text-sm text-ink-soft">{d.tenant.edlNone}</p>
          ) : (
            <ul className="divide-y divide-sand-100">
              {lease.edls.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 py-2">
                  <div>
                    <p className="text-sm font-semibold text-ink">{e.kind === "exit" ? d.tenant.edlExit : d.tenant.edlEntry}</p>
                    {(e.completedAt ?? e.scheduledAt) && <p className="text-xs text-ink-soft">{fmt(d.tenant.edlOn, { date: formatDate(e.completedAt ?? e.scheduledAt, locale) })}</p>}
                  </div>
                  {edlMeta[e.status] ? <MetaBadge meta={edlMeta[e.status]} /> : <Badge>{e.status}</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={d.tenant.insuranceTitle}>
          {lease.insurances.length === 0 ? (
            <p className="text-sm text-ink-soft">{d.tenant.insuranceNone}</p>
          ) : (
            <ul className="divide-y divide-sand-100">
              {lease.insurances.map((i) => (
                <li key={i.id} className="py-2">
                  <p className="text-sm font-semibold text-ink">{i.provider}</p>
                  <p className="text-xs text-ink-soft">
                    {i.policyNumber && fmt(d.tenant.insurancePolicy, { number: i.policyNumber })}
                    {i.policyNumber && i.expiresOn && " · "}
                    {i.expiresOn && fmt(d.tenant.insuranceExpires, { date: formatDate(i.expiresOn, locale) })}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title={d.tenant.propertyTitle}>
        <p className="text-sm font-semibold text-ink">{lease.property.name}</p>
        <p className="text-sm text-ink-soft">{lease.property.address}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {lease.property.energyClass && <Badge>{fmt(d.tenant.energyClass, { c: lease.property.energyClass })}</Badge>}
          {lease.property.syndicName && <Badge>{fmt(d.tenant.syndic, { name: lease.property.syndicName })}</Badge>}
          {lease.property.smokeDetectorsConfirmed && <Badge className="bg-emerald-100 text-emerald-800">{d.tenant.smokeDetectors}</Badge>}
        </div>
      </Panel>

      <Panel title={d.tenant.docsTitle}>
        {lease.documents.length === 0 ? (
          <p className="text-sm text-ink-soft">{d.tenant.docsNone}</p>
        ) : (
          <ul className="divide-y divide-sand-100">
            {lease.documents.map((doc) => (
              <li key={doc.id} className="flex items-center gap-3 py-2.5">
                <svg className="h-4 w-4 shrink-0 text-ink-soft" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14 3v5h5M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
                </svg>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">{doc.name}</p>
                  <p className="text-xs text-ink-soft">{formatDate(doc.createdAt, locale)}</p>
                </div>
                {doc.url && (
                  <a href={doc.url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-brand-700 hover:underline">
                    {d.tenant.docOpen}
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
