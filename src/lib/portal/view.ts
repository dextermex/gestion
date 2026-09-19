import { addDays } from "@/domain/dates";
import type { TenantLease, TenantPayments } from "@/lib/portal/tenant-space";

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
