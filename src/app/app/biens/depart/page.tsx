import { notFound, redirect } from "next/navigation";
import DepartureWizard, { type DepartureLease } from "@/components/gestion/DepartureWizard";
import { getDatasetId, getDemo } from "@/lib/demo";
import { getI18n } from "@/lib/i18n";
import { METER_UNITS, euros, formatDate } from "@/lib/types";

/**
 * Recording a departure. It opens on the step the departure already stands
 * at (or the one the URL names, which is how the exit inventory hands back),
 * with everything entered so far. A lease that has already ended sends the
 * owner to the history rather than letting them close it twice; a dossier
 * in preparation has no tenant to see off and goes back to the property.
 */
export default async function DepartPage({ searchParams }: { searchParams: Promise<{ bail?: string; etape?: string }> }) {
  const { bail, etape } = await searchParams;
  const { locale, d } = await getI18n();
  const demo = await getDemo();
  const datasetId = await getDatasetId();

  const lease = bail ? demo.LEASES.find((l) => l.id === bail) : undefined;
  if (!lease) notFound();
  const unit = demo.UNITS.find((u) => u.id === lease.unitId);
  const property = unit ? demo.PROPERTIES.find((p) => p.id === unit.propertyId) : undefined;
  if (!unit || !property) notFound();
  if (lease.status === "ended") redirect(`/app/biens/${property.id}?onglet=historique`);
  if (lease.status === "draft") redirect(`/app/biens/${property.id}?onglet=location&lot=${unit.id}`);

  // What the ledger says is still open, and what the guarantee holds. Both
  // are read, never asserted: the owner decides what to do about them.
  const periods = demo.RENT_PERIODS.filter((rp) => rp.leaseId === lease.id);
  const outstanding = periods.reduce((a, rp) => a + Math.max(0, rp.totalCents - rp.allocatedCents), 0);
  const deposit = demo.DEPOSITS.find((x) => x.leaseId === lease.id) ?? null;
  const exitEdl = demo.EDLS.some((e) => e.leaseId === lease.id && e.kind === "exit");
  const meters = demo.METERS.filter((m) => m.unitId === unit.id || (m.unitId === null && m.propertyId === property.id));

  const requested = Number(etape);
  const startStep = Number.isFinite(requested) && requested >= 1 ? Math.round(requested) : (lease.departure?.step ?? 1);

  const payload: DepartureLease = {
    id: lease.id,
    unitId: unit.id,
    tenantNames: demo.leaseTenantNames(lease).join(", "),
    unitLabel: unit.label,
    propertyId: property.id,
    propertyName: property.name,
    startDate: lease.startDate,
    monthlyLabel: euros(lease.rentCents + lease.chargesCents, locale),
    outstandingLabel: outstanding > 0 ? euros(outstanding, locale) : null,
    depositLabel: deposit ? euros(deposit.amountCents, locale) : null,
    hasExitEdl: exitEdl,
    meters: meters.map((m) => ({
      id: m.id,
      label: `${d.status.meter[m.kind]} · ${m.serial}`,
      unit: METER_UNITS[m.kind],
      last: m.lastReading ? { value: m.lastReading.value, date: formatDate(m.lastReading.date, locale) } : null,
    })),
    periods: periods.map((rp) => ({ month: `${rp.period.slice(0, 7)}-01`, allocated: rp.allocatedCents > 0 })),
    existing: lease.departure ?? null,
    startStep,
  };

  return <DepartureWizard d={d} lease={payload} real={datasetId === "real"} notice={d.common.demoCreateNotice} />;
}
