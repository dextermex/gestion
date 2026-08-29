import { Badge, PageHeader, EmptyState } from "@/components/pro/ui";
import HubTabs from "@/components/gestion/HubTabs";
import { LegalNote, Panel } from "@/components/gestion/bits";
import { getDemo } from "@/lib/demo";
import { euros } from "@/lib/types";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";
import { mapSyndicDecompte } from "@/domain/charges/recharge";

export default async function ChargesPage() {
  const { locale, d } = await getI18n();
  const { LEASE_TANTIEMES, RENT_PERIODS, SYNDIC_DECOMPTE_2025, leaseById, leaseTenantNames, leaseUnitLabel } = await getDemo();

  // The décompte walk-through recharges the sample syndic statement; a
  // real account without an imported décompte sees its empty state.
  if (RENT_PERIODS.length === 0 || SYNDIC_DECOMPTE_2025.lines.length === 0)
    return (
      <div>
        <HubTabs d={d} hub="argent" active="/app/charges" />
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

  // Map the AG-approved syndic décompte through the recharge engine for Apt 3B.
  const showcaseLeaseId = "l-3b";
  const tantiemes = LEASE_TANTIEMES[showcaseLeaseId];
  const mapped = mapSyndicDecompte(
    SYNDIC_DECOMPTE_2025.lines.map((l) => ({
      label: l.label,
      category: l.category,
      totalBuilding: l.totalBuilding,
      tantiemes,
      tantiemesTotal: SYNDIC_DECOMPTE_2025.tantiemesTotal,
    })),
    "residential",
  );
  const lease = leaseById(showcaseLeaseId);
  const advances2025 = lease.chargesCents * 12;
  const balance = mapped.totalRecoverable - advances2025;

  const chargeRegimes = RENT_PERIODS.filter((rp) => rp.period === "2026-08");

  return (
    <div>
      <HubTabs d={d} hub="argent" active="/app/charges" />
      <PageHeader title={d.charges.title} subtitle={d.charges.subtitle} />

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Panel title={fmt(d.charges.decompteTitle, { unit: leaseUnitLabel(lease) })}>
            <p className="mb-3 text-xs text-ink-soft">
              {fmt(d.charges.decompteMeta, {
                t: tantiemes,
                tt: SYNDIC_DECOMPTE_2025.tantiemesTotal,
                tenant: leaseTenantNames(lease).join(", "),
              })}
            </p>
            <div className="overflow-x-auto">
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
                  {mapped.lines.map((line) => (
                    <tr key={line.label} className="border-b border-sand-50 last:border-0">
                      <td className="px-3 py-2.5">
                        <p className={line.blocked ? "text-ink-soft line-through decoration-red-300" : "text-ink"}>
                          {line.label}
                        </p>
                        {line.blocked && (
                          <p className="text-[11px] text-red-700">
                            {blockLabel[line.category] ?? line.category} — {d.charges.blockNever}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-soft">
                        {euros(SYNDIC_DECOMPTE_2025.lines.find((l) => l.label === line.label)!.totalBuilding, locale)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-soft">{euros(line.lotShare, locale)}</td>
                      <td
                        className={
                          "px-3 py-2.5 text-right tabular-nums " +
                          (line.blocked ? "text-red-700" : "font-semibold text-ink")
                        }
                      >
                        {line.blocked ? euros(0, locale) : euros(line.tenantRecoverable, locale)}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-sand-50/60">
                    <td className="px-3 py-2.5 font-bold text-ink">{d.charges.totalRecoverable}</td>
                    <td className="px-3 py-2.5" />
                    <td className="px-3 py-2.5 text-right tabular-nums text-red-700">
                      {fmt(d.charges.blocked, { amount: euros(mapped.totalBlocked, locale) })}
                    </td>
                    <td className="px-3 py-2.5 text-right font-display font-bold tabular-nums text-ink">
                      {euros(mapped.totalRecoverable, locale)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-sand-50 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{d.charges.advances}</p>
                <p className="mt-0.5 font-display text-lg font-bold tabular-nums text-ink">
                  {euros(advances2025, locale)}
                </p>
              </div>
              <div className="rounded-xl bg-sand-50 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{d.charges.actual}</p>
                <p className="mt-0.5 font-display text-lg font-bold tabular-nums text-ink">
                  {euros(mapped.totalRecoverable, locale)}
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

          <Panel title={d.charges.regimesTitle}>
            <ul className="divide-y divide-sand-100 text-sm">
              {chargeRegimes.map((rp) => {
                const l = leaseById(rp.leaseId);
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
