import { beforeEach, describe, expect, it } from "vitest";
import { fr } from "@/lib/i18n/fr";
import type { OrgContext } from "@/lib/gestion/api";
import { saveRentalDraft } from "@/lib/gestion/rental";
import { closeLease } from "@/lib/gestion/lease";
import { addDays, addMonths } from "@/domain/dates";
import { createInvitation, invitationLink, invitationMail, revokeInvitation, sendInvitation } from "@/lib/portal/invitations";
import { acceptInvitation, previewInvitation } from "@/lib/portal/accept";
import { isTenant, paymentsOf, tenantLeaseIds } from "@/lib/portal/tenant-space";
import { addTenantMessage, attachTenantFiles, createTenantRequest, parseRequestInput } from "@/lib/portal/requests";
import { attachmentFolder, inviteFor, inviteState, requestKindOf, requestState, ticketCategoryFor } from "@/lib/portal/types";
import { alertsFor, rentSituation } from "@/lib/portal/view";
import type { TenantLease } from "@/lib/portal/tenant-space";
import { FakeDb } from "./helpers/fake-postgrest";
import { ORG, OTHER_ORG, ctxFor, dossier, hydrate, letTo, seedProperty, space } from "./helpers/tenancy";

/**
 * The tenant portal, end to end, on one database.
 *
 * The owner's side runs the real write functions the routes call; the
 * tenant's side runs the real portal functions under a client bound to the
 * tenant's account, where the database's own policies decide every row. What
 * the owner's screens and the tenant's screens show is asserted against the
 * same rows: there is one record of a tenancy, read two ways.
 */

const today = new Date().toISOString().slice(0, 10);
const thisMonth = `${today.slice(0, 7)}-01`;
const nextMonth = addMonths(thisMonth, 1);
const lastDayOfMonth = addDays(nextMonth, -1);
const BASE = "https://app.morada.lu";

const ANNA = { firstName: "Anna", lastName: "Weber", email: "Anna.Weber@example.lu", phone: "+352 621 000 001" };
const LUC = { firstName: "Luc", lastName: "Weber", email: "luc.weber@example.lu" };
const NORA = { firstName: "Nora", lastName: "Adam", email: "nora.adam@example.lu" };
const anna = { id: "user-anna", email: "anna.weber@example.lu" };
const luc = { id: "user-luc", email: "luc.weber@example.lu" };
const nora = { id: "user-nora", email: "nora.adam@example.lu" };
const stranger = { id: "user-stranger", email: "someone.else@example.lu" };

const inviteVars = { firstName: "Anna", orgName: "Cabinet Test", propertyName: "Maison Weber", unitLabel: "Maison" };
const fmtDate = (iso: string) => iso.slice(0, 10);

describe("the tenant portal, from the invitation to the departure", () => {
  let db: FakeDb;
  let ctx: OrgContext;
  let propertyId: string;
  let unitId: string;

  beforeEach(() => {
    db = new FakeDb(today);
    ctx = ctxFor(db);
    db.insertRow("agencies", { id: ORG, name: "Cabinet Test", email: "bonjour@cabinet-test.lu", phone: "+352 26 00 00 00" });
    db.insertRow("crm_members", { agency_id: ORG, user_id: "user-owner", role: "owner", status: "active", email: "owner@cabinet-test.lu" });
    ({ propertyId, unitId } = seedProperty(db));
  });

  it("walks the whole flow: rental, invitation, account, space, request, departure, history, next tenant", async () => {
    // ── The owner creates the rental and activates it ──
    const rental = await letTo(ctx, unitId, [ANNA]);
    const [annaContact] = rental.contactIds;
    expect(db.table("contacts").find((c) => c.id === annaContact)!.email).toBe("anna.weber@example.lu");

    // ── Nobody is invited yet: the owner sees "Non invité" ──
    let demo = await hydrate(db);
    expect(demo.INVITES).toEqual([]);
    expect(demo.contactById(annaContact).portalLinked).toBe(false);
    expect(inviteFor(demo.INVITES, annaContact, rental.leaseId)).toBeNull();

    // ── The owner sends the invitation. No mail key in this environment: the link is handed over ──
    const sent = await sendInvitation(ctx, fr, { leaseId: rental.leaseId, contactId: annaContact, baseUrl: BASE, vars: inviteVars, formatDate: fmtDate });
    if ("error" in sent) throw new Error(sent.error);
    expect(sent.email).toBe("anna.weber@example.lu");
    expect(sent.sent).toBe(false);
    expect(sent.reason).toBe("not_configured");
    expect(sent.link.startsWith(`${BASE}/invitation/`)).toBe(true);
    const token = sent.link.slice(`${BASE}/invitation/`.length);
    expect(token).toHaveLength(64);

    demo = await hydrate(db);
    expect(demo.INVITES).toHaveLength(1);
    const row = inviteFor(demo.INVITES, annaContact, rental.leaseId)!;
    expect(row.leaseId).toBe(rental.leaseId);
    expect(inviteState(row, db.nowIso())).toBe("sent");
    // The token is not part of what the owner reads back.
    expect(Object.keys(row)).not.toContain("token");

    // ── The link, opened before any sign-in, says whose home is waiting ──
    const preview = await previewInvitation(db.anonClient(), token);
    expect(preview.state).toBe("pending");
    expect(preview.mine).toBe(false);
    expect(preview.firstName).toBe("Anna");
    expect(preview.email).toBe("anna.weber@example.lu");
    expect(preview.orgName).toBe("Cabinet Test");
    expect(preview.propertyName).toBe("Maison Weber");
    expect(preview.address.city).toBe("Strassen");
    expect(preview.unitLabel).toBe("Maison");
    expect(preview.leaseStatus).toBe("active");

    // ── Anna creates her account and accepts: the account is linked to her contact, once ──
    expect(await acceptInvitation(db.anonClient(), token)).toEqual({ error: "sign_in" });
    const accepted = await acceptInvitation(db.tenantClient(anna), token);
    expect(accepted).toEqual({ ok: true, leaseId: rental.leaseId, orgId: ORG, already: false });
    expect(db.table("contacts").find((c) => c.id === annaContact)!.user_id).toBe(anna.id);

    // A second click, a second tab, a refresh: same answer, nothing changes.
    expect(await acceptInvitation(db.tenantClient(anna), token)).toEqual({ ok: true, leaseId: rental.leaseId, orgId: ORG, already: true });
    expect((await previewInvitation(db.tenantClient(anna), token)).mine).toBe(true);
    // Somebody else with the link: it has been used.
    expect(await acceptInvitation(db.tenantClient(stranger), token)).toEqual({ error: "used" });

    demo = await hydrate(db);
    expect(inviteState(inviteFor(demo.INVITES, annaContact, rental.leaseId)!, db.nowIso())).toBe("accepted");
    expect(demo.contactById(annaContact).portalLinked).toBe(true);

    // ── Her space: the right home, read from the owner's rows ──
    expect(await tenantLeaseIds(db.tenantClient(anna))).toEqual([rental.leaseId]);
    let mine = await space(db, anna);
    expect(mine.me.name).toBe("Anna Weber");
    expect(mine.me.firstName).toBe("Anna");
    expect(mine.current?.id).toBe(rental.leaseId);
    expect(mine.current?.property.name).toBe("Maison Weber");
    expect(mine.current?.property.address).toBe("12, Rue de la Gare, 8001 Strassen");
    expect(mine.current?.unit.label).toBe("Maison");
    expect(mine.current?.rentCents).toBe(125000);
    expect(mine.current?.chargesCents).toBe(15000);
    expect(mine.current?.parties.map((p) => [p.name, p.isMe])).toEqual([["Anna Weber", true]]);
    expect(mine.past).toEqual([]);
    expect(mine.managers).toEqual([{ orgId: ORG, name: "Cabinet Test", email: "bonjour@cabinet-test.lu", phone: "+352 26 00 00 00" }]);

    // The ledger the owner opened is the ledger she sees, figure for figure.
    const ownerPeriods = demo.RENT_PERIODS.filter((rp) => rp.leaseId === rental.leaseId);
    expect(mine.current?.periods.map((p) => [p.period, p.totalCents, p.rentCents, p.chargesCents]).sort()).toEqual(
      ownerPeriods.map((rp) => [rp.period, rp.totalCents, rp.rentCents, rp.chargesCents]).sort(),
    );
    expect(mine.payments).not.toBeNull();
    expect(mine.payments!.history.every((p) => p.allocatedCents === 0)).toBe(true);
    expect(mine.payments!.nextDueCents).toBe(140000);

    // ── A payment lands: paid-ness is derived from the allocation, on both sides ──
    const first = ownerPeriods.slice().sort((a, b) => (a.period < b.period ? -1 : 1))[0];
    const payment = db.insertRow("payments", { org_id: ORG, lease_id: rental.leaseId, amount_cents: 140000, received_on: today });
    db.insertRow("payment_allocations", { org_id: ORG, payment_id: payment.id, rent_period_id: first.id, amount_cents: 140000 });
    mine = await space(db, anna);
    const paid = mine.payments!.history.find((p) => p.id === first.id)!;
    expect(paid.status).toBe("paid");
    expect(paid.allocatedCents).toBe(140000);
    expect(mine.payments!.outstandingCents).toBe(0);
    // ...and the payment row itself is not hers to read: only the allocation's amount.
    const { data: payments } = await db.tenantClient(anna).from("payments").select("*");
    expect(payments).toEqual([]);

    // ── She reports a problem: an intervention the owner sees, with a photo and a follow-up ──
    const input = parseRequestInput({ kind: "technical", category: "heating", title: "Plus de chauffage", description: "Depuis hier soir, radiateurs froids.", severity: "urgent" })!;
    const lease = { id: rental.leaseId, orgId: ORG, unitId, propertyId, subject: "Maison · Maison Weber" };
    const request = await createTenantRequest(db.tenantClient(anna), anna, lease, input);
    if ("error" in request) throw new Error(request.error);
    const folder = attachmentFolder(ORG, rental.leaseId);
    const attached = await attachTenantFiles(db.tenantClient(anna), anna, lease, request.id, [
      { path: `${folder}photo-1.jpg`, name: "radiateur.jpg", mime: "image/jpeg", sizeBytes: 120000 },
      { path: `${ORG}/${propertyId}/not-mine.jpg`, name: "hors dossier", mime: "image/jpeg", sizeBytes: 1 },
    ]);
    expect(attached).toEqual({ attached: 1 });
    const message = await addTenantMessage(db.tenantClient(anna), anna, lease, "Le technicien peut passer demain matin.");
    expect("id" in message).toBe(true);

    demo = await hydrate(db);
    const ticket = demo.TICKETS.find((t) => t.id === request.id)!;
    expect(ticket.source).toBe("tenant");
    expect(ticket.leaseId).toBe(rental.leaseId);
    expect(ticket.unitId).toBe(unitId);
    expect(ticket.category).toBe("heating");
    expect(ticket.severity).toBe("urgent");
    expect(ticket.status).toBe("new");
    expect(ticket.title).toBe("Plus de chauffage");
    expect(demo.DOCUMENTS.filter((doc) => doc.relatedLabel === ticket.ref).map((doc) => doc.name)).toEqual(["radiateur.jpg"]);
    const thread = demo.CONVERSATIONS.find((c) => c.scopeType === "lease" && c.scopeId === rental.leaseId)!;
    expect(thread.subject).toBe("Maison · Maison Weber");
    expect(thread.messages.map((m) => [m.from, m.kind, m.body, m.ticketId])).toEqual([
      ["Anna Weber", "tenant", "Plus de chauffage", request.id],
      ["Anna Weber", "tenant", "Le technicien peut passer demain matin.", null],
    ]);
    expect(thread.unread).toBe(2);
    expect(ticket.conversationId).toBe(thread.id);

    mine = await space(db, anna);
    expect(mine.requests.map((r) => [r.kind, r.state, r.title, r.attachments.length, r.conversationId])).toEqual([["technical", "sent", "Plus de chauffage", 1, thread.id]]);
    expect(mine.conversations.map((c) => [c.id, c.leaseId, c.label])).toEqual([[thread.id, rental.leaseId, "Maison · Maison Weber"]]);
    expect(mine.conversations[0].messages.map((m) => [m.mine, m.ticketId, m.body])).toEqual([
      [true, request.id, "Plus de chauffage"],
      [true, null, "Le technicien peut passer demain matin."],
    ]);

    // The owner takes it on: the tenant's state follows the intervention's.
    db.table("tickets").find((t) => t.id === request.id)!.status = "scheduled";
    mine = await space(db, anna);
    expect(mine.requests[0].state).toBe("in_progress");
    db.table("tickets").find((t) => t.id === request.id)!.status = "done";
    mine = await space(db, anna);
    expect(mine.requests[0].state).toBe("resolved");

    // ── The owner records the departure: the tenancy closes, history stays hers ──
    const closed = await closeLease(ctx, rental.leaseId, { endDate: lastDayOfMonth, depositOutcome: "released", releasedCents: 0, keysReturned: true, decompteIssuedOn: null }, today);
    if ("error" in closed) throw new Error(closed.error);
    demo = await hydrate(db);
    expect(demo.LEASES.find((l) => l.id === rental.leaseId)!.status).toBe("ended");

    mine = await space(db, anna);
    expect(mine.current).toBeNull();
    expect(mine.payments).toBeNull();
    expect(mine.past.map((l) => [l.id, l.status, l.endDate])).toEqual([[rental.leaseId, "ended", lastDayOfMonth]]);
    expect(mine.past[0].periods.length).toBeGreaterThan(0);
    expect(mine.requests).toHaveLength(1);
    // No new request on a closed tenancy: the database refuses, not the screen.
    expect(await createTenantRequest(db.tenantClient(anna), anna, lease, input)).toEqual({ error: "forbidden" });
    expect(await attachTenantFiles(db.tenantClient(anna), anna, lease, request.id, [{ path: `${folder}late.jpg`, name: "late", mime: "image/jpeg", sizeBytes: 1 }])).toEqual({ error: "forbidden" });
    // Her account is still there, still linked: nothing was deleted.
    expect(db.table("contacts").find((c) => c.id === annaContact)!.user_id).toBe(anna.id);
    // And she cannot be re-invited on an ended lease.
    expect(await createInvitation(ctx, { leaseId: rental.leaseId, contactId: annaContact })).toEqual({ error: "not_live" });

    // ── The next tenant is a separate person with a separate invitation ──
    const next = await letTo(ctx, unitId, [NORA], "1 300");
    expect(next.leaseId).not.toBe(rental.leaseId);
    const [noraContact] = next.contactIds;
    const invited = await createInvitation(ctx, { leaseId: next.leaseId, contactId: noraContact });
    if ("error" in invited) throw new Error(invited.error);
    expect(invited.email).toBe("nora.adam@example.lu");
    expect(invited.token).not.toBe(token);
    // Anna's account cannot take Nora's invitation.
    expect(await acceptInvitation(db.tenantClient(anna), invited.token)).toEqual({ error: "wrong_account" });
    expect(await acceptInvitation(db.tenantClient(nora), invited.token)).toMatchObject({ ok: true, leaseId: next.leaseId });

    const hers = await space(db, nora);
    expect(hers.current?.id).toBe(next.leaseId);
    expect(hers.past).toEqual([]);
    expect(hers.requests).toEqual([]);
    // Anna still sees only her former tenancy; Nora's lease and Anna's request never cross.
    mine = await space(db, anna);
    expect(mine.current).toBeNull();
    expect(mine.past.map((l) => l.id)).toEqual([rental.leaseId]);
    expect(await tenantLeaseIds(db.tenantClient(nora))).toEqual([next.leaseId]);
  });

  it("links every co-tenant to the same lease through their own invitation", async () => {
    const rental = await letTo(ctx, unitId, [ANNA, LUC]);
    const [annaContact, lucContact] = rental.contactIds;

    const a = await createInvitation(ctx, { leaseId: rental.leaseId, contactId: annaContact });
    const l = await createInvitation(ctx, { leaseId: rental.leaseId, contactId: lucContact });
    if ("error" in a || "error" in l) throw new Error("invitation failed");
    expect(a.token).not.toBe(l.token);

    // Each invitation is bound to its own address.
    expect(await acceptInvitation(db.tenantClient(luc), a.token)).toEqual({ error: "wrong_account" });
    expect(await acceptInvitation(db.tenantClient(anna), a.token)).toMatchObject({ ok: true });
    expect(await acceptInvitation(db.tenantClient(luc), l.token)).toMatchObject({ ok: true });

    const demo = await hydrate(db);
    expect(inviteState(inviteFor(demo.INVITES, annaContact, rental.leaseId)!, db.nowIso())).toBe("accepted");
    expect(inviteState(inviteFor(demo.INVITES, lucContact, rental.leaseId)!, db.nowIso())).toBe("accepted");

    const annaSpace = await space(db, anna);
    const lucSpace = await space(db, luc);
    expect(annaSpace.current?.id).toBe(rental.leaseId);
    expect(lucSpace.current?.id).toBe(rental.leaseId);
    expect(annaSpace.current?.parties.map((p) => [p.name, p.isMe])).toEqual([["Anna Weber", true], ["Luc Weber", false]]);
    expect(lucSpace.current?.parties.map((p) => [p.name, p.isMe])).toEqual([["Anna Weber", false], ["Luc Weber", true]]);
    // Names only: a co-tenant's e-mail and phone are never part of what the other reads.
    expect(Object.keys(lucSpace.current!.parties[0])).toEqual(["contactId", "name", "role", "movedInOn", "movedOutOn", "isMe"]);

    // A request by one is on the shared lease: both follow it.
    const req = await createTenantRequest(db.tenantClient(luc), luc, { id: rental.leaseId, orgId: ORG, unitId, propertyId, subject: "Maison · Maison Weber" }, parseRequestInput({ kind: "question", title: "Charges", description: "Comment sont calculées les avances ?" })!);
    if ("error" in req) throw new Error(req.error);
    expect((await space(db, anna)).requests.map((r) => [r.kind, r.title, r.description])).toEqual([["question", "Charges", "Comment sont calculées les avances ?"]]);
    // The shared conversation too: Luc's request reads as his to Anna, in the one thread they both have.
    expect((await space(db, anna)).conversations.map((c) => c.messages.map((m) => [m.mine, m.ticketId]))).toEqual([[[false, req.id]]]);
    expect((await space(db, luc)).conversations.map((c) => c.messages.map((m) => [m.mine, m.ticketId]))).toEqual([[[true, req.id]]]);
    expect((await hydrate(db)).TICKETS.find((t) => t.id === req.id)!.category).toBe("administrative");
  });

  it("refuses an expired invitation, a revoked one, and honours a resend", async () => {
    const rental = await letTo(ctx, unitId, [ANNA]);
    const [annaContact] = rental.contactIds;
    const first = await createInvitation(ctx, { leaseId: rental.leaseId, contactId: annaContact });
    if ("error" in first) throw new Error(first.error);

    // Expired: the row's date is in the past.
    const row = db.table("portal_invites").find((i) => i.id === first.id)!;
    row.expires_at = `${db.plusDays(-1)}T12:00:00.000Z`;
    expect((await previewInvitation(db.anonClient(), first.token)).state).toBe("expired");
    expect(await acceptInvitation(db.tenantClient(anna), first.token)).toEqual({ error: "expired" });
    let demo = await hydrate(db);
    expect(inviteState(inviteFor(demo.INVITES, annaContact, rental.leaseId)!, db.nowIso())).toBe("expired");

    // Resend: a new link, the old one revoked rather than erased.
    const second = await createInvitation(ctx, { leaseId: rental.leaseId, contactId: annaContact });
    if ("error" in second) throw new Error(second.error);
    expect(second.token).not.toBe(first.token);
    expect(second.expiresAt > db.nowIso()).toBe(true);
    demo = await hydrate(db);
    expect(demo.INVITES).toHaveLength(2);
    expect(inviteState(inviteFor(demo.INVITES, annaContact, rental.leaseId)!, db.nowIso())).toBe("sent");
    expect(inviteFor(demo.INVITES, annaContact, rental.leaseId)!.id).toBe(second.id);

    // Revoked by the owner: the link dies, the tenant is told why.
    expect(await revokeInvitation(ctx, second.id)).toEqual({ ok: true });
    expect((await previewInvitation(db.anonClient(), second.token)).state).toBe("revoked");
    expect(await acceptInvitation(db.tenantClient(anna), second.token)).toEqual({ error: "revoked" });
    demo = await hydrate(db);
    expect(inviteState(inviteFor(demo.INVITES, annaContact, rental.leaseId)!, db.nowIso())).toBe("revoked");
    expect(demo.contactById(annaContact).portalLinked).toBe(false);

    // A third one works; a forged or truncated token never resolves.
    const third = await createInvitation(ctx, { leaseId: rental.leaseId, contactId: annaContact });
    if ("error" in third) throw new Error(third.error);
    expect((await previewInvitation(db.anonClient(), "0123456789abcdef")).state).toBe("unknown");
    expect((await previewInvitation(db.anonClient(), third.token.slice(0, 63) + (third.token.endsWith("0") ? "1" : "0"))).state).toBe("unknown");
    expect(await acceptInvitation(db.tenantClient(anna), "not-a-token-at-all")).toEqual({ error: "unknown" });
    expect(await acceptInvitation(db.tenantClient(anna), third.token)).toMatchObject({ ok: true });
    // Once linked, a fresh invitation is pointless and refused.
    expect(await createInvitation(ctx, { leaseId: rental.leaseId, contactId: annaContact })).toEqual({ error: "already_linked" });
  });

  it("only invites parties of a live lease who have an e-mail", async () => {
    const draft = await saveRentalDraft(ctx, fr, dossier({ unitId, step: "tenant", tenants: [ANNA] }));
    if ("error" in draft) throw new Error(draft.error);
    expect(await createInvitation(ctx, { leaseId: draft.leaseId, contactId: draft.contactIds[0] })).toEqual({ error: "not_live" });
    expect(await createInvitation(ctx, { leaseId: "0f0f0f0f-0000-4000-8000-000000000404", contactId: draft.contactIds[0] })).toEqual({ error: "not_found" });

    const { unitId: otherUnit } = seedProperty(db, ORG, "Studio Gare");
    const rental = await letTo(ctx, otherUnit, [{ firstName: "Sans", lastName: "Adresse" }]);
    expect(await createInvitation(ctx, { leaseId: rental.leaseId, contactId: rental.contactIds[0] })).toEqual({ error: "no_email" });
    // Anna is not a party of that lease.
    expect(await createInvitation(ctx, { leaseId: rental.leaseId, contactId: draft.contactIds[0] })).toEqual({ error: "not_party" });
    // A tenant account cannot mint invitations.
    const { error } = await db.tenantClient(anna).rpc("portal_invite_lease", { p_lease: rental.leaseId, p_contact: rental.contactIds[0] });
    expect(error?.message).toContain("not allowed");
  });

  it("keeps an account that already exists, and a returning tenant, on one contact", async () => {
    // Anna already has a Morada account elsewhere: the invitation links it, nothing is created.
    const rental = await letTo(ctx, unitId, [ANNA]);
    const [annaContact] = rental.contactIds;
    const inv = await createInvitation(ctx, { leaseId: rental.leaseId, contactId: annaContact });
    if ("error" in inv) throw new Error(inv.error);
    expect(await acceptInvitation(db.tenantClient(anna), inv.token)).toMatchObject({ ok: true });
    expect(db.table("contacts").filter((c) => c.email === "anna.weber@example.lu")).toHaveLength(1);

    // She leaves, then comes back for another lot: same contact, same account, no second invitation.
    const closed = await closeLease(ctx, rental.leaseId, { endDate: lastDayOfMonth, depositOutcome: "released", releasedCents: 0, keysReturned: true, decompteIssuedOn: null }, today);
    if ("error" in closed) throw new Error(closed.error);
    const { unitId: otherUnit } = seedProperty(db, ORG, "Studio Gare");
    const again = await letTo(ctx, otherUnit, [{ ...ANNA, email: "ANNA.weber@example.lu" }], "900");
    expect(again.contactIds).toEqual([annaContact]);
    expect(db.table("contacts").filter((c) => c.email === "anna.weber@example.lu")).toHaveLength(1);
    expect(db.table("contact_roles").filter((r) => r.contact_id === annaContact && r.role === "tenant")).toHaveLength(1);
    expect(await createInvitation(ctx, { leaseId: again.leaseId, contactId: annaContact })).toEqual({ error: "already_linked" });

    const demo = await hydrate(db);
    expect(demo.contactById(annaContact).portalLinked).toBe(true);
    expect(demo.LEASES.filter((l) => l.tenantContactIds.includes(annaContact)).map((l) => l.status).sort()).toEqual(["active", "ended"]);

    const mine = await space(db, anna);
    expect(mine.current?.id).toBe(again.leaseId);
    expect(mine.current?.property.name).toBe("Studio Gare");
    expect(mine.past.map((l) => l.id)).toEqual([rental.leaseId]);
  });

  it("keeps a second lot's invitation apart from the first, and lists both tenancies as running", async () => {
    // Anna rents the house, then a studio of the same cabinet: one contact, two live leases.
    const house = await letTo(ctx, unitId, [ANNA], "1 250", addDays(today, -60));
    const { unitId: studioUnit } = seedProperty(db, ORG, "Studio Gare");
    const studio = await letTo(ctx, studioUnit, [ANNA], "900");
    expect(studio.contactIds).toEqual(house.contactIds);
    const [annaContact] = house.contactIds;

    // Inviting her for the studio leaves the house's invitation open.
    const forHouse = await createInvitation(ctx, { leaseId: house.leaseId, contactId: annaContact });
    if ("error" in forHouse) throw new Error(forHouse.error);
    const forStudio = await createInvitation(ctx, { leaseId: studio.leaseId, contactId: annaContact });
    if ("error" in forStudio) throw new Error(forStudio.error);
    const demo = await hydrate(db);
    expect(inviteState(inviteFor(demo.INVITES, annaContact, house.leaseId)!, db.nowIso())).toBe("sent");
    expect(inviteState(inviteFor(demo.INVITES, annaContact, studio.leaseId)!, db.nowIso())).toBe("sent");
    // Sending the house's again replaces the house's, and only that one.
    const houseAgain = await createInvitation(ctx, { leaseId: house.leaseId, contactId: annaContact });
    if ("error" in houseAgain) throw new Error(houseAgain.error);
    expect((await previewInvitation(db.anonClient(), forHouse.token)).state).toBe("revoked");
    expect((await previewInvitation(db.anonClient(), forStudio.token)).state).toBe("pending");
    expect((await previewInvitation(db.anonClient(), houseAgain.token)).state).toBe("pending");

    // Either link opens the account onto both tenancies.
    expect(await acceptInvitation(db.tenantClient(anna), forStudio.token)).toMatchObject({ ok: true });
    expect(await isTenant(db.tenantClient(anna))).toBe(true);
    expect(await isTenant(db.tenantClient(stranger))).toBe(false);
    expect(await isTenant(db.anonClient() as Parameters<typeof isTenant>[0])).toBe(false);
    expect((await tenantLeaseIds(db.tenantClient(anna))).sort()).toEqual([house.leaseId, studio.leaseId].sort());

    // The home page is the latest tenancy; the other one is running, not former.
    const mine = await space(db, anna);
    expect(mine.current?.id).toBe(studio.leaseId);
    expect(mine.others.map((l) => l.id)).toEqual([house.leaseId]);
    expect(mine.past).toEqual([]);
    expect(mine.others[0].status).toBe("active");
  });

  it("recognises a returning tenant however the address was stored, and never folds another person onto them", async () => {
    // A card from before addresses were lower-cased: found again, kept as it is.
    const legacy = db.insertRow("contacts", { org_id: ORG, kind: "natural", first_name: "Anna", last_name: "Weber", email: "Anna.Weber@Example.lu", phone: "+352 621 000 009" });
    const rental = await letTo(ctx, unitId, [{ firstName: " anna ", lastName: "WEBER", email: "ANNA.WEBER@EXAMPLE.LU" }]);
    expect(rental.contactIds).toEqual([legacy.id]);
    expect(db.table("contacts").filter((c) => c.last_name === "Weber")).toHaveLength(1);
    const card = db.table("contacts").find((c) => c.id === legacy.id)!;
    expect([card.first_name, card.last_name, card.email, card.phone]).toEqual(["Anna", "Weber", "Anna.Weber@Example.lu", "+352 621 000 009"]);
    expect(db.table("contact_roles").filter((r) => r.contact_id === legacy.id && r.role === "tenant")).toHaveLength(1);

    // Somebody else on Nora's mailbox is not Nora: the address is taken, nothing is overwritten, nobody is added.
    const { unitId: studioUnit } = seedProperty(db, ORG, "Studio Gare");
    const nora = await saveRentalDraft(ctx, fr, dossier({ unitId: studioUnit, step: "tenant", tenants: [NORA] }));
    if ("error" in nora) throw new Error(nora.error);
    const [noraContact] = nora.contactIds;
    const { unitId: parkingUnit } = seedProperty(db, ORG, "Parking Gare");
    const sam = { firstName: "Sam", lastName: "Adam", email: "NORA.adam@example.lu" };
    expect(await saveRentalDraft(ctx, fr, dossier({ unitId: parkingUnit, step: "tenant", tenants: [sam] }))).toEqual({ error: "email_taken" });
    expect(db.table("contacts").find((c) => c.id === noraContact)!.first_name).toBe("Nora");
    expect(db.table("contacts").filter((c) => c.first_name === "Sam")).toHaveLength(0);

    // A company writing from an address is not a person either.
    db.insertRow("contacts", { org_id: ORG, kind: "legal", legal_name: "Weber Sàrl", email: "contact@weber.lu" });
    const paul = { firstName: "Paul", lastName: "Weber", email: "contact@weber.lu" };
    expect(await saveRentalDraft(ctx, fr, dossier({ unitId: parkingUnit, step: "tenant", tenants: [paul] }))).toEqual({ error: "email_taken" });
    expect(db.table("contacts").find((c) => c.email === "contact@weber.lu")!.kind).toBe("legal");

    // Moving an address onto someone already on the dossier while another card holds it: refused the same way.
    const moved = await saveRentalDraft(ctx, fr, dossier({ unitId: studioUnit, leaseId: nora.leaseId, step: "tenant", tenants: [{ contactId: noraContact, ...NORA, email: "contact@weber.lu" }] }));
    expect(moved).toEqual({ error: "email_taken" });
    expect(db.table("contacts").find((c) => c.id === noraContact)!.email).toBe("nora.adam@example.lu");

    // A wildcard typed in an address matches nothing but itself.
    const wild = await saveRentalDraft(ctx, fr, dossier({ unitId: parkingUnit, step: "tenant", tenants: [{ firstName: "Anna", lastName: "Weber", email: "a%@example.lu" }] }));
    if ("error" in wild) throw new Error(wild.error);
    expect(wild.contactIds).toHaveLength(1);
    expect(wild.contactIds).not.toContain(legacy.id);
  });

  it("gives a tenant nothing of another tenant, another property, or the owner's private data", async () => {
    // Anna in Maison Weber, Luc in a second property of the same cabinet, Nora at another cabinet.
    const rentalA = await letTo(ctx, unitId, [ANNA]);
    const { propertyId: propertyB, unitId: unitB } = seedProperty(db, ORG, "Résidence Beaulieu");
    const rentalB = await letTo(ctx, unitB, [LUC]);
    db.insertRow("agencies", { id: OTHER_ORG, name: "Autre cabinet" });
    const { unitId: unitC } = seedProperty(db, OTHER_ORG, "Maison Adam");
    const rentalC = await letTo(ctxFor(db, OTHER_ORG), unitC, [NORA]);

    for (const [user, lease, contact] of [[anna, rentalA, ctx], [luc, rentalB, ctx], [nora, rentalC, ctxFor(db, OTHER_ORG)]] as const) {
      const inv = await createInvitation(contact, { leaseId: lease.leaseId, contactId: lease.contactIds[0] });
      if ("error" in inv) throw new Error(inv.error);
      expect(await acceptInvitation(db.tenantClient(user), inv.token)).toMatchObject({ ok: true });
    }

    // Each account sees exactly its lease.
    expect(await tenantLeaseIds(db.tenantClient(anna))).toEqual([rentalA.leaseId]);
    expect(await tenantLeaseIds(db.tenantClient(luc))).toEqual([rentalB.leaseId]);
    expect(await tenantLeaseIds(db.tenantClient(nora))).toEqual([rentalC.leaseId]);
    expect(await tenantLeaseIds(db.tenantClient(stranger))).toEqual([]);
    const strangerSpace = await space(db, stranger);
    expect(strangerSpace.current).toBeNull();
    expect(strangerSpace.past).toEqual([]);
    expect(strangerSpace.requests).toEqual([]);

    // The owner's private money exists and is theirs alone: a bank account, a transaction, a payment.
    const account = db.insertRow("bank_accounts", { org_id: ORG, label: "Compte cabinet", iban: "LU120010001234567891" });
    db.insertRow("bank_transactions", { org_id: ORG, bank_account_id: account.id, booked_on: today, amount_cents: 125000, counterparty_name: "Anna Weber" });
    db.insertRow("payments", { org_id: ORG, lease_id: rentalA.leaseId, amount_cents: 125000, received_on: today });
    expect((await db.client().from("bank_accounts").select("*").eq("org_id", ORG)).data).toHaveLength(1);
    expect((await db.client().from("payments").select("*").eq("org_id", ORG)).data).toHaveLength(1);

    // Anna asks, by id, for what is not hers: every table answers with nothing.
    const g = db.tenantClient(anna);
    for (const [table, column, value] of [
      ["leases", "id", rentalB.leaseId],
      ["leases", "id", rentalA.leaseId],
      ["units", "id", unitB],
      ["properties", "id", propertyB],
      ["properties", "id", propertyId],
      ["contacts", "id", rentalB.contactIds[0]],
      ["contacts", "id", rentalA.contactIds[0]],
      ["rent_periods", "lease_id", rentalB.leaseId],
      ["rent_period_status", "lease_id", rentalB.leaseId],
      ["lease_parties", "lease_id", rentalB.leaseId],
      ["portal_invites", "lease_id", rentalA.leaseId],
      ["bank_accounts", "org_id", ORG],
      ["bank_transactions", "org_id", ORG],
      ["payments", "org_id", ORG],
    ] as const) {
      const { data } = await g.from(table).select("*").eq(column, value);
      expect(data, `${table} by ${column}`).toEqual([]);
    }
    // ...while her own ledger rows do come back.
    const { data: own } = await g.from("rent_period_status").select("*").eq("lease_id", rentalA.leaseId);
    expect((own as unknown[]).length).toBeGreaterThan(0);

    // Luc opens a request with a photo and a message; Anna neither sees nor touches it.
    const leaseB = { id: rentalB.leaseId, orgId: ORG, unitId: unitB, propertyId: propertyB, subject: "Maison · Résidence Beaulieu" };
    const req = await createTenantRequest(db.tenantClient(luc), luc, leaseB, parseRequestInput({ kind: "technical", category: "plumbing", title: "Fuite", description: "Sous l'évier." })!);
    if ("error" in req) throw new Error(req.error);
    await attachTenantFiles(db.tenantClient(luc), luc, leaseB, req.id, [{ path: `${attachmentFolder(ORG, rentalB.leaseId)}p.jpg`, name: "p", mime: "image/jpeg", sizeBytes: 1 }]);
    await addTenantMessage(db.tenantClient(luc), luc, leaseB, "Bonjour");

    const annaSpace = await space(db, anna);
    expect(annaSpace.requests).toEqual([]);
    expect(annaSpace.current?.documents).toEqual([]);
    expect((await g.from("tickets").select("*").eq("id", req.id)).data).toEqual([]);
    expect((await g.from("documents").select("*").eq("related_id", req.id)).data).toEqual([]);
    expect((await g.from("conversations").select("*").eq("scope_id", rentalB.leaseId)).data).toEqual([]);
    expect((await g.from("messages").select("*")).data).toEqual([]);
    // Writing on Luc's lease or request, even with the right ids in hand, is refused by policy.
    expect(await createTenantRequest(g, anna, leaseB, parseRequestInput({ kind: "other", title: "x", description: "" })!)).toEqual({ error: "forbidden" });
    expect(await attachTenantFiles(g, anna, leaseB, req.id, [{ path: `${attachmentFolder(ORG, rentalB.leaseId)}q.jpg`, name: "q", mime: "image/jpeg", sizeBytes: 1 }])).toEqual({ error: "forbidden" });
    expect(await addTenantMessage(g, anna, leaseB, "Moi aussi")).toEqual({ error: "forbidden" });
    // Nor can she claim a request of her own lease was raised by someone else.
    const forged = await g.from("tickets").insert({ org_id: ORG, unit_id: unitId, property_id: propertyId, lease_id: rentalA.leaseId, source: "manager", category: "other", severity: "routine", status: "new", title: "forged" });
    expect(forged.error?.code).toBe("42501");

    // Luc's own view of his request is complete.
    const lucSpace = await space(db, luc);
    expect(lucSpace.requests.map((r) => [r.title, r.attachments.length])).toEqual([["Fuite", 1]]);
    expect(lucSpace.conversations.map((c) => c.messages.map((m) => m.body))).toEqual([["Fuite", "Bonjour"]]);
    // The owner of the first cabinet sees both of their tenants' leases and nothing of the other cabinet.
    const demo = await hydrate(db);
    expect(demo.LEASES.map((l) => l.id).sort()).toEqual([rentalA.leaseId, rentalB.leaseId].sort());
  });

  it("writes the invitation e-mail in the cabinet's language with the link and the expiry", () => {
    const mail = invitationMail(fr, { ...inviteVars, link: invitationLink(BASE, "abc"), expiresOn: "3 octobre 2026" });
    expect(mail.subject).toBe("Votre logement vous attend sur Morada : Maison · Maison Weber");
    expect(mail.text).toContain("Bonjour Anna,");
    expect(mail.text).toContain("Cabinet Test vous ouvre votre espace locataire pour Maison · Maison Weber.");
    expect(mail.text).toContain(`${BASE}/invitation/abc`);
    expect(mail.text).toContain("3 octobre 2026");
    expect(mail.html).toContain(`href="${BASE}/invitation/abc"`);
    expect(mail.html).not.toContain("<script");
    expect(invitationLink(`${BASE}/`, "t")).toBe(`${BASE}/invitation/t`);
  });
});

describe("the portal's vocabulary", () => {
  const now = "2026-09-19T12:00:00.000Z";
  const base = { acceptedAt: null, revokedAt: null, expiresAt: "2026-10-03T12:00:00.000Z" };

  it("orders an invitation's states: accepted, then revoked, then expired, else sent", () => {
    expect(inviteState(base, now)).toBe("sent");
    expect(inviteState({ ...base, expiresAt: "2026-09-01T00:00:00.000Z" }, now)).toBe("expired");
    expect(inviteState({ ...base, revokedAt: now, expiresAt: "2026-09-01T00:00:00.000Z" }, now)).toBe("revoked");
    expect(inviteState({ ...base, acceptedAt: now, revokedAt: now }, now)).toBe("accepted");
  });

  it("picks the latest invitation of a person on a lease", () => {
    const row = (id: string, createdAt: string, leaseId: string | null) => ({ id, contactId: "c", leaseId, email: "", createdAt, sentAt: null, delivery: null, ...base });
    const invites = [row("a", "2026-01-01", "l1"), row("b", "2026-02-01", "l1"), row("c", "2026-03-01", "l2"), row("d", "2025-12-01", null)];
    expect(inviteFor(invites, "c", "l1")?.id).toBe("b");
    expect(inviteFor(invites, "c", "l2")?.id).toBe("c");
    expect(inviteFor(invites, "c", "l3")?.id).toBe("d");
    expect(inviteFor(invites, "other", "l1")).toBeNull();
  });

  it("maps requests onto interventions and back", () => {
    expect(ticketCategoryFor("technical", "heating")).toBe("heating");
    expect(ticketCategoryFor("technical", "nonsense")).toBe("other");
    expect(ticketCategoryFor("document", "heating")).toBe("administrative");
    expect(requestKindOf({ category: "plumbing", description: null })).toBe("technical");
    expect(requestKindOf({ category: "administrative", description: "[document] attestation" })).toBe("document");
    expect(requestKindOf({ category: "administrative", description: "[question] charges" })).toBe("question");
    expect(requestKindOf({ category: "administrative", description: "no tag" })).toBe("other");
    expect(["new", "triaged"].map(requestState)).toEqual(["sent", "sent"]);
    expect(["offered", "scheduled", "in_progress", "pending_tenant"].map(requestState)).toEqual(["in_progress", "in_progress", "in_progress", "in_progress"]);
    expect(["done", "closed", "cancelled"].map(requestState)).toEqual(["resolved", "resolved", "refused"]);
    expect(parseRequestInput({ kind: "spam", title: "x" })).toBeNull();
    expect(parseRequestInput({ kind: "technical", title: "" })).toBeNull();
    expect(parseRequestInput({ kind: "technical", title: " Fuite ", severity: "bogus" })).toEqual({ kind: "technical", category: null, title: "Fuite", description: "", severity: "routine" });
  });

  it("derives the money picture from the ledger alone", () => {
    const p = (period: string, dueDate: string, total: number, allocated: number, status: string) => ({
      id: period, period, dueDate, rentCents: total, chargesCents: 0, otherCents: 0, vatCents: 0, totalCents: total, allocatedCents: allocated, status,
    });
    const lease = { paymentDay: 1, startDate: "2026-01-01", endDate: null, periods: [
      p("2026-07", "2026-07-01", 1000, 1000, "paid"),
      p("2026-08", "2026-08-01", 1000, 400, "partial"),
      p("2026-09", "2026-09-01", 1000, 0, "late"),
      p("2026-10", "2026-10-01", 1000, 0, "upcoming"),
    ] };
    const money = paymentsOf(lease, "2026-09-19");
    expect(money.thisMonth?.period).toBe("2026-09");
    expect(money.outstandingCents).toBe(1600);
    expect(money.nextDueOn).toBe("2026-10-01");
    expect(money.nextDueCents).toBe(1000);
    expect(money.history.map((x) => x.period)).toEqual(["2026-10", "2026-09", "2026-08", "2026-07"]);
    // Nothing open ahead: the calendar says when the next one falls.
    const settled = paymentsOf({ ...lease, periods: lease.periods.map((x) => ({ ...x, allocatedCents: x.totalCents })) }, "2026-09-19");
    expect(settled.outstandingCents).toBe(0);
    expect(settled.nextDueOn).toBe("2026-10-01");

    // The one word on the home page follows the open periods.
    expect(rentSituation(money)).toBe("late");
    expect(rentSituation(settled)).toBe("ok");
    // Part-paid but not yet due is "partial"; part-paid and past due is late, like the alert says.
    expect(rentSituation(paymentsOf({ ...lease, periods: [p("2026-09", "2026-09-25", 1000, 400, "partial")] }, "2026-09-19"))).toBe("partial");
    expect(rentSituation(paymentsOf({ ...lease, periods: [p("2026-09", "2026-09-01", 1000, 400, "partial")] }, "2026-09-19"))).toBe("late");
    expect(rentSituation(paymentsOf({ ...lease, periods: [p("2026-09", "2026-09-25", 1000, 0, "pending")] }, "2026-09-19"))).toBe("pending");
    expect(rentSituation(null)).toBe("ok");
    // The due day itself is "to pay", not "behind": late starts the day after, where the ledger's status starts it.
    const dueToday = paymentsOf({ ...lease, periods: [p("2026-09", "2026-09-19", 1000, 0, "pending")] }, "2026-09-19");
    expect(dueToday.outstandingCents).toBe(0);
    expect(dueToday.nextDueOn).toBe("2026-09-19");
    expect(dueToday.nextDueCents).toBe(1000);
    expect(rentSituation(dueToday)).toBe("pending");
    const dueYesterday = paymentsOf({ ...lease, periods: [p("2026-09", "2026-09-19", 1000, 0, "late")] }, "2026-09-20");
    expect(dueYesterday.outstandingCents).toBe(1000);
    expect(rentSituation(dueYesterday)).toBe("late");
  });

  it("raises the few alerts worth a line on the home page", () => {
    const today = "2026-09-19";
    const base: TenantLease = {
      id: "l", orgId: "o", unitId: "u", propertyId: "p", status: "active", type: "residential", startDate: "2026-01-01", endDate: null,
      rentCents: 1000, chargesCents: 0, chargesRegime: "advances", paymentDay: 1, rfReference: "", furnished: false, colocation: false,
      lastAdjustmentOn: null, previousRentCents: null,
      unit: { label: "Apt", floor: "", areaSqm: 0, rooms: 0, bedrooms: null },
      property: { name: "P", address: "", commune: "", energyClass: "", cpeIssuedOn: null, syndicName: null, smokeDetectorsConfirmed: false, photoPath: null, photoUrl: null },
      parties: [], deposit: null, edls: [], insurances: [], documents: [], periods: [],
    };
    const covered = { id: "i", kind: "liability", provider: "X", policyNumber: "1", expiresOn: "2027-01-01" };
    expect(alertsFor({ ...base, insurances: [covered] }, null, today)).toEqual([]);
    expect(alertsFor(base, null, today)).toEqual([{ kind: "insurance_missing" }]);
    expect(alertsFor({ ...base, insurances: [{ ...covered, expiresOn: "2026-10-01" }] }, null, today)).toEqual([{ kind: "insurance_expiring", date: "2026-10-01" }]);
    // The owner's own building cover is not the tenant's insurance.
    expect(alertsFor({ ...base, insurances: [{ ...covered, kind: "building" }] }, null, today)).toEqual([{ kind: "insurance_missing" }]);
    expect(alertsFor({ ...base, insurances: [covered], status: "notice", endDate: "2026-12-31" }, null, today)).toEqual([{ kind: "notice", date: "2026-12-31" }]);
    expect(alertsFor({ ...base, insurances: [covered], endDate: "2027-12-31" }, null, today)).toEqual([]);
    expect(alertsFor({ ...base, insurances: [covered], edls: [{ id: "e", kind: "entry", status: "draft", scheduledAt: null, completedAt: null, keyHandoverAt: null, sealed: false }] }, null, today)).toEqual([{ kind: "edl" }]);
    expect(alertsFor({ ...base, insurances: [covered], edls: [{ id: "e", kind: "entry", status: "sealed", scheduledAt: null, completedAt: null, keyHandoverAt: null, sealed: true }] }, null, today)).toEqual([]);
    const money = paymentsOf({ ...base, periods: [{ id: "x", period: "2026-08", dueDate: "2026-08-01", rentCents: 1000, chargesCents: 0, otherCents: 0, vatCents: 0, totalCents: 1000, allocatedCents: 0, status: "late" }] }, today);
    expect(alertsFor({ ...base, insurances: [covered] }, money, today)).toEqual([{ kind: "late", amountCents: 1000 }]);
  });
});
