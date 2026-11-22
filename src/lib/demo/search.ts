import type { DemoData } from "./index";
import { isLettable } from "@/lib/gestion/portfolio";

/**
 * Serializable search corpus for the ⌘K palette, built server-side from the
 * ACTIVE dataset and handed to the client shell as a prop — the client bundle
 * never ships the demo datasets themselves.
 */

export interface SearchHit {
  type: "property" | "unit" | "tenant" | "lease" | "contact";
  label: string;
  sub: string;
  href: string;
  /** Lowercased haystack the palette filters on. */
  hay: string;
}

export function buildSearchIndex(demo: DemoData): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const p of demo.PROPERTIES) {
    hits.push({
      type: "property",
      label: p.name,
      sub: p.address,
      href: `/app/biens/${p.id}`,
      hay: `${p.name} ${p.address}`.toLowerCase(),
    });
  }
  // A property's one lettable lot is the property's own sheet (a house, a flat). Every other lot has a
  // sheet of its own: the lots of a building, and the annexes (a parking space, a cellar).
  const lettable = new Map<string, number>();
  for (const u of demo.UNITS) if (isLettable(u)) lettable.set(u.propertyId, (lettable.get(u.propertyId) ?? 0) + 1);
  for (const u of demo.UNITS) {
    const p = demo.propertyById(u.propertyId);
    hits.push({
      type: "unit",
      label: `${u.label} · ${p.name}`,
      sub: p.address,
      href: isLettable(u) && (lettable.get(u.propertyId) ?? 0) <= 1 ? `/app/biens/${p.id}` : `/app/biens/${p.id}/lots/${u.id}`,
      hay: `${u.label} ${p.name}`.toLowerCase(),
    });
  }
  for (const c of demo.CONTACTS) {
    hits.push({
      type: "contact",
      label: c.name,
      sub: c.email ?? c.phone ?? "",
      href: `/app/contacts/${c.id}`,
      hay: `${c.name} ${c.email ?? ""}`.toLowerCase(),
    });
  }
  for (const l of demo.LEASES) {
    const label = demo.leaseUnitLabel(l);
    const tenants = demo.leaseTenantNames(l).join(", ");
    hits.push({
      type: "lease",
      label,
      sub: tenants,
      href: `/app/baux/${l.id}`,
      hay: `${label} ${tenants}`.toLowerCase(),
    });
  }
  return hits;
}
