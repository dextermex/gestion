import "server-only";
import type { OrgContext } from "@/lib/gestion/api";
import { parseEuroInput } from "@/lib/gestion/euros";
import {
  LIVE_STATUSES,
  createLease,
  normalizeDepositForm,
  normalizePaymentDay,
  type DepositForm,
  type LeaseIssue,
} from "@/lib/gestion/lease";
import type { Dict } from "@/lib/i18n";

/**
 * The guided tenancy: one call that turns a vacant lot into a running rental.
 *
 * It creates the people, hands the lease to `createLease`, records the
 * guarantee, and remembers the account the rent will arrive from. A lease is
 * signed by everyone who moves in: a couple, a family, three roommates. Each
 * of them becomes a contact and a party to the same lease, so the property,
 * the contact sheet and the ledger all name the same people. Whether that
 * makes the lease a colocation in the legal sense is the owner's explicit
 * answer, never a count.
 *
 * The lot is known from where the owner started, so it is never asked for
 * again, and the property is read from the lot rather than trusted from the
 * request.
 */

export interface TenantInput {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  language: string;
}

export interface RentalInput {
  unitId: string;
  tenants: TenantInput[];
  colocation: boolean;
  type: "residential" | "commercial";
  startDate: string;
  endDate: string | null;
  rentCents: number;
  chargesCents: number;
  paymentDay: number;
  depositMonths: number;
  depositForm: DepositForm;
  payerIban: string | null;
  payerName: string | null;
}

export interface RentalResult {
  leaseId: string;
  contactIds: string[];
  propertyId: string;
  status: "active";
  issues: LeaseIssue[];
  periodsOpened: number;
}

export type RentalFailure =
  | { error: "not_found" | "already_let" }
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
 * the same way. An added block left blank is simply not a person.
 */
export function parseRentalInput(
  body: Record<string, unknown>,
  today: string,
  defaultLanguage: string,
): RentalInput | null {
  const unitId = str(body.unitId, 64);
  const rawTenants = Array.isArray(body.tenants) ? body.tenants : [body];
  const tenants = rawTenants.map((t) => tenantFrom(t, defaultLanguage)).filter((t): t is TenantInput => t !== null);
  const rentCents = parseEuroInput(str(body.rent, 20));
  const chargesRaw = str(body.charges, 20);
  const chargesCents = chargesRaw === "" ? 0 : (parseEuroInput(chargesRaw) ?? -1);
  const depositMonths = Math.round(Number(body.depositMonths ?? 0));

  if (!unitId || tenants.length === 0 || !rentCents || chargesCents < 0) return null;
  if (!Number.isFinite(depositMonths) || depositMonths < 0 || depositMonths > 12) return null;

  return {
    unitId,
    tenants,
    // One person cannot be a colocation, whatever the box says.
    colocation: body.colocation === true && tenants.length > 1,
    type: body.type === "commercial" ? "commercial" : "residential",
    startDate: ISO.test(str(body.startDate, 10)) ? str(body.startDate, 10) : today,
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
export function payerTenantIndex(tenants: TenantInput[], payerName: string | null): number {
  if (tenants.length === 1) return payerName && !nameMatches(tenants[0], payerName) ? -1 : 0;
  if (!payerName) return -1;
  return tenants.findIndex((t) => nameMatches(t, payerName));
}

function nameMatches(t: TenantInput, holder: string): boolean {
  const full = fold(`${t.firstName} ${t.lastName}`);
  const reversed = fold(`${t.lastName} ${t.firstName}`);
  const h = fold(holder);
  return h !== "" && (h === full || h === reversed);
}

export async function createRental(ctx: OrgContext, d: Dict, input: RentalInput): Promise<RentalResult | RentalFailure> {
  const { g, org } = ctx;

  // The lot decides the property and whether the home is furnished; the
  // request is not believed about either.
  const { data: unit, error: unitErr } = await g
    .from("units")
    .select("id,furnished,property_id")
    .eq("org_id", org.id)
    .eq("id", input.unitId)
    .maybeSingle();
  if (unitErr) return { error: "storage_failed", context: "rental unit lookup", detail: unitErr };
  if (!unit) return { error: "not_found" };

  // A lot already under a live lease cannot take a second one.
  const { data: existing, error: busyErr } = await g
    .from("leases")
    .select("id")
    .eq("org_id", org.id)
    .eq("unit_id", input.unitId)
    .in("status", [...LIVE_STATUSES])
    .limit(1);
  if (busyErr) return { error: "storage_failed", context: "rental occupancy lookup", detail: busyErr };
  if ((existing ?? []).length > 0) return { error: "already_let" };

  // Everyone who moves in becomes a contact with the tenant role.
  // display_name is a generated column: the parts go in, the label comes out.
  const contactIds: string[] = [];
  for (const t of input.tenants) {
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
    if (contactErr || !contact) return { error: "storage_failed", context: "tenant contact insert", detail: contactErr };
    contactIds.push(contact.id as string);

    const { error: roleErr } = await g
      .from("contact_roles")
      .insert({ org_id: org.id, contact_id: contact.id, role: "tenant" });
    if (roleErr) console.error("tenant role insert failed:", roleErr.code, roleErr.message);
  }

  const lease = await createLease(ctx, d, {
    unitId: input.unitId,
    tenantContactIds: contactIds,
    colocation: input.colocation,
    type: input.type,
    startDate: input.startDate,
    endDate: input.endDate,
    rentCents: input.rentCents,
    chargesCents: input.chargesCents,
    paymentDay: input.paymentDay,
    depositMonths: input.depositMonths,
    depositForm: input.depositForm,
    furnished: unit.furnished === true,
  });
  if ("error" in lease) return { error: "storage_failed", context: "lease insert", detail: { code: lease.error } };

  // The account the rent is expected from. It makes the matcher confident,
  // it never makes it certain: a transfer from an unknown account still
  // lands in review rather than being refused.
  if (input.payerIban) {
    const { error: bindErr } = await g
      .from("iban_bindings")
      .insert({ org_id: org.id, payer_iban: input.payerIban, lease_id: lease.id });
    if (bindErr) console.error("payer binding insert failed:", bindErr.code, bindErr.message);

    const holder = payerTenantIndex(input.tenants, input.payerName);
    if (holder >= 0) {
      const { error: ibanErr } = await g
        .from("contacts")
        .update({ iban: input.payerIban, bank_holder_name: input.payerName })
        .eq("org_id", org.id)
        .eq("id", contactIds[holder]);
      if (ibanErr) console.error("tenant iban update failed:", ibanErr.code, ibanErr.message);
    }
  }

  return {
    leaseId: lease.id,
    contactIds,
    propertyId: unit.property_id as string,
    status: lease.status,
    issues: lease.issues,
    periodsOpened: lease.periodsOpened,
  };
}
