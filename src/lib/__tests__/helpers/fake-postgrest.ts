import { randomBytes, randomUUID } from "node:crypto";
import type { OrgContext } from "@/lib/gestion/api";
import type { GestionReader } from "@/lib/demo/data-real";

/**
 * An in-memory stand-in for the PostgREST client the write layer and the
 * hydration read through, faithful to the parts of the gestion schema they
 * lean on: generated columns, the identity sequence on leases, column
 * defaults, the unique keys the code relies on, cascading deletes, the
 * check on lease dates, and the rent_period_status view. It exists so the
 * lifecycle tests run the real functions against one database and assert
 * what the pages would compute from it, without a network.
 *
 * It also plays the tenant portal's side of the database (0006, 0015): a
 * client bound to a tenant account sees only what the portal policies
 * return, may insert only what they allow, and the portal RPCs (my_home,
 * invitations, acceptance, preview) run the same checks as their SQL.
 *
 * It is not a SQL engine. It supports exactly the builder calls the code
 * makes: select / insert / upsert / update / delete, eq / is / in / gte,
 * order / limit, single / maybeSingle, rpc, and an awaited `{ data, error }`.
 */

export type Row = Record<string, unknown>;
type DbError = { code: string; message: string };
type Result = { data: unknown; error: DbError | null; count?: number | null };

const n = (v: unknown): number => (typeof v === "number" ? v : 0);

const DEFAULTS: Record<string, () => Row> = {
  bills: () => ({ direction: "expense", supplier_contact_id: null, property_id: null, unit_id: null, doc_no: "", doc_date: null, due_on: null, paid_on: null, cashflow: true, vat_rate_pct: 17, vat_cents: 0, document_id: null, created_by: null }),
  properties: () => ({ archived_at: null, is_copropriete: false, smoke_detectors_confirmed: false, photo_url: null }),
  units: () => ({ archived_at: null, furnished: false, kind: "dwelling", floor: null, area_sqm: 0, rooms: 0, bedrooms: null, photo_url: null }),
  contacts: () => ({
    archived_at: null,
    kind: "natural",
    first_name: null,
    last_name: null,
    legal_name: null,
    email: null,
    phone: null,
    language: "fr",
    iban: null,
    bank_holder_name: null,
    notes: null,
  }),
  contact_roles: () => ({ ended_on: null }),
  leases: () => ({
    status: "draft",
    lease_type: "residential",
    end_date: null,
    signed_at: null,
    charges_cents: 0,
    charges_regime: "advances",
    payment_day: 1,
    rf_reference: null,
    mentions: {},
    furnished: false,
    furniture_supplement_cents: 0,
    furniture_invoice_total_cents: 0,
    colocation: false,
    pacte_colocation_signed: false,
    capital_investi: {},
    rent_ceiling_check: {},
    last_adjustment_on: null,
    previous_rent_cents: null,
    indexation_clause: {},
    vat_regime: "exempt",
    vat_option: {},
    details: {},
  }),
  lease_parties: () => ({ joint_liability: true, moved_in_on: null, moved_out_on: null }),
  rent_periods: () => ({ charges_cents: 0, other_cents: 0, other_label: null, vat_cents: 0, written_off: false }),
  deposits: () => ({
    status: "held",
    key_handover_on: null,
    decompte_issued_on: null,
    mise_en_demeure_ar_on: null,
    released_first_tranche_cents: null,
    released_balance_cents: null,
  }),
  payment_allocations: () => ({ auto: false, reversed_at: null }),
  tickets: () => ({ description: null, closed_at: null, sla_due_at: null }),
  work_orders: () => ({ status: "offered", artisan_contact_id: null }),
  conversations: () => ({ last_message_at: null }),
  messages: () => ({ sender_contact_id: null, read_at: null, ticket_id: null }),
};

/** Columns the database computes. */
const GENERATED: Record<string, (row: Row) => void> = {
  contacts: (r) => {
    r.display_name =
      r.kind === "legal"
        ? String(r.legal_name ?? "")
        : [r.first_name, r.last_name].filter((x) => typeof x === "string" && x !== "").join(" ");
  },
  rent_periods: (r) => {
    r.total_cents = n(r.rent_cents) + n(r.charges_cents) + n(r.other_cents) + n(r.vat_cents);
  },
};

const UNIQUE: Record<string, string[][]> = {
  rent_periods: [["lease_id", "period"]],
  iban_bindings: [["org_id", "payer_iban", "lease_id"]],
};

const CHECKS: Record<string, (row: Row) => string | null> = {
  leases: (r) =>
    r.end_date !== null && r.end_date !== undefined && String(r.end_date) <= String(r.start_date)
      ? "leases_check: end_date must follow start_date"
      : null,
  rent_periods: (r) => (n(r.rent_cents) < 0 ? "rent_periods_rent_cents_check" : null),
};

/** Who a client speaks for: the manager (org-scoped by the code, unfiltered here), a tenant account, or nobody. */
export type Principal = { kind: "manager" } | { kind: "tenant"; userId: string; email: string } | { kind: "anon" };

const TENANT_ROLES = new Set(["tenant", "colocataire"]);
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Foreign keys that cascade when a lease row goes, and those set to null (0003, 0004, 0010). */
const LEASE_CASCADE = ["lease_parties", "deposits", "iban_bindings", "rent_periods", "edl_sessions", "notice_records", "defects", "payment_plans", "arrears_actions"];
const LEASE_SET_NULL = ["payments", "tickets", "workflows", "insurance_policies"];
const EDL_CASCADE = ["edl_items"];

const LIVE = new Set(["active", "notice"]);

/**
 * The trigger `leases_one_per_lot` (0014): at most one draft and one live
 * lease per lot, checked on insert and on any change of status or lot, and
 * refused as a unique violation carrying a stable message.
 */
function lotRule(rows: Row[], row: Row): DbError | null {
  const others = rows.filter((r) => r !== row && r.id !== row.id && r.unit_id === row.unit_id);
  if (row.status === "draft") {
    if (others.some((r) => r.status === "draft")) return { code: "23505", message: "gestion: one draft dossier per lot" };
    if (others.some((r) => LIVE.has(String(r.status)))) return { code: "23505", message: "gestion: lot already let" };
  } else if (LIVE.has(String(row.status))) {
    if (others.some((r) => LIVE.has(String(r.status)))) return { code: "23505", message: "gestion: lot already let" };
  }
  return null;
}

export class FakeDb {
  private tables = new Map<string, Row[]>();
  private leaseSeq = 0;

  constructor(public today: string) {}

  /** now(), as the database would write it. */
  nowIso(): string {
    return `${this.today}T12:00:00.000Z`;
  }

  // ── The portal predicates (0006, 0015), as functions of the rows ──

  /** gestion.portal_tenant_lease: the account is a tenant party of the lease. */
  tenantLease(leaseId: unknown, userId: string): boolean {
    return this.table("lease_parties").some(
      (lp) =>
        lp.lease_id === leaseId &&
        TENANT_ROLES.has(String(lp.role)) &&
        this.table("contacts").some((c) => c.id === lp.contact_id && c.user_id === userId),
    );
  }
  tenantLiveLease(leaseId: unknown, userId: string): boolean {
    return this.tenantLease(leaseId, userId) && this.table("leases").some((l) => l.id === leaseId && LIVE.has(String(l.status)));
  }
  tenantTicket(ticketId: unknown, userId: string): boolean {
    return this.table("tickets").some((t) => t.id === ticketId && t.lease_id != null && this.tenantLease(t.lease_id, userId));
  }
  /** The tenancy's conversation, or a request's own thread from before 0019. */
  private tenantConversation(conversationId: unknown, userId: string): boolean {
    return this.table("conversations").some((cv) => cv.id === conversationId && this.tenantScope(cv, userId));
  }
  private tenantScope(cv: Row, userId: string): boolean {
    return (
      (cv.scope_type === "lease" && cv.scope_id != null && this.tenantLease(cv.scope_id, userId)) ||
      (cv.scope_type === "ticket" && cv.scope_id != null && this.tenantTicket(cv.scope_id, userId))
    );
  }

  /** What a tenant account may read of a table: the `*_portal` select policies. */
  visibleToTenant(table: string, row: Row, userId: string): boolean {
    switch (table) {
      case "rent_periods":
      case "rent_period_status":
      case "lease_parties":
      case "deposits":
      case "edl_sessions":
        return this.tenantLease(row.lease_id, userId);
      case "insurance_policies":
        return row.lease_id != null && this.tenantLease(row.lease_id, userId);
      case "payment_allocations":
        return this.table("rent_periods").some((rp) => rp.id === row.rent_period_id && this.tenantLease(rp.lease_id, userId));
      case "documents":
        return (
          (row.related_type === "lease" && row.related_id != null && this.tenantLease(row.related_id, userId)) ||
          (row.related_type === "ticket" && row.related_id != null && this.tenantTicket(row.related_id, userId))
        );
      case "tickets":
        return row.lease_id != null && this.tenantLease(row.lease_id, userId);
      case "conversations":
        return this.tenantScope(row, userId);
      case "messages":
        return this.tenantConversation(row.conversation_id, userId);
      default:
        return false; // leases, units, properties, contacts, payments, bank tables, invites: nothing
    }
  }

  /** What a tenant account may insert: the `*_portal_insert` policies. */
  insertAllowedForTenant(table: string, row: Row, userId: string): boolean {
    switch (table) {
      case "tickets":
        return row.lease_id != null && row.source === "tenant" && this.tenantLiveLease(row.lease_id, userId);
      case "documents":
        return (
          row.related_type === "ticket" && row.related_id != null && row.class === "photo" && row.uploaded_by === userId &&
          this.table("tickets").some((t) => t.id === row.related_id && t.lease_id != null && this.tenantLiveLease(t.lease_id, userId))
        );
      case "conversations":
        return row.scope_type === "lease" && row.scope_id != null && this.tenantLease(row.scope_id, userId);
      case "messages":
        return (
          row.sender_kind === "tenant" && row.sender_user_id === userId &&
          (row.ticket_id == null || this.tenantTicket(row.ticket_id, userId)) &&
          this.tenantConversation(row.conversation_id, userId)
        );
      default:
        return false;
    }
  }

  // ── The portal RPCs (0006, 0015), with the same checks as their SQL ──

  callRpc(name: string, args: Row, principal: Principal): Result {
    const raise = (message: string): Result => ({ data: null, error: { code: "P0001", message } });
    const uid = principal.kind === "tenant" ? principal.userId : null;
    switch (name) {
      case "my_home": {
        if (!uid) return { data: [], error: null };
        const rows = this.table("leases")
          .filter((l) => this.tenantLease(l.id, uid))
          .map((l) => {
            const u = this.table("units").find((x) => x.id === l.unit_id) ?? {};
            const p = this.table("properties").find((x) => x.id === u.property_id) ?? {};
            return {
              lease_id: l.id, org_id: l.org_id, unit_id: u.id, property_id: p.id, lease_status: l.status, lease_type: l.lease_type,
              start_date: l.start_date, end_date: l.end_date, rent_cents: l.rent_cents, charges_cents: l.charges_cents,
              charges_regime: l.charges_regime, payment_day: l.payment_day, rf_reference: l.rf_reference, furnished: l.furnished,
              colocation: l.colocation, last_adjustment_on: l.last_adjustment_on, previous_rent_cents: l.previous_rent_cents,
              unit_label: u.label, unit_floor: u.floor, unit_area_sqm: u.area_sqm, unit_rooms: u.rooms, unit_bedrooms: u.bedrooms,
              property_name: p.name, property_address: p.address, property_commune: p.commune, energy_class: p.energy_class,
              cpe_issued_on: p.cpe_issued_on, syndic_name: p.syndic_name, smoke_detectors_confirmed: p.smoke_detectors_confirmed,
              photo_url: u.photo_url ?? p.photo_url,
            };
          })
          .sort((a, b) => (String(a.start_date) < String(b.start_date) ? 1 : -1));
        return { data: rows, error: null };
      }
      case "is_tenant": {
        if (!uid) return { data: false, error: null };
        return { data: this.table("leases").some((l) => this.tenantLease(l.id, uid)), error: null };
      }
      case "my_lease_parties": {
        if (!uid) return { data: [], error: null };
        const rows = this.table("lease_parties")
          .filter((lp) => this.tenantLease(lp.lease_id, uid))
          .map((lp) => {
            const c = this.table("contacts").find((x) => x.id === lp.contact_id) ?? {};
            return { lease_id: lp.lease_id, contact_id: c.id, display_name: c.display_name, role: lp.role, moved_in_on: lp.moved_in_on, moved_out_on: lp.moved_out_on, is_me: c.user_id === uid };
          });
        return { data: rows, error: null };
      }
      case "my_managers": {
        if (!uid) return { data: [], error: null };
        const orgIds = [...new Set(this.table("leases").filter((l) => this.tenantLease(l.id, uid)).map((l) => l.org_id))];
        const rows = orgIds.map((orgId) => {
          const a = this.table("agencies").find((x) => x.id === orgId) ?? { id: orgId, name: "" };
          const m = this.table("crm_members").find((x) => x.agency_id === orgId && x.role === "owner" && x.status === "active");
          return { org_id: orgId, name: a.name, email: (a.email as string | undefined) || m?.email || null, phone: (a.phone as string | undefined) || m?.phone || null };
        });
        return { data: rows, error: null };
      }
      case "portal_invite_lease": {
        if (principal.kind !== "manager") return raise("gestion: not allowed");
        const lease = this.table("leases").find((l) => l.id === args.p_lease);
        if (!lease) return raise("gestion: lease not found");
        if (!LIVE.has(String(lease.status))) return raise("gestion: lease not live");
        const party = this.table("lease_parties").some((lp) => lp.lease_id === args.p_lease && lp.contact_id === args.p_contact && TENANT_ROLES.has(String(lp.role)));
        if (!party) return raise("gestion: not a party");
        const contact = this.table("contacts").find((c) => c.id === args.p_contact);
        if (!contact) return raise("gestion: not a party");
        if (contact.user_id) return raise("gestion: already linked");
        const email = String(contact.email ?? "");
        if (!EMAIL.test(email)) return raise("gestion: no email");
        for (const inv of this.table("portal_invites")) {
          if (inv.contact_id === args.p_contact && (inv.lease_id === args.p_lease || inv.lease_id == null) && !inv.accepted_at && !inv.revoked_at) {
            inv.revoked_at = this.nowIso();
          }
        }
        const row = this.insertRow("portal_invites", {
          org_id: lease.org_id, contact_id: args.p_contact, lease_id: args.p_lease, role: "tenant", email: email.toLowerCase(),
          token: randomBytes(32).toString("hex"), expires_at: `${this.plusDays(14)}T12:00:00.000Z`, sent_at: this.nowIso(), delivery: "link",
          accepted_at: null, accepted_by: null, revoked_at: null,
        });
        return { data: [{ invite_id: row.id, token: row.token, email: row.email, expires_at: row.expires_at }], error: null };
      }
      case "portal_invite_delivered": {
        if (principal.kind !== "manager") return raise("gestion: not allowed");
        const inv = this.table("portal_invites").find((i) => i.id === args.p_invite);
        if (!inv) return raise("gestion: not allowed");
        inv.delivery = args.p_delivery;
        inv.sent_at = this.nowIso();
        return { data: true, error: null };
      }
      case "portal_revoke": {
        if (principal.kind !== "manager") return raise("gestion: not allowed");
        const inv = this.table("portal_invites").find((i) => i.id === args.p_invite);
        if (!inv) return raise("gestion: not allowed");
        if (inv.accepted_at || inv.revoked_at) return { data: false, error: null };
        inv.revoked_at = this.nowIso();
        return { data: true, error: null };
      }
      case "gestion_invite_preview": {
        const token = String(args.p_token ?? "");
        const inv = token.length >= 32 ? this.table("portal_invites").find((i) => i.token === token) : undefined;
        if (!inv) return { data: { state: "unknown" }, error: null };
        const state = inv.accepted_at ? "accepted" : inv.revoked_at ? "revoked" : String(inv.expires_at) < this.nowIso() ? "expired" : "pending";
        const c = this.table("contacts").find((x) => x.id === inv.contact_id) ?? {};
        const l = this.table("leases").find((x) => x.id === inv.lease_id) ?? {};
        const u = this.table("units").find((x) => x.id === l.unit_id) ?? {};
        const p = this.table("properties").find((x) => x.id === u.property_id) ?? {};
        const a = this.table("agencies").find((x) => x.id === inv.org_id) ?? {};
        const addr = (p.address as Row | undefined) ?? {};
        return {
          data: {
            state, mine: uid !== null && inv.accepted_by === uid,
            first_name: c.first_name ?? String(c.display_name ?? "").split(" ")[0], email: inv.email, org_name: a.name ?? null,
            property_name: p.name ?? null,
            address: { street: addr.street ?? null, number: addr.number ?? null, postal_code: addr.postal_code ?? null, city: addr.city ?? null },
            unit_label: u.label ?? null, lease_status: l.status ?? null, expires_at: inv.expires_at,
          },
          error: null,
        };
      }
      case "portal_accept": {
        if (!uid || principal.kind !== "tenant") return raise("gestion: sign in first");
        const inv = this.table("portal_invites").find((i) => i.token === args.p_token);
        if (!inv) return raise("gestion: invitation unknown");
        if (inv.accepted_at) {
          if (inv.accepted_by === uid) return { data: { org_id: inv.org_id, role: inv.role, lease_id: inv.lease_id, already: true }, error: null };
          return raise("gestion: invitation used");
        }
        if (inv.revoked_at) return raise("gestion: invitation revoked");
        if (String(inv.expires_at) < this.nowIso()) return raise("gestion: invitation expired");
        if (EMAIL.test(String(inv.email)) && String(inv.email).toLowerCase() !== principal.email.toLowerCase()) return raise("gestion: wrong account");
        const contact = this.table("contacts").find((c) => c.id === inv.contact_id);
        if (contact?.user_id && contact.user_id !== uid) return raise("gestion: contact linked elsewhere");
        if (this.table("contacts").some((c) => c.org_id === inv.org_id && c.user_id === uid && c.id !== inv.contact_id)) {
          return raise("gestion: account linked to another contact");
        }
        if (contact && !contact.user_id) contact.user_id = uid;
        inv.accepted_at = this.nowIso();
        inv.accepted_by = uid;
        return { data: { org_id: inv.org_id, role: inv.role, lease_id: inv.lease_id, already: false }, error: null };
      }
      default:
        return { data: null, error: { code: "PGRST202", message: `unknown rpc ${name}` } };
    }
  }

  /** today + n days, ISO date. */
  plusDays(days: number): string {
    const d = new Date(`${this.today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  replace(name: string, rows: Row[]): void {
    this.tables.set(name, rows);
  }

  table(name: string): Row[] {
    let rows = this.tables.get(name);
    if (!rows) {
      rows = [];
      this.tables.set(name, rows);
    }
    return rows;
  }

  /** Seeds a row the way the database would store it, returning it. */
  insertRow(table: string, row: Row): Row {
    const stored = this.prepare(table, row);
    const conflict = this.conflictOf(table, stored);
    if (conflict) throw Object.assign(new Error(conflict.message), { code: conflict.code });
    this.table(table).push(stored);
    return stored;
  }

  prepare(table: string, row: Row): Row {
    const stored: Row = { ...(DEFAULTS[table]?.() ?? {}), ...row };
    if (stored.id === undefined) stored.id = randomUUID();
    if (stored.created_at === undefined) stored.created_at = `${this.today}T12:00:00.000Z`;
    // `sent_at default now()`: a message written without a clock takes the real one, so threads keep their order.
    if (table === "messages" && stored.sent_at === undefined) stored.sent_at = new Date().toISOString();
    if (table === "leases" && stored.seq === undefined) stored.seq = ++this.leaseSeq;
    GENERATED[table]?.(stored);
    const check = CHECKS[table]?.(stored);
    if (check) throw Object.assign(new Error(check), { code: "23514" });
    return stored;
  }

  /** The unique indexes, checked on every insert and update. */
  uniqueConflictOf(table: string, row: Row): DbError | null {
    for (const key of UNIQUE[table] ?? []) {
      const clash = this.table(table).some((r) => r !== row && key.every((k) => r[k] === row[k]));
      if (clash) return { code: "23505", message: `duplicate key value violates unique constraint on ${key.join(",")}` };
    }
    // conversations_lease_one (0019): one conversation per lease.
    if (table === "conversations" && row.scope_type === "lease" && row.scope_id != null) {
      const clash = this.table(table).some((r) => r !== row && r.scope_type === "lease" && r.scope_id === row.scope_id);
      if (clash) return { code: "23505", message: 'duplicate key value violates unique constraint "conversations_lease_one"' };
    }
    // contacts_email_active_key (0002): one live contact per e-mail and workspace.
    if (table === "contacts" && row.email != null && row.archived_at == null) {
      const clash = this.table(table).some((r) => r !== row && r.org_id === row.org_id && r.email === row.email && r.archived_at == null);
      if (clash) return { code: "23505", message: 'duplicate key value violates unique constraint "contacts_email_active_key"' };
    }
    return null;
  }

  /** What an insert runs into: the unique indexes, then the lot's rules. */
  conflictOf(table: string, row: Row): DbError | null {
    const unique = this.uniqueConflictOf(table, row);
    if (unique) return unique;
    if (table === "leases") return lotRule(this.table(table), row);
    return null;
  }

  /** The rent_period_status view, derived exactly as the SQL does. */
  periodStatus(): Row[] {
    const allocations = this.table("payment_allocations");
    return this.table("rent_periods").map((rp) => {
      const allocated = allocations
        .filter((a) => a.rent_period_id === rp.id && a.reversed_at == null)
        .reduce((sum, a) => sum + n(a.amount_cents), 0);
      const total = n(rp.total_cents);
      const due = String(rp.due_date);
      const period = String(rp.period);
      let status: string;
      if (rp.written_off) status = "written_off";
      else if (allocated >= total) status = "paid";
      else if (allocated > 0) status = due < this.today ? "partial_late" : "partial";
      else if (due < this.today) status = "late";
      else if (period > this.today) status = "upcoming";
      else status = "pending";
      return {
        id: rp.id,
        org_id: rp.org_id,
        lease_id: rp.lease_id,
        period: rp.period,
        due_date: rp.due_date,
        total_cents: total,
        allocated_cents: allocated,
        status,
      };
    });
  }

  /** The conversation_heads view (0020): the last message and the unread count of every conversation. */
  conversationHeads(): Row[] {
    const messages = this.table("messages");
    return this.table("conversations").map((c) => {
      const own = messages.filter((m) => m.conversation_id === c.id).slice().sort((a, b) => (String(a.sent_at) < String(b.sent_at) ? 1 : -1));
      const last = own[0] ?? null;
      return {
        conversation_id: c.id,
        org_id: c.org_id,
        unread: own.filter((m) => m.read_at == null && m.sender_kind !== "manager").length,
        last_message_id: last?.id ?? null,
        last_sender_kind: last?.sender_kind ?? null,
        last_sender_contact_id: last?.sender_contact_id ?? null,
        last_sender_user_id: last?.sender_user_id ?? null,
        last_body: last?.body ?? null,
        last_sent_at: last?.sent_at ?? null,
        last_read_at: last?.read_at ?? null,
        last_ticket_id: last?.ticket_id ?? null,
      };
    });
  }

  /** The edl_session_counts view (0020): items and photos per inventory session. */
  edlSessionCounts(): Row[] {
    const items = this.table("edl_items");
    const media = this.table("edl_media");
    return this.table("edl_sessions").map((sess) => {
      const own = items.filter((i) => i.session_id === sess.id).map((i) => i.id);
      return { session_id: sess.id, org_id: sess.org_id, items: own.length, photos: media.filter((m) => own.includes(m.item_id)).length };
    });
  }

  rowsOf(table: string): Row[] {
    if (table === "rent_period_status") return this.periodStatus();
    if (table === "conversation_heads") return this.conversationHeads();
    if (table === "edl_session_counts") return this.edlSessionCounts();
    return this.table(table);
  }

  removeLease(id: unknown): void {
    const sessions = new Set(this.table("edl_sessions").filter((r) => r.lease_id === id).map((r) => r.id));
    for (const t of EDL_CASCADE) this.replace(t, this.table(t).filter((r) => !sessions.has(r.session_id)));
    for (const t of LEASE_CASCADE) this.replace(t, this.table(t).filter((r) => r.lease_id !== id));
    for (const t of LEASE_SET_NULL) for (const r of this.table(t)) if (r.lease_id === id) r.lease_id = null;
  }

  from(table: string): FakeQuery {
    return new FakeQuery(this, table, { kind: "manager" });
  }

  schema(): FakeDb {
    return this;
  }

  rpc(name: string, args: Row = {}): Promise<Result> {
    return Promise.resolve(this.callRpc(name, args, { kind: "manager" }));
  }

  /** The database as the write layer sees it: the manager's client. */
  client(): OrgContext["g"] & GestionReader {
    return this as unknown as OrgContext["g"] & GestionReader;
  }

  /** The database as a tenant account sees it: the portal policies decide every row. */
  tenantClient(user: { id: string; email: string }): OrgContext["g"] & GestionReader {
    return new FakeClient(this, { kind: "tenant", userId: user.id, email: user.email }) as unknown as OrgContext["g"] & GestionReader;
  }

  /** The database as nobody: only the public preview answers. */
  anonClient(): Pick<OrgContext["g"], "rpc"> {
    return new FakeClient(this, { kind: "anon" }) as unknown as Pick<OrgContext["g"], "rpc">;
  }
}

/** A client bound to a principal other than the manager. */
class FakeClient {
  constructor(
    private db: FakeDb,
    private principal: Principal,
  ) {}
  from(table: string): FakeQuery {
    return new FakeQuery(this.db, table, this.principal);
  }
  schema(): FakeClient {
    return this;
  }
  rpc(name: string, args: Row = {}): Promise<Result> {
    return Promise.resolve(this.db.callRpc(name, args, this.principal));
  }
}

type Filter = (row: Row) => boolean;

class FakeQuery implements PromiseLike<Result> {
  private op: "select" | "insert" | "upsert" | "update" | "delete" = "select";
  private filters: Filter[] = [];
  private payload: Row[] = [];
  private patch: Row = {};
  private ignoreDuplicates = false;
  private wantRows = false;
  private shape: "single" | "maybe" | null = null;
  private orderKey: string | null = null;
  private orderAsc = true;
  private limitN: number | null = null;

  constructor(
    private db: FakeDb,
    private table: string,
    private principal: Principal,
  ) {}

  private wantCount = false;
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;

  // The columns are accepted for the caller's sake and ignored: rows come back whole.
  select(columns?: string, opts?: { count?: "exact" | "planned" | "estimated"; head?: boolean }): this {
    void columns;
    this.wantRows = true;
    if (opts?.count) this.wantCount = true;
    return this;
  }
  insert(rows: Row | Row[]): this {
    this.op = "insert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  upsert(rows: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }): this {
    this.op = "upsert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    this.ignoreDuplicates = opts?.ignoreDuplicates === true;
    return this;
  }
  update(patch: Row): this {
    this.op = "update";
    this.patch = patch;
    return this;
  }
  delete(): this {
    this.op = "delete";
    return this;
  }
  eq(key: string, value: unknown): this {
    this.filters.push((r) => r[key] === value);
    return this;
  }
  is(key: string, value: unknown): this {
    this.filters.push((r) => (value === null ? r[key] === null || r[key] === undefined : r[key] === value));
    return this;
  }
  in(key: string, values: unknown[]): this {
    this.filters.push((r) => values.includes(r[key]));
    return this;
  }
  /** PostgREST `ilike`: `%` and `_` are wildcards unless escaped with a backslash; case is ignored. */
  ilike(key: string, pattern: string): this {
    let source = "^";
    for (let i = 0; i < pattern.length; i++) {
      const c = pattern[i];
      if (c === "\\" && i + 1 < pattern.length) source += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      else if (c === "%") source += ".*";
      else if (c === "_") source += ".";
      else source += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
    const re = new RegExp(`${source}$`, "i");
    this.filters.push((r) => typeof r[key] === "string" && re.test(r[key] as string));
    return this;
  }
  gte(key: string, value: unknown): this {
    this.filters.push((r) => String(r[key]) >= String(value));
    return this;
  }
  lte(key: string, value: unknown): this {
    this.filters.push((r) => String(r[key]) <= String(value));
    return this;
  }
  neq(key: string, value: unknown): this {
    this.filters.push((r) => r[key] !== value);
    return this;
  }
  /** PostgREST `or=(a.op.v,b.in.(x,y))`: the comma-separated conditions, any one of which passes the row. */
  or(expression: string): this {
    const parts: string[] = [];
    let depth = 0;
    let current = "";
    for (const ch of expression) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) {
        parts.push(current);
        current = "";
      } else current += ch;
    }
    if (current) parts.push(current);
    const tests = parts.map((part) => {
      const m = /^([a-z_]+)\.(eq|neq|gte|gt|lte|lt|is|in)\.(.*)$/.exec(part.trim());
      if (!m) throw new Error(`fake or(): unsupported condition ${part}`);
      const [, key, op, raw] = m;
      if (op === "in") {
        const values = raw.replace(/^\(/, "").replace(/\)$/, "").split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
        return (r: Row) => values.includes(String(r[key]));
      }
      if (op === "is") return (r: Row) => (raw === "null" ? r[key] === null || r[key] === undefined : String(r[key]) === raw);
      return (r: Row) => {
        const a = String(r[key]);
        return op === "eq" ? a === raw : op === "neq" ? a !== raw : op === "gte" ? a >= raw : op === "gt" ? a > raw : op === "lte" ? a <= raw : a < raw;
      };
    });
    this.filters.push((r) => tests.some((t) => t(r)));
    return this;
  }
  /** PostgREST's window: zero-based, inclusive on both ends. */
  range(from: number, to: number): this {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }
  order(key: string, opts?: { ascending?: boolean }): this {
    this.orderKey = key;
    this.orderAsc = opts?.ascending !== false;
    return this;
  }
  limit(count: number): this {
    this.limitN = count;
    return this;
  }
  single(): this {
    this.shape = "single";
    return this;
  }
  maybeSingle(): this {
    this.shape = "maybe";
    return this;
  }

  then<A = Result, B = never>(
    onFulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve()
      .then(() => this.run())
      .then(onFulfilled, onRejected);
  }

  /** Row-level security first, the query's own filters second. */
  private matching(): Row[] {
    const rows = this.db.rowsOf(this.table);
    const visible =
      this.principal.kind === "manager"
        ? rows
        : this.principal.kind === "tenant"
          ? rows.filter((r) => this.db.visibleToTenant(this.table, r, (this.principal as { userId: string }).userId))
          : [];
    return visible.filter((r) => this.filters.every((f) => f(r)));
  }

  private shaped(rows: Row[]): Result {
    if (this.shape === "single") {
      if (rows.length !== 1) return { data: null, error: { code: "PGRST116", message: `expected one row, got ${rows.length}` } };
      return { data: rows[0], error: null };
    }
    if (this.shape === "maybe") {
      if (rows.length > 1) return { data: null, error: { code: "PGRST116", message: `expected at most one row, got ${rows.length}` } };
      return { data: rows[0] ?? null, error: null };
    }
    return { data: rows, error: null };
  }

  private run(): Result {
    try {
      switch (this.op) {
        case "select": {
          let rows = this.matching();
          const total = rows.length;
          if (this.orderKey) {
            const k = this.orderKey;
            rows = rows.slice().sort((a, b) => (String(a[k]) < String(b[k]) ? -1 : String(a[k]) > String(b[k]) ? 1 : 0));
            if (!this.orderAsc) rows.reverse();
          }
          if (this.rangeFrom !== null && this.rangeTo !== null) rows = rows.slice(this.rangeFrom, this.rangeTo + 1);
          if (this.limitN !== null) rows = rows.slice(0, this.limitN);
          const shaped = this.shaped(rows.map((r) => ({ ...r })));
          return this.wantCount ? { ...shaped, count: total } : shaped;
        }
        case "insert":
        case "upsert": {
          const written: Row[] = [];
          for (const raw of this.payload) {
            if (this.principal.kind === "anon") return { data: null, error: { code: "42501", message: "permission denied" } };
            if (this.principal.kind === "tenant" && !this.db.insertAllowedForTenant(this.table, raw, this.principal.userId)) {
              return { data: null, error: { code: "42501", message: `new row violates row-level security policy for table "${this.table}"` } };
            }
            const row = this.db.prepare(this.table, raw);
            const conflict = this.db.conflictOf(this.table, row);
            if (conflict) {
              if (this.op === "upsert" && this.ignoreDuplicates) continue;
              return { data: null, error: conflict };
            }
            this.db.table(this.table).push(row);
            written.push(row);
          }
          return this.wantRows ? this.shaped(written.map((r) => ({ ...r }))) : { data: null, error: null };
        }
        case "update": {
          const rows = this.matching();
          // Like `update of status, unit_id`: the lot rule only runs when one of them is set.
          const touchesLot = this.table === "leases" && ("status" in this.patch || "unit_id" in this.patch);
          for (const r of rows) {
            const before = { ...r };
            Object.assign(r, this.patch);
            GENERATED[this.table]?.(r);
            const check = CHECKS[this.table]?.(r);
            if (check) return { data: null, error: { code: "23514", message: check } };
            const rule = touchesLot ? lotRule(this.db.table(this.table), r) : this.db.uniqueConflictOf(this.table, r);
            if (rule) {
              Object.assign(r, before);
              return { data: null, error: rule };
            }
          }
          return this.wantRows ? this.shaped(rows.map((r) => ({ ...r }))) : { data: null, error: null };
        }
        case "delete": {
          const gone = this.matching();
          const ids = new Set(gone.map((r) => r.id));
          this.db.replace(
            this.table,
            this.db.table(this.table).filter((r) => !ids.has(r.id)),
          );
          if (this.table === "leases") for (const r of gone) this.db.removeLease(r.id);
          return this.wantRows ? this.shaped(gone.map((r) => ({ ...r }))) : { data: null, error: null };
        }
      }
    } catch (e) {
      const err = e as Error & { code?: string };
      return { data: null, error: { code: err.code ?? "XX000", message: err.message } };
    }
  }
}
