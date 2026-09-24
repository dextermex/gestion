import Link from "next/link";
import { Badge, PageHeader, EmptyState } from "@/components/pro/ui";
import { LegalNote, MetaBadge, Panel } from "@/components/gestion/bits";
import { ChargeDecompteForm, ChargePeriodActions } from "@/components/gestion/ChargeDecompte";
import { getDemo, isSampleData } from "@/lib/demo";
import { chargePeriodStatusMeta, euros, formatDate, formatMonth } from "@/lib/types";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";

/**
 * Charges: the décomptes as rows. A period per tenancy and year, its lines
 * computed once through the recharge engine (a residential hard block stays
 * visible and reaches the tenant as zero), the advances the ledger billed,
 * the balance that follows. The sample cabinet's is the syndic statement
 * mapped to Apt 3B; a real account enters its own and issues it from here.
 */
export default async function ChargesPage({ searchParams }: { searchParams: Promise<{ periode?: string }> }) {
  const { locale, d } = await getI18n();
  const { CHARGE_PERIODS, ENDED_LEASES, LEASES, ORG, RENT_PERIODS, TODAY, leaseTenantNames, leaseUnitLabel } = await getDemo();
  const { periode } = await searchParams;
  const sample = await isSampleData();
  const writable = !sample;
  const sampleNote = sample ? fmt(d.shell.sampleBanner, { cabinet: ORG.shortName }) : null;

  if (LEASES.length === 0 && CHARGE_PERIODS.length === 0)
    return (
      <div>
        <EmptyState title={fmt(d.common.emptyTitle, { section: d.hubs.statements })} body={d.common.emptyBody} />
      </div>
    );

  // Blocked categories are stable engine codes — labels come from the dict.
  const blockLabel: Record<string, string> = {
    management_fee: d.charges.blockManagement,
    building_insurance: d.charges.blockInsurance,
    impot_foncier: d.charges.blockTax,
    energy_passport: d.charges.blockCpe,
    meter_rental: d.charges.blockMeter,
    major_repair: d.charges.blockMajor,
    vetuste_renewal: d.charges.blockVetuste,
  };
  const categoryLabel = d.status.chargeCategory as Record<string, string>;
  const periodMeta = chargePeriodStatusMeta(d);

  // Lease facts for a period, whether its lease is still live or ended.
  const leaseFacts = (leaseId: string): { label: string; tenant: string } => {
    const live = LEASES.find((l) => l.id === leaseId);
    if (live) return { label: leaseUnitLabel(live), tenant: leaseTenantNames(live).join(", ") };
    const ended = ENDED_LEASES.find((e) => e.id === leaseId);
    return { label: ended?.label ?? "", tenant: ended?.tenant ?? "" };
  };

  const periods = [...CHARGE_PERIODS].sort((a, b) => b.year - a.year || (a.leaseId < b.leaseId ? -1 : 1));
  const selected = periods.find((p) => p.id === periode) ?? periods.find((p) => p.status === "issued") ?? periods[0] ?? null;
  const selectedFacts = selected ? leaseFacts(selected.leaseId) : null;
  const syndicLine = selected?.lines.find((l) => l.source === "syndic_decompte" && l.tantiemes !== null && l.tantiemesTotal !== null) ?? null;
  const blockedCents = selected ? selected.lines.filter((l) => l.blocked).reduce((a, l) => a + l.lotShareCents, 0) : 0;
  const balance = selected ? selected.actualCents - selected.advancesBilledCents : 0;

  const liveLeases = LEASES.filter((l) => l.status === "active" || l.status === "notice").map((l) => ({
    id: l.id,
    label: `${leaseUnitLabel(l)} · ${leaseTenantNames(l).join(", ")}`,
  }));
  const categories = Object.keys(categoryLabel).map((value) => ({ value, label: categoryLabel[value] }));
  const chargeLabels = { ...d.charges, close: d.common.close };

  const month = TODAY.slice(0, 7);
  const chargeRegimes = RENT_PERIODS.filter((rp) => rp.period === month);

  return (
    <div>
      <PageHeader title={d.charges.title} subtitle={d.charges.subtitle} />

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-5">
        <div className="space-y-5 lg:col-span-3">
          {selected && selectedFacts ? (
          <Panel title={fmt(d.charges.decompteTitle, { year: selected.year, unit: selectedFacts.label })}>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <MetaBadge meta={periodMeta[selected.status]} />
              {selected.issuedOn && (
                <span className="text-xs text-ink-soft">
                  {fmt(d.charges.issued, { date: formatDate(selected.issuedOn, locale), due: formatDate(selected.dueOn ?? null, locale) })}
                </span>
              )}
            </div>
            <p className="mb-3 text-xs text-ink-soft">
              {syndicLine
                ? fmt(d.charges.decompteMeta, { t: syndicLine.tantiemes ?? 0, tt: syndicLine.tantiemesTotal ?? 0, tenant: selectedFacts.tenant })
                : fmt(d.charges.decompteMetaPlain, { tenant: selectedFacts.tenant })}
            </p>
            <div className="table-scroll">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-sand-100 bg-sand-50/60 text-left text-[11px] uppercase tracking-wide text-ink-soft">
                    <th className="px-3 py-2.5 font-semibold">{d.charges.colItem}</th>
                    <th className="px-3 py-2.5 text-right font-semibold">{d.charges.colBuilding}</th>
                    <th className="px-3 py-2.5 text-right font-semibold">{d.charges.colLotShare}</th>
                    <th className="px-3 py-2.5 text-right font-semibold">{d.charges.colRecoverable}</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.lines.map((line) => (
                    <tr key={line.id} className="border-b border-sand-50 last:border-0">
                      <td className="px-3 py-2.5">
                        <p className={line.blocked ? "text-ink-soft line-through decoration-red-300" : "text-ink"}>
                          {line.label}
                        </p>
                        {line.blocked && (
                          <p className="text-[11px] text-red-700">
                            {blockLabel[line.category] ?? categoryLabel[line.category] ?? line.category} — {d.charges.blockNever}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-soft">
                        {line.buildingTotalCents !== null ? euros(line.buildingTotalCents, locale) : d.common.none}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-soft">{euros(line.lotShareCents, locale)}</td>
                      <td
                        className={
                          "px-3 py-2.5 text-right tabular-nums " +
                          (line.blocked ? "text-red-700" : "font-semibold text-ink")
                        }
                      >
                        {line.blocked ? euros(0, locale) : euros(line.tenantShareCents, locale)}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-sand-50/60">
                    <td className="px-3 py-2.5 font-bold text-ink">{d.charges.totalRecoverable}</td>
                    <td className="px-3 py-2.5" />
                    <td className="px-3 py-2.5 text-right tabular-nums text-red-700">
                      {fmt(d.charges.blocked, { amount: euros(blockedCents, locale) })}
                    </td>
                    <td className="px-3 py-2.5 text-right font-display font-bold tabular-nums text-ink">
                      {euros(selected.actualCents, locale)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-sand-50 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{fmt(d.charges.advances, { year: selected.year })}</p>
                <p className="mt-0.5 font-display text-lg font-bold tabular-nums text-ink">
                  {euros(selected.advancesBilledCents, locale)}
                </p>
              </div>
              <div className="rounded-xl bg-sand-50 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{d.charges.actual}</p>
                <p className="mt-0.5 font-display text-lg font-bold tabular-nums text-ink">
                  {euros(selected.actualCents, locale)}
                </p>
              </div>
              <div className={"rounded-xl p-3 " + (balance > 0 ? "bg-amber-50" : "bg-emerald-50")}>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                  {balance > 0 ? d.charges.balanceDue : d.charges.balanceRefund}
                </p>
                <p
                  className={
                    "mt-0.5 font-display text-lg font-bold tabular-nums " +
                    (balance > 0 ? "text-amber-800" : "text-emerald-700")
                  }
                >
                  {euros(Math.abs(balance), locale)}
                </p>
              </div>
            </div>
            <LegalNote>{d.charges.decompteLegal}</LegalNote>
          </Panel>
          ) : null}

          <Panel title={d.charges.periodsTitle}>
            <div className="mb-3">
              <ChargeDecompteForm
                leases={liveLeases}
                categories={categories}
                defaultYear={Number(TODAY.slice(0, 4)) - 1}
                writable={writable}
                sampleNote={sampleNote}
                labels={chargeLabels}
              />
            </div>
            {periods.length === 0 ? (
              <p className="text-sm text-ink-soft">{d.charges.noneYet}</p>
            ) : (
              <ul className="divide-y divide-sand-100">
                {periods.map((p) => {
                  const facts = leaseFacts(p.leaseId);
                  const due = p.actualCents - p.advancesBilledCents;
                  return (
                    <li key={p.id} className="py-3" data-charge-period={p.id}>
                      <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <Link
                            href={`/app/charges?periode=${encodeURIComponent(p.id)}`}
                            className="block truncate text-sm font-semibold text-ink hover:text-brand-700 max-sm:leading-10"
                          >
                            {fmt(d.charges.decompteTitle, { year: p.year, unit: facts.label })}
                          </Link>
                          <p className="truncate text-xs text-ink-soft">
                            {facts.tenant}
                            {p.issuedOn ? ` · ${formatDate(p.issuedOn, locale)}` : ""}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-3">
                          <span className={"tabular-nums text-sm font-semibold " + (due > 0 ? "text-amber-800" : "text-emerald-700")}>
                            {euros(Math.abs(due), locale)}
                          </span>
                          <MetaBadge meta={periodMeta[p.status]} />
                        </div>
                      </div>
                      {p.status === "draft" && (
                        <div className="mt-2">
                          <ChargePeriodActions periodId={p.id} locale={locale} writable={writable} labels={chargeLabels} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>

        <div className="flex flex-col gap-5 lg:col-span-2">
          <Panel title={d.charges.blocksTitle}>
            <ul className="space-y-2 text-sm">
              {[
                d.charges.blockManagement,
                d.charges.blockInsurance,
                d.charges.blockTax,
                d.charges.blockCpe,
                d.charges.blockMeter,
                d.charges.blockMajor,
                d.charges.blockVetuste,
              ].map((label) => (
                <li key={label} className="flex items-center justify-between gap-3 rounded-lg bg-red-50/70 px-3 py-2">
                  <span className="text-ink">{label}</span>
                  <Badge className="bg-red-100 text-red-700">{d.charges.blockNever}</Badge>
                </li>
              ))}
            </ul>
            <LegalNote>{d.charges.blocksLegal}</LegalNote>
          </Panel>

          <Panel title={fmt(d.charges.regimesTitle, { month: formatMonth(month, locale) })}>
            <ul className="divide-y divide-sand-100 text-sm">
              {chargeRegimes.map((rp) => {
                const l = LEASES.find((x) => x.id === rp.leaseId);
                if (!l) return null;
                return (
                  <li key={rp.id} className="flex items-center gap-3 py-2.5">
                    <p className="min-w-0 flex-1 truncate text-ink">{leaseUnitLabel(l)}</p>
                    <span className="tabular-nums text-ink-soft">
                      {euros(l.chargesCents, locale)}
                      {d.common.perMonth}
                    </span>
                    <Badge
                      className={
                        l.chargesRegime === "advances" ? "bg-sky-100 text-sky-800" : "bg-sand-100 text-ink-soft"
                      }
                    >
                      {l.chargesRegime === "advances" ? d.charges.regimeAdvances : d.charges.regimeForfait}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
