import { beforeEach, describe, expect, it } from "vitest";
import type { OrgContext } from "@/lib/gestion/api";
import { closeLease } from "@/lib/gestion/lease";
import { addManagerMessage, createIntervention, markConversationRead, parseRequestStatus, setRequestStatus, statusOfFailure } from "@/lib/gestion/requests";
import { addTenantMessage, attachTenantFiles, createTenantRequest, parseRequestInput } from "@/lib/portal/requests";
import {
  REQUEST_STATUSES,
  attachmentFolder,
  isIntervention,
  isPendingThreadId,
  isRequestOpen,
  pendingThreadId,
  requestState,
  requestStatusOf,
  ticketStatusFor,
} from "@/lib/portal/types";
import { addDays, addMonths } from "@/domain/dates";
import { FakeDb } from "./helpers/fake-postgrest";
import { ORG, OTHER_ORG, ctxFor, hydrate, letTo, linkAccount, seedProperty, space } from "./helpers/tenancy";

/**
 * A tenant's request, both sides on one database.
 *
 * The tenant's side runs the portal functions under a client bound to the
 * tenant's account, where the database's policies decide every row. The
 * desk's side runs the functions the Messages routes call, under the
 * manager's context. What each side reads is asserted against the same
 * rows: one ticket, one thread, one set of photos, read two ways.
 */

const ANNA = { firstName: "Anna", lastName: "Weber", email: "anna.weber@example.lu" };
const LUC = { firstName: "Luc", lastName: "Weber", email: "luc.weber@example.lu" };
const NORA = { firstName: "Nora", lastName: "Adam", email: "nora.adam@example.lu" };
const anna = { id: "user-anna", email: "anna.weber@example.lu" };
const luc = { id: "user-luc", email: "luc.weber@example.lu" };
const nora = { id: "user-nora", email: "nora.adam@example.lu" };

const today = new Date().toISOString().slice(0, 10);
const endOfMonth = addDays(addMonths(`${today.slice(0, 7)}-01`, 1), -1);

const technical = (title: string, description: string) =>
  parseRequestInput({ kind: "technical", category: "plumbing", severity: "priority", title, description })!;

describe("a tenant's request, from the tenant's space to the desk's Messages and back", () => {
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

  it("runs the whole flow: request with photos, Messages, reply, statuses, intervention, resolution, history", async () => {
    const rental = await letTo(ctx, unitId, [ANNA]);
    await linkAccount(db, ctx, rental, anna);
    const lease = { id: rental.leaseId, orgId: ORG, unitId, propertyId };
    const tenant = db.tenantClient(anna);

    // ── The tenant asks, with two photos ──
    const input = technical("Fuite sous l'évier", "De l'eau coule sous l'évier depuis ce matin.");
    const created = await createTenantRequest(tenant, anna, lease, input);
    if ("error" in created) throw new Error(created.error);
    const folder = attachmentFolder(ORG, rental.leaseId);
    expect(
      await attachTenantFiles(tenant, anna, lease, created.id, [
        { path: `${folder}a.jpg`, name: "evier-1.jpg", mime: "image/jpeg", sizeBytes: 90000 },
        { path: `${folder}b.jpg`, name: "evier-2.jpg", mime: "image/jpeg", sizeBytes: 120000 },
      ]),
    ).toEqual({ attached: 2 });

    // The thread opens with the request: one conversation, the ticket's own.
    const threads = db.table("conversations").filter((c) => c.scope_type === "ticket" && c.scope_id === created.id);
    expect(threads).toHaveLength(1);
    const conversationId = String(threads[0].id);

    // ── The desk lists it under Messages and Demandes, not under Interventions ──
    let demo = await hydrate(db);
    let ticket = demo.TICKETS.find((t) => t.id === created.id)!;
    expect(ticket.source).toBe("tenant");
    expect(ticket.leaseId).toBe(rental.leaseId);
    expect(ticket.conversationId).toBe(conversationId);
    expect(ticket.interventionId).toBeNull();
    expect(isIntervention(ticket)).toBe(false);
    expect(demo.TICKETS.filter(isIntervention)).toEqual([]);
    expect(requestStatusOf(ticket.status)).toBe("todo");
    expect(ticket.attachments.map((a) => a.name)).toEqual(["evier-1.jpg", "evier-2.jpg"]);
    let thread = demo.CONVERSATIONS.find((c) => c.id === conversationId)!;
    expect([thread.scopeType, thread.scopeId, thread.subject, thread.participantName]).toEqual(["ticket", created.id, "Fuite sous l'évier", "Anna Weber"]);
    expect(thread.messages).toEqual([]);
    expect(thread.unread).toBe(0);

    // ── The desk answers on the same thread, not on a new one ──
    const reply = await addManagerMessage(ctx, { ticketId: created.id }, "Un plombier passe jeudi matin.");
    if ("error" in reply) throw new Error(reply.error);
    expect(reply.conversationId).toBe(conversationId);
    expect(db.table("conversations").filter((c) => c.scope_id === created.id)).toHaveLength(1);
    demo = await hydrate(db);
    thread = demo.CONVERSATIONS.find((c) => c.id === conversationId)!;
    expect(thread.messages.map((m) => [m.from, m.kind, m.body])).toEqual([["Cabinet Test", "manager", "Un plombier passe jeudi matin."]]);
    expect(thread.unread).toBe(0);

    // ── The tenant reads it in their space and answers; the desk sees it unread, then read ──
    let mine = await space(db, anna);
    expect(mine.requests.map((r) => [r.title, r.state, r.attachments.length])).toEqual([["Fuite sous l'évier", "sent", 2]]);
    expect(mine.requests[0].messages.map((m) => [m.senderKind, m.mine, m.body])).toEqual([["manager", false, "Un plombier passe jeudi matin."]]);
    expect("id" in (await addTenantMessage(tenant, anna, lease, { id: created.id, title: input.title }, "Jeudi matin me convient."))).toBe(true);
    demo = await hydrate(db);
    thread = demo.CONVERSATIONS.find((c) => c.id === conversationId)!;
    expect(thread.unread).toBe(1);
    expect(thread.messages.map((m) => m.kind)).toEqual(["manager", "tenant"]);
    expect(await markConversationRead(ctx, conversationId)).toEqual({ marked: 1 });
    expect(await markConversationRead(ctx, conversationId)).toEqual({ marked: 0 });
    demo = await hydrate(db);
    thread = demo.CONVERSATIONS.find((c) => c.id === conversationId)!;
    expect(thread.unread).toBe(0);
    expect(thread.messages.map((m) => m.readAt !== null)).toEqual([false, true]);
    // Read is a property of the messages: the request's status did not move.
    expect(db.table("tickets").find((t) => t.id === created.id)!.status).toBe("new");

    // ── Status: to handle, then in progress; the tenant's state follows ──
    expect(await setRequestStatus(ctx, created.id, "in_progress")).toEqual({ status: "in_progress" });
    let row = db.table("tickets").find((t) => t.id === created.id)!;
    expect([row.status, row.closed_at]).toEqual(["in_progress", null]);
    mine = await space(db, anna);
    expect(mine.requests[0].state).toBe("in_progress");

    // ── "Créer une intervention": a work order on the same ticket, once ──
    const work = await createIntervention(ctx, created.id);
    if ("error" in work) throw new Error(work.error);
    expect(work.created).toBe(true);
    expect(await createIntervention(ctx, created.id)).toEqual({ id: work.id, created: false });
    expect(db.table("work_orders").filter((w) => w.ticket_id === created.id).map((w) => [w.org_id, w.status])).toEqual([[ORG, "offered"]]);
    demo = await hydrate(db);
    ticket = demo.TICKETS.find((t) => t.id === created.id)!;
    expect(ticket.interventionId).toBe(work.id);
    expect(isIntervention(ticket)).toBe(true);
    expect(demo.TICKETS.filter(isIntervention).map((t) => t.id)).toEqual([created.id]);
    // The request kept its thread, its photos and its history.
    expect(ticket.conversationId).toBe(conversationId);
    expect(ticket.attachments).toHaveLength(2);
    expect(demo.CONVERSATIONS.find((c) => c.id === conversationId)!.messages).toHaveLength(2);

    // ── Resolved, reopened, refused, resolved again: both sides read one status ──
    expect(await setRequestStatus(ctx, created.id, "resolved")).toEqual({ status: "resolved" });
    row = db.table("tickets").find((t) => t.id === created.id)!;
    expect(row.status).toBe("done");
    expect(row.closed_at).not.toBeNull();
    mine = await space(db, anna);
    expect([mine.requests[0].state, mine.requests[0].closedAt]).toEqual(["resolved", today]);
    demo = await hydrate(db);
    expect(requestStatusOf(demo.TICKETS.find((t) => t.id === created.id)!.status)).toBe("resolved");

    expect(await setRequestStatus(ctx, created.id, "todo")).toEqual({ status: "todo" });
    row = db.table("tickets").find((t) => t.id === created.id)!;
    expect([row.status, row.closed_at]).toEqual(["new", null]);

    expect(await setRequestStatus(ctx, created.id, "refused")).toEqual({ status: "refused" });
    row = db.table("tickets").find((t) => t.id === created.id)!;
    expect(row.status).toBe("cancelled");
    expect(row.closed_at).not.toBeNull();
    mine = await space(db, anna);
    expect([mine.requests[0].state, mine.requests[0].closedAt]).toEqual(["refused", today]);

    expect(await setRequestStatus(ctx, created.id, "resolved")).toEqual({ status: "resolved" });

    // ── The tenant leaves: the history stays on both sides; nothing new can be opened ──
    const closed = await closeLease(ctx, rental.leaseId, { endDate: endOfMonth, depositOutcome: "released", releasedCents: 0, keysReturned: true, decompteIssuedOn: null }, today);
    if ("error" in closed) throw new Error(closed.error);
    mine = await space(db, anna);
    expect(mine.current).toBeNull();
    expect(mine.past.map((l) => l.id)).toEqual([rental.leaseId]);
    expect(mine.requests.map((r) => [r.state, r.attachments.length, r.messages.length])).toEqual([["resolved", 2, 2]]);
    expect(await createTenantRequest(tenant, anna, lease, input)).toEqual({ error: "forbidden" });
    expect(await attachTenantFiles(tenant, anna, lease, created.id, [{ path: `${folder}late.jpg`, name: "late", mime: "image/jpeg", sizeBytes: 1 }])).toEqual({ error: "forbidden" });
    demo = await hydrate(db);
    ticket = demo.TICKETS.find((t) => t.id === created.id)!;
    expect(ticket.leaseId).toBe(rental.leaseId);
    expect(ticket.conversationId).toBe(conversationId);
    expect(demo.CONVERSATIONS.find((c) => c.id === conversationId)!.messages).toHaveLength(2);
    // The desk can still write on it (a word about the guarantee, say) and the former tenant still reads it.
    expect("id" in (await addManagerMessage(ctx, { ticketId: created.id }, "La garantie est restituée."))).toBe(true);
    mine = await space(db, anna);
    expect(mine.requests[0].messages.map((m) => m.body)).toEqual(["Un plombier passe jeudi matin.", "Jeudi matin me convient.", "La garantie est restituée."]);

    // ── The next tenant on the lot sees none of it ──
    const next = await letTo(ctx, unitId, [NORA], "1 300");
    await linkAccount(db, ctx, next, nora);
    const hers = await space(db, nora);
    expect(hers.current?.id).toBe(next.leaseId);
    expect(hers.requests).toEqual([]);
    const other = db.tenantClient(nora);
    expect((await other.from("tickets").select("*").eq("id", created.id)).data).toEqual([]);
    expect((await other.from("conversations").select("*").eq("id", conversationId)).data).toEqual([]);
    expect((await other.from("messages").select("*").eq("conversation_id", conversationId)).data).toEqual([]);
    expect((await other.from("documents").select("*").eq("related_id", created.id)).data).toEqual([]);
    // And the former tenant sees nothing of the new tenancy.
    mine = await space(db, anna);
    expect(mine.current).toBeNull();
    expect((await tenant.from("tickets").select("*").eq("lease_id", next.leaseId)).data).toEqual([]);
  });

  it("keeps every cabinet's and every tenant's requests apart, and answers a foreign id with not found", async () => {
    const rentalA = await letTo(ctx, unitId, [ANNA]);
    await linkAccount(db, ctx, rentalA, anna);
    const { propertyId: propertyB, unitId: unitB } = seedProperty(db, ORG, "Résidence Beaulieu");
    const rentalB = await letTo(ctx, unitB, [LUC]);
    await linkAccount(db, ctx, rentalB, luc);
    db.insertRow("agencies", { id: OTHER_ORG, name: "Autre cabinet" });
    const otherCtx = ctxFor(db, OTHER_ORG);
    const { propertyId: propertyC, unitId: unitC } = seedProperty(db, OTHER_ORG, "Maison Adam");
    const rentalC = await letTo(otherCtx, unitC, [NORA]);
    await linkAccount(db, otherCtx, rentalC, nora);

    const leaseA = { id: rentalA.leaseId, orgId: ORG, unitId, propertyId };
    const leaseB = { id: rentalB.leaseId, orgId: ORG, unitId: unitB, propertyId: propertyB };
    const leaseC = { id: rentalC.leaseId, orgId: OTHER_ORG, unitId: unitC, propertyId: propertyC };
    const ask = async (user: { id: string; email: string }, lease: typeof leaseA, title: string) => {
      const r = await createTenantRequest(db.tenantClient(user), user, lease, parseRequestInput({ kind: "question", title, description: "Une question." })!);
      if ("error" in r) throw new Error(r.error);
      return r.id;
    };
    const reqA = await ask(anna, leaseA, "Question d'Anna");
    const reqB = await ask(luc, leaseB, "Question de Luc");
    await ask(nora, leaseC, "Question de Nora");

    // Each desk lists its own tenants' requests, in Messages and in Demandes.
    const demo = await hydrate(db);
    expect(demo.TICKETS.map((t) => t.title).sort()).toEqual(["Question d'Anna", "Question de Luc"]);
    expect(demo.CONVERSATIONS.map((c) => c.subject).sort()).toEqual(["Question d'Anna", "Question de Luc"]);
    // A non-technical request keeps its kind in storage and shows the words alone.
    expect(demo.TICKETS.find((t) => t.id === reqA)!.description).toBe("[question] Une question.");
    const otherDemo = await hydrate(db, OTHER_ORG);
    expect(otherDemo.TICKETS.map((t) => t.title)).toEqual(["Question de Nora"]);
    expect(otherDemo.CONVERSATIONS.map((c) => c.subject)).toEqual(["Question de Nora"]);

    // The other cabinet, holding Anna's ids, changes nothing: not found, and nothing leaks.
    const convA = String(db.table("conversations").find((c) => c.scope_id === reqA)!.id);
    expect(await setRequestStatus(otherCtx, reqA, "resolved")).toEqual({ error: "not_found" });
    expect(await addManagerMessage(otherCtx, { ticketId: reqA }, "Bonjour")).toEqual({ error: "not_found" });
    expect(await addManagerMessage(otherCtx, { conversationId: convA }, "Bonjour")).toEqual({ error: "not_found" });
    expect(await createIntervention(otherCtx, reqA)).toEqual({ error: "not_found" });
    expect(db.table("tickets").find((t) => t.id === reqA)!.status).toBe("new");
    expect(db.table("messages").filter((m) => m.conversation_id === convA)).toEqual([]);
    expect(db.table("work_orders")).toEqual([]);
    // Nor does a read mark from elsewhere touch her thread.
    expect("id" in (await addTenantMessage(db.tenantClient(anna), anna, leaseA, { id: reqA, title: "Question d'Anna" }, "Toujours là ?"))).toBe(true);
    expect(await markConversationRead(otherCtx, convA)).toEqual({ marked: 0 });
    expect(db.table("messages").find((m) => m.conversation_id === convA)!.read_at ?? null).toBeNull();

    // Anna, with Luc's ids in hand, reads and writes nothing of his, even once the desk answered him.
    expect("id" in (await addManagerMessage(ctx, { ticketId: reqB }, "Bonjour Luc"))).toBe(true);
    const convB = String(db.table("conversations").find((c) => c.scope_id === reqB)!.id);
    const g = db.tenantClient(anna);
    expect((await g.from("tickets").select("*").eq("id", reqB)).data).toEqual([]);
    expect((await g.from("conversations").select("*").eq("id", convB)).data).toEqual([]);
    expect((await g.from("messages").select("*").eq("conversation_id", convB)).data).toEqual([]);
    expect((await g.from("documents").select("*").eq("related_id", reqB)).data).toEqual([]);
    expect(await addTenantMessage(g, anna, leaseB, { id: reqB, title: "Question de Luc" }, "Moi aussi")).toEqual({ error: "forbidden" });
    expect(await attachTenantFiles(g, anna, leaseB, reqB, [{ path: `${attachmentFolder(ORG, rentalB.leaseId)}x.jpg`, name: "x", mime: "image/jpeg", sizeBytes: 1 }])).toEqual({ error: "forbidden" });
    // Each request is exactly as its own people left it.
    expect((await space(db, luc)).requests.map((r) => [r.title, r.messages.map((m) => m.body)])).toEqual([["Question de Luc", ["Bonjour Luc"]]]);
    expect((await space(db, anna)).requests.map((r) => [r.title, r.messages.map((m) => m.body)])).toEqual([["Question d'Anna", ["Toujours là ?"]]]);
    expect((await space(db, nora)).requests.map((r) => r.title)).toEqual(["Question de Nora"]);

    // Only the desk's four statuses are accepted, and each failure has its HTTP answer.
    expect(parseRequestStatus("resolved")).toBe("resolved");
    expect(parseRequestStatus("done")).toBeNull();
    expect(parseRequestStatus(42)).toBeNull();
    expect([statusOfFailure("invalid"), statusOfFailure("not_found"), statusOfFailure("forbidden"), statusOfFailure("storage_failed")]).toEqual([400, 404, 403, 502]);
    expect(await addManagerMessage(ctx, { ticketId: reqA }, "   ")).toEqual({ error: "invalid" });
    expect(await addManagerMessage(ctx, { ticketId: reqA }, 42)).toEqual({ error: "invalid" });
  });

  it("keeps a plain conversation a conversation: no request, no status, nothing for the tenant's space", async () => {
    const rental = await letTo(ctx, unitId, [ANNA]);
    await linkAccount(db, ctx, rental, anna);
    const conversation = db.insertRow("conversations", { org_id: ORG, scope_type: "lease", scope_id: rental.leaseId, subject: "Relevé des compteurs" });
    const sent = await addManagerMessage(ctx, { conversationId: String(conversation.id) }, "Pouvez-vous relever le compteur d'eau ?");
    if ("error" in sent) throw new Error(sent.error);
    expect(sent.conversationId).toBe(conversation.id);

    const demo = await hydrate(db);
    expect(demo.TICKETS).toEqual([]);
    const thread = demo.CONVERSATIONS.find((c) => c.id === conversation.id)!;
    expect([thread.scopeType, thread.scopeId, thread.participantName]).toEqual(["lease", rental.leaseId, "Anna Weber"]);
    expect(thread.messages.map((m) => [m.kind, m.body])).toEqual([["manager", "Pouvez-vous relever le compteur d'eau ?"]]);
    expect(thread.lastMessageAt).toBe(db.table("messages")[0].sent_at);
    // The stand-in id of a request whose thread is not open yet never collides with a conversation's.
    expect(isPendingThreadId(pendingThreadId("abc"))).toBe(true);
    expect(isPendingThreadId(String(conversation.id))).toBe(false);
    // A lease's thread is the desk's own; the tenant's space reads request threads only.
    const g = db.tenantClient(anna);
    expect((await g.from("conversations").select("*").eq("id", conversation.id)).data).toEqual([]);
    expect((await g.from("messages").select("*").eq("conversation_id", conversation.id)).data).toEqual([]);
    expect((await space(db, anna)).requests).toEqual([]);
  });
});

describe("the request vocabulary the desk and the tenant share", () => {
  it("folds the intervention statuses into four and picks one back", () => {
    expect(["new", "triaged"].map(requestStatusOf)).toEqual(["todo", "todo"]);
    expect(["offered", "scheduled", "in_progress", "pending_tenant"].map(requestStatusOf)).toEqual(["in_progress", "in_progress", "in_progress", "in_progress"]);
    expect(["done", "closed"].map(requestStatusOf)).toEqual(["resolved", "resolved"]);
    expect(requestStatusOf("cancelled")).toBe("refused");
    for (const status of REQUEST_STATUSES) expect(requestStatusOf(ticketStatusFor(status))).toBe(status);
    expect(REQUEST_STATUSES.map(isRequestOpen)).toEqual([true, true, false, false]);
    expect(["new", "in_progress", "done", "cancelled"].map(requestState)).toEqual(["sent", "in_progress", "resolved", "refused"]);
  });

  it("makes a request an intervention only once the owner opened one on it", () => {
    expect(isIntervention({ source: "tenant", interventionId: null })).toBe(false);
    expect(isIntervention({ source: "tenant", interventionId: "wo-1" })).toBe(true);
    expect(isIntervention({ source: "manager", interventionId: null })).toBe(true);
    expect(isIntervention({ source: "edl_defect", interventionId: null })).toBe(true);
  });
});
