import { addDays } from "@/domain/dates";
import type { TenantConversation, TenantLease, TenantPayments, TenantPeriod, TenantRequest } from "@/lib/portal/tenant-space";

/**
 * What "Mon logement" says at a glance, derived from the space and nothing
 * else: the rent situation in one word, and the handful of things worth a
 * line. Pure, so the page never hand-writes a conclusion.
 */
export type RentSituation = "ok" | "pending" | "partial" | "late";

export function rentSituation(p: TenantPayments | null): RentSituation {
  if (!p) return "ok";
  // Anything due and not there is late, however much of it arrived: the same
  // figure the "Impayé" box and the alert show.
  if (p.outstandingCents > 0) return "late";
  const open = p.history.filter((x) => x.allocatedCents < x.totalCents && x.status !== "written_off");
  if (open.some((x) => x.status === "partial")) return "partial";
  if (open.some((x) => x.status === "pending")) return "pending";
  return "ok";
}

export type TenantAlert =
  | { kind: "late"; amountCents: number }
  | { kind: "notice"; date: string }
  | { kind: "insurance_missing" }
  | { kind: "insurance_expiring"; date: string }
  | { kind: "edl" };

/** Home insurance is the tenant's liability cover; the owner's own policies are not theirs to keep. */
const TENANT_INSURANCE = new Set(["liability", "other"]);

export function alertsFor(lease: TenantLease, p: TenantPayments | null, today: string): TenantAlert[] {
  const out: TenantAlert[] = [];
  if (p && p.outstandingCents > 0) out.push({ kind: "late", amountCents: p.outstandingCents });
  if (lease.endDate && lease.endDate >= today && (lease.status === "notice" || lease.endDate <= addDays(today, 90))) {
    out.push({ kind: "notice", date: lease.endDate });
  }
  const cover = lease.insurances.filter((i) => TENANT_INSURANCE.has(i.kind));
  if (cover.length === 0) out.push({ kind: "insurance_missing" });
  else {
    const soonest = cover.map((i) => i.expiresOn).filter((x): x is string => x !== null).sort()[0];
    if (soonest && soonest >= today && soonest <= addDays(today, 60)) out.push({ kind: "insurance_expiring", date: soonest });
  }
  // Only an entry inventory that was started and not finished is worth a line:
  // a lease without one on record says nothing about the home.
  const entry = lease.edls.filter((e) => e.kind === "entry");
  if (entry.length > 0 && !entry.some((e) => e.status === "signed" || e.status === "sealed")) out.push({ kind: "edl" });
  return out;
}

/**
 * What is owed today and why, read off the ledger rows: the periods due
 * before today that are not fully allocated, oldest first. `staleOrder`
 * names the one cause the rows themselves can show: a payment that arrived
 * at exactly the rent before its last adaptation (a standing order nobody
 * updated). Nothing here is guessed: without that exact match it is null.
 */
export interface RentDue {
  lateCents: number;
  latePeriods: TenantPeriod[];
  staleOrder: { paidCents: number; dueCents: number } | null;
}

export function rentDue(lease: Pick<TenantLease, "periods" | "previousRentCents">, today: string): RentDue {
  const latePeriods = lease.periods
    .filter((p) => p.allocatedCents < p.totalCents && p.status !== "written_off" && p.dueDate < today)
    .sort((a, b) => (a.period < b.period ? -1 : 1));
  const lateCents = latePeriods.reduce((a, p) => a + (p.totalCents - p.allocatedCents), 0);
  const prev = lease.previousRentCents;
  const stale = prev === null ? undefined : latePeriods.find((p) => p.allocatedCents > 0 && p.rentCents > prev && p.allocatedCents === p.totalCents - (p.rentCents - prev));
  return { lateCents, latePeriods, staleOrder: stale ? { paidCents: stale.allocatedCents, dueCents: stale.totalCents } : null };
}

/** What the tenant has to do: the alerts minus the late rent, which the rent block already says. */
export function todoFor(lease: TenantLease, p: TenantPayments | null, today: string): Exclude<TenantAlert, { kind: "late" }>[] {
  return alertsFor(lease, p, today).filter((a): a is Exclude<TenantAlert, { kind: "late" }> => a.kind !== "late");
}

/** The dated things ahead, each from a row that carries its date. */
export type TenantUpcoming =
  | { kind: "visit"; at: string; requestId: string; title: string; artisanName: string | null }
  | { kind: "edl"; at: string; edlKind: string }
  | { kind: "rent"; at: string; amountCents: number }
  | { kind: "lease_end"; at: string };

const VISIT_AHEAD = new Set(["scheduled", "accepted", "slots_proposed"]);

export function upcomingFor(lease: TenantLease, p: TenantPayments | null, requests: readonly TenantRequest[], today: string, max = 4): TenantUpcoming[] {
  const out: TenantUpcoming[] = [];
  for (const r of requests) {
    if (r.leaseId !== lease.id || !r.visit || r.state === "resolved" || r.state === "refused") continue;
    if (VISIT_AHEAD.has(r.visit.status) && r.visit.scheduledAt.slice(0, 10) >= today) {
      out.push({ kind: "visit", at: r.visit.scheduledAt, requestId: r.id, title: r.title, artisanName: r.visit.artisanName });
    }
  }
  for (const e of lease.edls) {
    if (e.scheduledAt && e.scheduledAt >= today && e.status !== "signed" && e.status !== "sealed") out.push({ kind: "edl", at: e.scheduledAt, edlKind: e.kind });
  }
  if (p && p.nextDueOn && p.nextDueOn >= today && p.nextDueCents > 0) out.push({ kind: "rent", at: p.nextDueOn, amountCents: p.nextDueCents });
  if (lease.endDate && lease.endDate >= today) out.push({ kind: "lease_end", at: lease.endDate });
  return out.sort((a, b) => (a.at.slice(0, 10) < b.at.slice(0, 10) ? -1 : a.at.slice(0, 10) > b.at.slice(0, 10) ? 1 : 0)).slice(0, max);
}

/**
 * A request's path as the tenant follows it, from the ticket's own status
 * and dates. A date is given only where a row carries one: the day it was
 * sent, the planned visit, the day it was closed, and the last update on
 * the step it is at now.
 */
export interface RequestStep {
  key: "sent" | "taken" | "slot" | "visit" | "resolved" | "refused";
  state: "done" | "now" | "todo";
  /** YYYY-MM-DD, or a full ISO date and time for a planned visit; null when no row says. */
  at: string | null;
}

/** Work-order statuses that say a slot was agreed: the order is scheduled, or the visit is behind it. */
const SLOT_CONFIRMED = new Set(["scheduled", "done", "invoiced", "paid"]);

export function requestTimeline(r: Pick<TenantRequest, "kind" | "status" | "createdAt" | "updatedAt" | "closedAt" | "visit">): RequestStep[] {
  const s = r.status;
  if (s === "cancelled") {
    return [
      { key: "sent", state: "done", at: r.createdAt || null },
      { key: "refused", state: "now", at: r.closedAt ?? (r.updatedAt || null) },
    ];
  }
  const closed = s === "done" || s === "closed";
  const visiting = s === "scheduled" || s === "in_progress";
  const taken = s !== "new";
  const withVisit = r.kind === "technical" || r.visit !== null;
  const steps: RequestStep[] = [{ key: "sent", state: taken ? "done" : "now", at: r.createdAt || null }];
  steps.push({ key: "taken", state: !taken ? "todo" : closed || visiting ? "done" : "now", at: taken && !closed && !visiting ? r.updatedAt || null : null });
  // The slot is confirmed when the work order itself says so (scheduled, or further along). No row dates that moment.
  if (r.visit && SLOT_CONFIRMED.has(r.visit.status)) steps.push({ key: "slot", state: "done", at: null });
  if (withVisit) {
    steps.push({ key: "visit", state: closed ? "done" : visiting ? "now" : "todo", at: r.visit?.scheduledAt ?? (visiting ? r.updatedAt || null : null) });
  }
  steps.push({ key: "resolved", state: closed ? "now" : "todo", at: closed ? r.closedAt ?? (r.updatedAt || null) : null });
  return steps;
}

/**
 * Messages the tenant has not read on this device. The database keeps no
 * read mark a tenant may set, so the line is drawn by what the tenant did:
 * their own last word in the conversation, or the moment this browser last
 * showed it (`seen`, by tenancy), whichever is later. Everything the other
 * side wrote after that counts.
 */
export function unreadCount(conversations: readonly TenantConversation[], seen: Readonly<Record<string, string>>): number {
  let total = 0;
  for (const c of conversations) {
    const mine = c.messages.filter((m) => m.mine).map((m) => m.sentAt).sort().pop() ?? "";
    const mark = [mine, seen[c.leaseId] ?? ""].sort().pop() ?? "";
    total += c.messages.filter((m) => !m.mine && m.sentAt > mark).length;
  }
  return total;
}
