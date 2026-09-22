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
} from "./data";
import { buildEmptyData, type Org } from "./data-empty";

/**
 * The real-account dataset: the same seam the demo flows through, hydrated
 * from `gestion.*` under the caller's own JWT. RLS decides what is visible;
 * this module only reshapes rows into the forms every page and engine
 * already consumes. Nothing here invents a figure: a column that does not
 * exist yet maps to the shape's honest empty value, and the page shows its
 * empty state — never a borrowed demo record.
 */

type Row = Record<string, unknown>;

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

export async function buildRealData(org: Org, accessToken: string): Promise<DemoData> {
  const client = authedClient(accessToken);
  return buildRealDataFrom(client.schema("gestion"), org, (paths) => signMedia(client, paths));
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
): Promise<DemoData> {
  const oid = org.id;

  // One org-scoped read per table, in parallel. A failed read degrades to an
  // empty collection (logged), never to sample data.
  // Tables carrying `archived_at`: an archived row is gone from every screen,
  // not only from the one that happens to filter it.
  const ARCHIVABLE = new Set(["properties", "units", "contacts"]);
  const q = async (table: string, select: string, order?: string): Promise<Row[]> => {
    let query = g.from(table).select(select).eq("org_id", oid);
    if (ARCHIVABLE.has(table)) query = query.is("archived_at", null);
    if (order) query = query.order(order);
    const { data, error } = await query.limit(2000);
    if (error) {
      console.error(`gestion read failed (${table}):`, error.code, error.message);
      return [];
    }
    return (data as unknown as Row[]) ?? [];
  };

  const [
    propertyRows,
    unitRows,
    contactRows,
    roleRows,
    leaseRows,
    partyRows,
    periodRows,
    statusRows,
    depositRows,
    deductionRows,
    accountRows,
    txRows,
    bindingRows,
    edlRows,
    edlItemRows,
    edlMediaRows,
    ticketRows,
    workOrderRows,
    meterRows,
    readingRows,
    workflowRows,
    conversationRows,
    messageRows,
    documentRows,
    insuranceRows,
    inviteRows,
  ] = await Promise.all([
    q(
      "properties",
      "id,name,type,address,commune,cadastral_commune,cadastral_section,cadastral_number,construction_year,completion_date,energy_class,cpe_issued_on,is_copropriete,syndic_name,syndic_mandate_start,smoke_detectors_confirmed,photo_url",
      "created_at",
    ),
    q("units", "id,property_id,label,kind,floor,area_sqm,rooms,bedrooms,furnished,photo_url", "created_at"),
    q(
      "contacts",
      "id,kind,first_name,last_name,legal_name,display_name,email,phone,language,iban,bank_holder_name,notes,user_id",
      "created_at",
    ),
    q("contact_roles", "contact_id,role,ended_on"),
    q(
      "leases",
      "id,unit_id,seq,lease_type,status,start_date,end_date,rent_cents,charges_cents,charges_regime,payment_day,rf_reference,furnished,furniture_supplement_cents,furniture_invoice_total_cents,colocation,capital_investi,last_adjustment_on,previous_rent_cents,indexation_clause,vat_regime,vat_option,details",
      "created_at",
    ),
    q("lease_parties", "lease_id,contact_id,role,moved_out_on"),
    q("rent_periods", "id,lease_id,period,due_date,rent_cents,charges_cents,vat_cents,total_cents", "period"),
    q("rent_period_status", "id,allocated_cents,status"),
    q(
      "deposits",
      "id,lease_id,form,amount_cents,status,key_handover_on,decompte_issued_on,mise_en_demeure_ar_on,released_first_tranche_cents,released_balance_cents",
    ),
    q("deposit_deductions", "id,deposit_id,kind,label,amount_cents,justified_at,justification_document_id,edl_item_id"),
    q("bank_accounts", "id,label,iban,bic,holder_name_verbatim,kind,provider,consent_expires_at,balance_cents"),
    q(
      "bank_transactions",
      "id,booked_on,amount_cents,counterparty_name,counterparty_iban,remittance_info,end_to_end_id,match_status,match_tier,match_explain",
      "booked_on",
    ),
    q("iban_bindings", "payer_iban,lease_id"),
    q("edl_sessions", "id,lease_id,kind,status,scheduled_at,completed_at,key_handover_at,hash_manifest_sha256"),
    q("edl_items", "id,session_id"),
    q("edl_media", "id,item_id"),
    q("tickets", "id,unit_id,property_id,lease_id,source,category,severity,status,title,description,created_at,updated_at,closed_at,sla_due_at"),
    q("work_orders", "id,ticket_id,status,created_at"),
    q("meters", "id,property_id,unit_id,kind,serial_number,supplier", "created_at"),
    q("meter_readings", "meter_id,read_on,value,source,tenant_ack_at,manager_ack_at", "read_on"),
    q("workflows", "id,kind,unit_id,lease_id,current_state,blocked_reason,started_at,completed_at"),
    q("conversations", "id,scope_type,scope_id,subject,last_message_at,created_at"),
    q("messages", "id,conversation_id,sender_kind,sender_contact_id,sender_user_id,body,sent_at,read_at", "sent_at"),
    q("documents", "id,name,class,retention_class,retention_until,sealed,related_type,related_id,size_bytes,storage_path,created_at"),
    q("insurance_policies", "id,property_id,lease_id,kind,provider,policy_number,premium_cents,starts_on,expires_on,notes", "created_at"),
    // The token is never selected: it is returned once, when the invitation is created.
    q("portal_invites", "id,contact_id,lease_id,email,expires_at,accepted_at,revoked_at,sent_at,delivery,created_at", "created_at"),
  ]);

  // ── Contacts ──
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
  const RENT_PERIODS: DemoRentPeriod[] = periodRows.map((rp) => {
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
  const documentNameById = new Map(documentRows.map((doc) => [s(doc.id), s(doc.name)]));
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

  // ── EDLs ──
  const itemSession = new Map(edlItemRows.map((i) => [s(i.id), s(i.session_id)]));
  const itemsBySession = new Map<string, number>();
  for (const i of edlItemRows) {
    itemsBySession.set(s(i.session_id), (itemsBySession.get(s(i.session_id)) ?? 0) + 1);
  }
  const photosBySession = new Map<string, number>();
  for (const m of edlMediaRows) {
    const sess = itemSession.get(s(m.item_id));
    if (sess) photosBySession.set(sess, (photosBySession.get(sess) ?? 0) + 1);
  }
  const EDLS: DemoEdl[] = edlRows.map((e) => ({
    id: s(e.id),
    leaseId: s(e.lease_id),
    unitLabel: labelOfLease(s(e.lease_id)),
    kind: (["entry", "intermediate", "exit"].includes(s(e.kind)) ? s(e.kind) : "entry") as DemoEdl["kind"],
    status: s(e.status) as DemoEdl["status"],
    scheduledAt: e.scheduled_at ? day(e.scheduled_at) : null,
    completedAt: e.completed_at ? day(e.completed_at) : null,
    itemsCount: itemsBySession.get(s(e.id)) ?? 0,
    photosCount: photosBySession.get(s(e.id)) ?? 0,
    keyHandoverAt: e.key_handover_at ? day(e.key_handover_at) : null,
    hashSealed: s(e.hash_manifest_sha256) !== "",
  }));

  // ── Tickets, meters, workflows ──
  // A request's thread is the ticket-scoped conversation; its work order,
  // if the owner opened one, makes it an intervention; its photos are the
  // ticket's documents, signed for the screen.
  const conversationByTicket = new Map(
    conversationRows.filter((c) => s(c.scope_type) === "ticket" && s(c.scope_id) !== "").map((c) => [s(c.scope_id), s(c.id)]),
  );
  const workOrderByTicket = new Map<string, string>();
  for (const w of workOrderRows) if (!workOrderByTicket.has(s(w.ticket_id))) workOrderByTicket.set(s(w.ticket_id), s(w.id));
  const ticketPhotoRows = documentRows.filter((doc) => s(doc.related_type) === "ticket" && s(doc.storage_path) !== "");
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
    conversationId: conversationByTicket.get(s(t.id)) ?? null,
    interventionId: workOrderByTicket.get(s(t.id)) ?? null,
    attachments: ticketPhotoRows
      .filter((doc) => s(doc.related_id) === s(t.id))
      .map((doc) => ({ id: s(doc.id), name: s(doc.name), url: signedPhotos.get(s(doc.storage_path)) ?? null })),
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
  const CONVERSATIONS: DemoConversation[] = conversationRows.map((c) => {
    const msgs = messagesByConv.get(s(c.id)) ?? [];
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
      unread: msgs.filter((m) => !m.read_at && s(m.sender_kind) !== "manager").length,
      messages: msgs.map((m) => ({
        id: s(m.id),
        from: senderName(m),
        kind: (["tenant", "manager", "owner", "artisan", "system"].includes(s(m.sender_kind))
          ? s(m.sender_kind)
          : "system") as DemoConversation["messages"][number]["kind"],
        body: s(m.body),
        at: s(m.sent_at),
        readAt: m.read_at ? s(m.read_at) : null,
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
    CONTACTS,
    PROPERTIES,
    UNITS,
    LEASES,
    RENT_PERIODS,
    BANK_ACCOUNTS,
    IBAN_BINDINGS,
    BANK_TXS,
    DEPOSITS,
    ENDED_LEASES,
    EDLS,
    TICKETS,
    METERS,
    WORKFLOWS,
    CONVERSATIONS,
    DOCUMENTS,
    INSURANCES,
    INVITES,
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
