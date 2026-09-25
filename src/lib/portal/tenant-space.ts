import "server-only";
import type { GestionReader } from "@/lib/demo/data-real";
import { formatAddress, type PropertyAddress } from "@/lib/gestion/address";
import { nextDueOn } from "@/lib/gestion/ledger";
import { requestKindOf, requestState, ticketRef, type RequestKind, type RequestState } from "@/lib/portal/types";

/**
 * Everything the tenant's space shows, read under the tenant's own token.
 *
 * There is no tenant copy of anything. `my_home()` hands back the lease, the
 * lot and the property with the columns a tenant may see; the ledger, the
 * guarantee, the inventories, the insurance, the documents and the requests
 * are the owner's own rows, filtered by the database's portal policies. If
 * a row is not the tenant's, the query simply does not return it, whatever
 * this code asks for.
 */

type Row = Record<string, unknown>;

/** The few PostgREST filters a tenant read uses, so the builder's deep generics stay out of the way. */
interface Narrow {
  in(column: string, values: readonly string[]): Narrow;
  eq(column: string, value: string): Narrow;
  order(column: string, opts?: { ascending?: boolean }): Narrow;
  limit(count: number): PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>;
}
const s = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const n = (v: unknown): number => (typeof v === "number" ? v : Number(v) || 0);
const day = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v.slice(0, 10) : null);

export interface TenantParty {
  contactId: string;
  name: string;
  role: string;
  movedInOn: string | null;
  movedOutOn: string | null;
  isMe: boolean;
}

export interface TenantPeriod {
  id: string;
  /** YYYY-MM */
  period: string;
  dueDate: string;
  rentCents: number;
  chargesCents: number;
  otherCents: number;
  vatCents: number;
  totalCents: number;
  allocatedCents: number;
  status: string;
}

export interface TenantDocument {
  id: string;
  name: string;
  klass: string;
  createdAt: string;
  storagePath: string;
  url: string | null;
  relatedType: string;
  relatedId: string;
}

export interface TenantLease {
  id: string;
  orgId: string;
  unitId: string;
  propertyId: string;
  status: string;
  type: "residential" | "commercial";
  startDate: string;
  endDate: string | null;
  rentCents: number;
  chargesCents: number;
  chargesRegime: string;
  paymentDay: number;
  rfReference: string;
  furnished: boolean;
  colocation: boolean;
  lastAdjustmentOn: string | null;
  previousRentCents: number | null;
  unit: { label: string; floor: string; areaSqm: number; rooms: number; bedrooms: number | null };
  property: {
    name: string;
    address: string;
    commune: string;
    energyClass: string;
    cpeIssuedOn: string | null;
    syndicName: string | null;
    smokeDetectorsConfirmed: boolean;
    photoPath: string | null;
    photoUrl: string | null;
  };
  parties: TenantParty[];
  deposit: { amountCents: number; form: string; status: string; receivedOn: string | null; keyHandoverOn: string | null } | null;
  edls: Array<{ id: string; kind: string; status: string; scheduledAt: string | null; completedAt: string | null; keyHandoverAt: string | null; sealed: boolean }>;
  insurances: Array<{ id: string; kind: string; provider: string; policyNumber: string; expiresOn: string | null }>;
  documents: TenantDocument[];
  periods: TenantPeriod[];
}

export interface TenantMessage {
  id: string;
  senderKind: string;
  body: string;
  sentAt: string;
  mine: boolean;
  /** Set when the message is a request's place in the conversation: the card is the ticket's. */
  ticketId: string | null;
}

/** The tenancy's conversation with the manager: one per lease, both sides on it. */
export interface TenantConversation {
  id: string;
  leaseId: string;
  /** "Apt 3B · Résidence Beaulieu" */
  label: string;
  lastMessageAt: string;
  messages: TenantMessage[];
}

export interface TenantRequest {
  id: string;
  ref: string;
  leaseId: string;
  kind: RequestKind;
  category: string;
  severity: string;
  status: string;
  state: RequestState;
  title: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  attachments: TenantDocument[];
  /** The conversation the request sits in, once anchored there. */
  conversationId: string | null;
}

export interface TenantPayments {
  /** This month's period, if the ledger holds it. */
  thisMonth: TenantPeriod | null;
  /** The next money to fall due: the earliest open period from today, else the ledger's calendar. */
  nextDueOn: string | null;
  nextDueCents: number;
  /** Everything due up to today that has not arrived. */
  outstandingCents: number;
  history: TenantPeriod[];
}

export interface TenantSpace {
  userId: string;
  me: { name: string; firstName: string; email: string };
  today: string;
  /** The tenancy in force, if the tenant has one: the latest one to start. */
  current: TenantLease | null;
  /** Other tenancies in force at the same time (a second lot, a parking): running, not ended. */
  others: TenantLease[];
  /** Tenancies that ended: the tenant keeps reading them. */
  past: TenantLease[];
  managers: Array<{ orgId: string; name: string; email: string | null; phone: string | null }>;
  /** The account the current tenancy is paid into, as the lessor set it; null while unset. */
  paymentInstructions: { legalName: string; iban: string; bic: string | null; holderName: string } | null;
  requests: TenantRequest[];
  /** One conversation per tenancy, the current one first. */
  conversations: TenantConversation[];
  payments: TenantPayments | null;
}

/** The first name a greeting uses: the contact's, else the account's. */
function firstNameOf(parties: TenantParty[], fallback: string): string {
  const me = parties.find((p) => p.isMe);
  const name = me?.name ?? fallback;
  return name.trim().split(/\s+/)[0] ?? "";
}

export async function buildTenantSpace(
  g: GestionReader,
  opts: { userId: string; email: string; displayName: string; today: string; sign: (paths: string[]) => Promise<Map<string, string>> },
): Promise<TenantSpace> {
  const rpc = async (name: string): Promise<Row[]> => {
    const { data, error } = await g.rpc(name);
    if (error) {
      console.error(`tenant read failed (${name}):`, error.code, error.message);
      return [];
    }
    return (data as Row[] | null) ?? [];
  };
  const read = async (table: string, select: string, apply?: (q: Narrow) => Narrow): Promise<Row[]> => {
    const base = g.from(table).select(select) as unknown as Narrow;
    const query = apply ? apply(base) : base;
    const { data, error } = await query.limit(2000);
    if (error) {
      console.error(`tenant read failed (${table}):`, error.code, error.message);
      return [];
    }
    return (data as unknown as Row[]) ?? [];
  };

  const [homes, partyRows, managerRows, instructionRows] = await Promise.all([rpc("my_home"), rpc("my_lease_parties"), rpc("my_managers"), rpc("my_payment_instructions")]);
  const leaseIds = homes.map((h) => s(h.lease_id));
  if (leaseIds.length === 0) {
    return {
      userId: opts.userId,
      me: { name: opts.displayName, firstName: opts.displayName.split(/\s+/)[0] ?? "", email: opts.email },
      today: opts.today,
      current: null,
      others: [],
      past: [],
      managers: [],
      paymentInstructions: null,
      requests: [],
      conversations: [],
      payments: null,
    };
  }

  // Each table filters to the tenant's own rows by policy; the `in` only
  // narrows what is asked for, it never widens what comes back.
  const [periodRows, lineRows, depositRows, edlRows, insuranceRows, ticketRows] = await Promise.all([
    read("rent_period_status", "id,lease_id,period,due_date,total_cents,allocated_cents,status", (q) => q.in("lease_id", leaseIds).order("period")),
    read("rent_periods", "id,lease_id,rent_cents,charges_cents,other_cents,vat_cents", (q) => q.in("lease_id", leaseIds)),
    read("deposits", "id,lease_id,form,amount_cents,status,received_on,key_handover_on", (q) => q.in("lease_id", leaseIds)),
    read("edl_sessions", "id,lease_id,kind,status,scheduled_at,completed_at,key_handover_at,hash_manifest_sha256", (q) => q.in("lease_id", leaseIds)),
    read("insurance_policies", "id,lease_id,kind,provider,policy_number,expires_on", (q) => q.in("lease_id", leaseIds)),
    read("tickets", "id,lease_id,category,severity,status,title,description,created_at,updated_at,closed_at", (q) => q.in("lease_id", leaseIds).order("created_at", { ascending: false })),
  ]);
  // The documents and conversations the space shows are the leases' and the
  // requests' own: asked for by those ids, not "everything the policy lets
  // through" and sorted out in memory.
  const ticketIds = ticketRows.map((t) => s(t.id));
  const [documentRows, conversationRows] = await Promise.all([
    read("documents", "id,class,name,storage_path,related_type,related_id,created_at", (q) =>
      q.in("related_id", [...leaseIds, ...ticketIds]).order("created_at", { ascending: false }),
    ),
    read("conversations", "id,scope_type,scope_id", (q) => q.eq("scope_type", "lease").in("scope_id", leaseIds)),
  ]);
  const conversationIds = conversationRows.map((c) => s(c.id));
  const messageRows = conversationIds.length > 0
    ? await read("messages", "*", (q) => q.in("conversation_id", conversationIds).order("sent_at"))
    : [];

  // Signed links for the property photos and the documents the tenant may open.
  const paths = [...homes.map((h) => s(h.photo_url)), ...documentRows.map((d) => s(d.storage_path))].filter((p) => p !== "" && !p.startsWith("http"));
  const signed = await opts.sign(paths);
  const urlOf = (path: string): string | null => (path.startsWith("http") ? path : signed.get(path) ?? null);

  const partiesByLease = new Map<string, TenantParty[]>();
  for (const p of partyRows) {
    const list = partiesByLease.get(s(p.lease_id)) ?? [];
    list.push({ contactId: s(p.contact_id), name: s(p.display_name), role: s(p.role), movedInOn: day(p.moved_in_on), movedOutOn: day(p.moved_out_on), isMe: p.is_me === true });
    partiesByLease.set(s(p.lease_id), list);
  }
  const documents: TenantDocument[] = documentRows.map((d) => ({
    id: s(d.id),
    name: s(d.name),
    klass: s(d.class),
    createdAt: day(d.created_at) ?? "",
    storagePath: s(d.storage_path),
    url: urlOf(s(d.storage_path)),
    relatedType: s(d.related_type),
    relatedId: s(d.related_id),
  }));

  const lineByPeriod = new Map(lineRows.map((r) => [s(r.id), r]));
  const leases: TenantLease[] = homes.map((h) => {
    const id = s(h.lease_id);
    const deposit = depositRows.find((x) => s(x.lease_id) === id);
    return {
      id,
      orgId: s(h.org_id),
      unitId: s(h.unit_id),
      propertyId: s(h.property_id),
      status: s(h.lease_status),
      type: s(h.lease_type) === "commercial" ? "commercial" : "residential",
      startDate: day(h.start_date) ?? "",
      endDate: day(h.end_date),
      rentCents: n(h.rent_cents),
      chargesCents: n(h.charges_cents),
      chargesRegime: s(h.charges_regime),
      paymentDay: n(h.payment_day) || 1,
      rfReference: s(h.rf_reference),
      furnished: h.furnished === true,
      colocation: h.colocation === true,
      lastAdjustmentOn: day(h.last_adjustment_on),
      previousRentCents: typeof h.previous_rent_cents === "number" ? h.previous_rent_cents : null,
      unit: { label: s(h.unit_label), floor: s(h.unit_floor), areaSqm: n(h.unit_area_sqm), rooms: n(h.unit_rooms), bedrooms: typeof h.unit_bedrooms === "number" ? h.unit_bedrooms : null },
      property: {
        name: s(h.property_name),
        address: formatAddress((h.property_address as PropertyAddress | null) ?? null),
        commune: s(h.property_commune),
        energyClass: s(h.energy_class),
        cpeIssuedOn: day(h.cpe_issued_on),
        syndicName: s(h.syndic_name) || null,
        smokeDetectorsConfirmed: h.smoke_detectors_confirmed === true,
        photoPath: s(h.photo_url) || null,
        photoUrl: s(h.photo_url) ? urlOf(s(h.photo_url)) : null,
      },
      parties: partiesByLease.get(id) ?? [],
      deposit: deposit
        ? { amountCents: n(deposit.amount_cents), form: s(deposit.form), status: s(deposit.status), receivedOn: day(deposit.received_on), keyHandoverOn: day(deposit.key_handover_on) }
        : null,
      edls: edlRows
        .filter((e) => s(e.lease_id) === id)
        .map((e) => ({ id: s(e.id), kind: s(e.kind), status: s(e.status), scheduledAt: day(e.scheduled_at), completedAt: day(e.completed_at), keyHandoverAt: day(e.key_handover_at), sealed: s(e.hash_manifest_sha256) !== "" })),
      insurances: insuranceRows
        .filter((i) => s(i.lease_id) === id)
        .map((i) => ({ id: s(i.id), kind: s(i.kind), provider: s(i.provider), policyNumber: s(i.policy_number), expiresOn: day(i.expires_on) })),
      documents: documents.filter((d) => d.relatedType === "lease" && d.relatedId === id),
      periods: periodRows
        .filter((rp) => s(rp.lease_id) === id)
        .map((rp) => {
          const line = lineByPeriod.get(s(rp.id));
          return {
            id: s(rp.id),
            period: s(rp.period).slice(0, 7),
            dueDate: day(rp.due_date) ?? "",
            rentCents: n(line?.rent_cents),
            chargesCents: n(line?.charges_cents),
            otherCents: n(line?.other_cents),
            vatCents: n(line?.vat_cents),
            totalCents: n(rp.total_cents),
            allocatedCents: n(rp.allocated_cents),
            status: s(rp.status),
          };
        }),
    };
  });

  // The home page is one tenancy: the latest one in force. Another one
  // running at the same time is not "former", it is listed as running.
  const byStart = (a: TenantLease, b: TenantLease) => (a.startDate < b.startDate ? 1 : -1);
  const isLive = (l: TenantLease) => l.status === "active" || l.status === "notice";
  const live = leases.filter(isLive).sort(byStart);
  const current = live[0] ?? null;
  const others = live.filter((l) => l !== current);
  const past = leases.filter((l) => !isLive(l)).sort(byStart);

  const conversationByLease = new Map(conversationRows.map((c) => [s(c.scope_id), s(c.id)]));
  const anchorByTicket = new Map<string, string>();
  for (const m of messageRows) if (s(m.ticket_id) !== "" && !anchorByTicket.has(s(m.ticket_id))) anchorByTicket.set(s(m.ticket_id), s(m.conversation_id));
  const toMessage = (m: Row): TenantMessage => ({
    id: s(m.id),
    senderKind: s(m.sender_kind),
    body: s(m.body),
    sentAt: s(m.sent_at),
    mine: s(m.sender_user_id) === opts.userId,
    ticketId: s(m.ticket_id) || null,
  });
  const labelOfLease = (id: string): string => {
    const l = leases.find((x) => x.id === id);
    return l ? [l.unit.label, l.property.name].filter(Boolean).join(" · ") : "";
  };
  const conversations: TenantConversation[] = conversationRows
    .map((c) => {
      const msgs = messageRows.filter((m) => s(m.conversation_id) === s(c.id)).map(toMessage);
      return { id: s(c.id), leaseId: s(c.scope_id), label: labelOfLease(s(c.scope_id)), lastMessageAt: msgs[msgs.length - 1]?.sentAt ?? "", messages: msgs };
    })
    .sort((a, b) => (a.leaseId === current?.id ? -1 : b.leaseId === current?.id ? 1 : a.lastMessageAt < b.lastMessageAt ? 1 : -1));
  const requests: TenantRequest[] = ticketRows.map((t) => {
    const conversationId = anchorByTicket.get(s(t.id)) ?? conversationByLease.get(s(t.lease_id)) ?? null;
    const description = s(t.description).replace(/^\[(document|question|other)\]\s*/, "");
    return {
      id: s(t.id),
      ref: ticketRef(s(t.id)),
      leaseId: s(t.lease_id),
      kind: requestKindOf({ category: s(t.category), description: s(t.description) || null }),
      category: s(t.category),
      severity: s(t.severity),
      status: s(t.status),
      state: requestState(s(t.status)),
      title: s(t.title),
      description,
      createdAt: day(t.created_at) ?? "",
      updatedAt: day(t.updated_at) ?? "",
      closedAt: day(t.closed_at),
      attachments: documents.filter((d) => d.relatedType === "ticket" && d.relatedId === s(t.id)),
      conversationId,
    };
  });

  const allParties = leases.flatMap((l) => l.parties);
  const meName = allParties.find((p) => p.isMe)?.name ?? opts.displayName;

  return {
    userId: opts.userId,
    me: { name: meName, firstName: firstNameOf(allParties, opts.displayName), email: opts.email },
    today: opts.today,
    current,
    others,
    past,
    managers: managerRows.map((m) => ({ orgId: s(m.org_id), name: s(m.name), email: s(m.email) || null, phone: s(m.phone) || null })),
    paymentInstructions: (() => {
      const row = current ? instructionRows.find((r) => s(r.org_id) === current.orgId) : undefined;
      return row && s(row.iban) ? { legalName: s(row.legal_name), iban: s(row.iban), bic: s(row.bic) || null, holderName: s(row.holder_name) || s(row.legal_name) } : null;
    })(),
    requests,
    conversations,
    payments: current ? paymentsOf(current, opts.today) : null,
  };
}

/** The tenant's money picture, derived from the ledger rows and nothing else. */
export function paymentsOf(lease: Pick<TenantLease, "periods" | "paymentDay" | "startDate" | "endDate">, today: string): TenantPayments {
  const month = today.slice(0, 7);
  const sorted = [...lease.periods].sort((a, b) => (a.period < b.period ? -1 : 1));
  const thisMonth = sorted.find((p) => p.period === month) ?? null;
  const open = sorted.filter((p) => p.allocatedCents < p.totalCents && p.status !== "written_off");
  // Late is "due before today", the same line the ledger's own status draws
  // (`due_date < current_date`): the day the rent falls due it is still to pay,
  // not behind.
  const outstandingCents = open.filter((p) => p.dueDate < today).reduce((a, p) => a + (p.totalCents - p.allocatedCents), 0);
  const upcoming = open.find((p) => p.dueDate >= today) ?? null;
  const nextDue = upcoming ? upcoming.dueDate : nextDueOn(today, lease.paymentDay, lease.startDate, lease.endDate);
  const nextDueCents = upcoming ? upcoming.totalCents - upcoming.allocatedCents : sorted.length > 0 ? sorted[sorted.length - 1].totalCents : 0;
  return { thisMonth, nextDueOn: nextDue, nextDueCents, outstandingCents, history: [...sorted].reverse() };
}

/**
 * Whether the signed-in account is a tenant anywhere, and where: the same
 * `my_home()` the space is built from, kept to its ids.
 */
export async function tenantLeaseIds(g: Pick<GestionReader, "rpc">): Promise<string[]> {
  const { data, error } = await g.rpc("my_home");
  if (error) {
    console.error("tenant lookup failed:", error.code, error.message);
    return [];
  }
  return ((data as Row[] | null) ?? []).map((h) => s(h.lease_id)).filter((id) => id !== "");
}

/**
 * The yes-or-no version the management layout asks on every request:
 * `gestion.is_tenant()` (0017) is the predicate behind `my_home()` and
 * nothing more, so no lease, lot or property row is assembled just to be
 * counted. An error reads as "not a tenant", the safe side for a layout.
 */
export async function isTenant(g: Pick<GestionReader, "rpc">): Promise<boolean> {
  const { data, error } = await g.rpc("is_tenant");
  if (error) {
    console.error("tenant lookup failed:", error.code, error.message);
    return false;
  }
  return data === true;
}
