import "server-only";
import { authedClient } from "@/lib/supabase/server";
import { signMedia } from "@/lib/gestion/media";
import { formatAddress, type PropertyAddress } from "@/lib/gestion/address";
import type { OpenInvoice } from "@/domain/banking/matching";
import type { DemoData } from "./index";
import type {
  DemoContact,
  DemoDeposit,
  DemoDocument,
  DemoEdl,
  DemoInsurance,
  DemoInvite,
  DemoLease,
  DemoMeter,
  DemoProperty,
  DemoRentPeriod,
  DemoTicket,
  DemoUnit,
  DemoWorkflow,
  DemoConversation,
  DemoBankTx,
  DemoBill,
} from "./data";
import { buildEmptyData, type Org } from "./data-empty";
import { pageBounds, pageInfo, windowStart, DEFAULT_MONTHS_BACK, DEFAULT_PAGE_SIZE, type PageRequest, type ReadScope } from "./scope";

/**
 * The real-account dataset: the same seam the demo flows through, hydrated
 * from `gestion.*` under the caller's own JWT. RLS decides what is visible;
 * this module only reshapes rows into the forms every page and engine
 * already consumes. Nothing here invents a figure: a column that does not
 * exist yet maps to the shape's honest empty value, and the page shows its
 * empty state — never a borrowed demo record.
 */

type Row = Record<string, unknown>;

const BILL_COLS = "id,direction,supplier_contact_id,property_id,unit_id,category,subject,doc_no,doc_date,due_on,paid_on,cashflow,vat_rate_pct,amount_cents,vat_cents,document_id,created_at";

/** The part of a PostgREST query these reads use, named once so the fake and the client agree. */
interface Narrow {
  eq(column: string, value: unknown): Narrow;
  is(column: string, value: unknown): Narrow;
  in(column: string, values: unknown[]): Narrow;
  gte(column: string, value: unknown): Narrow;
  or(filters: string): Narrow;
  order(column: string, opts?: { ascending?: boolean }): Narrow;
  range(from: number, to: number): Narrow;
  limit(count: number): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
  then<T>(onfulfilled: (value: { data: unknown; error: { code?: string; message?: string } | null; count?: number | null }) => T): PromiseLike<T>;
}

const s = (v: unknown): string => (typeof v === "string" ? v : "");
const sOr = <T>(v: unknown, fallback: T): string | T => (typeof v === "string" && v !== "" ? v : fallback);
const n = (v: unknown): number => (typeof v === "number" ? v : 0);
const b = (v: unknown): boolean => v === true;
const day = (v: unknown): string => s(v).slice(0, 10);

/** The gestion schema as PostgREST exposes it, bound to one caller. */
export type GestionReader = ReturnType<ReturnType<typeof authedClient>["schema"]>;

/** The guided rental's memory on a draft lease, if the row carries one. */
function dossierOf(details: Row): DemoLease["dossier"] | undefined {
  const raw = details.dossier as Row | undefined;
  if (!raw || typeof raw !== "object") return undefined;
  return {
    completed: Array.isArray(raw.completed) ? raw.completed.map(String) : [],
    step: s(raw.step),
    payerName: sOr(raw.payerName, null),
  };
}

/** A departure being recorded, if the running lease carries one. */
function departureOf(details: Row): DemoLease["departure"] | undefined {
  const raw = details.departure as Row | undefined;
  if (!raw || typeof raw !== "object") return undefined;
  const step = Number(raw.step);
  return {
    step: Number.isFinite(step) && step >= 1 ? Math.min(Math.round(step), 7) : 1,
    endDate: sOr(raw.endDate, null),
    keysReturned: raw.keysReturned === true,
    keysReturnedOn: sOr(raw.keysReturnedOn, null),
    depositOutcome: s(raw.depositOutcome) || "release_pending",
    releasedAmount: s(raw.releasedAmount),
    decompteIssuedOn: sOr(raw.decompteIssuedOn, null),
    metersDone: raw.metersDone === true,
  };
}

export async function buildRealData(org: Org, accessToken: string, scope: ReadScope = {}): Promise<DemoData> {
  const client = authedClient(accessToken);
  return buildRealDataFrom(client.schema("gestion"), org, (paths) => signMedia(client, paths), scope);
}

/**
 * The hydration itself, over any reader of the gestion schema. Production
 * hands it the caller's PostgREST client; the lifecycle tests hand it an
 * in-memory database, so what the pages compute from real rows is exactly
 * what the tests assert against.
 */
export async function buildRealDataFrom(
  g: GestionReader,
  org: Org,
  sign: (paths: string[]) => Promise<Map<string, string>>,
  scope: ReadScope = {},
): Promise<DemoData> {
  const oid = org.id;
  const today = new Date().toISOString().slice(0, 10);
  // The history window: the ledger, the bank, the requests and the readings
  // are read from here on. Arrears older than that still owe and come
  // along by id; a sheet that looks at one tenancy reads its whole past.
  const from = windowStart(today, scope.monthsBack ?? DEFAULT_MONTHS_BACK);
  const fromStamp = `${from}T00:00:00Z`;
  const leaseScoped = scope.leaseId ?? null;
  const propertyScoped = scope.propertyId ?? null;
  const scoped = Boolean(leaseScoped || propertyScoped);
  // The shell reads no history at all: the layout asks for it on every
  // screen, the screen itself reads what it shows.
  const shell = Boolean(scope.shell);
  const none = (): Promise<Row[]> => Promise.resolve([]);
  const docPage = scope.documents ?? { page: 1, size: DEFAULT_PAGE_SIZE };

  // One filtered read per table. A failed read degrades to an empty
  // collection (logged), never to sample data. Tables carrying
  // `archived_at`: an archived row is gone from every screen, not only from
  // the one that happens to filter it. The cap is a safety net, no longer
  // the way a workspace is read.
  const ARCHIVABLE = new Set(["properties", "units", "contacts"]);
  const CAP = 2000;
  const q = async (table: string, select: string, apply?: (b: Narrow) => Narrow, cap = CAP): Promise<Row[]> => {
    let base = g.from(table).select(select).eq("org_id", oid) as unknown as Narrow;
    if (ARCHIVABLE.has(table)) base = base.is("archived_at", null);
    const query = apply ? apply(base) : base;
    const { data, error } = await query.limit(cap);
    if (error) {
      console.error(`gestion read failed (${table}):`, error.code, error.message);
      return [];
    }
    return (data as unknown as Row[]) ?? [];
  };
  /** One page of a register, newest first, with the count its footer shows. */
  const page = async (table: string, select: string, order: string, req: PageRequest): Promise<{ rows: Row[]; total: number }> => {
    const { from: lo, to: hi } = pageBounds(req);
    const base = g.from(table).select(select, { count: "exact" }).eq("org_id", oid) as unknown as Narrow;
    const { data, error, count } = await base.order(order, { ascending: false }).range(lo, hi);
    if (error) {
      console.error(`gestion page read failed (${table}):`, error.code, error.message);
      return { rows: [], total: 0 };
    }
    return { rows: (data as unknown as Row[]) ?? [], total: count ?? 0 };
  };
  /** A filter over many ids, in chunks an address can carry. */
  const inChunks = async (ids: string[], read: (chunk: string[]) => Promise<Row[]>): Promise<Row[]> => {
    const unique = [...new Set(ids.filter(Boolean))];
    const out: Row[] = [];
    for (let i = 0; i < unique.length; i += 100) out.push(...(await read(unique.slice(i, i + 100))));
    return out;
  };

  // ── A. The portfolio: read whole, it is what a cabinet manages. On a sheet, the one property. ──
  const [propertyRows, unitRows, contactRows, roleRows, accountRows, bindingRows, workflowRows, meterRows, conversationRows, headRows, documentPage] = await Promise.all([
    q("properties", "id,name,type,address,commune,cadastral_commune,cadastral_section,cadastral_number,construction_year,completion_date,energy_class,cpe_issued_on,is_copropriete,syndic_name,syndic_mandate_start,smoke_detectors_confirmed,photo_url", (b) => (propertyScoped ? b.eq("id", propertyScoped) : b).order("created_at")),
    q("units", "id,property_id,label,kind,floor,area_sqm,rooms,bedrooms,furnished,photo_url", (b) => (propertyScoped ? b.eq("property_id", propertyScoped) : b).order("created_at")),
    q("contacts", "id,kind,first_name,last_name,legal_name,display_name,email,phone,language,iban,bank_holder_name,notes,user_id"),
    q("contact_roles", "contact_id,role,ended_on"),
    q("bank_accounts", "id,label,iban,bic,holder_name_verbatim,kind,provider,consent_expires_at,balance_cents"),
    shell ? none() : q("iban_bindings", "payer_iban,lease_id"),
    shell ? none() : q("workflows", "id,kind,unit_id,lease_id,current_state,blocked_reason,started_at,completed_at"),
    shell ? none() : q("meters", "id,property_id,unit_id,kind,serial_number,supplier", (b) => (propertyScoped ? b.eq("property_id", propertyScoped) : b).order("created_at")),
    // One thread per tenancy: the threads are read whole, their messages one thread at a time (below).
    q("conversations", "id,scope_type,scope_id,subject,last_message_at,created_at"),
    q("conversation_heads", "conversation_id,unread,last_message_id,last_sender_kind,last_sender_contact_id,last_sender_user_id,last_body,last_sent_at,last_read_at,last_ticket_id"),
    scoped || shell ? Promise.resolve({ rows: [] as Row[], total: 0 }) : page("documents", "id,name,class,retention_class,retention_until,sealed,related_type,related_id,size_bytes,storage_path,created_at", "created_at", docPage),
  ]);
  const unitIds = unitRows.map((u) => s(u.id));

  // ── B. The tenancies in scope, and what hangs off them. ──
  const leaseRows = leaseScoped
    ? await q("leases", "id,unit_id,seq,lease_type,status,start_date,end_date,rent_cents,charges_cents,charges_regime,payment_day,rf_reference,furnished,furniture_supplement_cents,furniture_invoice_total_cents,colocation,capital_investi,last_adjustment_on,previous_rent_cents,indexation_clause,vat_regime,vat_option,details", (b) => b.eq("id", leaseScoped))
    : propertyScoped
      ? await inChunks(unitIds, (ids) => q("leases", "id,unit_id,seq,lease_type,status,start_date,end_date,rent_cents,charges_cents,charges_regime,payment_day,rf_reference,furnished,furniture_supplement_cents,furniture_invoice_total_cents,colocation,capital_investi,last_adjustment_on,previous_rent_cents,indexation_clause,vat_regime,vat_option,details", (b) => b.in("unit_id", ids)))
      : await q("leases", "id,unit_id,seq,lease_type,status,start_date,end_date,rent_cents,charges_cents,charges_regime,payment_day,rf_reference,furnished,furniture_supplement_cents,furniture_invoice_total_cents,colocation,capital_investi,last_adjustment_on,previous_rent_cents,indexation_clause,vat_regime,vat_option,details");
  const leaseIds = leaseRows.map((l) => s(l.id));
  // On a tenancy's sheet, its lot and that lot's property; on a property's, the property and its lots.
  const sheetUnitIds = leaseScoped ? leaseRows.map((l) => s(l.unit_id)) : unitIds;
  const sheetPropertyIds = leaseScoped ? unitRows.filter((u) => sheetUnitIds.includes(s(u.id))).map((u) => s(u.property_id)) : propertyRows.map((p) => s(p.id));
  /** A table keyed by tenancy: those in scope on a sheet, the workspace's (as `whole` narrows it) otherwise; nothing for the shell. */
  const byLease = (table: string, select: string, whole: (b: Narrow) => Narrow, order?: string): Promise<Row[]> =>
    shell
      ? none()
      : scoped
        ? inChunks(leaseIds, (ids) => q(table, select, (b) => (order ? b.in("lease_id", ids).order(order) : b.in("lease_id", ids))))
        : q(table, select, (b) => (order ? whole(b).order(order) : whole(b)));
  const INSURANCE_COLS = "id,property_id,lease_id,kind,provider,policy_number,premium_cents,starts_on,expires_on,notes";
  /** The policies in scope: the property's own and its tenancies', or the workspace's. */
  const readInsurance = async (): Promise<Row[]> => {
    if (shell) return [];
    if (!scoped) return q("insurance_policies", INSURANCE_COLS, (b) => b.order("created_at"));
    const ofProperty = propertyScoped ? await q("insurance_policies", INSURANCE_COLS, (b) => b.eq("property_id", propertyScoped)) : [];
    const ofLeases = await inChunks(leaseIds, (ids) => q("insurance_policies", INSURANCE_COLS, (b) => b.in("lease_id", ids)));
    const seen = new Set<string>();
    return [...ofProperty, ...ofLeases].filter((r) => !seen.has(s(r.id)) && Boolean(seen.add(s(r.id))));
  };
  const [partyRows, periodRows, statusRows, depositRows, edlRows, ticketRows, insuranceRows, inviteRows, arrearsRows, chargePeriodRows, readingRows, txRows, billRows, leaseLetterRows] = await Promise.all([
    // The shell keeps the parties: the pickers and the palette name a tenancy by its tenants.
    shell ? q("lease_parties", "lease_id,contact_id,role,moved_out_on") : byLease("lease_parties", "lease_id,contact_id,role,moved_out_on", (b) => b),
    byLease("rent_periods", "id,lease_id,period,due_date,rent_cents,charges_cents,vat_cents,total_cents", (b) => b.gte("period", from), "period"),
    // Paid-ness from the view; an arrear older than the window is still an
    // arrear. The shell asks one thing of the ledger: whether a rent was
    // ever received (one period with money on it, read by id below).
    shell
      ? q("rent_period_status", "id,allocated_cents,status", (b) => b.in("status", ["paid", "partial", "partial_late"]), 1)
      : byLease("rent_period_status", "id,allocated_cents,status", (b) => b.or(`period.gte.${from},status.in.(late,partial_late)`)),
    byLease("deposits", "id,lease_id,form,amount_cents,status,key_handover_on,decompte_issued_on,mise_en_demeure_ar_on,released_first_tranche_cents,released_balance_cents", (b) => b),
    byLease("edl_sessions", "id,lease_id,kind,status,scheduled_at,completed_at,key_handover_at,hash_manifest_sha256", (b) => b),
    shell
      ? none()
      : leaseScoped
      ? q("tickets", "id,unit_id,property_id,lease_id,source,category,severity,status,title,description,created_at,updated_at,closed_at,sla_due_at", (b) => b.eq("lease_id", leaseScoped))
      : propertyScoped
        ? q("tickets", "id,unit_id,property_id,lease_id,source,category,severity,status,title,description,created_at,updated_at,closed_at,sla_due_at", (b) => b.eq("property_id", propertyScoped))
        : q("tickets", "id,unit_id,property_id,lease_id,source,category,severity,status,title,description,created_at,updated_at,closed_at,sla_due_at", (b) => b.or(`created_at.gte.${fromStamp},status.in.(new,triaged,offered,scheduled,in_progress,pending_tenant)`)),
    readInsurance(),
    byLease("portal_invites", "id,contact_id,lease_id,email,expires_at,accepted_at,revoked_at,sent_at,delivery,created_at", (b) => b, "created_at"),
    byLease("arrears_actions", "id,lease_id,rent_period_id,stage,executed_at,registered_letter_id", (b) => b.gte("executed_at", fromStamp), "executed_at"),
    byLease("charge_periods", "id,lease_id,year,regime,status,advances_billed_cents,actual_cents,issued_on,due_on", (b) => b, "year"),
    shell || leaseScoped
      ? none()
      : propertyScoped
        ? inChunks(meterRows.map((m) => s(m.id)), (ids) => q("meter_readings", "meter_id,read_on,value,source,tenant_ack_at,manager_ack_at", (b) => b.in("meter_id", ids).order("read_on")))
        : q("meter_readings", "meter_id,read_on,value,source,tenant_ack_at,manager_ack_at", (b) => b.gte("read_on", from).order("read_on")),
    // The bank: the window, plus whatever still waits in the review queue, whenever it landed. The shell counts the queue.
    shell
      ? q("bank_transactions", "id,booked_on,amount_cents,counterparty_name,counterparty_iban,remittance_info,end_to_end_id,match_status,match_tier,match_explain", (b) => b.eq("match_status", "review"), 5000)
      : scoped
        ? none()
        : q("bank_transactions", "id,booked_on,amount_cents,counterparty_name,counterparty_iban,remittance_info,end_to_end_id,match_status,match_tier,match_explain", (b) => b.or(`booked_on.gte.${from},match_status.in.(review,unmatched)`).order("booked_on"), 5000),
    shell || leaseScoped
      ? none()
      : propertyScoped
        ? q("bills", BILL_COLS, (b) => b.eq("property_id", propertyScoped).order("created_at"))
        : q("bills", BILL_COLS, (b) => b.or(`doc_date.gte.${from},doc_date.is.null,paid_on.is.null`).order("created_at")),
    shell
      ? none()
      : scoped
      ? inChunks(leaseIds, (ids) => q("registered_letters", "id,template_key,related_type,related_id,recipient_contact_id,status,dispatched_on,ar_received_on", (b) => b.eq("related_type", "lease").in("related_id", ids)))
      : q("registered_letters", "id,template_key,related_type,related_id,recipient_contact_id,status,dispatched_on,ar_received_on", (b) => b.gte("created_at", fromStamp).order("created_at")),
  ]);

  // ── C. What hangs off those rows: by id, in chunks. ──
  const ticketIds = ticketRows.map((t) => s(t.id));
  const periodIds = new Set(periodRows.map((rp) => s(rp.id)));
  const lateOutsideWindow = statusRows.map((st) => s(st.id)).filter((id) => !periodIds.has(id));
  const newest = [...conversationRows].sort((a, b) => (s(a.last_message_at) || s(a.created_at)) < (s(b.last_message_at) || s(b.created_at)) ? 1 : -1)[0];
  // The thread read in full: the one asked for when it is the workspace's
  // (an unknown or foreign id falls back to the most recent, the policies
  // having answered nothing for it), the tenancy's own on its sheet, else
  // the most recent when Messages asks for one.
  const asked = scope.conversationId && scope.conversationId !== "latest" && conversationRows.some((c) => s(c.id) === scope.conversationId) ? scope.conversationId : null;
  const scopedConversationId =
    asked ??
    (scope.conversationId
      ? (newest ? s(newest.id) : null)
      : leaseScoped
        ? ((conversationRows.find((c) => s(c.scope_type) === "lease" && s(c.scope_id) === leaseScoped)?.id as string | undefined) ?? null)
        : null);
  const [workOrderRows, chargeLineRows, deductionRows, countRows, lateRows, messageRows, periodLetterRows, relatedDocRows] = await Promise.all([
    inChunks(ticketIds, (ids) => q("work_orders", "id,ticket_id,status,artisan_contact_id,scheduled_at,amount_cents,vat_cents,created_at", (b) => b.in("ticket_id", ids).order("created_at"))),
    inChunks(chargePeriodRows.map((cp) => s(cp.id)), (ids) => q("charge_lines", "id,charge_period_id,source,label,category,building_total_cents,tantiemes,tantiemes_total,lot_share_cents,tenant_share_cents,blocked", (b) => b.in("charge_period_id", ids))),
    inChunks(depositRows.map((d) => s(d.id)), (ids) => q("deposit_deductions", "id,deposit_id,kind,label,amount_cents,justified_at,justification_document_id,edl_item_id", (b) => b.in("deposit_id", ids))),
    inChunks(edlRows.map((e) => s(e.id)), (ids) => q("edl_session_counts", "session_id,items,photos", (b) => b.in("session_id", ids))),
    inChunks(lateOutsideWindow, (ids) => q("rent_periods", "id,lease_id,period,due_date,rent_cents,charges_cents,vat_cents,total_cents", (b) => b.in("id", ids))),
    scopedConversationId ? q("messages", "*", (b) => b.eq("conversation_id", scopedConversationId).order("sent_at"), 5000) : Promise.resolve([] as Row[]),
    scoped ? inChunks([...periodIds], (ids) => q("registered_letters", "id,template_key,related_type,related_id,recipient_contact_id,status,dispatched_on,ar_received_on", (b) => b.eq("related_type", "rent_period").in("related_id", ids))) : Promise.resolve([] as Row[]),
    // The pieces the screens name: a request's photos, and on a sheet the property's, its lots' and its tenancies' own.
    inChunks([...ticketIds, ...(scoped ? [...leaseIds, ...sheetUnitIds, ...sheetPropertyIds] : [])], (ids) => q("documents", "id,name,class,retention_class,retention_until,sealed,related_type,related_id,size_bytes,storage_path,created_at", (b) => b.in("related_id", ids))),
  ]);
  // ── D. The pieces the retention lines point at, by id. ──
  const justificationDocRows = await inChunks(
    deductionRows.map((x) => s(x.justification_document_id)),
    (ids) => q("documents", "id,name,class,retention_class,retention_until,sealed,related_type,related_id,size_bytes,storage_path,created_at", (b) => b.in("id", ids)),
  );
  const letterRows = [...leaseLetterRows, ...periodLetterRows];
  const documentRows = scoped ? relatedDocRows : documentPage.rows;
  const allPeriodRows = [...periodRows, ...lateRows];

  const rolesByContact = new Map<string, DemoContact["roles"]>();
  for (const r of roleRows) {
    if (r.ended_on) continue;
    const list = rolesByContact.get(s(r.contact_id)) ?? [];
    list.push(s(r.role) as DemoContact["roles"][number]);
    rolesByContact.set(s(r.contact_id), list);
  }
  const CONTACTS: DemoContact[] = contactRows.map((c) => ({
    id: s(c.id),
    kind: c.kind === "legal" ? "legal" : "natural",
    name:
      sOr(c.display_name, null) ??
      sOr(c.legal_name, null) ??
      [s(c.first_name), s(c.last_name)].filter(Boolean).join(" "),
    email: sOr(c.email, null),
    phone: sOr(c.phone, null),
    language: sOr(c.language, "fr") as string,
    roles: rolesByContact.get(s(c.id)) ?? [],
    iban: sOr(c.iban, undefined),
    bankHolderName: sOr(c.bank_holder_name, undefined),
    notes: sOr(c.notes, undefined),
    portalLinked: typeof c.user_id === "string" && c.user_id !== "",
  }));
  const contactByUser = new Map(contactRows.filter((c) => typeof c.user_id === "string" && c.user_id !== "").map((c) => [s(c.user_id), s(c.id)]));

  // ── Properties & units ──
  // photo_url holds a bucket path, not a link: one batched signing call,
  // skipped entirely when no property has a photograph yet.
  const signed = await sign([...propertyRows.map((p) => s(p.photo_url)), ...unitRows.map((u) => s(u.photo_url))].filter(Boolean));
  const unitsByProperty = new Map<string, number>();
  for (const u of unitRows) {
    unitsByProperty.set(s(u.property_id), (unitsByProperty.get(s(u.property_id)) ?? 0) + 1);
  }
  const PROPERTIES: DemoProperty[] = propertyRows.map((p) => ({
    id: s(p.id),
    name: s(p.name),
    address: formatAddress(p.address as PropertyAddress | null),
    commune: s(p.commune),
    cadastralRef: [s(p.cadastral_commune), s(p.cadastral_section), s(p.cadastral_number)]
      .filter(Boolean)
      .join(" / "),
    type: s(p.type),
    constructionYear: n(p.construction_year),
    completionDate: day(p.completion_date),
    energyClass: s(p.energy_class),
    cpeIssuedOn: day(p.cpe_issued_on),
    isCopropriete: b(p.is_copropriete),
    syndicName: sOr(p.syndic_name, undefined),
    syndicMandateStart: sOr(p.syndic_mandate_start, undefined),
    smokeDetectorsConfirmed: b(p.smoke_detectors_confirmed),
    ownerContactIds: [],
    ownershipNote: "",
    unitsCount: unitsByProperty.get(s(p.id)) ?? 0,
    photoUrl: signed.get(s(p.photo_url)) ?? null,
  }));
  const UNITS: DemoUnit[] = unitRows.map((u) => ({
    id: s(u.id),
    propertyId: s(u.property_id),
    label: s(u.label),
    kind: (["dwelling", "commercial", "office", "parking", "cellar", "other"].includes(s(u.kind)) ? s(u.kind) : "dwelling") as DemoUnit["kind"],
    floor: s(u.floor),
    areaSqm: n(u.area_sqm),
    rooms: n(u.rooms),
    bedrooms: typeof u.bedrooms === "number" ? u.bedrooms : undefined,
    furnished: b(u.furnished),
    photoUrl: signed.get(s(u.photo_url)) ?? null,
  }));

  // ── Leases ──
  // A party who moved out has left a tenancy that goes on without them (a
  // co-tenant leaving a couple's lease). On a tenancy that has ended, the
  // move-out date is the closure itself, and the people stay: history keeps
  // its names.
  const partiesByLease = new Map<string, Row[]>();
  for (const p of partyRows) {
    const list = partiesByLease.get(s(p.lease_id)) ?? [];
    list.push(p);
    partiesByLease.set(s(p.lease_id), list);
  }
  const partyIds = (leaseId: string, ended: boolean, role: "tenant" | "guarantor"): string[] =>
    (partiesByLease.get(leaseId) ?? [])
      .filter((p) => (role === "guarantor") === (s(p.role) === "guarantor"))
      .filter((p) => ended || !p.moved_out_on)
      .map((p) => s(p.contact_id));
  const depositByLease = new Map<string, Row>();
  for (const d of depositRows) depositByLease.set(s(d.lease_id), d);

  const LEASES: DemoLease[] = leaseRows.map((l) => {
    const details = (l.details ?? {}) as Row;
    const dep = depositByLease.get(s(l.id));
    const rent = n(l.rent_cents);
    const status = (["draft", "active", "notice", "ended"].includes(s(l.status))
      ? s(l.status)
      : "active") as DemoLease["status"];
    const ended = status === "ended";
    const depMonths =
      typeof details.depositMonths === "number"
        ? details.depositMonths
        : dep && rent > 0
          ? Math.max(1, Math.round(n(dep.amount_cents) / rent))
          : 2;
    return {
      id: s(l.id),
      seq: n(l.seq),
      unitId: s(l.unit_id),
      type: l.lease_type === "commercial" ? "commercial" : "residential",
      status,
      tenantContactIds: partyIds(s(l.id), ended, "tenant"),
      guarantorContactIds: partyIds(s(l.id), ended, "guarantor"),
      colocation: b(l.colocation),
      startDate: day(l.start_date),
      endDate: l.end_date ? day(l.end_date) : null,
      rentCents: rent,
      chargesCents: n(l.charges_cents),
      chargesRegime: l.charges_regime === "forfait" ? "forfait" : "advances",
      depositMonths: depMonths,
      depositForm: (dep ? s(dep.form) : sOr(details.depositForm, "cash")) as DemoLease["depositForm"],
      paymentDay: n(l.payment_day) || 1,
      rfReference: s(l.rf_reference),
      lastAdjustmentOn: l.last_adjustment_on ? day(l.last_adjustment_on) : null,
      previousRentCents: typeof l.previous_rent_cents === "number" ? l.previous_rent_cents : null,
      furnitureSupplementCents: typeof l.furniture_supplement_cents === "number" ? l.furniture_supplement_cents : undefined,
      furnitureInvoiceTotalCents:
        typeof l.furniture_invoice_total_cents === "number" ? l.furniture_invoice_total_cents : undefined,
      capitalComponents: Array.isArray(l.capital_investi)
        ? (l.capital_investi as DemoLease["capitalComponents"])
        : [],
      vatRegime: l.vat_regime === "opted" ? "opted" : "exempt",
      vatOption: (l.vat_option as DemoLease["vatOption"]) ?? undefined,
      indexationClause: (l.indexation_clause as DemoLease["indexationClause"]) ?? undefined,
      dossier: dossierOf(details),
      departure: departureOf(details),
    };
  });
  const leaseIndex = new Map(LEASES.map((l) => [l.id, l]));
  const unitIndex = new Map(UNITS.map((u) => [u.id, u]));
  const propertyIndex = new Map(PROPERTIES.map((p) => [p.id, p]));
  const contactIndex = new Map(CONTACTS.map((c) => [c.id, c]));
  const labelOfUnit = (unitId: string): string => {
    const u = unitIndex.get(unitId);
    if (!u) return "";
    const p = propertyIndex.get(u.propertyId);
    return p ? `${u.label} · ${p.name}` : u.label;
  };
  const labelOfLease = (leaseId: string): string => {
    const l = leaseIndex.get(leaseId);
    return l ? labelOfUnit(l.unitId) : "";
  };

  // ── Rent periods: figures from the table, paid-ness from the view, which
  //    derives it from non-reversed allocations. Never a stored boolean. ──
  const statusById = new Map(statusRows.map((r) => [s(r.id), r]));
  const RENT_PERIODS: DemoRentPeriod[] = allPeriodRows.map((rp) => {
    const st = statusById.get(s(rp.id));
    const raw = st ? s(st.status) : "pending";
    return {
      id: s(rp.id),
      leaseId: s(rp.lease_id),
      period: day(rp.period).slice(0, 7),
      dueDate: day(rp.due_date),
      rentCents: n(rp.rent_cents),
      chargesCents: n(rp.charges_cents),
      vatCents: n(rp.vat_cents),
      totalCents: n(rp.total_cents),
      allocatedCents: st ? n(st.allocated_cents) : 0,
      status: (raw === "partial_late" ? "partial" : raw) as DemoRentPeriod["status"],
    };
  });

  // ── Deposits ──
  const deductionsByDeposit = new Map<string, Row[]>();
  for (const dd of deductionRows) {
    const list = deductionsByDeposit.get(s(dd.deposit_id)) ?? [];
    list.push(dd);
    deductionsByDeposit.set(s(dd.deposit_id), list);
  }
  const documentNameById = new Map([...documentRows, ...relatedDocRows, ...justificationDocRows].map((doc) => [s(doc.id), s(doc.name)]));
  const DEPOSITS: DemoDeposit[] = depositRows.map((d) => ({
    id: s(d.id),
    leaseId: s(d.lease_id),
    form: s(d.form) as DemoDeposit["form"],
    amountCents: n(d.amount_cents),
    status: s(d.status) as DemoDeposit["status"],
    keyHandoverOn: sOr(d.key_handover_on, undefined),
    decompteIssuedOn: d.decompte_issued_on ? day(d.decompte_issued_on) : null,
    miseEnDemeureArOn: d.mise_en_demeure_ar_on ? day(d.mise_en_demeure_ar_on) : null,
    entryEdlExists: edlRows.some(
      (e) => s(e.lease_id) === s(d.lease_id) && s(e.kind) === "entry" && ["signed", "sealed"].includes(s(e.status)),
    ),
    deductions: (deductionsByDeposit.get(s(d.id)) ?? []).map((x) => ({
      id: s(x.id),
      kind: s(x.kind) as "arrears" | "damage" | "charge_reserve",
      label: s(x.label),
      amountCents: n(x.amount_cents),
      justifiedAt: sOr(x.justified_at, undefined),
      justificationDocRef: x.justification_document_id
        ? (documentNameById.get(s(x.justification_document_id)) ?? s(x.justification_document_id))
        : undefined,
      edlItemRef: sOr(x.edl_item_id, undefined),
    })),
    releasedFirstTrancheCents: n(d.released_first_tranche_cents),
    releasedBalanceCents: n(d.released_balance_cents),
  }));

  // ── Bank ──
  const BANK_ACCOUNTS: DemoData["BANK_ACCOUNTS"] = accountRows.map((a) => ({
    id: s(a.id),
    label: s(a.label),
    iban: s(a.iban),
    bic: s(a.bic),
    holderNameVerbatim: s(a.holder_name_verbatim),
    kind: s(a.kind),
    provider: s(a.provider),
    consentExpiresAt: a.consent_expires_at ? day(a.consent_expires_at) : null,
    balanceCents: n(a.balance_cents),
  }));
  const BANK_TXS: DemoBankTx[] = txRows.map((t) => ({
    id: s(t.id),
    bookedAt: day(t.booked_on),
    amount: n(t.amount_cents),
    counterpartyName: s(t.counterparty_name),
    counterpartyIban: sOr(t.counterparty_iban, null),
    remittanceInfo: s(t.remittance_info),
    endToEndId: sOr(t.end_to_end_id, null),
    status: (["unmatched", "auto", "manual", "review", "ignored"].includes(s(t.match_status))
      ? s(t.match_status)
      : "unmatched") as DemoBankTx["status"],
    matchTier: sOr(t.match_tier, undefined),
    matchExplain: sOr(t.match_explain, undefined),
  }));
  const IBAN_BINDINGS: DemoData["IBAN_BINDINGS"] = bindingRows.map((r) => ({
    payerIban: s(r.payer_iban),
    leaseId: s(r.lease_id),
  }));

  // ── Arrears ladder ──
  const REGISTERED_LETTERS: DemoData["REGISTERED_LETTERS"] = letterRows.map((r) => ({
    id: s(r.id),
    templateKey: s(r.template_key),
    relatedType: s(r.related_type),
    relatedId: s(r.related_id),
    recipientContactId: sOr(r.recipient_contact_id, null),
    status: (["draft", "dispatched", "ar_received", "returned_undelivered"].includes(s(r.status)) ? s(r.status) : "draft") as DemoData["REGISTERED_LETTERS"][number]["status"],
    dispatchedOn: r.dispatched_on ? day(r.dispatched_on) : null,
    arReceivedOn: r.ar_received_on ? day(r.ar_received_on) : null,
  }));
  const ARREARS_ACTIONS: DemoData["ARREARS_ACTIONS"] = arrearsRows
    .filter((r) => ["friendly", "formal", "mise_en_demeure", "justice_dossier"].includes(s(r.stage)))
    .map((r) => ({
      id: s(r.id),
      leaseId: s(r.lease_id),
      rentPeriodId: sOr(r.rent_period_id, null),
      stage: s(r.stage) as DemoData["ARREARS_ACTIONS"][number]["stage"],
      executedOn: day(r.executed_at),
      registeredLetterId: sOr(r.registered_letter_id, null),
    }));

  // ── EDLs ──
  // Items and photos counted by the database (0020), never by reading them.
  const countBySession = new Map(countRows.map((c) => [s(c.session_id), c]));
  const EDLS: DemoEdl[] = edlRows.map((e) => ({
    id: s(e.id),
    leaseId: s(e.lease_id),
    unitLabel: labelOfLease(s(e.lease_id)),
    kind: (["entry", "intermediate", "exit"].includes(s(e.kind)) ? s(e.kind) : "entry") as DemoEdl["kind"],
    status: s(e.status) as DemoEdl["status"],
    scheduledAt: e.scheduled_at ? day(e.scheduled_at) : null,
    completedAt: e.completed_at ? day(e.completed_at) : null,
    itemsCount: Number(countBySession.get(s(e.id))?.items) || 0,
    photosCount: Number(countBySession.get(s(e.id))?.photos) || 0,
    keyHandoverAt: e.key_handover_at ? day(e.key_handover_at) : null,
    hashSealed: s(e.hash_manifest_sha256) !== "",
  }));

  // ── Tickets, meters, workflows ──
  // A request sits in its tenancy's conversation (the one its anchor
  // message is on, else the lease's own); its work order, if the owner
  // opened one, makes it an intervention; its photos are the ticket's
  // documents, signed for the screen.
  const conversationByLease = new Map(
    conversationRows.filter((c) => s(c.scope_type) === "lease" && s(c.scope_id) !== "").map((c) => [s(c.scope_id), s(c.id)]),
  );
  const conversationByTicket = new Map<string, string>();
  for (const m of messageRows) if (s(m.ticket_id) !== "" && !conversationByTicket.has(s(m.ticket_id))) conversationByTicket.set(s(m.ticket_id), s(m.conversation_id));
  const workOrderByTicket = new Map<string, Row>();
  for (const w of workOrderRows) if (!workOrderByTicket.has(s(w.ticket_id))) workOrderByTicket.set(s(w.ticket_id), w);
  const WORK_ORDER_STATUSES = ["offered", "declined", "accepted", "slots_proposed", "scheduled", "done", "invoiced", "paid"];
  const workOrderOf = (ticketId: string): DemoTicket["workOrder"] => {
    const w = workOrderByTicket.get(ticketId);
    if (!w) return null;
    return {
      id: s(w.id),
      status: (WORK_ORDER_STATUSES.includes(s(w.status)) ? s(w.status) : "offered") as NonNullable<DemoTicket["workOrder"]>["status"],
      artisanContactId: sOr(w.artisan_contact_id, null),
      scheduledAt: w.scheduled_at ? s(w.scheduled_at) : null,
      amountCents: typeof w.amount_cents === "number" ? w.amount_cents : null,
      vatCents: typeof w.vat_cents === "number" ? w.vat_cents : null,
    };
  };
  const ticketPhotoRows = relatedDocRows.filter((doc) => s(doc.related_type) === "ticket" && s(doc.storage_path) !== "");
  const signedPhotos = await sign(ticketPhotoRows.map((doc) => s(doc.storage_path)));
  const TICKETS: DemoTicket[] = ticketRows.map((t) => ({
    id: s(t.id),
    ref: `INT-${s(t.id).slice(0, 8).toUpperCase()}`,
    unitId: s(t.unit_id),
    unitLabel: labelOfUnit(s(t.unit_id)),
    leaseId: sOr(t.lease_id, null),
    source: (["tenant", "manager", "edl_defect", "owner"].includes(s(t.source))
      ? s(t.source)
      : "manager") as DemoTicket["source"],
    category: s(t.category),
    severity: s(t.severity) as DemoTicket["severity"],
    status: s(t.status) as DemoTicket["status"],
    title: s(t.title),
    description: sOr(t.description, null),
    createdAt: day(t.created_at),
    updatedAt: t.updated_at ? day(t.updated_at) : day(t.created_at),
    closedAt: t.closed_at ? day(t.closed_at) : null,
    slaDueAt: t.sla_due_at ? day(t.sla_due_at) : null,
    conversationId: conversationByTicket.get(s(t.id)) ?? (s(t.lease_id) ? conversationByLease.get(s(t.lease_id)) : undefined) ?? null,
    interventionId: workOrderByTicket.has(s(t.id)) ? s(workOrderByTicket.get(s(t.id))!.id) : null,
    workOrder: workOrderOf(s(t.id)),
    attachments: ticketPhotoRows
      .filter((doc) => s(doc.related_id) === s(t.id))
      .map((doc) => ({ id: s(doc.id), name: s(doc.name), url: signedPhotos.get(s(doc.storage_path)) ?? null })),
    artisanContactId: workOrderOf(s(t.id))?.artisanContactId ?? undefined,
    amountCents: workOrderOf(s(t.id))?.amountCents ?? undefined,
  }));

  // ── Charges: the décomptes and their lines ──
  const linesByPeriod = new Map<string, Row[]>();
  for (const l of chargeLineRows) linesByPeriod.set(s(l.charge_period_id), [...(linesByPeriod.get(s(l.charge_period_id)) ?? []), l]);
  const CHARGE_PERIODS: DemoData["CHARGE_PERIODS"] = chargePeriodRows.map((cp) => ({
    id: s(cp.id),
    leaseId: s(cp.lease_id),
    year: n(cp.year),
    regime: cp.regime === "forfait" ? "forfait" : "advances",
    status: (["open", "draft", "issued", "disputed", "settled"].includes(s(cp.status)) ? s(cp.status) : "open") as DemoData["CHARGE_PERIODS"][number]["status"],
    advancesBilledCents: n(cp.advances_billed_cents),
    actualCents: n(cp.actual_cents),
    issuedOn: cp.issued_on ? day(cp.issued_on) : null,
    dueOn: cp.due_on ? day(cp.due_on) : null,
    lines: (linesByPeriod.get(s(cp.id)) ?? []).map((l) => ({
      id: s(l.id),
      source: (["invoice", "syndic_decompte", "meter", "estimate"].includes(s(l.source)) ? s(l.source) : "invoice") as DemoData["CHARGE_PERIODS"][number]["lines"][number]["source"],
      label: s(l.label),
      category: s(l.category) as DemoData["CHARGE_PERIODS"][number]["lines"][number]["category"],
      buildingTotalCents: typeof l.building_total_cents === "number" ? l.building_total_cents : null,
      tantiemes: typeof l.tantiemes === "number" ? l.tantiemes : null,
      tantiemesTotal: typeof l.tantiemes_total === "number" ? l.tantiemes_total : null,
      lotShareCents: n(l.lot_share_cents),
      tenantShareCents: n(l.tenant_share_cents),
      blocked: b(l.blocked),
    })),
  }));
  const lastReadingByMeter = new Map<string, Row>();
  for (const r of readingRows) lastReadingByMeter.set(s(r.meter_id), r); // ordered by read_on: last wins
  const METERS: DemoMeter[] = meterRows.map((m) => {
    const r = lastReadingByMeter.get(s(m.id));
    return {
      id: s(m.id),
      unitId: sOr(m.unit_id, null),
      propertyId: s(m.property_id),
      kind: s(m.kind) as DemoMeter["kind"],
      serial: s(m.serial_number),
      supplier: s(m.supplier),
      lastReading: r
        ? {
            date: day(r.read_on),
            value: n(r.value),
            source: s(r.source),
            tenantAck: Boolean(r.tenant_ack_at),
            managerAck: Boolean(r.manager_ack_at),
          }
        : null,
    };
  });
  const WORKFLOWS: DemoWorkflow[] = workflowRows
    .filter((w) => !w.completed_at)
    .map((w) => ({
      id: s(w.id),
      kind: s(w.kind) as DemoWorkflow["kind"],
      label: (s(w.lease_id) && labelOfLease(s(w.lease_id))) || labelOfUnit(s(w.unit_id)) || s(w.kind),
      currentState: s(w.current_state),
      startedAt: day(w.started_at),
      blockedReason: sOr(w.blocked_reason, null),
    }));

  // ── Conversations ──
  const messagesByConv = new Map<string, Row[]>();
  for (const m of messageRows) {
    const list = messagesByConv.get(s(m.conversation_id)) ?? [];
    list.push(m);
    messagesByConv.set(s(m.conversation_id), list);
  }
  const ticketIndex = new Map(TICKETS.map((t) => [t.id, t]));
  const tenantNamesOfLease = (leaseId: string): string[] =>
    (leaseIndex.get(leaseId)?.tenantContactIds ?? []).map((id) => contactIndex.get(id)?.name ?? "").filter(Boolean);
  const scopeLabel = (type: string, id: string): string => {
    if (type === "lease") return labelOfLease(id);
    if (type === "unit") return labelOfUnit(id);
    if (type === "property") return propertyIndex.get(id)?.name ?? "";
    if (type === "contact") return contactIndex.get(id)?.name ?? "";
    if (type === "ticket") {
      const t = ticketIndex.get(id);
      return t ? [t.ref, t.unitLabel].filter(Boolean).join(" · ") : "";
    }
    return "";
  };
  const SCOPE_TYPES = ["lease", "ticket", "mandate", "contact", "general"] as const;
  const headByConv = new Map(headRows.map((h) => [s(h.conversation_id), h]));
  /** The head's last message, in the row shape, for a thread not read in full. */
  const headMessage = (h: Row): Row => ({
    id: h.last_message_id,
    conversation_id: h.conversation_id,
    sender_kind: h.last_sender_kind,
    sender_contact_id: h.last_sender_contact_id,
    sender_user_id: h.last_sender_user_id,
    body: h.last_body,
    sent_at: h.last_sent_at,
    read_at: h.last_read_at,
    ticket_id: h.last_ticket_id,
  });
  const CONVERSATIONS: DemoConversation[] = conversationRows.map((c) => {
    const loaded = s(c.id) === scopedConversationId;
    const head = headByConv.get(s(c.id));
    const msgs = loaded ? (messagesByConv.get(s(c.id)) ?? []) : head && head.last_message_id ? [headMessage(head)] : [];
    const scopeType = (SCOPE_TYPES as readonly string[]).includes(s(c.scope_type)) ? (s(c.scope_type) as DemoConversation["scopeType"]) : "general";
    const scopeId = sOr(c.scope_id, null);
    const senderName = (m: Row): string =>
      contactIndex.get(s(m.sender_contact_id))?.name ??
      contactIndex.get(contactByUser.get(s(m.sender_user_id)) ?? "")?.name ??
      (s(m.sender_kind) === "manager" ? org.name : "Système");
    // The other side of the desk: the tenants of the lease or request, the
    // contact, else whoever wrote first from outside the cabinet.
    const partyNames =
      scopeType === "ticket" && scopeId
        ? tenantNamesOfLease(ticketIndex.get(scopeId)?.leaseId ?? "")
        : scopeType === "lease" && scopeId
          ? tenantNamesOfLease(scopeId)
          : scopeType === "contact" && scopeId
            ? [contactIndex.get(scopeId)?.name ?? ""].filter(Boolean)
            : [];
    const outsider = msgs.find((m) => s(m.sender_kind) !== "manager" && s(m.sender_kind) !== "system");
    const lastAt = msgs.length > 0 ? s(msgs[msgs.length - 1].sent_at) : s(c.last_message_at) || s(c.created_at);
    return {
      id: s(c.id),
      subject: s(c.subject),
      scopeLabel: scopeLabel(scopeType, scopeId ?? ""),
      scopeType,
      scopeId,
      participantName: partyNames.join(", ") || (outsider ? senderName(outsider) : org.name),
      lastMessageAt: lastAt,
      unread: head ? Number(head.unread) || 0 : msgs.filter((m) => !m.read_at && s(m.sender_kind) !== "manager").length,
      loaded,
      messages: msgs.map((m) => ({
        id: s(m.id),
        from: senderName(m),
        kind: (["tenant", "manager", "owner", "artisan", "system"].includes(s(m.sender_kind))
          ? s(m.sender_kind)
          : "system") as DemoConversation["messages"][number]["kind"],
        body: s(m.body),
        at: s(m.sent_at),
        readAt: m.read_at ? s(m.read_at) : null,
        ticketId: sOr(m.ticket_id, null),
      })),
    };
  });

  // ── Documents ──
  const relatedLabel = (type: string, id: string): string => {
    if (type === "lease") return labelOfLease(id);
    if (type === "unit") return labelOfUnit(id);
    if (type === "property") return propertyIndex.get(id)?.name ?? "";
    if (type === "contact") return contactIndex.get(id)?.name ?? "";
    if (type === "ticket") return `INT-${id.slice(0, 8).toUpperCase()}`;
    return "";
  };
  const DOCUMENTS: DemoDocument[] = documentRows.map((doc) => ({
    id: s(doc.id),
    name: s(doc.name),
    klass: s(doc.class),
    retentionClass: s(doc.retention_class),
    retentionUntil: doc.retention_until ? day(doc.retention_until) : null,
    sealed: b(doc.sealed),
    relatedLabel: relatedLabel(s(doc.related_type), s(doc.related_id)),
    sizeKb: Math.max(1, Math.round(n(doc.size_bytes) / 1024)),
    createdAt: day(doc.created_at),
    hasFile: s(doc.storage_path) !== "",
  }));

  const INSURANCES: DemoInsurance[] = insuranceRows.map((i) => ({
    id: s(i.id),
    propertyId: sOr(i.property_id, null),
    leaseId: sOr(i.lease_id, null),
    kind: s(i.kind) as DemoInsurance["kind"],
    provider: s(i.provider),
    policyNumber: s(i.policy_number),
    premiumCents: n(i.premium_cents),
    startsOn: i.starts_on ? day(i.starts_on) : null,
    expiresOn: i.expires_on ? day(i.expires_on) : null,
    notes: s(i.notes),
  }));

  const INVITES: DemoInvite[] = inviteRows.map((i) => ({
    id: s(i.id),
    contactId: s(i.contact_id),
    leaseId: sOr(i.lease_id, null),
    email: s(i.email),
    expiresAt: s(i.expires_at),
    acceptedAt: sOr(i.accepted_at, null),
    revokedAt: sOr(i.revoked_at, null),
    sentAt: sOr(i.sent_at, null),
    delivery: i.delivery === "email" || i.delivery === "link" ? i.delivery : null,
    createdAt: s(i.created_at),
  }));

  // ── Bills ──
  const BILLS: DemoBill[] = billRows.map((bill) => ({
    id: s(bill.id),
    direction: bill.direction === "income" ? "income" : "expense",
    supplierContactId: sOr(bill.supplier_contact_id, null),
    supplierName: contactIndex.get(s(bill.supplier_contact_id))?.name ?? "",
    propertyId: sOr(bill.property_id, null),
    unitId: sOr(bill.unit_id, null),
    unitLabel: bill.unit_id ? labelOfUnit(s(bill.unit_id)) : (propertyIndex.get(s(bill.property_id))?.name ?? ""),
    category: s(bill.category) as DemoBill["category"],
    subject: s(bill.subject),
    docNo: s(bill.doc_no),
    docDate: bill.doc_date ? day(bill.doc_date) : null,
    dueOn: bill.due_on ? day(bill.due_on) : null,
    paidOn: bill.paid_on ? day(bill.paid_on) : null,
    cashflow: bill.cashflow !== false,
    vatRatePct: Number(bill.vat_rate_pct) || 0,
    amountCents: n(bill.amount_cents),
    vatCents: n(bill.vat_cents),
    documentId: sOr(bill.document_id, null),
    hasDocument: Boolean(bill.document_id),
    createdAt: day(bill.created_at),
  }));

  const ENDED_LEASES: DemoData["ENDED_LEASES"] = LEASES.filter((l) => l.status === "ended").map((l) => ({
    id: l.id,
    label: labelOfUnit(l.unitId),
    tenant: l.tenantContactIds.map((id) => contactIndex.get(id)?.name ?? "").join(", "),
    rentCents: l.rentCents,
  }));

  // Start from the honest empty assembly, then fill what the account owns.
  const base = buildEmptyData(org);
  const data: DemoData = {
    ...base,
    TODAY: today,
    CONTACTS,
    PROPERTIES,
    UNITS,
    LEASES,
    RENT_PERIODS,
    BANK_ACCOUNTS,
    IBAN_BINDINGS,
    REGISTERED_LETTERS,
    ARREARS_ACTIONS,
    BANK_TXS,
    DEPOSITS,
    ENDED_LEASES,
    CHARGE_PERIODS,
    EDLS,
    TICKETS,
    METERS,
    WORKFLOWS,
    CONVERSATIONS,
    DOCUMENTS,
    BILLS,
    INSURANCES,
    INVITES,
    PAGING: { documents: pageInfo(docPage, scoped ? DOCUMENTS.length : documentPage.total) },
    contactById: (id: string) => contactIndex.get(id)!,
    propertyById: (id: string) => propertyIndex.get(id)!,
    unitById: (id: string) => unitIndex.get(id)!,
    leaseById: (id: string) => leaseIndex.get(id)!,
    leaseTenantNames: (l: DemoLease) => l.tenantContactIds.map((id) => contactIndex.get(id)?.name ?? ""),
    leaseUnitLabel: (l: DemoLease) => labelOfUnit(l.unitId),
    openInvoicesForMatching: (): OpenInvoice[] =>
      RENT_PERIODS.filter((rp) => rp.allocatedCents < rp.totalCents && rp.status !== "upcoming" && rp.status !== "written_off").map(
        (rp) => {
          const l = leaseIndex.get(rp.leaseId);
          return {
            id: rp.id,
            leaseId: rp.leaseId,
            tenantNames: l ? l.tenantContactIds.map((id) => contactIndex.get(id)?.name ?? "") : [],
            rfReference: l?.rfReference ?? "",
            dueDate: rp.dueDate,
            totalAmount: rp.totalCents,
            openAmount: rp.totalCents - rp.allocatedCents,
            previousRentAmount: l?.previousRentCents ?? null,
            unitLabel: l ? labelOfUnit(l.unitId) : "",
          };
        },
      ),
  };
  return data;
}
