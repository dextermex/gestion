import type { DemoData } from "@/lib/demo";
import { isLettable } from "@/lib/gestion/portfolio";

/**
 * What the quick "Bail" sheet offers.
 *
 * A lease attaches to a lot that can be let and has no lease in force, and
 * to a person recorded as a tenant. Anything else is not on the list: an
 * occupied flat, a parking space or a cellar (part of a home, never let on
 * its own here), a plumber, a syndic. The guided rental on a vacant lot
 * creates its tenant itself; this sheet only joins what already exists.
 */
export interface QuickOption {
  id: string;
  label: string;
}

export function quickLeaseOptions(demo: Pick<DemoData, "UNITS" | "LEASES" | "CONTACTS" | "PROPERTIES">): {
  units: QuickOption[];
  tenants: QuickOption[];
} {
  const let_ = new Set(demo.LEASES.filter((l) => l.status === "active" || l.status === "notice").map((l) => l.unitId));
  const propertyName = new Map(demo.PROPERTIES.map((p) => [p.id, p.name]));
  return {
    units: demo.UNITS.filter((u) => isLettable(u) && !let_.has(u.id)).map((u) => ({
      id: u.id,
      // A lot whose property is not on screen (archived) still reads by its own label.
      label: [u.label, propertyName.get(u.propertyId)].filter(Boolean).join(" · "),
    })),
    tenants: demo.CONTACTS.filter((c) => c.roles.includes("tenant")).map((c) => ({ id: c.id, label: c.name })),
  };
}
