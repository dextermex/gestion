import type { DemoData } from "./index";

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
  for (const u of demo.UNITS) {
    const p = demo.propertyById(u.propertyId);
    hits.push({
      type: "unit",
      label: `${u.label} — ${p.name}`,
      sub: p.address,
      href: `/app/biens/${p.id}`,
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
