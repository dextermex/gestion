import type { DemoData } from "./index";

/** Demo persona of the tenant portal: the first tenant of lease l-3b in the
 *  active dataset (Jean Muller at Cabinet Reuter, Jang Weis at Majerus). */
export const TENANT_LEASE_ID = "l-3b";

export type TenantPersona = {
  lease: DemoData["LEASES"][number];
  tenant: DemoData["CONTACTS"][number];
  unit: DemoData["UNITS"][number];
  property: DemoData["PROPERTIES"][number];
  unitLabel: string;
};

/**
 * Null once the portal reads real data and the signed-in account is not a
 * tenant anywhere. The pages then show their empty state instead of guessing.
 */
export function tenantPersona(demo: DemoData): TenantPersona | null {
  const lease = demo.LEASES.find((l) => l.id === TENANT_LEASE_ID);
  if (!lease) return null;
  const tenant = demo.CONTACTS.find((c) => c.id === lease.tenantContactIds[0]);
  const unit = demo.UNITS.find((u) => u.id === lease.unitId);
  if (!tenant || !unit) return null;
  const property = demo.PROPERTIES.find((p) => p.id === unit.propertyId);
  if (!property) return null;
  return { lease, tenant, unit, property, unitLabel: demo.leaseUnitLabel(lease) };
}
