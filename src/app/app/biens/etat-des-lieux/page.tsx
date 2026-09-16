import { notFound } from "next/navigation";
import EdlWizard, { type MeterOption } from "@/components/gestion/EdlWizard";
import { getDatasetId, getDemo } from "@/lib/demo";
import { getI18n } from "@/lib/i18n";
import { METER_UNITS } from "@/lib/types";

/**
 * An inspection always belongs to a tenancy, so it opens from one. The rooms
 * are suggested from what the lot actually has — a studio is not offered four
 * bedrooms — and the meters offered are the ones attached to that lot or its
 * building, so the walk-through records them once and for all.
 */
export default async function EtatDesLieuxPage({
  searchParams,
}: {
  searchParams: Promise<{ bail?: string; type?: string }>;
}) {
  const { bail, type } = await searchParams;
  const { d } = await getI18n();
  const demo = await getDemo();
  const datasetId = await getDatasetId();

  const lease = bail ? demo.LEASES.find((l) => l.id === bail) : undefined;
  if (!lease) notFound();
  const unit = demo.UNITS.find((u) => u.id === lease.unitId);
  if (!unit) notFound();
  const property = demo.PROPERTIES.find((p) => p.id === unit.propertyId);
  if (!property) notFound();

  const meters: MeterOption[] = demo.METERS.filter((m) => m.unitId === unit.id || m.propertyId === property.id).map(
    (m) => ({ id: m.id, label: `${d.status.meter[m.kind]} · ${m.serial}`, unit: METER_UNITS[m.kind] }),
  );

  // Rooms an inspector would expect to walk, scaled to the home in front of
  // them rather than to a generic template.
  const bedrooms = unit.bedrooms ?? Math.max(0, unit.rooms - 1);
  const rooms = [
    d.edlWizard.roomEntrance,
    d.edlWizard.roomLiving,
    d.edlWizard.roomKitchen,
    ...Array.from({ length: Math.min(bedrooms, 6) }, (_, i) => `${d.edlWizard.roomBedroom} ${i + 1}`),
    d.edlWizard.roomBathroom,
  ];

  return (
    <EdlWizard
      d={d}
      leaseId={lease.id}
      kind={type === "exit" ? "exit" : "entry"}
      unitLabel={unit.label}
      propertyId={property.id}
      propertyName={property.name}
      meters={meters}
      suggestedRooms={rooms}
      real={datasetId === "real"}
      notice={d.common.demoCreateNotice}
    />
  );
}
