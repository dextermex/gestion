import { fr } from "@/lib/i18n/fr";
import type { OrgContext } from "@/lib/gestion/api";
import { parseDossierInput, saveRentalDraft, type DossierInput } from "@/lib/gestion/rental";
import { activateLease } from "@/lib/gestion/lease";
import { buildRealDataFrom } from "@/lib/demo/data-real";
import type { ReadScope } from "@/lib/demo/scope";
import { orgFromWorkspace } from "@/lib/demo/data-empty";
import { createInvitation } from "@/lib/portal/invitations";
import { acceptInvitation } from "@/lib/portal/accept";
import { buildTenantSpace } from "@/lib/portal/tenant-space";
import type { FakeDb } from "./fake-postgrest";

/**
 * The moves a tenancy is made of, for the tests that run the owner's and
 * the tenant's sides against one database: a workspace context, a property
 * with one lot, a rental activated on it, the account of a tenant linked
 * through their invitation, and the two read models (the owner's screens,
 * the tenant's space) built from the same rows.
 */

export const ORG = "0f0f0f0f-0000-4000-8000-00000000c0de";
export const OTHER_ORG = "0f0f0f0f-0000-4000-8000-00000000beef";

export const isoToday = (): string => new Date().toISOString().slice(0, 10);

/** The write layer's view of a workspace: the manager's client, an owner role. */
export function ctxFor(db: FakeDb, org = ORG): OrgContext {
  return { g: db.client(), org: { id: org, name: "Cabinet Test", kind: "owner", role: "owner" }, userId: "user-owner" };
}

/**
 * What the owner's screens read: the workspace's rows, hydrated through the
 * same seam as production, with the scope a screen asks for (a tenancy's
 * sheet, a property's, one conversation in full, a page of the register).
 */
export async function hydrate(db: FakeDb, org = ORG, scope: ReadScope = {}) {
  return buildRealDataFrom(db.client(), orgFromWorkspace({ id: org, name: "Cabinet Test", kind: "owner" }), async () => new Map(), scope);
}

export function seedProperty(db: FakeDb, org = ORG, name = "Maison Weber"): { propertyId: string; unitId: string } {
  const property = db.insertRow("properties", {
    org_id: org,
    name,
    type: "house",
    address: { street: "Rue de la Gare", number: "12", postal_code: "8001", city: "Strassen" },
    commune: "Strassen",
    energy_class: "C",
    photo_url: `${org}/photo-${name}.jpg`,
  });
  const unit = db.insertRow("units", { org_id: org, property_id: property.id, label: "Maison", kind: "dwelling", area_sqm: 120, rooms: 5 });
  return { propertyId: String(property.id), unitId: String(unit.id) };
}

export const dossier = (body: Record<string, unknown>): DossierInput => {
  const input = parseDossierInput(body, "fr");
  if (!input) throw new Error("unreadable dossier");
  return input;
};

/** The owner records a tenancy and activates it: the shortest path to a let lot. */
export async function letTo(ctx: OrgContext, unitId: string, tenants: Array<Record<string, string>>, rent = "1 250", on = isoToday()) {
  const saved = await saveRentalDraft(ctx, fr, dossier({ unitId, step: "rent", tenants, rent, charges: "150", startDate: on, paymentDay: "1" }));
  if ("error" in saved) throw new Error(saved.error);
  const active = await activateLease(ctx, saved.leaseId, on);
  if ("error" in active) throw new Error(active.error);
  return saved;
}

/** The tenant's screens, built under the tenant's own account. */
export async function space(db: FakeDb, user: { id: string; email: string }, name = "Compte") {
  return buildTenantSpace(db.tenantClient(user), { userId: user.id, email: user.email, displayName: name, today: db.today, sign: async () => new Map() });
}

/** The owner invites a party of the lease and that person's account takes the link: the contact now carries the account. */
export async function linkAccount(db: FakeDb, ctx: OrgContext, rental: { leaseId: string; contactIds: string[] }, user: { id: string; email: string }, party = 0) {
  const invite = await createInvitation(ctx, { leaseId: rental.leaseId, contactId: rental.contactIds[party] });
  if ("error" in invite) throw new Error(invite.error);
  const accepted = await acceptInvitation(db.tenantClient(user), invite.token);
  if ("error" in accepted) throw new Error(accepted.error);
  return invite;
}
