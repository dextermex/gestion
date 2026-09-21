import type { DemoData } from "./index";
import { paymentsOf, type TenantLease, type TenantSpace } from "@/lib/portal/tenant-space";
import { requestKindOf, requestState } from "@/lib/portal/types";

/**
 * The sample cabinets' tenant: the first tenant of lease l-3b (Jean Muller
 * at Cabinet Reuter, Jang Weis at Majerus), whose space is assembled from
 * the same sample rows the owner's screens show. Nothing here is ever read
 * on a real account: `getTenantView()` only reaches for it when a sample
 * dataset is on screen.
 */
export const TENANT_LEASE_ID = "l-3b";

function leaseOf(demo: DemoData, id: string): TenantLease | null {
  const lease = demo.LEASES.find((l) => l.id === id);
  if (!lease) return null;
  const unit = demo.UNITS.find((u) => u.id === lease.unitId);
  if (!unit) return null;
  const property = demo.PROPERTIES.find((p) => p.id === unit.propertyId);
  if (!property) return null;
  const deposit = demo.DEPOSITS.find((x) => x.leaseId === lease.id) ?? null;
  const me = lease.tenantContactIds[0];
  return {
    id: lease.id,
    orgId: demo.ORG.id,
    unitId: unit.id,
    propertyId: property.id,
    status: lease.status,
    type: lease.type,
    startDate: lease.startDate,
    endDate: lease.endDate,
    rentCents: lease.rentCents,
    chargesCents: lease.chargesCents,
    chargesRegime: lease.chargesRegime,
    paymentDay: lease.paymentDay,
    rfReference: lease.rfReference,
    furnished: unit.furnished,
    colocation: lease.colocation,
    lastAdjustmentOn: lease.lastAdjustmentOn,
    previousRentCents: lease.previousRentCents,
    unit: { label: unit.label, floor: unit.floor, areaSqm: unit.areaSqm, rooms: unit.rooms, bedrooms: unit.bedrooms ?? null },
    property: {
      name: property.name,
      address: property.address,
      commune: property.commune,
      energyClass: property.energyClass,
      cpeIssuedOn: property.cpeIssuedOn ?? null,
      syndicName: property.syndicName ?? null,
      smokeDetectorsConfirmed: property.smokeDetectorsConfirmed,
      photoPath: null,
      photoUrl: property.photoUrl ?? null,
    },
    parties: lease.tenantContactIds.map((cid) => {
      const c = demo.contactById(cid);
      return { contactId: cid, name: c.name, role: lease.colocation ? "colocataire" : "tenant", movedInOn: lease.startDate, movedOutOn: lease.endDate, isMe: cid === me };
    }),
    deposit: deposit
      ? { amountCents: deposit.amountCents, form: deposit.form, status: deposit.status, receivedOn: null, keyHandoverOn: deposit.keyHandoverOn ?? null }
      : null,
    edls: demo.EDLS.filter((e) => e.leaseId === lease.id).map((e) => ({
      id: e.id, kind: e.kind, status: e.status, scheduledAt: e.scheduledAt, completedAt: e.completedAt, keyHandoverAt: e.keyHandoverAt, sealed: e.hashSealed,
    })),
    insurances: demo.INSURANCES.filter((i) => i.leaseId === lease.id).map((i) => ({
      id: i.id, kind: i.kind, provider: i.provider, policyNumber: i.policyNumber, expiresOn: i.expiresOn,
    })),
    documents: demo.DOCUMENTS.filter((doc) => doc.relatedLabel === unit.label && doc.klass === "lease").map((doc) => ({
      id: doc.id, name: doc.name, klass: doc.klass, createdAt: doc.createdAt, storagePath: "", url: null, relatedType: "lease", relatedId: lease.id,
    })),
    periods: demo.RENT_PERIODS.filter((rp) => rp.leaseId === lease.id).map((rp) => ({
      id: rp.id, period: rp.period, dueDate: rp.dueDate, rentCents: rp.rentCents, chargesCents: rp.chargesCents, otherCents: 0, vatCents: rp.vatCents,
      totalCents: rp.totalCents, allocatedCents: rp.allocatedCents, status: rp.status,
    })),
  };
}

export function tenantSpaceFromSample(demo: DemoData): TenantSpace {
  const current = leaseOf(demo, TENANT_LEASE_ID);
  const tenant = current ? demo.contactById(current.parties[0].contactId) : null;
  const name = tenant?.name ?? "";
  const requests = current
    ? demo.TICKETS.filter((t) => t.leaseId === current.id).map((t) => ({
        id: t.id,
        ref: t.ref,
        leaseId: current.id,
        kind: requestKindOf({ category: t.category, description: null }),
        category: t.category,
        severity: t.severity,
        status: t.status,
        state: requestState(t.status),
        title: t.title,
        description: "",
        createdAt: t.createdAt,
        updatedAt: t.createdAt,
        closedAt: null,
        attachments: [],
        messages: [],
      }))
    : [];
  return {
    userId: "sample-tenant",
    me: { name, firstName: name.split(/\s+/)[0] ?? "", email: tenant?.email ?? "" },
    today: demo.TODAY,
    current,
    others: [],
    past: [],
    managers: [{ orgId: demo.ORG.id, name: demo.ORG.shortName, email: demo.ORG.managerEmail || null, phone: null }],
    requests,
    payments: current ? paymentsOf(current, demo.TODAY) : null,
  };
}
