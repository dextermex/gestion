import { beforeEach, describe, expect, it } from "vitest";
import type { OrgContext } from "@/lib/gestion/api";
import { closeLease } from "@/lib/gestion/lease";
import { addManagerMessage, createIntervention, markConversationRead, parseRequestStatus, setRequestStatus, statusOfFailure } from "@/lib/gestion/requests";
import { addTenantMessage, attachTenantFiles, createTenantRequest, parseRequestInput } from "@/lib/portal/requests";
import { leaseConversation } from "@/lib/portal/thread";
import { REQUEST_STATUSES, attachmentFolder, isIntervention, isRequestOpen, leaseSubject, requestState, requestStatusOf, ticketStatusFor } from "@/lib/portal/types";
import { addDays, addMonths } from "@/domain/dates";
import { FakeDb } from "./helpers/fake-postgrest";
import { ORG, OTHER_ORG, ctxFor, hydrate, letTo, linkAccount, seedProperty, space } from "./helpers/tenancy";

/**
 * One conversation per tenancy, with the tenant's requests inside it,
 * both sides on one database.
 *
 * The tenant's side runs the portal functions under a client bound to the
 * tenant's account, where the database's policies decide every row. The
 * desk's side runs the functions the Messages routes call, under the
 * manager's context. What each side reads is asserted against the same
 * rows: one conversation, one set of messages, the tickets they carry.
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
const question = (title: string, description: string) => parseRequestInput({ kind: "question", title, description })!;

describe("a tenancy's conversation, with the tenant's requests inside it", () => {
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

  it("runs the whole flow: chat, request with photos, replies, a second request, more chat, resolution, history", async () => {
    const rental = await letTo(ctx, unitId, [ANNA]);
    await linkAccount(db, ctx, rental, anna);
    const lease = { id: rental.leaseId, orgId: ORG, unitId, propertyId, subject: "Maison · Maison Weber" };
    const tenant = db.tenantClient(anna);
    const conversations = () => db.table("conversations").filter((c) => c.scope_type === "lease" && c.scope_id === rental.leaseId);
    const ownerThread = async () => (await hydrate(db)).CONVERSATIONS.find((c) => c.scopeType === "lease" && c.scopeId === rental.leaseId)!;

    // ── A normal message opens the conversation ──
    const hello = await addTenantMessage(tenant, anna, lease, "Bonjour, j'ai une question sur mon bail.");
    if ("error" in hello) throw new Error(hello.error);
    expect(conversations()).toHaveLength(1);
    const conversationId = String(conversations()[0].id);
    expect(hello.conversationId).toBe(conversationId);
    expect(conversations()[0].subject).toBe("Maison · Maison Weber");
    let thread = await ownerThread();
    expect([thread.id, thread.participantName, thread.unread]).toEqual([conversationId, "Anna Weber", 1]);
    expect(thread.messages.map((m) => [m.kind, m.body, m.ticketId])).toEqual([["tenant", "Bonjour, j'ai une question sur mon bail.", null]]);
    expect((await hydrate(db)).TICKETS).toEqual([]);

    // ── The desk answers on it ──
    const reply = await addManagerMessage(ctx, { conversationId }, "Bonjour Anna, je vous écoute.");
    if ("error" in reply) throw new Error(reply.error);
    expect(reply.conversationId).toBe(conversationId);
    let mine = await space(db, anna);
    expect(mine.conversations.map((c) => [c.id, c.leaseId, c.label])).toEqual([[conversationId, rental.leaseId, "Maison · Maison Weber"]]);
    expect(mine.conversations[0].messages.map((m) => [m.mine, m.senderKind, m.body])).toEqual([
      [true, "tenant", "Bonjour, j'ai une question sur mon bail."],
      [false, "manager", "Bonjour Anna, je vous écoute."],
    ]);

    // ── A request, with two photos, takes its place in the same conversation ──
    const first = await createTenantRequest(tenant, anna, lease, technical("Fuite sous l'évier", "De l'eau coule sous l'évier depuis ce matin."));
    if ("error" in first) throw new Error(first.error);
    expect(first.conversationId).toBe(conversationId);
    expect(conversations()).toHaveLength(1);
    const folder = attachmentFolder(ORG, rental.leaseId);
    expect(
      await attachTenantFiles(tenant, anna, lease, first.id, [
        { path: `${folder}a.jpg`, name: "evier-1.jpg", mime: "image/jpeg", sizeBytes: 90000 },
        { path: `${folder}b.jpg`, name: "evier-2.jpg", mime: "image/jpeg", sizeBytes: 120000 },
      ]),
    ).toEqual({ attached: 2 });
    let demo = await hydrate(db);
    let ticket = demo.TICKETS.find((t) => t.id === first.id)!;
    expect([ticket.source, ticket.leaseId, ticket.conversationId, ticket.interventionId]).toEqual(["tenant", rental.leaseId, conversationId, null]);
    expect(ticket.attachments.map((a) => a.name)).toEqual(["evier-1.jpg", "evier-2.jpg"]);
    expect(requestStatusOf(ticket.status)).toBe("todo");
    expect(isIntervention(ticket)).toBe(false);
    thread = demo.CONVERSATIONS.find((c) => c.id === conversationId)!;
    expect(thread.messages.map((m) => [m.kind, m.body, m.ticketId])).toEqual([
      ["tenant", "Bonjour, j'ai une question sur mon bail.", null],
      ["manager", "Bonjour Anna, je vous écoute.", null],
      ["tenant", "Fuite sous l'évier", first.id],
    ]);
    // The desk has read the first message by answering; the request is new to it.
    expect(await markConversationRead(ctx, conversationId)).toEqual({ marked: 2 });
    expect((await ownerThread()).unread).toBe(0);
    expect(db.table("tickets").find((t) => t.id === first.id)!.status).toBe("new");

    // ── Chat continues under the request, on both sides ──
    const onRequest = await addManagerMessage(ctx, { ticketId: first.id }, "Un plombier passe jeudi matin.");
    if ("error" in onRequest) throw new Error(onRequest.error);
    expect(onRequest.conversationId).toBe(conversationId);
    expect("id" in (await addTenantMessage(tenant, anna, lease, "Jeudi matin me convient."))).toBe(true);
    expect(conversations()).toHaveLength(1);

    // ── A second request, then more chat ──
    const second = await createTenantRequest(tenant, anna, lease, question("Ampoule du couloir", "L'ampoule du palier ne s'allume plus."));
    if ("error" in second) throw new Error(second.error);
    expect(second.conversationId).toBe(conversationId);
    expect("id" in (await addManagerMessage(ctx, { conversationId }, "C'est noté pour l'ampoule."))).toBe(true);
    expect(conversations()).toHaveLength(1);
    demo = await hydrate(db);
    expect(demo.TICKETS.map((t) => [t.title, t.conversationId])).toEqual([
      ["Fuite sous l'évier", conversationId],
      ["Ampoule du couloir", conversationId],
    ]);

    // ── The first request is resolved; the second waits; the conversation reads the same on both sides ──
    expect(await setRequestStatus(ctx, first.id, "resolved")).toEqual({ status: "resolved" });
    demo = await hydrate(db);
    expect(demo.TICKETS.map((t) => requestStatusOf(t.status))).toEqual(["resolved", "todo"]);
    mine = await space(db, anna);
    expect(mine.requests.map((r) => [r.title, r.state, r.conversationId])).toEqual([
      ["Ampoule du couloir", "sent", conversationId],
      ["Fuite sous l'évier", "resolved", conversationId],
    ]);
    const chronology = [
      ["Bonjour, j'ai une question sur mon bail.", null],
      ["Bonjour Anna, je vous écoute.", null],
      ["Fuite sous l'évier", first.id],
      ["Un plombier passe jeudi matin.", null],
      ["Jeudi matin me convient.", null],
      ["Ampoule du couloir", second.id],
      ["C'est noté pour l'ampoule.", null],
    ];
    expect(demo.CONVERSATIONS.find((c) => c.id === conversationId)!.messages.map((m) => [m.body, m.ticketId])).toEqual(chronology);
    expect(mine.conversations[0].messages.map((m) => [m.body, m.ticketId])).toEqual(chronology);
    expect(mine.conversations[0].messages.map((m) => m.mine)).toEqual([true, false, true, false, true, true, false]);

    // ── "Créer une intervention" on the first request: a work order, the conversation untouched ──
    const work = await createIntervention(ctx, first.id);
    if ("error" in work) throw new Error(work.error);
    expect(work.created).toBe(true);
    expect(await createIntervention(ctx, first.id)).toEqual({ id: work.id, created: false });
    demo = await hydrate(db);
    ticket = demo.TICKETS.find((t) => t.id === first.id)!;
    expect([ticket.interventionId, isIntervention(ticket)]).toEqual([work.id, true]);
    expect(demo.TICKETS.filter(isIntervention).map((t) => t.id)).toEqual([first.id]);
    expect(demo.CONVERSATIONS.find((c) => c.id === conversationId)!.messages).toHaveLength(7);

    // ── Reopened, refused, resolved again: one status, read two ways ──
    expect(await setRequestStatus(ctx, second.id, "in_progress")).toEqual({ status: "in_progress" });
    expect(await setRequestStatus(ctx, second.id, "refused")).toEqual({ status: "refused" });
    let row = db.table("tickets").find((t) => t.id === second.id)!;
    expect([row.status, row.closed_at !== null]).toEqual(["cancelled", true]);
    mine = await space(db, anna);
    expect(mine.requests.find((r) => r.id === second.id)!.state).toBe("refused");
    expect(await setRequestStatus(ctx, second.id, "todo")).toEqual({ status: "todo" });
    row = db.table("tickets").find((t) => t.id === second.id)!;
    expect([row.status, row.closed_at]).toEqual(["new", null]);

    // ── The tenant leaves: the conversation and its requests stay theirs to read; nothing new can be asked ──
    const closed = await closeLease(ctx, rental.leaseId, { endDate: endOfMonth, depositOutcome: "released", releasedCents: 0, keysReturned: true, decompteIssuedOn: null }, today);
    if ("error" in closed) throw new Error(closed.error);
    mine = await space(db, anna);
    expect(mine.current).toBeNull();
    expect(mine.past.map((l) => l.id)).toEqual([rental.leaseId]);
    expect(mine.conversations.map((c) => c.messages.length)).toEqual([7]);
    expect(mine.requests).toHaveLength(2);
    expect(await createTenantRequest(tenant, anna, lease, technical("Encore", "x"))).toEqual({ error: "forbidden" });
    expect(await attachTenantFiles(tenant, anna, lease, first.id, [{ path: `${folder}late.jpg`, name: "late", mime: "image/jpeg", sizeBytes: 1 }])).toEqual({ error: "forbidden" });
    // A word about the guarantee still goes through, both ways.
    expect("id" in (await addManagerMessage(ctx, { conversationId }, "La garantie est restituée."))).toBe(true);
    expect("id" in (await addTenantMessage(tenant, anna, lease, "Merci."))).toBe(true);
    mine = await space(db, anna);
    expect(mine.conversations[0].messages.slice(-2).map((m) => m.body)).toEqual(["La garantie est restituée.", "Merci."]);

    // ── The next tenant of the lot has a conversation of their own and sees none of this ──
    const next = await letTo(ctx, unitId, [NORA], "1 300");
    await linkAccount(db, ctx, next, nora);
    let hers = await space(db, nora);
    expect([hers.current?.id, hers.conversations, hers.requests]).toEqual([next.leaseId, [], []]);
    const other = db.tenantClient(nora);
    expect((await other.from("conversations").select("*").eq("id", conversationId)).data).toEqual([]);
    expect((await other.from("messages").select("*").eq("conversation_id", conversationId)).data).toEqual([]);
    expect((await other.from("tickets").select("*").eq("id", first.id)).data).toEqual([]);
    const hersFirst = await addTenantMessage(other, nora, { id: next.leaseId, orgId: ORG, subject: "Maison · Maison Weber" }, "Bonjour, je viens d'emménager.");
    if ("error" in hersFirst) throw new Error(hersFirst.error);
    expect(hersFirst.conversationId).not.toBe(conversationId);
    hers = await space(db, nora);
    expect(hers.conversations.map((c) => [c.leaseId, c.messages.length])).toEqual([[next.leaseId, 1]]);
    mine = await space(db, anna);
    expect(mine.conversations.map((c) => c.id)).toEqual([conversationId]);
    demo = await hydrate(db);
    expect(demo.CONVERSATIONS.filter((c) => c.scopeType === "lease").map((c) => c.participantName).sort()).toEqual(["Anna Weber", "Nora Adam"]);
  });

  it("keeps every cabinet's and every tenant's conversation apart, and answers a foreign id with not found", async () => {
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

    const leaseA = { id: rentalA.leaseId, orgId: ORG, unitId, propertyId, subject: "Maison · Maison Weber" };
    const leaseB = { id: rentalB.leaseId, orgId: ORG, unitId: unitB, propertyId: propertyB, subject: "Maison · Résidence Beaulieu" };
    const leaseC = { id: rentalC.leaseId, orgId: OTHER_ORG, unitId: unitC, propertyId: propertyC, subject: "Maison · Maison Adam" };
    const ask = async (user: { id: string; email: string }, lease: typeof leaseA, title: string) => {
      const r = await createTenantRequest(db.tenantClient(user), user, lease, question(title, "Une question."));
      if ("error" in r) throw new Error(r.error);
      return r;
    };
    expect("id" in (await addTenantMessage(db.tenantClient(anna), anna, leaseA, "Bonjour"))).toBe(true);
    const reqA = await ask(anna, leaseA, "Question d'Anna");
    const reqB = await ask(luc, leaseB, "Question de Luc");
    await ask(nora, leaseC, "Question de Nora");
    const convA = reqA.conversationId!;
    const convB = reqB.conversationId!;
    expect(convA).not.toBe(convB);

    // Each desk lists its own tenants' conversations and requests.
    const demo = await hydrate(db);
    expect(demo.CONVERSATIONS.map((c) => [c.participantName, c.messages.length]).sort()).toEqual([
      ["Anna Weber", 2],
      ["Luc Weber", 1],
    ]);
    expect(demo.TICKETS.map((t) => t.title).sort()).toEqual(["Question d'Anna", "Question de Luc"]);
    expect(demo.TICKETS.find((t) => t.id === reqA.id)!.description).toBe("[question] Une question.");
    const otherDemo = await hydrate(db, OTHER_ORG);
    expect(otherDemo.CONVERSATIONS.map((c) => c.participantName)).toEqual(["Nora Adam"]);
    expect(otherDemo.TICKETS.map((t) => t.title)).toEqual(["Question de Nora"]);

    // The other cabinet, holding Anna's ids, changes nothing: not found, and nothing leaks.
    expect(await setRequestStatus(otherCtx, reqA.id, "resolved")).toEqual({ error: "not_found" });
    expect(await addManagerMessage(otherCtx, { ticketId: reqA.id }, "Bonjour")).toEqual({ error: "not_found" });
    expect(await addManagerMessage(otherCtx, { conversationId: convA }, "Bonjour")).toEqual({ error: "not_found" });
    expect(await addManagerMessage(otherCtx, { leaseId: rentalA.leaseId }, "Bonjour")).toEqual({ error: "not_found" });
    expect(await createIntervention(otherCtx, reqA.id)).toEqual({ error: "not_found" });
    expect(await markConversationRead(otherCtx, convA)).toEqual({ marked: 0 });
    expect(db.table("tickets").find((t) => t.id === reqA.id)!.status).toBe("new");
    expect(db.table("messages").filter((m) => m.conversation_id === convA).map((m) => [m.body, m.read_at ?? null])).toEqual([
      ["Bonjour", null],
      ["Question d'Anna", null],
    ]);
    expect(db.table("work_orders")).toEqual([]);

    // Anna, with Luc's ids in hand, reads and writes nothing of his, even once the desk answered him.
    expect("id" in (await addManagerMessage(ctx, { ticketId: reqB.id }, "Bonjour Luc"))).toBe(true);
    const g = db.tenantClient(anna);
    expect((await g.from("tickets").select("*").eq("id", reqB.id)).data).toEqual([]);
    expect((await g.from("conversations").select("*").eq("id", convB)).data).toEqual([]);
    expect((await g.from("messages").select("*").eq("conversation_id", convB)).data).toEqual([]);
    expect(await addTenantMessage(g, anna, leaseB, "Moi aussi")).toEqual({ error: "forbidden" });
    expect(await attachTenantFiles(g, anna, leaseB, reqB.id, [{ path: `${attachmentFolder(ORG, rentalB.leaseId)}x.jpg`, name: "x", mime: "image/jpeg", sizeBytes: 1 }])).toEqual({ error: "forbidden" });
    // Nor can she anchor his request in her own conversation, or write in his name.
    const forgedAnchor = await g.from("messages").insert({ org_id: ORG, conversation_id: convA, sender_kind: "tenant", sender_user_id: anna.id, body: "x", ticket_id: reqB.id });
    expect(forgedAnchor.error?.code).toBe("42501");
    const forgedSender = await g.from("messages").insert({ org_id: ORG, conversation_id: convA, sender_kind: "manager", sender_user_id: anna.id, body: "x" });
    expect(forgedSender.error?.code).toBe("42501");
    // Each conversation is exactly as its own people left it.
    expect((await space(db, luc)).conversations.map((c) => c.messages.map((m) => m.body))).toEqual([["Question de Luc", "Bonjour Luc"]]);
    expect((await space(db, anna)).conversations.map((c) => c.messages.map((m) => m.body))).toEqual([["Bonjour", "Question d'Anna"]]);
    expect((await space(db, nora)).conversations.map((c) => c.messages.map((m) => m.body))).toEqual([["Question de Nora"]]);

    // Only the desk's four statuses are accepted, and each failure has its HTTP answer.
    expect(parseRequestStatus("resolved")).toBe("resolved");
    expect(parseRequestStatus("done")).toBeNull();
    expect(parseRequestStatus(42)).toBeNull();
    expect([statusOfFailure("invalid"), statusOfFailure("not_found"), statusOfFailure("forbidden"), statusOfFailure("storage_failed")]).toEqual([400, 404, 403, 502]);
    expect(await addManagerMessage(ctx, { conversationId: convA }, "   ")).toEqual({ error: "invalid" });
    expect(await addTenantMessage(g, anna, leaseA, "   ")).toEqual({ error: "invalid" });
  });

  it("lets the desk write first, keeps one conversation per tenancy however it is opened, and keeps a mandate's thread to the desk", async () => {
    const rental = await letTo(ctx, unitId, [ANNA]);
    await linkAccount(db, ctx, rental, anna);
    const lease = { id: rental.leaseId, orgId: ORG, subject: "Maison · Maison Weber" };

    // Nobody has written: the tenant's space has no conversation, the desk has a tenancy to open.
    expect((await space(db, anna)).conversations).toEqual([]);
    const opened = await addManagerMessage(ctx, { leaseId: rental.leaseId }, "Bonjour Anna, bienvenue.");
    if ("error" in opened) throw new Error(opened.error);
    const row = db.table("conversations").find((c) => c.id === opened.conversationId)!;
    expect([row.scope_type, row.scope_id, row.subject]).toEqual(["lease", rental.leaseId, "Maison · Maison Weber"]);
    // Both sides asking for it get the same one; nobody opens a second.
    expect(await leaseConversation(db.tenantClient(anna), lease)).toEqual({ id: opened.conversationId, created: false });
    expect(await leaseConversation(db.client(), lease)).toEqual({ id: opened.conversationId, created: false });
    const answered = await addTenantMessage(db.tenantClient(anna), anna, lease, "Merci, tout est parfait.");
    if ("error" in answered) throw new Error(answered.error);
    expect(answered.conversationId).toBe(opened.conversationId);
    expect(db.table("conversations")).toHaveLength(1);
    // The tenant reads it, in order; no request was created by talking.
    const mine = await space(db, anna);
    expect(mine.conversations[0].messages.map((m) => [m.mine, m.body])).toEqual([
      [false, "Bonjour Anna, bienvenue."],
      [true, "Merci, tout est parfait."],
    ]);
    expect(mine.requests).toEqual([]);
    let demo = await hydrate(db);
    expect(demo.TICKETS).toEqual([]);
    expect(demo.CONVERSATIONS.map((c) => [c.scopeType, c.unread])).toEqual([["lease", 1]]);

    // A mandate's thread is the desk's own: never the tenant's.
    const mandate = db.insertRow("conversations", { org_id: ORG, scope_type: "mandate", scope_id: null, subject: "Décompte de gérance" });
    expect("id" in (await addManagerMessage(ctx, { conversationId: String(mandate.id) }, "Décompte joint."))).toBe(true);
    demo = await hydrate(db);
    expect(demo.CONVERSATIONS.map((c) => c.scopeType).sort()).toEqual(["lease", "mandate"]);
    const g = db.tenantClient(anna);
    expect((await g.from("conversations").select("*").eq("id", mandate.id)).data).toEqual([]);
    expect((await g.from("messages").select("*").eq("conversation_id", mandate.id)).data).toEqual([]);
    expect((await space(db, anna)).conversations).toHaveLength(1);
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

  it("makes a request an intervention only once the owner opened one on it, and names a tenancy's conversation", () => {
    expect(isIntervention({ source: "tenant", interventionId: null })).toBe(false);
    expect(isIntervention({ source: "tenant", interventionId: "wo-1" })).toBe(true);
    expect(isIntervention({ source: "manager", interventionId: null })).toBe(true);
    expect(isIntervention({ source: "edl_defect", interventionId: null })).toBe(true);
    expect(leaseSubject("Apt 3B", "Résidence Beaulieu")).toBe("Apt 3B · Résidence Beaulieu");
    expect(leaseSubject(" Maison ", "")).toBe("Maison");
  });
});
