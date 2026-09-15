import { notFound, redirect } from "next/navigation";
import TenantWizard from "@/components/gestion/TenantWizard";
import { getDatasetId, getDemo } from "@/lib/demo";
import { getI18n } from "@/lib/i18n";

/**
 * Adding a tenant always starts from a lot, never from a picker: the owner
 * clicked "Ajouter un locataire" on something vacant, so the flow already
 * knows the property, the lot and whether it is furnished. A lot that is
 * already let sends them back to the property rather than opening a second
 * lease on it.
 */
export default async function AjouterLocatairePage({
  searchParams,
}: {
  searchParams: Promise<{ lot?: string }>;
}) {
  const { lot } = await searchParams;
  const { d } = await getI18n();
  const demo = await getDemo();
  const datasetId = await getDatasetId();

  const unit = lot ? demo.UNITS.find((u) => u.id === lot) : undefined;
  if (!unit) notFound();
  const property = demo.PROPERTIES.find((p) => p.id === unit.propertyId);
  if (!property) notFound();

  const live = demo.LEASES.find((l) => l.unitId === unit.id && (l.status === "active" || l.status === "notice"));
  if (live) redirect(`/app/biens/${property.id}?onglet=location`);

  return (
    <TenantWizard
      d={d}
      unitId={unit.id}
      unitLabel={unit.label}
      propertyId={property.id}
      propertyName={property.name}
      real={datasetId === "real"}
      notice={d.common.demoCreateNotice}
    />
  );
}
