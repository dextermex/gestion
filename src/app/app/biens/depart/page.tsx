import { notFound, redirect } from "next/navigation";
import DepartureWizard, { type DepartureLease } from "@/components/gestion/DepartureWizard";
import { getDatasetId, getDemo } from "@/lib/demo";
import { getI18n } from "@/lib/i18n";
import { euros } from "@/lib/types";

/**
 * Recording a departure. A lease that has already ended sends the owner to
 * the history rather than letting them close it twice.
 */
export default async function DepartPage({ searchParams }: { searchParams: Promise<{ bail?: string }> }) {
  const { bail } = await searchParams;
  const { locale, d } = await getI18n();
  const demo = await getDemo();
  const datasetId = await getDatasetId();

  const lease = bail ? demo.LEASES.find((l) => l.id === bail) : undefined;
  if (!lease) notFound();
  const unit = demo.UNITS.find((u) => u.id === lease.unitId);
  const property = unit ? demo.PROPERTIES.find((p) => p.id === unit.propertyId) : undefined;
  if (!unit || !property) notFound();
  if (lease.status === "ended") redirect(`/app/biens/${property.id}?onglet=historique`);

  // What the ledger says is still open, and what the guarantee holds. Both
  // are read, never asserted: the owner decides what to do about them.
  const outstanding = demo.RENT_PERIODS.filter((rp) => rp.leaseId === lease.id).reduce(
    (a, rp) => a + Math.max(0, rp.totalCents - rp.allocatedCents),
    0,
  );
  const deposit = demo.DEPOSITS.find((x) => x.leaseId === lease.id) ?? null;
  const exitEdl = demo.EDLS.some((e) => e.leaseId === lease.id && e.kind === "exit");

  const payload: DepartureLease = {
    id: lease.id,
    tenantNames: demo.leaseTenantNames(lease).join(", "),
    unitLabel: unit.label,
    propertyId: property.id,
    propertyName: property.name,
    startDate: lease.startDate,
    monthlyLabel: euros(lease.rentCents + lease.chargesCents, locale),
    outstandingLabel: outstanding > 0 ? euros(outstanding, locale) : null,
    depositLabel: deposit ? euros(deposit.amountCents, locale) : null,
    hasExitEdl: exitEdl,
  };

  return (
    <DepartureWizard d={d} lease={payload} real={datasetId === "real"} notice={d.common.demoCreateNotice} />
  );
}
