import { notFound, redirect } from "next/navigation";
import TenantWizard, { type Person } from "@/components/gestion/TenantWizard";
import { getDatasetId, getDemo } from "@/lib/demo";
import { getI18n } from "@/lib/i18n";
import { dossierOf } from "@/lib/gestion/dossier";
import { stepAt, type RentalStep } from "@/lib/gestion/rental-flow";
import { getParamValue } from "@/domain/legal/params";

/**
 * The guided rental, entered two ways.
 *
 * `?lot=` starts one: the owner clicked "Ajouter un locataire" on something
 * vacant, so the flow already knows the property, the lot and whether it is
 * furnished, and never asks again. A dossier already in preparation on that
 * lot is resumed rather than doubled.
 *
 * `?bail=` resumes a dossier. Without `?etape=`, it opens at the first step
 * the dossier has not completed, read from the lease row the property sheet
 * reads; with it (the état des lieux hands back this way), at that step. A
 * lease that is no longer a draft has nothing left for this flow: it is
 * edited from the property.
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

  const cents = (n: number): string => (n > 0 ? (n / 100).toFixed(2).replace(".", ",") : "");

  // What the law allows for the guarantee, resolved as of today by the
  // registry: the step says it, the dossier flags what exceeds it.
  const depositMax = {
    residential: getParamValue("residential.deposit_max_months", demo.TODAY),
    commercial: getParamValue("commercial.deposit_max_months", demo.TODAY),
  };

  // ── Starting from a lot ──
  if (!bail) {
    const unit = lot ? demo.UNITS.find((u) => u.id === lot) : undefined;
    if (!unit) notFound();
    const property = demo.PROPERTIES.find((p) => p.id === unit.propertyId);
    if (!property) notFound();

    // A lot already under a live lease cannot take a second one.
    const live = demo.LEASES.find((l) => l.unitId === unit.id && (l.status === "active" || l.status === "notice"));
    if (live) redirect(`/app/biens/${property.id}?onglet=location`);

    // A dossier already in preparation here is continued, never doubled.
    const draft = demo.LEASES.filter((l) => l.unitId === unit.id && l.status === "draft").sort((a, b) => b.seq - a.seq)[0];
    if (draft) redirect(`/app/biens/locataire?bail=${draft.id}`);

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

  // ── Resuming a dossier ──
  const lease = demo.LEASES.find((l) => l.id === bail);
  if (!lease) notFound();
  const unit = demo.UNITS.find((u) => u.id === lease.unitId);
  const property = unit ? demo.PROPERTIES.find((p) => p.id === unit.propertyId) : undefined;
  if (!unit || !property) notFound();
  if (lease.status !== "draft") redirect(`/app/biens/${property.id}?onglet=location`);

  const progress = dossierOf(demo, lease);
  const startStep: RentalStep = etape ? stepAt(Number(etape)) : progress.resumeStep;

  // Everyone on the dossier comes back, in the order they were recorded.
  const tenants: Person[] = lease.tenantContactIds
    .map((id) => demo.CONTACTS.find((c) => c.id === id))
    .filter((c) => c !== undefined)
    .map((c) => {
      const parts = c.name.trim().split(/\s+/);
      return {
        contactId: c.id,
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
        completed: progress.completed,
        tenants,
        colocation: lease.colocation,
        type: lease.type,
        startDate: lease.startDate,
        endDate: lease.endDate ?? "",
        rent: cents(lease.rentCents),
        charges: cents(lease.chargesCents),
        paymentDay: String(lease.paymentDay),
        payerName: lease.dossier?.payerName ?? "",
        payerIban: demo.IBAN_BINDINGS.find((b) => b.leaseId === lease.id)?.payerIban ?? "",
        depositMonths: String(deposit && lease.rentCents > 0 ? Math.round(deposit.amountCents / lease.rentCents) : deposit ? lease.depositMonths : 0),
        depositForm: deposit?.form ?? "cash",
        hasInspection: demo.EDLS.some((e) => e.leaseId === lease.id && e.kind === "entry"),
        hasInsurance: demo.INSURANCES.some((i) => i.leaseId === lease.id),
      }}
    />
  );
}
