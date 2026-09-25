import { fmt } from "@/lib/i18n/config";
import type { Dict } from "@/lib/i18n/fr";

/**
 * What an e-mail of the workspace says, in the reader's language, from the
 * dictionaries and nothing else: a subject, a plain text, and the same as
 * the smallest safe HTML (escaped text, one button, no tracking). The
 * legally significant wording is never here: it is in the document
 * attached, produced from its validated template.
 */
export interface ComposedMail {
  subject: string;
  text: string;
  html: string;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The first words of a message, enough to know what it is about, never the whole of it. */
export function excerptOf(text: string, max = 400): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

function greeting(d: Dict, firstName: string): string {
  return firstName ? fmt(d.mail.hello, { name: firstName }) : d.mail.helloAnonymous;
}

function render(paragraphs: string[], quote: string | null, button: { label: string; href: string }, foot: string, signature: string): { text: string; html: string } {
  const lines = [...paragraphs, ...(quote ? ["", quote] : []), "", button.href, "", foot, "", signature];
  const html = [
    `<div style="font-family:Inter,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1f2924;max-width:560px">`,
    ...paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`),
    ...(quote ? [`<blockquote style="margin:0 0 12px;padding:8px 14px;border-left:3px solid #d9d2c5;color:#3d4a44;white-space:pre-wrap">${escapeHtml(quote)}</blockquote>`] : []),
    `<p><a href="${escapeHtml(button.href)}" style="display:inline-block;background:#17635c;color:#fff;text-decoration:none;font-weight:600;padding:10px 16px;border-radius:12px">${escapeHtml(button.label)}</a></p>`,
    `<p style="color:#5d6b64;font-size:13px">${escapeHtml(button.href)}</p>`,
    `<p style="color:#5d6b64;font-size:13px">${escapeHtml(foot)}</p>`,
    `<p>${escapeHtml(signature)}</p>`,
    `</div>`,
  ].join("\n");
  return { text: lines.join("\n"), html };
}

/** A document of the tenancy, attached, to its tenant. */
export function documentMail(d: Dict, v: { firstName: string; org: string; home: string; kind: string; link: string }): ComposedMail {
  const body = render(
    [greeting(d, v.firstName), fmt(d.mail.documentBody, { org: v.org, kind: v.kind, home: v.home })],
    null,
    { label: d.mail.documentButton, href: v.link },
    fmt(d.mail.noReply, { org: v.org }),
    d.mail.signature,
  );
  return { subject: fmt(d.mail.documentSubject, { kind: v.kind, home: v.home }), ...body };
}

/** A word from the desk, to the tenant. */
export function messageMail(d: Dict, v: { firstName: string; org: string; home: string; excerpt: string; link: string }): ComposedMail {
  const body = render(
    [greeting(d, v.firstName), fmt(d.mail.messageBody, { org: v.org, home: v.home })],
    v.excerpt,
    { label: d.mail.messageButton, href: v.link },
    fmt(d.mail.noReply, { org: v.org }),
    d.mail.signature,
  );
  return { subject: fmt(d.mail.messageSubject, { org: v.org, home: v.home }), ...body };
}

/** A word from the tenant, to the desk. */
export function tenantMessageMail(d: Dict, v: { name: string; home: string; excerpt: string; link: string }): ComposedMail {
  const body = render(
    [d.mail.helloAnonymous, fmt(d.mail.tenantMessageBody, { name: v.name, home: v.home })],
    v.excerpt,
    { label: d.mail.managerButton, href: v.link },
    d.mail.managerFoot,
    d.mail.signature,
  );
  return { subject: fmt(d.mail.tenantMessageSubject, { name: v.name, home: v.home }), ...body };
}

/** A request from the tenant, to the desk. */
export function requestMail(d: Dict, v: { name: string; home: string; title: string; excerpt: string; link: string }): ComposedMail {
  const body = render(
    [d.mail.helloAnonymous, fmt(d.mail.requestBody, { name: v.name, home: v.home, title: v.title })],
    v.excerpt || null,
    { label: d.mail.managerButton, href: v.link },
    d.mail.managerFoot,
    d.mail.signature,
  );
  return { subject: fmt(d.mail.requestSubject, { name: v.name, title: v.title }), ...body };
}
