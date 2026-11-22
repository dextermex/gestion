import "server-only";
import { NextResponse } from "next/server";

/**
 * Rate limits, counted in the database.
 *
 * The application runs as many short-lived instances that share no memory,
 * so a counter kept here would count nothing. `gestion.rate_take` (migration
 * 0033) counts under the caller's own token, per person and per workspace,
 * in fixed windows; it only ever counts up, so calling it directly earns
 * nothing back. Every route that sends an e-mail, calls a paid service or
 * opens a session at a provider takes one here first.
 *
 * A database that does not carry the function yet (the migration is pending)
 * limits nothing and says so in the log: the product keeps working. Any
 * other failure of the count also lets the call through, logged; a limiter
 * must never be the reason a landlord cannot write to a tenant.
 */
export interface RateRule {
  /** The counter's name: lower case, dots and underscores. */
  action: string;
  windowSeconds: number;
  /** Calls allowed per person in a window, across their workspaces; null: not checked. */
  perUser: number | null;
  /** Calls allowed per workspace in a window, across its members; null: not checked. */
  perOrg: number | null;
}

const HOUR = 3600;
const DAY = 86400;

/**
 * The limits. Each is several times what a busy desk does by hand, and well
 * under what a loop does: they are ceilings on abuse and accidents, not
 * quotas a subscription sells.
 */
export const RATE = {
  /** The e-mail that tells a tenancy's tenants the desk wrote. Over the limit the message is kept and no e-mail leaves. */
  mailMessage: { action: "mail.message", windowSeconds: HOUR, perUser: 60, perOrg: 120 },
  /** A piece mailed to the tenants with its file attached. */
  mailDocument: { action: "mail.document", windowSeconds: HOUR, perUser: 30, perOrg: 60 },
  /** An invitation to the tenant space, mailed to the contact's address. */
  mailInvitation: { action: "mail.invitation", windowSeconds: HOUR, perUser: 20, perOrg: 40 },
  /** The e-mail that tells the desk a tenant wrote or raised a request. Counted on the tenant alone. */
  mailFromTenant: { action: "mail.tenant", windowSeconds: HOUR, perUser: 20, perOrg: null },
  /** The confirmation the account system mails to a new address. */
  mailAccount: { action: "mail.account", windowSeconds: HOUR, perUser: 6, perOrg: null },
  /** A file read by the document reader (a paid call per file). */
  documentRead: { action: "document.read", windowSeconds: DAY, perUser: 150, perOrg: 300 },
  /** A bank-consent journey opened at the provider. */
  bankConnect: { action: "bank.connect", windowSeconds: HOUR, perUser: 10, perOrg: 20 },
  /** The provider's accounts and operations read back. */
  bankSync: { action: "bank.sync", windowSeconds: HOUR, perUser: 12, perOrg: 24 },
  /** The connection's diagnosis, which asks the provider once. */
  bankProbe: { action: "bank.probe", windowSeconds: HOUR, perUser: 20, perOrg: 40 },
  /** A contract sent to be signed (billed per signature). */
  signatureSend: { action: "signature.send", windowSeconds: HOUR, perUser: 20, perOrg: 40 },
  /** Signature requests cancelled at the provider. */
  signatureCancel: { action: "signature.cancel", windowSeconds: HOUR, perUser: 30, perOrg: 60 },
  /** Signature statuses read back from the provider. */
  signatureRead: { action: "signature.read", windowSeconds: HOUR, perUser: 120, perOrg: 240 },
  /** A Checkout or portal session, a change of rhythm, a trial extension. */
  billingSession: { action: "billing.session", windowSeconds: HOUR, perUser: 20, perOrg: 30 },
} as const satisfies Record<string, RateRule>;

/** What a counted call needs: the caller's own client on the `gestion` schema. */
export interface RateCounter {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
}

let pendingSaid = false;

/**
 * Counts one call and says whether it may go on. `orgId` null keeps the
 * person's counter alone (the tenant's routes). The workspace's counter is
 * kept only for a workspace the caller belongs to: the database refuses any
 * other, and so does this.
 */
export async function withinRate(g: RateCounter, rule: RateRule, orgId: string | null): Promise<boolean> {
  try {
    const { data, error } = await g.rpc("rate_take", {
      p_action: rule.action,
      p_org: orgId,
      p_window_seconds: rule.windowSeconds,
      p_user_max: rule.perUser,
      p_org_max: orgId === null ? null : rule.perOrg,
    });
    if (!error) return data !== false;
    // The function is not in this database yet: nothing is limited until the migration is applied.
    if (error.code === "PGRST202" || error.code === "42883") {
      if (!pendingSaid) {
        pendingSaid = true;
        console.warn("rate limit: gestion.rate_take is missing (migration 0033 pending), nothing is limited");
      }
      return true;
    }
    // Not signed in, or not a member of the workspace named: not a call to let through.
    if (error.code === "42501") return false;
    console.error("rate limit: count failed, call allowed:", rule.action, error.code);
    return true;
  } catch (e) {
    console.error("rate limit: count unreachable, call allowed:", rule.action, e instanceof Error ? e.name : "error");
    return true;
  }
}

/** Seconds until the rule's current window ends: what `Retry-After` says. */
export function retryAfter(rule: RateRule, nowMs: number = Date.now()): number {
  const now = Math.floor(nowMs / 1000);
  return rule.windowSeconds - (now % rule.windowSeconds);
}

/** The answer a refused call gets: 429, the code the screens word, and when to try again. */
export function rateLimited(rule: RateRule): NextResponse {
  const wait = retryAfter(rule);
  return NextResponse.json({ error: "rate_limited", retryAfter: wait }, { status: 429, headers: { "Retry-After": String(wait) } });
}

/** For a route: the 429 to answer, or null when the call may go on. */
export async function refuseOverRate(g: RateCounter, rule: RateRule, orgId: string | null): Promise<NextResponse | null> {
  return (await withinRate(g, rule, orgId)) ? null : rateLimited(rule);
}
