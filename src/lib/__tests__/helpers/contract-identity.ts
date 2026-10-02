import type { FakeDb } from "./fake-postgrest";

/**
 * The facts a residential contract names, filled in on the fake base the
 * way the screens fill them: the lessor in the settings (a person or a
 * company), each tenant on their contact, the dwelling on its property.
 */

/** The settings columns of a lessor who is a person. */
export const LESSOR_PERSON = {
  lessor_kind: "natural",
  lessor_civility: "f",
  lessor_birth_date: "1975-04-12",
  lessor_birth_place: "Esch-sur-Alzette",
  lessor_nationality: "luxembourgeoise",
};

/** The settings columns of a lessor that is a company. */
export const LESSOR_COMPANY = {
  lessor_kind: "legal",
  lessor_legal_form: "sarl",
  lessor_rcs_number: "B123456",
  signatory_role: "gérant",
};

/** A tenant who is a person, as their contact reads once completed. */
export const TENANT_PERSON = {
  civility: "f",
  birth_date: "1990-05-03",
  birth_place: "Luxembourg",
  nationality: "luxembourgeoise",
  address: { street: "Avenue de la Liberté", number: "8", postal_code: "1930", city: "Luxembourg", country: "LU" },
};

/** The dwelling's facts the contract declares: its parcel, its energy certificate, its smoke detectors. */
export const DWELLING_FACTS = {
  cadastral_commune: "Strassen",
  cadastral_section: "A",
  cadastral_number: "123/4567",
  energy_class: "C",
  smoke_detectors_confirmed: true,
};

/** Completes the tenants and the dwelling of one lease, in place. */
export function completeContractFacts(db: FakeDb, leaseId: string): void {
  const lease = db.table("leases").find((l) => l.id === leaseId);
  const unit = db.table("units").find((u) => u.id === lease?.unit_id);
  const property = db.table("properties").find((p) => p.id === unit?.property_id);
  if (!lease || !unit || !property) throw new Error(`no lease ${leaseId}`);
  Object.assign(property, DWELLING_FACTS);
  for (const party of db.table("lease_parties").filter((p) => p.lease_id === leaseId && p.role === "tenant")) {
    const contact = db.table("contacts").find((c) => c.id === party.contact_id);
    if (contact) Object.assign(contact, TENANT_PERSON);
  }
}
