import { beforeEach, describe, expect, it } from "vitest";
import type { OrgContext } from "@/lib/gestion/api";
import { addLeaseParty, moveOutParty } from "@/lib/gestion/lease";
import { saveRentalDraft } from "@/lib/gestion/rental";
import { unlinkTenantAccount } from "@/lib/portal/access";
import { createInvitation } from "@/lib/portal/invitations";
import { fr } from "@/lib/i18n/fr";
import { addDays } from "@/domain/dates";
import { FakeDb } from "./helpers/fake-postgrest";
import { ORG, ctxFor, dossier, hydrate, isoToday, letTo, linkAccount, seedProperty, space } from "./helpers/tenancy";

/**
 * The people on a tenancy in force: a co-tenant or a guarantor joins, a
 * co-tenant leaves on a date and stops writing from the tenant space while
 * keeping their history, the last tenant never leaves from here, and the
 * owner can take back a person's access to the space.
 */
const today = isoToday();
const ANNA = { firstName: "Anna", lastName: "Weber", email: "anna.weber@example.lu" };
const LUC = { firstName: "Luc", lastName: "Weber", email: "luc.weber@example.lu" };
const anna = { id: "user-anna", email: ANNA.email };
const luc = { id: "user-luc", email: LUC.email };

describe("the people on a tenancy in force", () => {
  let db: FakeDb;
  let ctx: OrgContext;
  let unitId: string;
  let propertyId: string;

  beforeEach(() => {
    db = new FakeDb(today);
    ctx = ctxFor(db);
    ({ propertyId, unitId } = seedProperty(db));
  });

  const partyOf = (leaseId: string, contactId: string) => db.table("lease_parties").find((lp) => lp.lease_id === leaseId && lp.contact_id === contactId)!;

  it("lets a co-tenant and a guarantor join, once each, from a day the tenancy covers", async () => {
    const rental = await letTo(ctx, unitId, [ANNA], "1 250", addDays(today, -40));
    const luc = db.insertRow("contacts", { org_id: ORG, kind: "natural", first_name: "Luc", last_name: "Weber" });
    const added = await addLeaseParty(ctx, rental.leaseId, { contactId: String(luc.id), role: "tenant", movedInOn: today });
    expect(added).toMatchObject({ ok: true });
    expect(await addLeaseParty(ctx, rental.leaseId, { contactId: String(luc.id), role: "tenant", movedInOn: today })).toEqual({ error: "already_party" });
    // The same person can also stand as guarantor; a day before the tenancy cannot.
    expect(await addLeaseParty(ctx, rental.leaseId, { contactId: String(luc.id), role: "guarantor", movedInOn: addDays(today, -400) })).toEqual({ error: "invalid" });
    expect(await addLeaseParty(ctx, rental.leaseId, { contactId: String(luc.id), role: "guarantor", movedInOn: null })).toMatchObject({ ok: true });

    const demo = await hydrate(db);
    const lease = demo.LEASES.find((l) => l.id === rental.leaseId)!;
    expect(lease.tenantContactIds).toHaveLength(2);
    expect(lease.guarantorContactIds).toEqual([String(luc.id)]);
    expect(demo.LEASE_PARTIES.filter((p) => p.leaseId === rental.leaseId).map((p) => p.role).sort()).toEqual(["guarantor", "tenant", "tenant"]);
  });

  it("refuses an archived contact, an unknown tenancy and a dossier not started", async () => {
    const rental = await letTo(ctx, unitId, [ANNA]);
    const gone = db.insertRow("contacts", { org_id: ORG, kind: "natural", first_name: "Ex", last_name: "Contact", archived_at: `${today}T10:00:00Z` });
    expect(await addLeaseParty(ctx, rental.leaseId, { contactId: String(gone.id), role: "tenant", movedInOn: null })).toEqual({ error: "invalid" });
    expect(await addLeaseParty(ctx, "nope", { contactId: String(gone.id), role: "tenant", movedInOn: null })).toEqual({ error: "not_found" });
    const { unitId: second } = seedProperty(db, ORG, "Maison Adam");
    const draft = await saveRentalDraft(ctx, fr, dossier({ unitId: second, step: "rent", tenants: [LUC], rent: "900", startDate: today }));
    if ("error" in draft) throw new Error(draft.error);
    const contact = db.insertRow("contacts", { org_id: ORG, kind: "natural", first_name: "Nora", last_name: "Adam" });
    expect(await addLeaseParty(ctx, draft.leaseId, { contactId: String(contact.id), role: "tenant", movedInOn: null })).toEqual({ error: "not_live" });
  });

  it("dates a co-tenant out; they keep reading and stop writing; the last tenant stays", async () => {
    const rental = await letTo(ctx, unitId, [ANNA, LUC], "1 250", addDays(today, -60));
    const [annaContact, lucContact] = rental.contactIds;
    await linkAccount(db, ctx, rental, luc, 1);
    const lucParty = partyOf(rental.leaseId, lucContact);
    const annaParty = partyOf(rental.leaseId, annaContact);

    expect(await moveOutParty(ctx, rental.leaseId, String(lucParty.id), addDays(today, -100))).toEqual({ error: "invalid" });
    expect(await moveOutParty(ctx, rental.leaseId, String(lucParty.id), today)).toEqual({ ok: true });
    expect(await moveOutParty(ctx, rental.leaseId, String(lucParty.id), today)).toEqual({ error: "invalid" });
    // The last tenant leaves through the departure, not from here; the base refuses it too.
    expect(await moveOutParty(ctx, rental.leaseId, String(annaParty.id), today)).toEqual({ error: "last_tenant" });
    const { error } = await db.client().from("lease_parties").update({ moved_out_on: today }).eq("id", annaParty.id).select("id");
    expect(error?.code).toBe("23514");
    const removed = await db.client().from("lease_parties").delete().eq("id", annaParty.id).select("id");
    expect(removed.error?.code).toBe("23514");
    expect(partyOf(rental.leaseId, annaContact)).toBeDefined();

    // Luc still reads the tenancy, and no longer opens a request on it.
    const mine = await space(db, luc);
    expect(mine.current?.id ?? mine.past[0]?.id).toBe(rental.leaseId);
    const { error: ticketErr } = await db
      .tenantClient(luc)
      .from("tickets")
      .insert({ org_id: ORG, unit_id: unitId, property_id: propertyId, lease_id: rental.leaseId, source: "tenant", category: "other", severity: "routine", status: "new", title: "Question" });
    expect(ticketErr?.code).toBe("42501");
    // On the owner's screens he is no longer one of the tenants in force.
    expect((await hydrate(db)).LEASES.find((l) => l.id === rental.leaseId)?.tenantContactIds).toEqual([annaContact]);
  });

  it("never lets a dossier start without a tenant", async () => {
    const draft = db.insertRow("leases", { org_id: ORG, unit_id: unitId, status: "draft", start_date: today, rent_cents: 100000 });
    const { error } = await db.client().from("leases").update({ status: "active" }).eq("id", draft.id).select("id");
    expect(error).toMatchObject({ code: "23514" });
    expect(db.table("leases").find((l) => l.id === draft.id)?.status).toBe("draft");
  });

  it("takes a person's access to the space back, and their open invitations with it", async () => {
    const rental = await letTo(ctx, unitId, [ANNA, LUC]);
    const [annaContact, lucContact] = rental.contactIds;
    await linkAccount(db, ctx, rental, anna, 0);
    const pending = await createInvitation(ctx, { leaseId: rental.leaseId, contactId: lucContact });
    if ("error" in pending) throw new Error(pending.error);
    expect((await space(db, anna)).current?.id).toBe(rental.leaseId);

    expect(await unlinkTenantAccount(ctx, annaContact)).toEqual({ ok: true, revoked: 0 });
    expect(db.table("contacts").find((c) => c.id === annaContact)?.user_id).toBeNull();
    const after = await space(db, anna);
    expect([after.current, after.past]).toEqual([null, []]);
    expect(await unlinkTenantAccount(ctx, annaContact)).toEqual({ error: "not_linked" });
    expect(await unlinkTenantAccount(ctx, "nope")).toEqual({ error: "not_found" });

    // Luc never accepted: nothing to take back, the invitation stays until he is unlinked.
    expect(await unlinkTenantAccount(ctx, lucContact)).toEqual({ error: "not_linked" });
    // Anna can be invited again, and comes back through the new link.
    const again = await createInvitation(ctx, { leaseId: rental.leaseId, contactId: annaContact });
    expect("token" in again).toBe(true);
  });

  it("revokes what is still open for a person whose access is taken back", async () => {
    const rental = await letTo(ctx, unitId, [ANNA]);
    const [annaContact] = rental.contactIds;
    await linkAccount(db, ctx, rental, anna, 0);
    // An invitation sent before the acceptance was read, still open on the same person.
    db.insertRow("portal_invites", { org_id: ORG, contact_id: annaContact, lease_id: rental.leaseId, role: "tenant", email: ANNA.email, token: "x".repeat(64), expires_at: `${addDays(today, 7)}T12:00:00.000Z`, accepted_at: null, revoked_at: null });
    expect(await unlinkTenantAccount(ctx, annaContact)).toEqual({ ok: true, revoked: 1 });
    expect(db.table("portal_invites").filter((i) => i.contact_id === annaContact && !i.accepted_at).every((i) => i.revoked_at != null)).toBe(true);
  });
});
