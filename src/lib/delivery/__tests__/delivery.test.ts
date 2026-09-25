import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fr } from "@/lib/i18n/fr";
import { getDict } from "@/lib/i18n";
import type { OrgContext } from "@/lib/gestion/api";
import { parseDossierInput, saveRentalDraft, type DossierInput } from "@/lib/gestion/rental";
import { activateLease } from "@/lib/gestion/lease";
import { addManagerMessage } from "@/lib/gestion/requests";
import { addTenantMessage, createTenantRequest, parseRequestInput } from "@/lib/portal/requests";
import { documentMail, excerptOf, messageMail, requestMail, tenantMessageMail } from "@/lib/delivery/compose";
import { sendDocumentByMail } from "@/lib/delivery/outbox";
import { generateDocument, type Generated } from "@/lib/documents/generate";
import { templateVersion } from "@/lib/documents/wording";
import { sendMail } from "@/lib/mail";
import { FakeDb, type Row } from "@/lib/__tests__/helpers/fake-postgrest";

/**
 * The outbox: what an e-mail says in each language, how the sender talks
 * to Resend (attachment as base64, reply-to, the id read back) and what it
 * answers without a key; then, on one database, the desk's word recorded
 * for the tenant in their language unless the workspace turned it off,
 * the tenant's word and request recorded for the desk through the portal
 * functions and on the tenant's own lease only, and a piece of the tenancy
 * mailed with its file attached, refused for what is not the lease's.
 */
const ORG = "0f0f0f0f-0000-4000-8000-0000000000bb";
const today = new Date().toISOString().slice(0, 10);
const ANNA = { firstName: "Anna", lastName: "Weber", email: "anna.weber@example.lu" };
const TENANT_USER = "tenant-user-1";
const SETTINGS = { org_id: ORG, legal_name: "Cabinet Test s.à r.l.", address_street: "Rue de Bonnevoie", address_number: "24", postal_code: "1260", city: "Luxembourg", email: "desk@example.lu", iban: "LU280019400644750000", holder_name: "Cabinet Test s.à r.l.", document_lang: "fr" };

function ctxFor(db: FakeDb): OrgContext {
  return { g: db.client(), org: { id: ORG, name: "Cabinet Test", kind: "owner", role: "owner" }, userId: "user-1" };
}

/** The bucket, remembered in memory: what was uploaded is what a download hands back. */
function fakeStorage(): { client: SupabaseClient; files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>();
  const client = {
    storage: {
      from: () => ({
        upload: async (path: string, bytes: Buffer) => {
          files.set(path, bytes);
          return { data: { path }, error: null };
        },
        download: async (path: string) => {
          const bytes = files.get(path);
          return bytes ? { data: new Blob([new Uint8Array(bytes)]), error: null } : { data: null, error: { message: "not found" } };
        },
        remove: async () => ({ data: [], error: null }),
      }),
    },
  } as unknown as SupabaseClient;
  return { client, files };
}

const dossier = (body: Record<string, unknown>): DossierInput => {
  const input = parseDossierInput(body, "fr");
  if (!input) throw new Error("unreadable dossier");
  return input;
};

async function seed(db: FakeDb, ctx: OrgContext): Promise<{ propertyId: string; unitId: string; leaseId: string; contactId: string }> {
  const property = db.insertRow("properties", { org_id: ORG, name: "Maison Weber", type: "house", address: { street: "Rue de la Gare", number: "12", postal_code: "8001", city: "Strassen" }, commune: "Strassen" });
  const unit = db.insertRow("units", { org_id: ORG, property_id: property.id, label: "Maison", kind: "dwelling", area_sqm: 120, rooms: 5 });
  const saved = await saveRentalDraft(ctx, fr, dossier({ unitId: unit.id, step: "rent", tenants: [ANNA], rent: "1250", startDate: today, paymentDay: "1" }));
  if ("error" in saved) throw new Error(saved.error);
  const active = await activateLease(ctx, saved.leaseId, today);
  if ("error" in active) throw new Error(active.error);
  const contact = db.table("contacts").find((c) => c.email === ANNA.email)!;
  // The tenant reads and writes in German, and holds the account the portal links.
  await ctx.g.from("contacts").update({ language: "de", user_id: TENANT_USER }).eq("org_id", ORG).eq("id", contact.id);
  db.insertRow("agencies", { id: ORG, name: "Cabinet Test", email: "" });
  return { propertyId: String(property.id), unitId: String(unit.id), leaseId: saved.leaseId, contactId: String(contact.id) };
}

describe("what an e-mail says", () => {
  it("names the document, the home and the sender in each language, without machine punctuation", () => {
    for (const lang of ["fr", "en", "de", "lu"] as const) {
      const d = getDict(lang);
      const m = documentMail(d, { firstName: "Anna", org: "Cabinet Test", home: "Maison · Maison Weber", kind: "Quittance de loyer", link: "https://app.example/locataire/bail" });
      expect(m.subject, lang).toContain("Quittance de loyer");
      expect(m.subject, lang).toContain("Maison Weber");
      expect(m.text, lang).toContain("Anna");
      expect(m.text, lang).toContain("Cabinet Test");
      expect(m.text, lang).toContain("https://app.example/locataire/bail");
      expect(m.html, lang).toContain('href="https://app.example/locataire/bail"');
      expect(m.subject + m.text, lang).not.toMatch(/—|→/);
    }
  });
  it("quotes the first words of a message, escapes what goes into HTML, and names the request", () => {
    const long = "Bonjour,\n\nla chaudière   est réparée. ".repeat(30);
    const m = messageMail(fr, { firstName: "", org: "Cabinet <Test>", home: "Apt 3B", excerpt: excerptOf(long), link: "https://app.example/locataire/messages" });
    expect(m.subject).toBe("Nouveau message de Cabinet <Test> : Apt 3B");
    expect(m.text.startsWith("Bonjour,")).toBe(true);
    expect(m.html).toContain("Cabinet &lt;Test&gt;");
    expect(m.html).not.toContain("<Test>");
    const q = excerptOf(long);
    expect(q.length).toBe(400);
    expect(q.endsWith("…")).toBe(true);
    expect(q).not.toContain("  ");
    const t = tenantMessageMail(fr, { name: "Anna Weber", home: "Apt 3B", excerpt: "Fuite", link: "https://app.example/app/messages" });
    expect(t.subject).toBe("Message de Anna Weber : Apt 3B");
    expect(t.text).toContain("Fuite");
    const r = requestMail(fr, { name: "Anna Weber", home: "Apt 3B", title: "Fuite sous l'évier", excerpt: "", link: "https://app.example/app/messages?demande=t-1" });
    expect(r.subject).toBe("Nouvelle demande de Anna Weber : Fuite sous l'évier");
    expect(r.text).toContain("?demande=t-1");
  });
});

describe("the sender", () => {
  const env = process.env;
  beforeEach(() => {
    process.env = { ...env };
  });
  afterEach(() => {
    process.env = env;
    vi.restoreAllMocks();
  });
  it("does nothing without a key, and says so", async () => {
    delete process.env.RESEND_API_KEY;
    expect(await sendMail({ to: "a@example.lu", subject: "s", text: "t", html: "<p>t</p>" })).toEqual({ sent: false, reason: "not_configured" });
  });
  it("posts to Resend with the attachment as base64 and the reply-to, and reads the id back", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.MORADA_MAIL_FROM = "Test <t@example.lu>";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "msg_1" }), { status: 200 }));
    const r = await sendMail({ to: "a@example.lu", subject: "s", text: "t", html: "<p>t</p>", replyTo: "desk@example.lu", attachments: [{ filename: "q.pdf", content: Buffer.from("%PDF-1.4") }] });
    expect(r).toEqual({ sent: true, id: "msg_1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ from: "Test <t@example.lu>", to: ["a@example.lu"], subject: "s", reply_to: "desk@example.lu", attachments: [{ filename: "q.pdf", content: Buffer.from("%PDF-1.4").toString("base64") }] });
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer re_test");
  });
  it("reports a refusal and an unreachable service without throwing", async () => {
    process.env.RESEND_API_KEY = "re_test";
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("nope", { status: 422 }));
    expect(await sendMail({ to: "a@example.lu", subject: "s", text: "t", html: "" })).toEqual({ sent: false, reason: "rejected" });
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("down"));
    expect(await sendMail({ to: "a@example.lu", subject: "s", text: "t", html: "" })).toEqual({ sent: false, reason: "unreachable" });
  });
});

describe("the outbox on one database", () => {
  const env = process.env;
  let db: FakeDb;
  let ctx: OrgContext;
  let storage: ReturnType<typeof fakeStorage>;
  let leaseId: string;
  let unitId: string;
  let propertyId: string;
  let contactId: string;

  beforeEach(async () => {
    process.env = { ...env };
    delete process.env.RESEND_API_KEY;
    db = new FakeDb(today);
    ctx = ctxFor(db);
    storage = fakeStorage();
    ({ leaseId, unitId, propertyId, contactId } = await seed(db, ctx));
  });
  afterEach(() => {
    process.env = env;
    vi.restoreAllMocks();
  });

  const deliveries = (): Row[] => db.table("deliveries");

  it("tells the tenant of the desk's word, in the tenant's language, and records it; not once the workspace turned it off", async () => {
    const r = await addManagerMessage(ctx, { leaseId }, "Bonjour Anna, la chaudière est réparée.");
    expect("error" in r).toBe(false);
    expect(deliveries()).toHaveLength(1);
    expect(deliveries()[0]).toMatchObject({ org_id: ORG, kind: "message", lease_id: leaseId, recipient_kind: "tenant", recipient_contact_id: contactId, recipient_email: ANNA.email, lang: "de", status: "not_configured", provider: null, created_by: "user-1", sent_at: null });
    expect(String(deliveries()[0].subject)).toBe("Neue Nachricht von Cabinet Test: Maison · Maison Weber");
    expect(String(deliveries()[0].body_text)).toContain("la chaudière est réparée");
    // A word on the request's or the conversation's thread finds the same tenancy.
    const conversationId = (r as { conversationId: string }).conversationId;
    expect("error" in (await addManagerMessage(ctx, { conversationId }, "Encore un mot."))).toBe(false);
    expect(deliveries()).toHaveLength(2);
    // Off: the word still goes through, nobody is mailed.
    db.insertRow("workspace_settings", { ...SETTINGS, notify_tenant_messages: false });
    expect("error" in (await addManagerMessage(ctx, { leaseId }, "Un troisième."))).toBe(false);
    expect(deliveries()).toHaveLength(2);
  });

  it("tells the desk of the tenant's word and request through the portal functions, on the tenant's own lease only", async () => {
    db.insertRow("workspace_settings", SETTINGS);
    const tenant = db.tenantClient({ id: TENANT_USER, email: ANNA.email });
    const lease = { id: leaseId, orgId: ORG, subject: "Maison · Maison Weber" };
    const m = await addTenantMessage(tenant, { id: TENANT_USER }, lease, "Bonjour, une question sur les charges.");
    expect("error" in m).toBe(false);
    const toDesk = () => deliveries().filter((x) => x.recipient_kind === "manager");
    expect(toDesk()).toHaveLength(1);
    expect(toDesk()[0]).toMatchObject({ org_id: ORG, kind: "message", lease_id: leaseId, recipient_email: "desk@example.lu", lang: "fr", status: "not_configured", created_by: TENANT_USER });
    expect(String(toDesk()[0].subject)).toBe("Message de Anna Weber : Maison · Maison Weber");
    expect(String(toDesk()[0].body_text)).toContain("une question sur les charges");
    const input = parseRequestInput({ kind: "technical", title: "Fuite sous l'évier", description: "Depuis ce matin.", severity: "priority", category: "plumbing" });
    expect(input).not.toBeNull();
    const req = await createTenantRequest(tenant, { id: TENANT_USER }, { ...lease, unitId, propertyId }, input!);
    expect("error" in req).toBe(false);
    const requests = deliveries().filter((x) => x.kind === "request");
    expect(requests).toHaveLength(1);
    expect(String(requests[0].subject)).toBe("Nouvelle demande de Anna Weber : Fuite sous l'évier");
    expect(String(requests[0].body_text)).toContain(`?demande=${(req as { id: string }).id}`);
    expect(String(requests[0].body_text)).toContain("Depuis ce matin.");
    // Nothing is recorded on a lease that is not the tenant's, and nothing without a valid kind.
    const foreign = await tenant.rpc("portal_record_delivery", { p_lease: "not-mine", p_kind: "message", p_recipient_email: "x@example.lu", p_lang: "fr", p_subject: "s", p_body: "b", p_status: "sent", p_provider: "resend", p_provider_message_id: "" });
    expect(foreign.error).toBeTruthy();
    const badKind = await tenant.rpc("portal_record_delivery", { p_lease: leaseId, p_kind: "document", p_recipient_email: "x@example.lu", p_lang: "fr", p_subject: "s", p_body: "b", p_status: "sent", p_provider: "", p_provider_message_id: "" });
    expect(badKind.error).toBeTruthy();
    expect(toDesk()).toHaveLength(2);
    // Off: the workspace no longer wants to be told.
    await ctx.g.from("workspace_settings").update({ notify_manager_messages: false }).eq("org_id", ORG);
    expect("error" in (await addTenantMessage(tenant, { id: TENANT_USER }, lease, "Encore une."))).toBe(false);
    expect(toDesk()).toHaveLength(2);
  });

  it("mails a piece of the tenancy to its tenants with the file attached, records each, and refuses what is not the lease's", async () => {
    db.insertRow("workspace_settings", SETTINGS);
    db.insertRow("template_validations", { org_id: ORG, kind: "rent_notice", lang: "fr", version: templateVersion("rent_notice", "fr") });
    const period = db.table("rent_periods").filter((r) => r.lease_id === leaseId).sort((a, b) => String(a.period).localeCompare(String(b.period)))[0];
    const produced = await generateDocument(ctx, storage.client, { kind: "rent_notice", sourceId: String(period.id), today });
    if ("error" in produced) throw new Error(JSON.stringify(produced));
    const g = produced as Generated;
    const out = await sendDocumentByMail(ctx, storage.client, g.documentId);
    expect(out).toMatchObject({ name: g.name, deliveries: [{ email: ANNA.email, status: "not_configured" }] });
    const row = deliveries().find((x) => x.kind === "document")!;
    expect(row).toMatchObject({ document_id: g.documentId, lease_id: leaseId, recipient_kind: "tenant", recipient_contact_id: contactId, recipient_email: ANNA.email, lang: "de", status: "not_configured", provider: null });
    expect(String(row.subject)).toBe(`${getDict("de").documents.kindLabels.rent_notice} · Maison · Maison Weber`);
    expect(String(row.body_text)).toContain("/locataire/bail");
    // With a key, the file goes with the mail and the outbox says it left.
    process.env.RESEND_API_KEY = "re_test";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "msg_2" }), { status: 200 }));
    const sent = await sendDocumentByMail(ctx, storage.client, g.documentId);
    expect(sent).toMatchObject({ deliveries: [{ email: ANNA.email, status: "sent" }] });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.reply_to).toBe("desk@example.lu");
    expect(body.attachments).toHaveLength(1);
    expect(body.attachments[0].filename).toBe(g.name);
    expect(Buffer.from(String(body.attachments[0].content), "base64").subarray(0, 5).toString()).toBe("%PDF-");
    const sentRow = deliveries().filter((x) => x.kind === "document")[1];
    expect(sentRow).toMatchObject({ status: "sent", provider: "resend", provider_message_id: "msg_2" });
    expect(sentRow.sent_at).toBeTruthy();
    // Refused: an id that is nobody's, a piece of the property rather than the lease, a tenant without an address.
    expect(await sendDocumentByMail(ctx, storage.client, "not-a-document")).toEqual({ error: "not_found" });
    const other = db.insertRow("documents", { org_id: ORG, class: "other", name: "x.pdf", storage_path: `${ORG}/documents/x.pdf`, related_type: "property", related_id: propertyId });
    expect(await sendDocumentByMail(ctx, storage.client, String(other.id))).toEqual({ error: "not_found" });
    await ctx.g.from("contacts").update({ email: "" }).eq("org_id", ORG).eq("id", contactId);
    expect(await sendDocumentByMail(ctx, storage.client, g.documentId)).toEqual({ error: "no_recipient" });
    expect(deliveries().filter((x) => x.kind === "document")).toHaveLength(2);
  });
});
