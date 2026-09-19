import "server-only";

/**
 * Outbound e-mail, through Resend's HTTP API when the deployment carries a
 * key. Nothing here is required for the product to work: an invitation
 * whose e-mail cannot be sent is still a valid link the owner hands over
 * themselves, and the invitation says so. The key never leaves the server.
 *
 *   RESEND_API_KEY     the API key (absent: e-mail is off)
 *   MORADA_MAIL_FROM   the sender, defaults to "Morada Gestion <gestion@morada.lu>"
 */

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export type MailResult = { sent: true; id: string | null } | { sent: false; reason: "not_configured" | "rejected" | "unreachable" };

export function mailConfigured(): boolean {
  return typeof process.env.RESEND_API_KEY === "string" && process.env.RESEND_API_KEY.trim() !== "";
}

export async function sendMail(message: MailMessage): Promise<MailResult> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return { sent: false, reason: "not_configured" };
  const from = process.env.MORADA_MAIL_FROM?.trim() || "Morada Gestion <gestion@morada.lu>";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
    });
    if (!res.ok) {
      console.error("mail rejected:", res.status, (await res.text()).slice(0, 300));
      return { sent: false, reason: "rejected" };
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { sent: true, id: data.id ?? null };
  } catch (e) {
    console.error("mail unreachable:", e);
    return { sent: false, reason: "unreachable" };
  }
}

/** The smallest safe HTML: escaped text, one link, no tracking. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
