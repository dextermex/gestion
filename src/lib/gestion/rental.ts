import "server-only";
import type { OrgContext } from "@/lib/gestion/api";
import { parseEuroInput } from "@/lib/gestion/euros";
import { leaseRF } from "@/domain/banking/rf";
import { getParamValue } from "@/domain/legal/params";
import { leaseIssueText } from "@/lib/i18n/engine";
import type { Dict } from "@/lib/i18n";
import {
  LIVE_STATUSES,
  leaseCompliance,
  mentionsFor,
  normalizeDepositForm,
  normalizePaymentDay,
  type DepositForm,
  type LeaseIssue,
} from "@/lib/gestion/lease";
import { completedOnSave, firstIncomplete, stepNamed, type RentalStep } from "@/lib/gestion/rental-flow";

/**
 * The rental dossier: the guided tenancy, saved as the owner goes.
 *
 * From the first save, on whichever step, the dossier IS a lease row with
 * status `draft`: the people on it are contacts and parties, its rent, dates
 * and guarantee are its columns, its payer account a binding, and what the
 * owner has completed is kept in the row's `details.dossier`. That is why
 * the owner can stop on any step, from any device, and come back to the
 * first step they have not completed. A draft never occupies the lot and
 * owes nothing: only the last step, activation (`activateLease`), makes the
 * rental active.
 *
 * A lease is signed by everyone who moves in: a couple, a family, three
 * roommates. Each of them is a contact and a party to the same lease, so the
 * property, the contact sheet and the ledger all name the same people.
 * Whether that makes the lease a colocation in the legal sense is the
 * owner's explicit answer, never a count.
 */

export interface TenantInput {
  /** The contact this person already is, when the dossier is being resumed. */
  contactId: string | null;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  language: string;
}

export interface DossierInput {
  leaseId: string | null;
  unitId: string;
  /** The step the owner is saving from. */
  step: RentalStep;
  tenants: TenantInput[];
  colocation: boolean;
  type: "residential" | "commercial";
  startDate: string | null;
  endDate: string | null;
  /** 0 until the rent step has been filled in. */
  rentCents: number;
  chargesCents: number;
  paymentDay: number;
  depositMonths: number;
  depositForm: DepositForm;
  payerIban: string | null;
  payerName: string | null;
}

export interface DossierResult {
  leaseId: string;
  propertyId: string;
  contactIds: string[];
  status: "draft";
  completed: RentalStep[];
  resumeStep: RentalStep;
  /** What the written lease still lacks, for the dossier. Informative. */
  issues: LeaseIssue[];
}

export type DossierFailure =
  | { error: "not_found" | "already_let" | "not_draft" | "wrong_lot" }
  | { error: "storage_failed"; context: string; detail: { code?: string; message?: string } | null };

const LANGUAGES = ["fr", "en", "de", "lu"];
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** IBAN as stored elsewhere in the product: upper case, no spaces. */
export function normalizeIban(raw: string): string | null {
  const iban = raw.replace(/[\s]/g, "").toUpperCase();
  return /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban) ? iban : null;
}

function tenantFrom(raw: unknown, defaultLanguage: string): TenantInput | null {
  const t = (raw ?? {}) as Record<string, unknown>;
  const firstName = str(t.firstName, 80);
  const lastName = str(t.lastName, 80);
  if (!firstName && !lastName) return null;
  const language = str(t.language, 2);
  return {
    contactId: str(t.contactId, 64) || null,
    firstName,
    lastName,
    email: str(t.email, 160) || null,
    phone: str(t.phone, 40) || null,
    language: LANGUAGES.includes(language) ? language : defaultLanguage,
  };
}

/**
 * The request, read once and not believed. `tenants` is the list of people
 * moving in; a request that still sends one person as flat fields is read
 * the same way. An added block left blank is simply not a person. A rent
 * left empty is 0 for now (the rent step has not been reached); a rent
 * that cannot be read is refused.
 */
export function parseDossierInput(body: Record<string, unknown>, defaultLanguage: string): DossierInput | null {
  const unitId = str(body.unitId, 64);
  const leaseId = str(body.leaseId, 64) || null;
  const rawTenants = Array.isArray(body.tenants) ? body.tenants : [body];
  const tenants = rawTenants.map((t) => tenantFrom(t, defaultLanguage)).filter((t): t is TenantInput => t !== null);
  const rentRaw = str(body.rent, 20);
  const rentCents = rentRaw === "" ? 0 : parseEuroInput(rentRaw);
  const chargesRaw = str(body.charges, 20);
  const chargesCents = chargesRaw === "" ? 0 : parseEuroInput(chargesRaw);
  const depositMonths = Math.round(Number(body.depositMonths ?? 0));

  if (!unitId || rentCents === null || chargesCents === null) return null;
  if (!Number.isFinite(depositMonths) || depositMonths < 0 || depositMonths > 12) return null;
  // Nothing to save yet: no dossier exists and nobody has been named.
  if (!leaseId && tenants.length === 0) return null;

  return {
    leaseId,
    unitId,
    step: stepNamed(body.step),
    tenants,
    // One person cannot be a colocation, whatever the box says.
    colocation: body.colocation === true && tenants.length > 1,
    type: body.type === "commercial" ? "commercial" : "residential",
    startDate: ISO.test(str(body.startDate, 10)) ? str(body.startDate, 10) : null,
    endDate: ISO.test(str(body.endDate, 10)) ? str(body.endDate, 10) : null,
    rentCents,
    chargesCents,
    paymentDay: normalizePaymentDay(body.paymentDay),
    depositMonths,
    depositForm: normalizeDepositForm(body.depositForm),
    payerIban: normalizeIban(str(body.payerIban, 40)),
    payerName: str(body.payerName, 120) || null,
  };
}

const fold = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/**
 * The tenant whose name the payer account is held in, if it is one of them.
 * A single tenant is assumed to be the holder unless another name was given;
 * among several, only a matching name decides, because a parent or a
 * partner outside the lease may well be the one paying.
 */
export function payerTenantIndex(tenants: Array<Pick<TenantInput, "firstName" | "lastName">>, payerName: string | null): number {
  if (tenants.length === 1) return payerName && !nameMatches(tenants[0], payerName) ? -1 : 0;
  if (!payerName) return -1;
  return tenants.findIndex((t) => nameMatches(t, payerName));
}

function nameMatches(t: Pick<TenantInput, "firstName" | "lastName">, holder: string): boolean {
  const full = fold(`${t.firstName} ${t.lastName}`);
  const reversed = fold(`${t.lastName} ${t.firstName}`);
  const h = fold(holder);
  return h !== "" && (h === full || h === reversed);
}

type Row = Record<string, unknown>;
const fail = (context: string, detail: { code?: string; message?: string } | null): DossierFailure => ({
  error: "storage_failed",
  context,
  detail,
});

export async function saveRentalDraft(ctx: OrgContext, d: Dict, input: DossierInput): Promise<DossierResult | DossierFailure> {
  const { g, org } = ctx;
  const today = new Date().toISOString().slice(0, 10);

  // The lot decides the property and whether the home is furnished; the
  // request is not believed about either.
  const { data: unit, error: unitErr } = await g
    .from("units")
    .select("id,furnished,property_id")
    .eq("org_id", org.id)
    .eq("id", input.unitId)
    .maybeSingle();
  if (unitErr) return fail("dossier unit lookup", unitErr);
  if (!unit) return { error: "not_found" };

  // ── The draft row: the one being resumed, the one already on this lot, or a new one ──
  // A dossier belongs to one lot for life: it is written with that lot's
  // `unit_id`, the lot names the property, and a resume that names another
  // lot (a stale tab, a forged request) is refused rather than moved or
  // written across.
  let lease: Row | null = null;
  if (input.leaseId) {
    const { data, error } = await g
      .from("leases")
      .select("id,status,unit_id,details")
      .eq("org_id", org.id)
      .eq("id", input.leaseId)
      .maybeSingle();
    if (error) return fail("dossier lease lookup", error);
    if (!data) return { error: "not_found" };
    if (data.status !== "draft") return { error: "not_draft" };
    if (String(data.unit_id) !== input.unitId) return { error: "wrong_lot" };
    lease = data as Row;
  } else {
    // A lot under a live lease cannot take a second tenancy.
    const { data: live, error: liveErr } = await g
      .from("leases")
      .select("id")
      .eq("org_id", org.id)
      .eq("unit_id", input.unitId)
      .in("status", [...LIVE_STATUSES])
      .limit(1);
    if (liveErr) return fail("dossier occupancy lookup", liveErr);
    if ((live ?? []).length > 0) return { error: "already_let" };

    // A dossier already in preparation on this lot is continued, never doubled.
    const { data: drafts, error: draftErr } = await g
      .from("leases")
      .select("id,status,unit_id,details,created_at")
      .eq("org_id", org.id)
      .eq("unit_id", input.unitId)
      .eq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(1);
    if (draftErr) return fail("dossier draft lookup", draftErr);
    lease = ((drafts as Row[] | null) ?? [])[0] ?? null;
  }

  if (!lease) {
    const { data: created, error: insErr } = await g
      .from("leases")
      .insert({
        org_id: org.id,
        unit_id: input.unitId,
        lease_type: input.type,
        status: "draft",
        start_date: input.startDate ?? today,
        end_date: input.endDate,
        rent_cents: input.rentCents,
        charges_cents: input.chargesCents,
        charges_regime: "advances",
        payment_day: input.paymentDay,
        mentions: mentionsFor(input.type),
        furnished: unit.furnished === true,
        colocation: input.colocation,
        vat_regime: "exempt",
        details: {},
      })
      .select("id,seq,status,unit_id,details")
      .single();
    if (insErr || !created) return fail("dossier lease insert", insErr);
    lease = created as Row;
    // The database assigns the lease number; the permanent structured
    // reference is derived from it plus a stable per-workspace prefix.
    const orgSeq = (parseInt(org.id.replace(/-/g, "").slice(0, 6), 16) % 9000) + 1000;
    const { error: rfErr } = await g
      .from("leases")
      .update({ rf_reference: leaseRF(orgSeq, created.seq as number) })
      .eq("org_id", org.id)
      .eq("id", created.id);
    if (rfErr) console.error("lease rf update failed:", rfErr.code, rfErr.message);
  }
  const leaseId = String(lease.id);

  // ── The people: everyone named is a contact and a party, nobody twice ──
  const { data: partyRows, error: partyErr } = await g
    .from("lease_parties")
    .select("id,contact_id")
    .eq("org_id", org.id)
    .eq("lease_id", leaseId)
    .eq("role", "tenant");
  if (partyErr) return fail("dossier parties lookup", partyErr);
  const existing = new Map(((partyRows as Row[] | null) ?? []).map((p) => [String(p.contact_id), String(p.id)]));

  const contactIds: string[] = [];
  for (const t of input.tenants) {
    if (t.contactId && existing.has(t.contactId)) {
      const { error } = await g
        .from("contacts")
        .update({
          first_name: t.firstName || null,
          last_name: t.lastName || null,
          email: t.email,
          phone: t.phone,
          language: t.language,
        })
        .eq("org_id", org.id)
        .eq("id", t.contactId);
      if (error) console.error("tenant contact update failed:", error.code, error.message);
      contactIds.push(t.contactId);
      continue;
    }
    // display_name is a generated column: the parts go in, the label comes out.
    const { data: contact, error: contactErr } = await g
      .from("contacts")
      .insert({
        org_id: org.id,
        kind: "natural",
        first_name: t.firstName || null,
        last_name: t.lastName || null,
        email: t.email,
        phone: t.phone,
        language: t.language,
      })
      .select("id")
      .single();
    if (contactErr || !contact) return fail("tenant contact insert", contactErr);
    const contactId = String(contact.id);
    contactIds.push(contactId);
    const { error: roleErr } = await g.from("contact_roles").insert({ org_id: org.id, contact_id: contactId, role: "tenant" });
    if (roleErr) console.error("tenant role insert failed:", roleErr.code, roleErr.message);
    const { error: linkErr } = await g
      .from("lease_parties")
      .insert({ org_id: org.id, lease_id: leaseId, contact_id: contactId, role: "tenant" });
    if (linkErr) console.error("lease party insert failed:", linkErr.code, linkErr.message);
  }
  // Someone removed from the dossier leaves the lease; they stay a contact.
  const gone = [...existing.entries()].filter(([contactId]) => !contactIds.includes(contactId)).map(([, partyId]) => partyId);
  if (gone.length > 0) {
    const { error } = await g.from("lease_parties").delete().eq("org_id", org.id).in("id", gone);
    if (error) console.error("lease party removal failed:", error.code, error.message);
  }

  // ── The terms, and the dossier's memory of what is done ──
  const previous = ((lease.details as Row | null)?.dossier as Row | undefined)?.completed;
  const completed = completedOnSave(Array.isArray(previous) ? previous.map(String) : [], input.step, {
    tenant: contactIds.length > 0,
    rent: input.rentCents > 0,
  });
  const details: Row = {
    ...((lease.details as Row | null) ?? {}),
    depositMonths: input.depositMonths,
    depositForm: input.depositForm,
    dossier: { completed, step: input.step, payerName: input.payerName, savedOn: today },
  };
  const { data: updated, error: updErr } = await g
    .from("leases")
    .update({
      lease_type: input.type,
      start_date: input.startDate ?? today,
      end_date: input.endDate,
      rent_cents: input.rentCents,
      charges_cents: input.chargesCents,
      payment_day: input.paymentDay,
      mentions: mentionsFor(input.type),
      furnished: unit.furnished === true,
      colocation: input.colocation,
      details,
    })
    .eq("org_id", org.id)
    .eq("id", leaseId)
    .select("id");
  if (updErr) return fail("dossier lease update", updErr);
  if (!updated?.length) return { error: "not_found" };

  // ── The guarantee: one row while there is one, none when there is none ──
  const { data: depositRows, error: depErr } = await g
    .from("deposits")
    .select("id")
    .eq("org_id", org.id)
    .eq("lease_id", leaseId);
  if (depErr) console.error("dossier deposit lookup failed:", depErr.code, depErr.message);
  const depositId = ((depositRows as Row[] | null) ?? [])[0]?.id;
  if (input.depositMonths > 0) {
    const row = { form: input.depositForm, amount_cents: input.rentCents * input.depositMonths, status: "pending" };
    const { error } = depositId
      ? await g.from("deposits").update(row).eq("org_id", org.id).eq("id", depositId)
      : await g.from("deposits").insert({ org_id: org.id, lease_id: leaseId, ...row });
    if (error) console.error("dossier deposit write failed:", error.code, error.message);
  } else if (depositId) {
    const { error } = await g.from("deposits").delete().eq("org_id", org.id).eq("id", depositId);
    if (error) console.error("dossier deposit removal failed:", error.code, error.message);
  }

  // ── The payer account: the binding is the fact, the contact's IBAN a convenience ──
  const { error: unbindErr } = await g.from("iban_bindings").delete().eq("org_id", org.id).eq("lease_id", leaseId);
  if (unbindErr) console.error("dossier payer reset failed:", unbindErr.code, unbindErr.message);
  if (input.payerIban) {
    const { error: bindErr } = await g
      .from("iban_bindings")
      .insert({ org_id: org.id, payer_iban: input.payerIban, lease_id: leaseId });
    if (bindErr) console.error("payer binding insert failed:", bindErr.code, bindErr.message);
    const holder = payerTenantIndex(input.tenants, input.payerName);
    if (holder >= 0 && contactIds[holder]) {
      const { error } = await g
        .from("contacts")
        .update({ iban: input.payerIban, bank_holder_name: input.payerName })
        .eq("org_id", org.id)
        .eq("id", contactIds[holder]);
      if (error) console.error("tenant iban update failed:", error.code, error.message);
    }
  }

  const issueVars = {
    months: input.depositMonths,
    max: getParamValue(input.type === "residential" ? "residential.deposit_max_months" : "commercial.deposit_max_months", today),
    date: "",
  };
  const issues = leaseCompliance(
    {
      unitId: input.unitId,
      tenantContactIds: contactIds,
      colocation: input.colocation,
      type: input.type,
      startDate: input.startDate ?? today,
      endDate: input.endDate,
      rentCents: input.rentCents,
      chargesCents: input.chargesCents,
      paymentDay: input.paymentDay,
      depositMonths: input.depositMonths,
      depositForm: input.depositForm,
      furnished: unit.furnished === true,
    },
    today,
  );

  return {
    leaseId,
    propertyId: String(unit.property_id),
    contactIds,
    status: "draft",
    completed,
    resumeStep: firstIncomplete(completed),
    issues: issues.map((i) => ({ code: i.code, severity: i.severity, message: leaseIssueText(d, i.code, issueVars, i.message) })),
  };
}
