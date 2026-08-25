/**
 * The real-account dataset: same shape as the demo, every collection empty.
 *
 * This is how the eighteen pages become data-driven without being rewritten.
 * They all read through `getDemo()`, so pointing that at this module makes
 * every screen fall back to its own empty state — no page-level change, no
 * fictitious figure, and no risk of a half-demo half-real screen.
 *
 * As each domain is connected to Supabase, its collection stops being `[]`
 * here and starts being the rows the signed-in user is allowed to read. The
 * pages still need no change: they were always reading through this seam.
 */

import type { DemoData } from "./index";
import * as reference from "./data";

export type Org = typeof reference.ORG;

/** The signed-in user's workspace, in the shape the pages already expect. */
export function orgFromWorkspace(input: {
  id: string;
  name: string;
  kind: string;
}): Org {
  return {
    id: input.id,
    name: input.name,
    shortName: input.name,
    // Identity comes from the session, never from a dataset: the shell is
    // passed the real name and e-mail separately.
    managerName: "",
    managerEmail: "",
    billInbox: "",
    kind: input.kind,
    autorisationNumber: "",
    autorisationExpiry: "",
    piInsuranceProvider: "",
    piInsuranceExpiry: "",
    vatNumber: "",
  };
}

/** Today, in the ISO form the engines expect. */
function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export function buildEmptyData(org: Org): DemoData {
  const CONTACTS: DemoData["CONTACTS"] = [];
  const PROPERTIES: DemoData["PROPERTIES"] = [];
  const UNITS: DemoData["UNITS"] = [];
  const LEASES: DemoData["LEASES"] = [];

  return {
    TODAY: isoToday(),
    ORG: org,
    CONTACTS,
    PROPERTIES,
    UNITS,
    LEASES,
    RENT_PERIODS: [],
    BANK_ACCOUNTS: [],
    IBAN_BINDINGS: [],
    BANK_TXS: [],
    DEPOSITS: [],
    ENDED_LEASES: [],
    EDLS: [],
    TICKETS: [],
    METERS: [],
    WORKFLOWS: [],
    CONVERSATIONS: [],
    LAMBERT_PORTFOLIO: [],
    SCI_BEAULIEU_PORTFOLIO: [],
    SYNDIC_DECOMPTE_2025: {
      propertyId: "",
      year: new Date().getFullYear(),
      agApproved: false,
      tantiemesTotal: 0,
      lines: [],
    },
    LEASE_TANTIEMES: {},
    DOCUMENTS: [],

    // The dataset's lookup helpers, closed over the empty collections above.
    // A page can only obtain an id from a collection, so with nothing to
    // iterate these are unreachable; the dynamic routes guard with notFound()
    // before touching them, which is what a tampered URL hits.
    contactById: (id: string) => CONTACTS.find((c) => c.id === id)!,
    propertyById: (id: string) => PROPERTIES.find((p) => p.id === id)!,
    unitById: (id: string) => UNITS.find((u) => u.id === id)!,
    leaseById: (id: string) => LEASES.find((l) => l.id === id)!,
    leaseTenantNames: () => [],
    leaseUnitLabel: () => "",
    openInvoicesForMatching: () => [],
  } satisfies DemoData;
}
