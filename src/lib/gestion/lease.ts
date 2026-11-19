import "server-only";
import type { OrgContext } from "@/lib/gestion/api";
import { validateLeaseDraft, type ValidationIssue } from "@/domain/lease/rules";
import { leaseRF } from "@/domain/banking/rf";
import { getParamValue } from "@/domain/legal/params";
import { dueDateFor, ledgerMonths } from "@/lib/gestion/ledger";
import { todayISO } from "@/lib/clock";
import { depositTransitionAllowed } from "@/lib/gestion/deposits";
import type { DepositStatus } from "@/lib/types";

export { dueDateFor, ledgerMonths };
import { leaseIssueText } from "@/lib/i18n/engine";
import type { Dict } from "@/lib/i18n";

/**
 * The tenancy, in one place: how it starts, how its ledger opens, how it ends.
 *
 * A lease carries two different truths, and they used to share one column.
 * Whether the tenancy is IN FORCE (someone has the keys, rent falls due each
 * month) is its lifecycle: `active`, `notice`, `ended`. Whether the written
 * lease is COMPLETE under the 2006/2024 law (the eight mentions, the deposit
 * ceiling, the pacte de colocation) is compliance: the legal engine derives
 * it from what is recorded, the dossier shows it, and nothing stores it.
 *
 * Deriving the first from the second is the bug this file now refuses. A
 * residential lease recorded through the guided flow can never carry the
 * capital investi declaration, so it was written as `draft`, opened no
 * ledger, and left the lot reading as vacant while Contacts showed the
 * tenant. Every doorway lands here, so the rule holds once: recording a
 * rental the owner has agreed makes it active. The document generator still
 * refuses to print a non-compliant lease; that is its job, not this one's.
 *
 * `draft` survives as a lifecycle state for a lease that has genuinely not
 * started, and for rows written before this rule. A draft never occupies a
 * lot; `activateLease` is its way out, `discardDraft` the other.
 */

export const DEPOSIT_FORMS = [
  "cash",
  "bank_guarantee",
  "third_party_caution",
  "insurance",
  "state_guarantee",
] as const;
export type DepositForm = (typeof DEPOSIT_FORMS)[number];

export const LIVE_STATUSES = ["active", "notice"] as const;

export interface LeaseInput {
  unitId: string;
  /** Everyone who signs: a couple, a family, three roommates. Each one is a
   *  party to the same lease; there is no "main tenant" with the rest as a
   *  note. */
  tenantContactIds: string[];
  /** The colocation regime of the 2024 law (pacte de colocation), which a
   *  couple or a family signing one lease is not. The owner's answer, never
   *  a head count. */
  colocation: boolean;
  type: "residential" | "commercial";
  startDate: string;
  endDate: string | null;
  rentCents: number;
  chargesCents: number;
  /** Day of the month the rent falls due. The schema caps this at 28. */
  paymentDay: number;
  depositMonths: number;
  depositForm: DepositForm;
  furnished: boolean;
}

export interface LeaseIssue {
  code: string;
  severity: string;
  message: string;
}

export interface LeaseResult {
  id: string;
  status: "active";
  rfReference: string;
  /** What the written lease still lacks, for the dossier. It never gates. */
  issues: LeaseIssue[];
  /** Monthly periods the ledger opened on the spot. */
  periodsOpened: number;
}

export function normalizeDepositForm(raw: unknown): DepositForm {
  return (DEPOSIT_FORMS as readonly string[]).includes(String(raw)) ? (String(raw) as DepositForm) : "cash";
}

export function normalizePaymentDay(raw: unknown): number {
  const n = Math.round(Number(raw));
  return Number.isFinite(n) && n >= 1 && n <= 28 ? n : 1;
}

const isoToday = (): string => todayISO();

/** The guided form collects seven of the eight mandatory mentions; the
 *  capital investi declaration is the one it cannot. */
export function mentionsFor(type: LeaseInput["type"]): Record<string, string> {
  return {
    parties_identity: "ok",
    property_designation: "ok",
    lease_start_date: "ok",
    duration_or_indefinite: "ok",
    rent_amount: "ok",
    charges_regime: "ok",
    deposit_terms: "ok",
    capital_investi_declaration: type === "commercial" ? "ok" : "",
  };
}

/**
 * What the legal engine says about the written lease, from the recorded
 * facts alone. Informative: the dossier lists it, the generator enforces it.
 */
export function leaseCompliance(input: LeaseInput, today: string): ValidationIssue[] {
  return validateLeaseDraft(
    {
      type: input.type,
      startDate: input.startDate,
      endDate: input.endDate,
      monthlyRent: input.rentCents,
      monthlyCharges: input.chargesCents,
      depositMonths: input.depositMonths,
      depositForm: input.depositForm,
      mentions: mentionsFor(input.type),
      hasCpiEscalationClause: false,
      furnished: input.furnished,
      colocation: input.colocation,
    },
    today,
  );
}

interface LedgerLease {
  id: string;
  startDate: string;
  endDate: string | null;
  rentCents: number;
  chargesCents: number;
  paymentDay: number;
  /** The month rent tracking starts from (YYYY-MM-01); absent, the lease's own start. */
  ledgerFrom?: string | null;
}

/**
 * Opens the monthly periods a live lease is missing. Idempotent: a month
 * that already exists is left exactly as it is, because creation and
 * activation may both pass here and neither may rewrite a period. Paid-ness
 * is derived from allocations by the rent_period_status view, never stored.
 * The calendar (which months, due when) is `ledger.ts`, mirrored nightly by
 * `gestion.roll_rent_periods()`. Returns how many periods were opened.
 */
export async function openLedger(ctx: OrgContext, lease: LedgerLease, today: string): Promise<number> {
  const { g, org } = ctx;
  // total_cents is a generated column: the database sums the parts.
  const rows = ledgerMonths(lease.startDate, lease.endDate, today, lease.ledgerFrom ?? null).map((m) => ({
    org_id: org.id,
    lease_id: lease.id,
    period: m,
    due_date: dueDateFor(m, lease.paymentDay, lease.startDate),
    rent_cents: lease.rentCents,
    charges_cents: lease.chargesCents,
    other_cents: 0,
    vat_cents: 0,
  }));
  if (rows.length === 0) return 0;
  const { data, error } = await g
    .from("rent_periods")
    .upsert(rows, { onConflict: "lease_id,period", ignoreDuplicates: true })
    .select("id");
  if (error) {
    console.error("rent periods open failed:", error.code, error.message);
    return 0;
  }
  const opened = data?.length ?? 0;
  if (opened > 0) {
    // Money already received above what was due waits for the next period:
    // the months just opened take it, oldest first (the nightly roll does the
    // same for the months it opens).
    const { error: creditErr } = await g.rpc("apply_lease_credit", { p_lease: lease.id });
    if (creditErr && creditErr.code !== "PGRST202" && creditErr.code !== "42883") console.error("credit application failed:", creditErr.code, creditErr.message);
  }
  return opened;
}

export async function createLease(
  ctx: OrgContext,
  d: Dict,
  input: LeaseInput,
): Promise<LeaseResult | { error: string }> {
  const { g, org } = ctx;
  const today = isoToday();
  if (input.tenantContactIds.length === 0) return { error: "no_tenant" };

  const issues = leaseCompliance(input, today);
  const issueVars = {
    months: input.depositMonths,
    max: getParamValue(
      input.type === "residential" ? "residential.deposit_max_months" : "commercial.deposit_max_months",
      today,
    ),
    date: "",
  };

  // The owner is recording a rental that exists: it is in force from the day
  // it says it is. What the written lease still lacks is returned alongside,
  // for the dossier to show; it decides nothing here.
  const { data: lease, error: leaseErr } = await g
    .from("leases")
    .insert({
      org_id: org.id,
      unit_id: input.unitId,
      lease_type: input.type,
      status: "active",
      start_date: input.startDate,
      end_date: input.endDate,
      rent_cents: input.rentCents,
      charges_cents: input.chargesCents,
      charges_regime: "advances",
      payment_day: input.paymentDay,
      mentions: mentionsFor(input.type),
      furnished: input.furnished,
      colocation: input.colocation,
      vat_regime: "exempt",
      details: { depositMonths: input.depositMonths, depositForm: input.depositForm },
    })
    .select("id,seq")
    .single();
  if (leaseErr || !lease) return { error: leaseErr?.code ?? "lease_insert_failed" };

  // The database assigns the lease number; the permanent structured
  // reference is derived from it plus a stable per-workspace prefix.
  const orgSeq = (parseInt(org.id.replace(/-/g, "").slice(0, 6), 16) % 9000) + 1000;
  const rfReference = leaseRF(orgSeq, lease.seq as number);
  const { error: rfErr } = await g
    .from("leases")
    .update({ rf_reference: rfReference })
    .eq("org_id", org.id)
    .eq("id", lease.id);
  if (rfErr) console.error("lease rf update failed:", rfErr.code, rfErr.message);

  // Every signatory is a party in their own right, in since the first day.
  const parties = input.tenantContactIds.map((contactId) => ({
    org_id: org.id,
    lease_id: lease.id as string,
    contact_id: contactId,
    role: "tenant",
    moved_in_on: input.startDate,
  }));
  const { error: partyErr } = await g.from("lease_parties").insert(parties);
  if (partyErr) console.error("lease parties insert failed:", partyErr.code, partyErr.message);

  // No guarantee means no deposit row: an empty record is not a fact.
  if (input.depositMonths > 0) {
    const { error: depErr } = await g.from("deposits").insert({
      org_id: org.id,
      lease_id: lease.id,
      form: input.depositForm,
      amount_cents: input.rentCents * input.depositMonths,
      status: "pending",
    });
    if (depErr) console.error("deposit insert failed:", depErr.code, depErr.message);
  }

  // An active lease opens its ledger on the spot. That is the whole of
  // "Morada knows this rent is due every month": there is no second switch.
  const periodsOpened = await openLedger(
    ctx,
    {
      id: lease.id as string,
      startDate: input.startDate,
      endDate: input.endDate,
      rentCents: input.rentCents,
      chargesCents: input.chargesCents,
      paymentDay: input.paymentDay,
    },
    today,
  );

  return {
    id: lease.id as string,
    status: "active",
    rfReference,
    issues: issues.map((i) => ({
      code: i.code,
      severity: i.severity,
      message: leaseIssueText(d, i.code, issueVars, i.message),
    })),
    periodsOpened,
  };
}

type LeaseRow = {
  id: string;
  status: string;
  unit_id: string;
  start_date: string;
  end_date: string | null;
  rent_cents: number;
  charges_cents: number;
  payment_day: number;
};

/**
 * A draft becomes the tenancy in force: the lot is occupied from its start
 * date and its ledger opens. Only a draft can be activated, only one that
 * names someone and a rent (there is no tenancy without either), and only
 * onto a lot with no other live lease. This is the single doorway of the
 * guided rental into "active"; every earlier step only saves the dossier.
 */
export async function activateLease(
  ctx: OrgContext,
  leaseId: string,
  today: string = isoToday(),
): Promise<
  { ok: true; periodsOpened: number } | { error: "not_found" | "not_draft" | "already_let" | "incomplete" | "storage_failed" }
> {
  const { g, org } = ctx;
  const { data: lease, error: findErr } = await g
    .from("leases")
    .select("id,status,unit_id,start_date,end_date,rent_cents,charges_cents,payment_day")
    .eq("org_id", org.id)
    .eq("id", leaseId)
    .maybeSingle();
  if (findErr) {
    console.error("activation lease lookup failed:", findErr.code, findErr.message);
    return { error: "storage_failed" };
  }
  const row = lease as LeaseRow | null;
  if (!row) return { error: "not_found" };
  if (row.status !== "draft") return { error: "not_draft" };

  const { data: parties, error: partiesErr } = await g
    .from("lease_parties")
    .select("id,moved_in_on")
    .eq("org_id", org.id)
    .eq("lease_id", leaseId)
    .eq("role", "tenant");
  if (partiesErr) {
    console.error("activation parties lookup failed:", partiesErr.code, partiesErr.message);
    return { error: "storage_failed" };
  }
  const tenants = (parties as Array<{ id: string; moved_in_on: string | null }> | null) ?? [];
  if (tenants.length === 0 || row.rent_cents <= 0) return { error: "incomplete" };

  const { data: busy, error: busyErr } = await g
    .from("leases")
    .select("id")
    .eq("org_id", org.id)
    .eq("unit_id", row.unit_id)
    .in("status", [...LIVE_STATUSES])
    .limit(1);
  if (busyErr) {
    console.error("activation occupancy lookup failed:", busyErr.code, busyErr.message);
    return { error: "storage_failed" };
  }
  if ((busy ?? []).length > 0) return { error: "already_let" };

  const { data: updated, error: updErr } = await g
    .from("leases")
    .update({ status: "active" })
    .eq("org_id", org.id)
    .eq("id", leaseId)
    .select("id");
  if (updErr) {
    // The database keeps the same rule (one live lease per lot) and says so
    // with a unique violation when two activations race.
    if (updErr.code === "23505") return { error: "already_let" };
    console.error("lease activation failed:", updErr.code, updErr.message);
    return { error: "storage_failed" };
  }
  if (!updated?.length) return { error: "not_found" };

  // Everyone on the lease moved in on the day it starts.
  const arriving = tenants.filter((p) => !p.moved_in_on).map((p) => p.id);
  if (arriving.length > 0) {
    const { error } = await g
      .from("lease_parties")
      .update({ moved_in_on: row.start_date })
      .eq("org_id", org.id)
      .in("id", arriving);
    if (error) console.error("move-in date update failed:", error.code, error.message);
  }

  const periodsOpened = await openLedger(
    ctx,
    {
      id: row.id,
      startDate: row.start_date,
      endDate: row.end_date,
      rentCents: row.rent_cents,
      chargesCents: row.charges_cents,
      paymentDay: row.payment_day,
    },
    today,
  );
  return { ok: true, periodsOpened };
}

/**
 * A draft that never started is removed, contacts included nothing: they
 * stay in the address book. Refused as soon as the draft carries anything
 * that happened (a period, a payment, an inventory, a policy), because at
 * that point it is a tenancy to close, not a note to discard.
 */
/**
 * A dossier in preparation is abandoned.
 *
 * Only a draft can be discarded, and a draft never occupied its lot, so
 * everything hanging off it existed for it alone: the people's places on
 * it, its guarantee, its payer bindings, its inventory sessions with their
 * items, its insurance. All of that goes with it. The people stay as
 * contacts, the lot and the property are untouched, and no other tenancy on
 * the lot, running or ended, is read or written. Money is the one exception:
 * a period something was allocated to, or a payment attached to the row,
 * means this is not a draft-only dossier, and the owner sorts that out first.
 *
 * This is also how a lot that carries a running tenancy and a stale draft
 * from before the one-dossier rule is cleaned up.
 */
export async function discardDraft(
  ctx: OrgContext,
  leaseId: string,
): Promise<{ ok: true } | { error: "not_found" | "not_draft" | "not_empty" | "storage_failed" }> {
  const { g, org } = ctx;
  const { data: lease, error: findErr } = await g
    .from("leases")
    .select("id,status")
    .eq("org_id", org.id)
    .eq("id", leaseId)
    .maybeSingle();
  if (findErr) {
    console.error("discard lease lookup failed:", findErr.code, findErr.message);
    return { error: "storage_failed" };
  }
  if (!lease) return { error: "not_found" };
  if (lease.status !== "draft") return { error: "not_draft" };

  const [{ data: statuses, error: statusErr }, { data: payments, error: payErr }] = await Promise.all([
    g.from("rent_period_status").select("id,allocated_cents").eq("lease_id", leaseId),
    g.from("payments").select("id").eq("org_id", org.id).eq("lease_id", leaseId).limit(1),
  ]);
  if (statusErr || payErr) {
    const e = statusErr ?? payErr;
    console.error("discard money lookup failed:", e?.code, e?.message);
    return { error: "storage_failed" };
  }
  const paidInto = ((statuses as Array<{ allocated_cents: number }> | null) ?? []).some((p) => (p.allocated_cents ?? 0) > 0);
  if (paidInto || ((payments as unknown[] | null) ?? []).length > 0) return { error: "not_empty" };

  // The insurance is the one draft-only row the database would keep (its
  // lease reference is set to null rather than cascaded): it goes first.
  const { error: insErr } = await g.from("insurance_policies").delete().eq("org_id", org.id).eq("lease_id", leaseId);
  if (insErr) {
    console.error("draft insurance removal failed:", insErr.code, insErr.message);
    return { error: "storage_failed" };
  }

  // Parties, guarantee, payer bindings, inventory sessions (and their items),
  // periods and notices cascade with the lease row.
  const { data: gone, error: delErr } = await g
    .from("leases")
    .delete()
    .eq("org_id", org.id)
    .eq("id", leaseId)
    .eq("status", "draft")
    .select("id");
  if (delErr) {
    console.error("draft discard failed:", delErr.code, delErr.message);
    return { error: "storage_failed" };
  }
  if (!gone?.length) return { error: "not_found" };
  return { ok: true };
}

/** Where a departure being recorded stands, kept on the lease row as the owner goes. */
export interface DepartureProgress {
  /** 1-based step reached, out of the seven the flow walks. */
  step: number;
  endDate: string | null;
  keysReturned: boolean;
  keysReturnedOn: string | null;
  depositOutcome: ClosureOutcome;
  releasedAmount: string;
  decompteIssuedOn: string | null;
  metersDone: boolean;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const dayOrNull = (v: unknown): string | null => (typeof v === "string" && ISO_DAY.test(v) ? v : null);

/** The departure progress a request carries, read once and not believed. */
export function readDeparture(raw: unknown): DepartureProgress | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const step = Math.round(Number(r.step));
  if (!Number.isFinite(step) || step < 1 || step > 7) return null;
  return {
    step,
    endDate: dayOrNull(r.endDate),
    keysReturned: r.keysReturned === true,
    keysReturnedOn: dayOrNull(r.keysReturnedOn),
    depositOutcome: (CLOSURE_OUTCOMES as readonly string[]).includes(String(r.depositOutcome))
      ? (String(r.depositOutcome) as ClosureOutcome)
      : "release_pending",
    releasedAmount: typeof r.releasedAmount === "string" ? r.releasedAmount.trim().slice(0, 20) : "",
    decompteIssuedOn: dayOrNull(r.decompteIssuedOn),
    metersDone: r.metersDone === true,
  };
}

/**
 * Saves where a departure stands, so the owner can stop on any step (the
 * exit inventory is a journey of its own) and come back. Nothing about the
 * tenancy changes: it stays in force, its ledger keeps running, and only
 * the confirmation (`closeLease`) ends it.
 */
export async function saveDeparture(
  ctx: OrgContext,
  leaseId: string,
  progress: DepartureProgress,
  today: string = isoToday(),
): Promise<{ ok: true } | { error: "not_found" | "not_live" | "storage_failed" }> {
  const { g, org } = ctx;
  const { data: lease, error: findErr } = await g
    .from("leases")
    .select("id,status,details")
    .eq("org_id", org.id)
    .eq("id", leaseId)
    .maybeSingle();
  if (findErr) {
    console.error("departure lease lookup failed:", findErr.code, findErr.message);
    return { error: "storage_failed" };
  }
  if (!lease) return { error: "not_found" };
  if (!(LIVE_STATUSES as readonly string[]).includes(String(lease.status))) return { error: "not_live" };

  const details = { ...((lease.details as Record<string, unknown> | null) ?? {}), departure: { ...progress, savedOn: today } };
  const { data, error } = await g.from("leases").update({ details }).eq("org_id", org.id).eq("id", leaseId).select("id");
  if (error) {
    console.error("departure save failed:", error.code, error.message);
    return { error: "storage_failed" };
  }
  if (!data?.length) return { error: "not_found" };
  return { ok: true };
}

/**
 * What the departure may say about the guarantee: that its restitution opens
 * (the keys are back), or that it is disputed. Money leaves a guarantee
 * through the settlement and its liberation route alone, never from here.
 */
export const CLOSURE_OUTCOMES = ["release_pending", "disputed"] as const;
export type ClosureOutcome = (typeof CLOSURE_OUTCOMES)[number];

export interface ClosureInput {
  /** The day the tenancy ends. Defaults to today. */
  endDate: string | null;
  depositOutcome: ClosureOutcome;
  keysReturned: boolean;
  /** The day the keys came back; the end date when not said. */
  keysReturnedOn?: string | null;
  decompteIssuedOn: string | null;
}

export interface ClosureResult {
  ok: true;
  /**
   * `ended`: the tenancy is over, the lot is free. `notice`: the date is
   * ahead, so the tenancy stays in force until that day (the lot occupied,
   * the rent due, the tenant's rights whole) and ends on it by itself.
   */
  status: "ended" | "notice";
  endDate: string;
  droppedPeriods: number;
  unitId: string;
  /** Where the guarantee stands after the closure, when it has one and the tenancy ended. */
  depositStatus: DepositStatus | null;
  /** Steps that did not land, for the screen to say so: the closure itself did. */
  pending: Array<"deposit" | "ledger">;
}

export type ClosureFailure =
  | { error: "not_found" | "already_ended" | "not_live" | "end_before_start" }
  | { error: "storage_failed"; context: string; detail: { code?: string; message?: string } | null };

/**
 * A tenant leaves.
 *
 * This is the one operation that must not destroy anything. The lease is
 * closed, not deleted: it keeps its tenants, its rent, its payments, its
 * inventory and its documents, and it becomes the property's history. What
 * ends is the future: the months that would have been owed and never will
 * be, and only those that nothing has been allocated to. A period somebody
 * actually paid stays, because it happened.
 *
 * The date decides when. A departure recorded for a day ahead is a notice:
 * the lease takes the status `notice` with its end date, and nothing else
 * changes until that day, when `gestion.end_due_leases()` (nightly) ends it.
 * A date of today or before ends it now: the lot is free, the tenants are
 * former tenants of this property, and "Ajouter un locataire" is available
 * again. The next tenancy is a new lease with its own ledger.
 *
 * The status, the end date, the parties' move-out and the ledger's trimming
 * are one transaction (`gestion.close_lease`). The guarantee is a second
 * write: only the keys' date and the opening of its restitution, under the
 * same transitions as its own screen.
 */
export async function closeLease(
  ctx: OrgContext,
  leaseId: string,
  input: ClosureInput,
  today: string = isoToday(),
): Promise<ClosureResult | ClosureFailure> {
  const { g, org } = ctx;
  const endDate = input.endDate ?? today;

  const { data: closed, error: closeErr } = await g.rpc("close_lease", { p_lease: leaseId, p_end_date: endDate });
  if (closeErr) {
    const message = closeErr.message ?? "";
    if (message.includes("lease not found")) return { error: "not_found" };
    if (message.includes("already ended")) return { error: "already_ended" };
    if (message.includes("not live")) return { error: "not_live" };
    if (message.includes("end before start")) return { error: "end_before_start" };
    return { error: "storage_failed", context: "lease closure", detail: closeErr };
  }
  const out = (closed ?? {}) as { status?: string; dropped?: number; unit_id?: string };
  const status = out.status === "ended" ? "ended" : "notice";
  const result: ClosureResult = {
    ok: true,
    status,
    endDate,
    droppedPeriods: Number(out.dropped) || 0,
    unitId: String(out.unit_id ?? ""),
    depositStatus: null,
    pending: [],
  };

  if (status === "notice") {
    // The months up to the departure stay due: whatever an earlier, nearer
    // date had taken out of the ledger is opened again.
    const { data: lease, error: leaseErr } = await g
      .from("leases")
      .select("id,start_date,end_date,rent_cents,charges_cents,payment_day,ledger_from")
      .eq("org_id", org.id)
      .eq("id", leaseId)
      .maybeSingle();
    if (leaseErr || !lease) {
      result.pending.push("ledger");
    } else {
      const row = lease as LeaseRow & { ledger_from?: string | null };
      await openLedger(ctx, { id: row.id, startDate: row.start_date, endDate: row.end_date, rentCents: row.rent_cents, chargesCents: row.charges_cents, paymentDay: row.payment_day, ledgerFrom: row.ledger_from ?? null }, today);
    }
    return result;
  }

  // The guarantee: the keys' date, and its restitution opened (or disputed).
  const { data: deposits, error: depErr } = await g
    .from("deposits")
    .select("id,status,key_handover_on")
    .eq("org_id", org.id)
    .eq("lease_id", leaseId)
    .order("created_at");
  if (depErr) {
    console.error("closure deposit lookup failed:", depErr.code, depErr.message);
    result.pending.push("deposit");
    return result;
  }
  for (const deposit of (deposits as Array<{ id: string; status: string; key_handover_on: string | null }> | null) ?? []) {
    const from = deposit.status as DepositStatus;
    const patch: Record<string, unknown> = {};
    // The keys cannot have come back on a day that has not happened.
    const asked = input.keysReturnedOn && input.keysReturnedOn <= today ? input.keysReturnedOn : endDate;
    if (input.keysReturned && !deposit.key_handover_on) patch.key_handover_on = asked;
    const keysOn = (patch.key_handover_on as string | undefined) ?? (deposit.key_handover_on ? String(deposit.key_handover_on).slice(0, 10) : null);
    if (input.decompteIssuedOn && input.decompteIssuedOn <= today && (!keysOn || input.decompteIssuedOn >= keysOn)) {
      patch.decompte_issued_on = input.decompteIssuedOn;
    }
    // Same moves as the guarantee's own screen: a restitution opens once the
    // keys are back, on a guarantee that was received.
    const to = input.depositOutcome;
    if (to !== from && depositTransitionAllowed(from, to) && (to !== "release_pending" || keysOn)) patch.status = to;
    result.depositStatus = (patch.status as DepositStatus | undefined) ?? from;
    if (Object.keys(patch).length === 0) continue;
    const { data: written, error } = await g.from("deposits").update(patch).eq("org_id", org.id).eq("id", deposit.id).eq("status", from).select("id");
    if (error || !written?.length) {
      if (error) console.error("deposit closure failed:", error.code, error.message);
      result.depositStatus = from;
      result.pending.push("deposit");
    }
  }
  return result;
}

/**
 * Re-prices the rent periods a change is allowed to touch.
 *
 * A rent that goes up, or an indexation that is applied, changes what is owed
 * from a date forward. It must never rewrite a month that already carries
 * money: the ledger is the record of what actually happened, and an allocated
 * period is history. So only periods from `fromMonth` onward that have nothing
 * allocated against them are re-priced; everything else is left exactly as the
 * bank and the tenant left it.
 *
 * Returns how many periods were re-priced, so a caller can tell the owner.
 */
export async function repriceOpenPeriods(
  ctx: OrgContext,
  leaseId: string,
  rentCents: number,
  chargesCents: number,
  fromMonth: string,
): Promise<number> {
  const { g, org } = ctx;
  const [{ data: periods, error: pErr }, { data: statuses, error: sErr }] = await Promise.all([
    g.from("rent_periods").select("id,period").eq("org_id", org.id).eq("lease_id", leaseId).gte("period", fromMonth),
    g.from("rent_period_status").select("id,allocated_cents").eq("lease_id", leaseId),
  ]);
  if (pErr || sErr) {
    console.error("reprice lookup failed:", pErr?.message ?? sErr?.message);
    return 0;
  }
  const allocated = new Map<string, number>();
  for (const row of (statuses as Array<{ id: string; allocated_cents: number }> | null) ?? []) {
    allocated.set(row.id, row.allocated_cents ?? 0);
  }
  const open = ((periods as Array<{ id: string; period: string }> | null) ?? []).filter(
    (p) => (allocated.get(p.id) ?? 0) === 0,
  );
  if (open.length === 0) return 0;

  // total_cents is generated: the database re-sums from the parts.
  const { error } = await g
    .from("rent_periods")
    .update({ rent_cents: rentCents, charges_cents: chargesCents })
    .eq("org_id", org.id)
    .in("id", open.map((p) => p.id));
  if (error) {
    console.error("reprice failed:", error.code, error.message);
    return 0;
  }
  return open.length;
}

/** The month a change takes effect from: today's month, or later. */
export function effectiveMonth(from: string | null): string {
  const today = todayISO().slice(0, 7);
  const asked = (from ?? "").slice(0, 7);
  return asked && asked > today ? `${asked}-01` : `${today}-01`;
}
