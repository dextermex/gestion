import type { DemoContact, DemoLease, DemoProperty, DemoUnit } from "./data";

/**
 * What a lookup answers for an id nothing in the dataset carries: a record
 * of the same shape with nothing in it. A screen that names a parent it
 * cannot find (a lot whose property was archived, a row whose table failed
 * to load) prints an empty cell instead of failing, and the by-id lookups
 * stay total: they never answer `undefined`.
 */

export function missingContact(id: string): DemoContact {
  return { id, kind: "natural", name: "", email: null, phone: null, language: "fr", roles: [] };
}

export function missingProperty(id: string): DemoProperty {
  return {
    id,
    name: "",
    address: "",
    commune: "",
    cadastralRef: "",
    type: "",
    constructionYear: 0,
    completionDate: "",
    energyClass: "",
    cpeIssuedOn: "",
    isCopropriete: false,
    smokeDetectorsConfirmed: false,
    ownerContactIds: [],
    ownershipNote: "",
    unitsCount: 0,
    photoUrl: null,
    photoThumbUrl: null,
  };
}

export function missingUnit(id: string): DemoUnit {
  return { id, propertyId: "", label: "", kind: "other", floor: "", areaSqm: 0, rooms: 0, furnished: false, photoUrl: null, photoThumbUrl: null };
}

/** A tenancy nothing knows: ended, with nobody on it and nothing owed. */
export function missingLease(id: string): DemoLease {
  return {
    id,
    seq: 0,
    unitId: "",
    type: "residential",
    status: "ended",
    tenantContactIds: [],
    guarantorContactIds: [],
    colocation: false,
    startDate: "",
    endDate: null,
    rentCents: 0,
    chargesCents: 0,
    chargesRegime: "advances",
    depositMonths: 0,
    depositForm: "cash",
    paymentDay: 1,
    rfReference: "",
    lastAdjustmentOn: null,
    previousRentCents: null,
    capitalComponents: [],
    vatRegime: "exempt",
  };
}
