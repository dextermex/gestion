import "server-only";
import { authedClient } from "@/lib/supabase/server";
import { formatAddress, type PropertyAddress } from "@/lib/gestion/address";
import type { OpenInvoice } from "@/domain/banking/matching";
import type { DemoData } from "./index";
import type {
  DemoContact,
  DemoDeposit,
  DemoDocument,
  DemoEdl,
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

export async function buildRealData(org: Org, accessToken: string): Promise<DemoData> {
  const g = authedClient(accessToken).schema("gestion");
  const oid = org.id;

  // One org-scoped read per table, in parallel. A failed read degrades to an
  // empty collection (logged), never to sample data.
  const q = async (table: string, select: string, order?: string): Promise<Row[]> => {
    let query = g.from(table).select(select).eq("org_id", oid);
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
    meterRows,
    readingRows,
    workflowRows,
    conversationRows,
    messageRows,
    documentRows,
  ] = await Promise.all([
    q(
      "properties",
      "id,name,type,address,commune,cadastral_commune,cadastral_section,cadastral_number,construction_year,completion_date,energy_class,cpe_issued_on,is_copropriete,syndic_name,syndic_mandate_start,smoke_detectors_confirmed",
      "created_at",
    ),
    q("units", "id,property_id,label,kind,floor,area_sqm,rooms,furnished", "created_at"),
    q(
      "contacts",
      "id,kind,first_name,last_name,legal_name,display_name,email,phone,language,iban,bank_holder_name,notes",
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
    q("tickets", "id,unit_id,lease_id,source,category,severity,status,title,created_at,sla_due_at"),
    q("meters", "id,property_id,unit_id,kind,serial_number,supplier", "created_at"),
    q("meter_readings", "meter_id,read_on,value,source,tenant_ack_at,manager_ack_at", "read_on"),
    q("workflows", "id,kind,unit_id,lease_id,current_state,blocked_reason,started_at,completed_at"),
    q("conversations", "id,scope_type,scope_id,subject,last_message_at"),
    q("messages", "conversation_id,sender_kind,sender_contact_id,body,sent_at,read_at", "sent_at"),
    q("documents", "id,name,class,retention_class,retention_until,sealed,related_type,related_id,size_bytes,created_at"),
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
  }));

  // ── Properties & units ──
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
  }));
  const UNITS: DemoUnit[] = unitRows.map((u) => ({
    id: s(u.id),
    propertyId: s(u.property_id),
    label: s(u.label),
    kind: (["dwelling", "commercial", "parking"].includes(s(u.kind)) ? s(u.kind) : "dwelling") as DemoUnit["kind"],
    floor: s(u.floor),
    areaSqm: n(u.area_sqm),
    rooms: n(u.rooms),
    furnished: b(u.furnished),
  }));

  // ── Leases ──
  const tenantsByLease = new Map<string, string[]>();
  const guarantorsByLease = new Map<string, string[]>();
  for (const p of partyRows) {
    if (p.moved_out_on) continue;
    const map = s(p.role) === "guarantor" ? guarantorsByLease : tenantsByLease;
    const list = map.get(s(p.lease_id)) ?? [];
    list.push(s(p.contact_id));
    map.set(s(p.lease_id), list);
  }
  const depositByLease = new Map<string, Row>();
  for (const d of depositRows) depositByLease.set(s(d.lease_id), d);

  const LEASES: DemoLease[] = leaseRows.map((l) => {
    const details = (l.details ?? {}) as Row;
    const dep = depositByLease.get(s(l.id));
    const rent = n(l.rent_cents);
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
      status: (["draft", "active", "notice", "ended"].includes(s(l.status))
        ? s(l.status)
        : "active") as DemoLease["status"],
      tenantContactIds: tenantsByLease.get(s(l.id)) ?? [],
      guarantorContactIds: guarantorsByLease.get(s(l.id)),
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
  const TICKETS: DemoTicket[] = ticketRows.map((t) => ({
    id: s(t.id),
    ref: `INT-${s(t.id).slice(0, 8).toUpperCase()}`,
    unitLabel: labelOfUnit(s(t.unit_id)),
    leaseId: sOr(t.lease_id, null),
    source: (["tenant", "manager", "edl_defect", "owner"].includes(s(t.source))
      ? s(t.source)
      : "manager") as DemoTicket["source"],
    category: s(t.category),
    severity: s(t.severity) as DemoTicket["severity"],
    status: s(t.status) as DemoTicket["status"],
    title: s(t.title),
    createdAt: day(t.created_at),
    slaDueAt: t.sla_due_at ? day(t.sla_due_at) : null,
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
  const scopeLabel = (type: string, id: string): string => {
    if (type === "lease") return labelOfLease(id);
    if (type === "unit") return labelOfUnit(id);
    if (type === "property") return propertyIndex.get(id)?.name ?? "";
    if (type === "contact") return contactIndex.get(id)?.name ?? "";
    return "";
  };
  const CONVERSATIONS: DemoConversation[] = conversationRows.map((c) => {
    const msgs = messagesByConv.get(s(c.id)) ?? [];
    return {
      id: s(c.id),
      subject: s(c.subject),
      scopeLabel: scopeLabel(s(c.scope_type), s(c.scope_id)),
      lastMessageAt: s(c.last_message_at),
      unread: msgs.filter((m) => !m.read_at && s(m.sender_kind) !== "manager").length,
      messages: msgs.map((m) => ({
        from:
          contactIndex.get(s(m.sender_contact_id))?.name ??
          (s(m.sender_kind) === "manager" ? org.name : "Système"),
        kind: (["tenant", "manager", "owner", "artisan", "system"].includes(s(m.sender_kind))
          ? s(m.sender_kind)
          : "system") as DemoConversation["messages"][number]["kind"],
        body: s(m.body),
        at: s(m.sent_at),
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
