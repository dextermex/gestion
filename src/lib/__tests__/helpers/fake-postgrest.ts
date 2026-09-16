import { randomUUID } from "node:crypto";
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
 * It is not a SQL engine. It supports exactly the builder calls the code
 * makes: select / insert / upsert / update / delete, eq / is / in / gte,
 * order / limit, single / maybeSingle, and an awaited `{ data, error }`.
 */

export type Row = Record<string, unknown>;
type DbError = { code: string; message: string };
type Result = { data: unknown; error: DbError | null };

const n = (v: unknown): number => (typeof v === "number" ? v : 0);

const DEFAULTS: Record<string, () => Row> = {
  properties: () => ({ archived_at: null, is_copropriete: false, smoke_detectors_confirmed: false, photo_url: null }),
  units: () => ({ archived_at: null, furnished: false, kind: "dwelling", floor: null, area_sqm: 0, rooms: 0, bedrooms: null }),
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

/** Foreign keys that cascade when a lease row goes, and those set to null. */
const LEASE_CASCADE = ["lease_parties", "deposits", "iban_bindings", "rent_periods", "edl_sessions", "insurance_policies"];
const LEASE_SET_NULL = ["payments", "tickets", "workflows"];

export class FakeDb {
  private tables = new Map<string, Row[]>();
  private leaseSeq = 0;

  constructor(public today: string) {}

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
    if (conflict) throw new Error(conflict.message);
    this.table(table).push(stored);
    return stored;
  }

  prepare(table: string, row: Row): Row {
    const stored: Row = { ...(DEFAULTS[table]?.() ?? {}), ...row };
    if (stored.id === undefined) stored.id = randomUUID();
    if (stored.created_at === undefined) stored.created_at = `${this.today}T12:00:00.000Z`;
    if (table === "leases" && stored.seq === undefined) stored.seq = ++this.leaseSeq;
    GENERATED[table]?.(stored);
    const check = CHECKS[table]?.(stored);
    if (check) throw Object.assign(new Error(check), { code: "23514" });
    return stored;
  }

  conflictOf(table: string, row: Row): DbError | null {
    for (const key of UNIQUE[table] ?? []) {
      const clash = this.table(table).some((r) => r !== row && key.every((k) => r[k] === row[k]));
      if (clash) return { code: "23505", message: `duplicate key value violates unique constraint on ${key.join(",")}` };
    }
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

  rowsOf(table: string): Row[] {
    return table === "rent_period_status" ? this.periodStatus() : this.table(table);
  }

  removeLease(id: unknown): void {
    for (const t of LEASE_CASCADE) this.replace(t, this.table(t).filter((r) => r.lease_id !== id));
    for (const t of LEASE_SET_NULL) for (const r of this.table(t)) if (r.lease_id === id) r.lease_id = null;
  }

  from(table: string): FakeQuery {
    return new FakeQuery(this, table);
  }

  schema(): FakeDb {
    return this;
  }

  /** The database as the write layer sees it. */
  client(): OrgContext["g"] & GestionReader {
    return this as unknown as OrgContext["g"] & GestionReader;
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
  ) {}

  select(): this {
    this.wantRows = true;
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
  gte(key: string, value: unknown): this {
    this.filters.push((r) => String(r[key]) >= String(value));
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

  private matching(): Row[] {
    return this.db.rowsOf(this.table).filter((r) => this.filters.every((f) => f(r)));
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
          if (this.orderKey) {
            const k = this.orderKey;
            rows = rows.slice().sort((a, b) => (String(a[k]) < String(b[k]) ? -1 : String(a[k]) > String(b[k]) ? 1 : 0));
            if (!this.orderAsc) rows.reverse();
          }
          if (this.limitN !== null) rows = rows.slice(0, this.limitN);
          return this.shaped(rows.map((r) => ({ ...r })));
        }
        case "insert":
        case "upsert": {
          const written: Row[] = [];
          for (const raw of this.payload) {
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
          for (const r of rows) {
            Object.assign(r, this.patch);
            GENERATED[this.table]?.(r);
            const check = CHECKS[this.table]?.(r);
            if (check) return { data: null, error: { code: "23514", message: check } };
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
