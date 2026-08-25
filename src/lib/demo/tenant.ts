import type { DemoData } from "./index";

/** Demo persona of the tenant portal: the first tenant of lease l-3b in the
 *  active dataset (Jean Muller at Cabinet Reuter, Jang Weis at Majerus). */
export const TENANT_LEASE_ID = "l-3b";

export function tenantPersona(demo: DemoData) {
  const lease = demo.leaseById(TENANT_LEASE_ID);
  const tenant = demo.contactById(lease.tenantContactIds[0]);
  const unit = demo.unitById(lease.unitId);
  const property = demo.propertyById(unit.propertyId);
  return { lease, tenant, unit, property, unitLabel: demo.leaseUnitLabel(lease) };
}
