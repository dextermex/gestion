import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { APP_URL } from "@/lib/constants";
import type { GestionReader } from "@/lib/demo/data-real";
import type { OrgContext } from "@/lib/gestion/api";
import { MEDIA_BUCKET } from "@/lib/gestion/media";
import { getDict } from "@/lib/i18n";
import { LOCALES, type Locale } from "@/lib/i18n/config";
import { mailConfigured, sendMail, type MailMessage } from "@/lib/mail";
import { leaseSubject } from "@/lib/portal/types";
import { documentMail, excerptOf, messageMail, requestMail, tenantMessageMail } from "./compose";

/**
 * The outbox: every e-mail the application composes is a row of
 * `gestion.deliveries`, whether it left (Resend, when the deployment has a
 * key), was recorded without leaving (no key), was refused or could not be
 * reached. A document goes to the tenants of its lease with the PDF
 * attached; a word from the desk warns the tenant; a word or a request from
 * the tenant warns the desk, through the two portal functions the tenant's
 * token may call. Nothing here ever fails the write it follows: a
 * notification that cannot go out is a row saying so, not an error.
 */
type Row = Record<string, unknown>;
const s = (v: unknown): string => (typeof v === "string" ? v : "");
const localeOf = (v: unknown, fallback: Locale): Locale => (typeof v === "string" && (LOCALES as readonly string[]).includes(v) ? (v as Locale) : fallback);

export type DeliveryStatus = "sent" | "not_configured" | "rejected" | "unreachable";
export interface DeliveryOutcome {
  email: string;
  status: DeliveryStatus;
  id: string | null;
}

async function dispatch(message: MailMessage): Promise<{ status: DeliveryStatus; providerId: string | null }> {
  if (!mailConfigured()) return { status: "not_configured", providerId: null };
  const result = await sendMail(message);
  return result.sent ? { status: "sent", providerId: result.id } : { status: result.reason, providerId: null };
}

interface Recipient {
  contactId: string;
  email: string;
  firstName: string;
  lang: Locale;
}

interface WorkspaceMail {
  replyTo: string;
  lang: Locale;
  notifyTenant: boolean;
  notifyManager: boolean;
}

async function workspaceMail(ctx: OrgContext): Promise<WorkspaceMail> {
  const { data } = await ctx.g.from("workspace_settings").select("email,document_lang,notify_tenant_messages,notify_manager_messages").eq("org_id", ctx.org.id).maybeSingle();
  const row = (data as Row | null) ?? null;
  return {
    replyTo: s(row?.email),
    lang: localeOf(row?.document_lang, "fr"),
    notifyTenant: row?.notify_tenant_messages !== false,
    notifyManager: row?.notify_manager_messages !== false,
  };
}

/** The tenants of a lease who can be written to: still in the home, with an address. */
async function tenantRecipients(ctx: OrgContext, leaseId: string, fallbackLang: Locale): Promise<Recipient[]> {
  const { data: parties } = await ctx.g.from("lease_parties").select("contact_id,role,moved_out_on").eq("org_id", ctx.org.id).eq("lease_id", leaseId);
  const ids = ((parties ?? []) as Row[]).filter((p) => (s(p.role) === "tenant" || s(p.role) === "colocataire") && !p.moved_out_on).map((p) => s(p.contact_id));
  if (ids.length === 0) return [];
  const { data: contacts } = await ctx.g.from("contacts").select("id,first_name,display_name,email,language").eq("org_id", ctx.org.id).in("id", ids);
  return ((contacts ?? []) as Row[])
    .filter((c) => s(c.email).includes("@"))
    .map((c) => ({ contactId: s(c.id), email: s(c.email).trim().toLowerCase(), firstName: s(c.first_name) || s(c.display_name).split(" ")[0] || "", lang: localeOf(c.language, fallbackLang) }));
}

/** "Apt 3B · Résidence Beaulieu" for a lease of the workspace, or nothing if it cannot be read. */
async function homeOf(ctx: OrgContext, leaseId: string): Promise<string> {
  const { data: lease } = await ctx.g.from("leases").select("unit_id").eq("org_id", ctx.org.id).eq("id", leaseId).maybeSingle();
  if (!lease) return "";
  const { data: unit } = await ctx.g.from("units").select("label,property_id").eq("org_id", ctx.org.id).eq("id", s((lease as Row).unit_id)).maybeSingle();
  if (!unit) return "";
  const { data: property } = await ctx.g.from("properties").select("name").eq("org_id", ctx.org.id).eq("id", s((unit as Row).property_id)).maybeSingle();
  return leaseSubject(s((unit as Row).label), property ? s((property as Row).name) : "");
}

interface DeliveryRow {
  kind: "document" | "message" | "request";
  leaseId: string | null;
  documentId: string | null;
  recipientKind: "tenant" | "manager";
  recipientContactId: string | null;
  recipientEmail: string;
  lang: Locale;
  subject: string;
  bodyText: string;
  status: DeliveryStatus;
  providerId: string | null;
}

/** One line of the outbox, under the manager's own token. */
export async function recordDelivery(ctx: OrgContext, row: DeliveryRow): Promise<string | null> {
  const { data, error } = await ctx.g
    .from("deliveries")
    .insert({
      org_id: ctx.org.id,
      kind: row.kind,
      lease_id: row.leaseId,
      document_id: row.documentId,
      recipient_kind: row.recipientKind,
      recipient_contact_id: row.recipientContactId,
      recipient_email: row.recipientEmail,
      lang: row.lang,
      subject: row.subject.slice(0, 400),
      body_text: row.bodyText.slice(0, 20000),
      status: row.status,
      provider: row.status === "sent" ? "resend" : null,
      provider_message_id: row.providerId,
      created_by: ctx.userId,
      sent_at: row.status === "sent" ? new Date().toISOString() : null,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("delivery record failed:", error?.code, error?.message);
    return null;
  }
  return String(data.id);
}

/**
 * The desk wrote to a tenancy: its tenants are told by e-mail, each in
 * their language, when the workspace wants it. Never throws.
 */
export async function notifyTenantsOfMessage(ctx: OrgContext, input: { leaseId: string; text: string }): Promise<DeliveryOutcome[]> {
  try {
    const settings = await workspaceMail(ctx);
    if (!settings.notifyTenant) return [];
    const recipients = await tenantRecipients(ctx, input.leaseId, settings.lang);
    if (recipients.length === 0) return [];
    const home = await homeOf(ctx, input.leaseId);
    const out: DeliveryOutcome[] = [];
    for (const r of recipients) {
      const d = getDict(r.lang);
      const mail = messageMail(d, { firstName: r.firstName, org: ctx.org.name, home, excerpt: excerptOf(input.text), link: `${APP_URL}/locataire/messages` });
      const result = await dispatch({ to: r.email, replyTo: settings.replyTo || undefined, ...mail });
      const id = await recordDelivery(ctx, {
        kind: "message",
        leaseId: input.leaseId,
        documentId: null,
        recipientKind: "tenant",
        recipientContactId: r.contactId,
        recipientEmail: r.email,
        lang: r.lang,
        subject: mail.subject,
        bodyText: mail.text,
        status: result.status,
        providerId: result.providerId,
      });
      out.push({ email: r.email, status: result.status, id });
    }
    return out;
  } catch (e) {
    console.error("tenant notification failed:", e);
    return [];
  }
}

/** The lease a conversation belongs to: its own, or its request's. */
export async function leaseOfConversation(ctx: OrgContext, conversationId: string): Promise<string | null> {
  const { data } = await ctx.g.from("conversations").select("scope_type,scope_id").eq("org_id", ctx.org.id).eq("id", conversationId).maybeSingle();
  const row = (data as Row | null) ?? null;
  if (!row || !row.scope_id) return null;
  if (s(row.scope_type) === "lease") return s(row.scope_id);
  if (s(row.scope_type) === "ticket") {
    const { data: ticket } = await ctx.g.from("tickets").select("lease_id").eq("org_id", ctx.org.id).eq("id", s(row.scope_id)).maybeSingle();
    return ticket && (ticket as Row).lease_id ? s((ticket as Row).lease_id) : null;
  }
  return null;
}

export type SendDocumentFailure = "not_found" | "no_recipient" | "storage_failed";

/**
 * A piece of the tenancy, mailed to its tenants with the PDF attached: the
 * document's own kind names it, in each tenant's language. Only a piece
 * related to a lease of the workspace, with a file behind it.
 */
export async function sendDocumentByMail(
  ctx: OrgContext,
  client: SupabaseClient,
  documentId: string,
): Promise<{ name: string; deliveries: DeliveryOutcome[] } | { error: SendDocumentFailure }> {
  const { data: doc, error } = await ctx.g.from("documents").select("id,name,storage_path,related_type,related_id").eq("org_id", ctx.org.id).eq("id", documentId).maybeSingle();
  if (error) {
    console.error("document lookup for mail failed:", error.code, error.message);
    return { error: "storage_failed" };
  }
  const row = (doc as Row | null) ?? null;
  if (!row || s(row.related_type) !== "lease" || !s(row.related_id) || !s(row.storage_path)) return { error: "not_found" };
  const leaseId = s(row.related_id);
  const settings = await workspaceMail(ctx);
  const recipients = await tenantRecipients(ctx, leaseId, settings.lang);
  if (recipients.length === 0) return { error: "no_recipient" };
  const { data: generated } = await ctx.g.from("generated_documents").select("kind").eq("org_id", ctx.org.id).eq("document_id", documentId).maybeSingle();
  const kind = generated ? s((generated as Row).kind) : "";
  const { data: file, error: fileErr } = await client.storage.from(MEDIA_BUCKET).download(s(row.storage_path));
  if (fileErr || !file) {
    console.error("document download for mail failed:", fileErr?.message);
    return { error: "storage_failed" };
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const home = await homeOf(ctx, leaseId);
  const name = s(row.name);
  const deliveries: DeliveryOutcome[] = [];
  for (const r of recipients) {
    const d = getDict(r.lang);
    const kindLabels = d.documents.kindLabels as Record<string, string>;
    const kindLabel = (kind && kindLabels[kind]) || name;
    const mail = documentMail(d, { firstName: r.firstName, org: ctx.org.name, home, kind: kindLabel, link: `${APP_URL}/locataire/bail` });
    const result = await dispatch({ to: r.email, replyTo: settings.replyTo || undefined, attachments: [{ filename: name, content: bytes }], ...mail });
    const id = await recordDelivery(ctx, {
      kind: "document",
      leaseId,
      documentId,
      recipientKind: "tenant",
      recipientContactId: r.contactId,
      recipientEmail: r.email,
      lang: r.lang,
      subject: mail.subject,
      bodyText: mail.text,
      status: result.status,
      providerId: result.providerId,
    });
    deliveries.push({ email: r.email, status: result.status, id });
  }
  return { name, deliveries };
}

/**
 * The tenant wrote, or raised a request: the desk is told at the address
 * the portal function hands out, when the workspace wants it, and the
 * tenant's token leaves the line of the outbox on its own lease. Never
 * throws; nothing about the workspace beyond that address is read.
 */
export async function notifyManagerFromTenant(
  g: GestionReader,
  lease: { id: string; subject: string },
  input: { kind: "message" | "request"; text: string; title?: string; ticketId?: string | null },
): Promise<DeliveryOutcome | null> {
  try {
    const { data: targets, error } = await g.rpc("portal_notification_target", { p_lease: lease.id });
    if (error) {
      console.error("notification target lookup failed:", error.code, error.message);
      return null;
    }
    const target = ((targets as Row[] | null) ?? [])[0];
    if (!target || target.enabled === false || !s(target.email).includes("@")) return null;
    const { data: parties } = await g.rpc("my_lease_parties");
    const me = ((parties as Row[] | null) ?? []).find((p) => s(p.lease_id) === lease.id && p.is_me === true);
    const lang = localeOf(target.lang, "fr");
    const d = getDict(lang);
    const name = me ? s(me.display_name) : d.mail.tenantAnonymous;
    const link = input.kind === "request" && input.ticketId ? `${APP_URL}/app/messages?demande=${encodeURIComponent(input.ticketId)}` : `${APP_URL}/app/messages`;
    const mail =
      input.kind === "request"
        ? requestMail(d, { name, home: lease.subject, title: input.title ?? excerptOf(input.text, 120), excerpt: input.title ? excerptOf(input.text) : "", link })
        : tenantMessageMail(d, { name, home: lease.subject, excerpt: excerptOf(input.text), link });
    const result = await dispatch({ to: s(target.email).trim(), ...mail });
    const { data: id, error: recordErr } = await g.rpc("portal_record_delivery", {
      p_lease: lease.id,
      p_kind: input.kind,
      p_recipient_email: s(target.email).trim(),
      p_lang: lang,
      p_subject: mail.subject,
      p_body: mail.text,
      p_status: result.status,
      p_provider: result.status === "sent" ? "resend" : "",
      p_provider_message_id: result.providerId ?? "",
    });
    if (recordErr) console.error("delivery record (tenant) failed:", recordErr.code, recordErr.message);
    return { email: s(target.email).trim(), status: result.status, id: id ? String(id) : null };
  } catch (e) {
    console.error("manager notification failed:", e);
    return null;
  }
}
