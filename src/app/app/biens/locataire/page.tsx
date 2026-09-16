import { notFound, redirect } from "next/navigation";
import TenantWizard, { type Person } from "@/components/gestion/TenantWizard";
import { getDatasetId, getDemo } from "@/lib/demo";
import { getI18n } from "@/lib/i18n";
import { stepAt, type RentalStep } from "@/lib/gestion/rental-flow";
import { getParamValue } from "@/domain/legal/params";

/**
 * The guided rental, entered two ways.
 *
 * `?lot=` starts a new one: the owner clicked "Ajouter un locataire" on
 * something vacant, so the flow already knows the property, the lot and
 * whether it is furnished, and never asks again.
 *
 * `?bail=` resumes one that exists. The inspection step hands off to the
 * état des lieux, which is a journey of its own; coming back has to land on
 * the next step of this one rather than bouncing off a "already let" guard.
 * That guard was why steps 7 and 8 were unreachable for anyone who actually
 * did the inspection. A dossier that is still a draft resumes the same way,
 * and its review step is where it becomes the tenancy in force.
 */
export default async function AjouterLocatairePage({
  searchParams,
}: {
  searchParams: Promise<{ lot?: string; bail?: string; etape?: string }>;
}) {
  const { lot, bail, etape } = await searchParams;
  const { d } = await getI18n();
  const demo = await getDemo();
  const datasetId = await getDatasetId();
  const real = datasetId === "real";

  const cents = (n: number): string => (n / 100).toFixed(2).replace(".", ",");
  const startStep: RentalStep = stepAt(Number(etape) || 1);

  // What the law allows for the guarantee, resolved as of today by the
  // registry: the step says it, the dossier flags what exceeds it.
  const depositMax = {
    residential: getParamValue("residential.deposit_max_months", demo.TODAY),
    commercial: getParamValue("commercial.deposit_max_months", demo.TODAY),
  };

  // ── Resuming an existing rental ──
  if (bail) {
    const lease = demo.LEASES.find((l) => l.id === bail);
    if (!lease) notFound();
    const unit = demo.UNITS.find((u) => u.id === lease.unitId);
    const property = unit ? demo.PROPERTIES.find((p) => p.id === unit.propertyId) : undefined;
    if (!unit || !property) notFound();

    // Everyone on the lease comes back, in the order they were recorded.
    const tenants: Person[] = lease.tenantContactIds
      .map((id) => demo.CONTACTS.find((c) => c.id === id))
      .filter((c) => c !== undefined)
      .map((c) => {
        const parts = c.name.trim().split(/\s+/);
        return {
          firstName: parts.length > 1 ? parts.slice(0, -1).join(" ") : c.name,
          lastName: parts.length > 1 ? parts[parts.length - 1] : "",
          email: c.email ?? "",
          phone: c.phone ?? "",
        };
      });
    const deposit = demo.DEPOSITS.find((x) => x.leaseId === lease.id);

    return (
      <TenantWizard
        d={d}
        unitId={unit.id}
        unitLabel={unit.label}
        propertyId={property.id}
        propertyName={property.name}
        real={real}
        notice={d.common.demoCreateNotice}
        depositMax={depositMax}
        existing={{
          leaseId: lease.id,
          status: lease.status,
          startStep,
          tenants,
          colocation: lease.colocation,
          type: lease.type,
          startDate: lease.startDate,
          endDate: lease.endDate ?? "",
          rent: cents(lease.rentCents),
          charges: cents(lease.chargesCents),
          paymentDay: String(lease.paymentDay),
          payerIban: demo.IBAN_BINDINGS.find((b) => b.leaseId === lease.id)?.payerIban ?? "",
          depositMonths: String(deposit ? Math.round(deposit.amountCents / Math.max(1, lease.rentCents)) : 0),
          depositForm: deposit?.form ?? "cash",
          hasInspection: demo.EDLS.some((e) => e.leaseId === lease.id && e.kind === "entry"),
          hasInsurance: demo.INSURANCES.some((i) => i.leaseId === lease.id),
        }}
      />
    );
  }

  // ── Starting a new one ──
  const unit = lot ? demo.UNITS.find((u) => u.id === lot) : undefined;
  if (!unit) notFound();
  const property = demo.PROPERTIES.find((p) => p.id === unit.propertyId);
  if (!property) notFound();

  // A lot already under a live lease cannot take a second one. Resuming that
  // rental is the `?bail=` path above, not this one.
  const live = demo.LEASES.find((l) => l.unitId === unit.id && (l.status === "active" || l.status === "notice"));
  if (live) redirect(`/app/biens/${property.id}?onglet=location`);

  return (
    <TenantWizard
      d={d}
      unitId={unit.id}
      unitLabel={unit.label}
      propertyId={property.id}
      propertyName={property.name}
      real={real}
      notice={d.common.demoCreateNotice}
      depositMax={depositMax}
    />
  );
}
