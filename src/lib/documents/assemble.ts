import "server-only";
import type { OrgContext } from "@/lib/gestion/api";
import { formatAddress, type PropertyAddress } from "@/lib/gestion/address";
import { loadSettlement } from "@/lib/gestion/deposit-settlement";
import type { DocumentKind, SourceType } from "./kinds";
import { KIND_SOURCE } from "./kinds";
import type { ComposeInput, KindData, Lessor, OpenPeriod, Place } from "./model";
import { postalAddress, type LessorSettings } from "./settings-rules";

/**
 * From the rows a document is about to the data its template fills: read
 * under the caller's token, table by table, so a source id that is not
 * the workspace's answers "not found" and nothing else. Every figure comes
 * from a row or an engine; nothing is typed in here.
 */
type Row = Record<string, unknown>;
const s = (v: unknown): string => (typeof v === "string" ? v : "");
const n = (v: unknown): number => (typeof v === "number" ? v : Number(v) || 0);
const day = (v: unknown): string => s(v).slice(0, 10);

export interface Assembled {
  input: Omit<ComposeInput, "lang" | "reference">;
  /** The tenancy the document hangs off in the register. */
  leaseId: string;
  source: { type: SourceType; id: string };
  /** What the register's file name ends with: a month, a year, a date. */
  nameSuffix: string;
  /** The data the document was made from, hashed and kept with it. */
  payload: unknown;
  /** Whether this kind prints payment instructions (and so needs them set). */
  needsPayment: boolean;
}

export type AssembleFailure =
  | { error: "not_found" }
  | { error: "not_ready"; reason: string }
  | { error: "storage_failed"; context: string; detail: { code?: string; message?: string } | null };

export const NEEDS_PAYMENT: Record<DocumentKind, boolean> = {
  rent_notice: true,
  rent_receipt: false,
  arrears_formal: true,
  arrears_mise_en_demeure: true,
  indexation_notice: false,
  charges_statement: false,
  deposit_settlement: false,
  lease_contract: false,
  housing_certificate: false,
  edl_report: false,
};

/** The settings row as the documents print it. */
export function lessorOf(row: Row | null, fallbackName: string): { lessor: Lessor; settings: LessorSettings } {
  const settings: LessorSettings = {
    legalName: s(row?.legal_name),
    signatoryName: s(row?.signatory_name),
    addressStreet: s(row?.address_street),
    addressNumber: s(row?.address_number),
    postalCode: s(row?.postal_code),
    city: s(row?.city),
    country: s(row?.country) || "LU",
    email: s(row?.email),
    phone: s(row?.phone),
    iban: s(row?.iban),
    bic: s(row?.bic),
    holderName: s(row?.holder_name),
    documentLang: (["fr", "en", "de", "lu"].includes(s(row?.document_lang)) ? s(row?.document_lang) : "fr") as LessorSettings["documentLang"],
  };
  return {
    settings,
    lessor: {
      legalName: settings.legalName || fallbackName,
      signatoryName: settings.signatoryName,
      addressLine: postalAddress(settings),
      city: settings.city,
      email: settings.email,
      phone: settings.phone,
      iban: settings.iban,
      bic: settings.bic,
      holderName: settings.holderName || settings.legalName,
    },
  };
}

export async function readSettings(ctx: OrgContext): Promise<Row | null> {
  const { data, error } = await ctx.g.from("workspace_settings").select("*").eq("org_id", ctx.org.id).maybeSingle();
  if (error) {
    console.error("settings read failed:", error.code, error.message);
    return null;
  }
  return (data as Row | null) ?? null;
}

const contactName = (c: Row): string => s(c.display_name) || s(c.legal_name) || [s(c.first_name), s(c.last_name)].filter(Boolean).join(" ");

interface Tenancy {
  lease: Row;
  unit: Row;
  property: Row;
  tenants: Array<{ id: string; name: string; email: string | null }>;
  place: Place;
}

async function tenancy(ctx: OrgContext, leaseId: string): Promise<Tenancy | AssembleFailure> {
  const { g, org } = ctx;
  const { data: lease, error: leaseErr } = await g
    .from("leases")
    .select("id,unit_id,lease_type,status,start_date,end_date,rent_cents,charges_cents,charges_regime,payment_day,rf_reference,furnished,furniture_supplement_cents,colocation,capital_investi,last_adjustment_on,previous_rent_cents,details")
    .eq("org_id", org.id)
    .eq("id", leaseId)
    .maybeSingle();
  if (leaseErr) return { error: "storage_failed", context: "lease lookup", detail: leaseErr };
  if (!lease) return { error: "not_found" };
  const { data: unit, error: unitErr } = await g.from("units").select("id,property_id,label,floor,area_sqm,rooms,bedrooms,furnished").eq("org_id", org.id).eq("id", s(lease.unit_id)).maybeSingle();
  if (unitErr) return { error: "storage_failed", context: "unit lookup", detail: unitErr };
  if (!unit) return { error: "not_found" };
  const [{ data: property, error: propErr }, { data: parties, error: partyErr }] = await Promise.all([
    g.from("properties").select("id,name,address,commune,energy_class,cadastral_commune,cadastral_section,cadastral_number").eq("org_id", org.id).eq("id", s(unit.property_id)).maybeSingle(),
    g.from("lease_parties").select("contact_id,role,moved_out_on").eq("org_id", org.id).eq("lease_id", leaseId),
  ]);
  if (propErr) return { error: "storage_failed", context: "property lookup", detail: propErr };
  if (partyErr) return { error: "storage_failed", context: "parties lookup", detail: partyErr };
  if (!property) return { error: "not_found" };
  const tenantIds = ((parties ?? []) as Row[]).filter((p) => s(p.role) === "tenant" && !p.moved_out_on).map((p) => s(p.contact_id));
  const { data: contacts, error: contactErr } = tenantIds.length > 0
    ? await g.from("contacts").select("id,display_name,legal_name,first_name,last_name,email").eq("org_id", org.id).in("id", tenantIds)
    : { data: [], error: null };
  if (contactErr) return { error: "storage_failed", context: "contacts lookup", detail: contactErr };
  const byId = new Map(((contacts ?? []) as Row[]).map((c) => [s(c.id), c]));
  const tenants = tenantIds.map((id) => byId.get(id)).filter((c): c is Row => Boolean(c)).map((c) => ({ id: s(c.id), name: contactName(c), email: s(c.email) || null }));
  const address = formatAddress((property.address as PropertyAddress | null) ?? null);
  return {
    lease: lease as Row,
    unit: unit as Row,
    property: property as Row,
    tenants,
    place: { unitLabel: `${s(unit.label)} · ${s(property.name)}`, propertyName: s(property.name), propertyAddress: address },
  };
}

const isFailure = (v: unknown): v is AssembleFailure => typeof v === "object" && v !== null && "error" in v;

async function periodRow(ctx: OrgContext, periodId: string): Promise<{ period: Row; allocated: number; status: string } | AssembleFailure> {
  const { g, org } = ctx;
  const [{ data: period, error: pErr }, { data: st, error: sErr }] = await Promise.all([
    g.from("rent_periods").select("id,lease_id,period,due_date,rent_cents,charges_cents,other_cents,other_label,vat_cents,total_cents").eq("org_id", org.id).eq("id", periodId).maybeSingle(),
    g.from("rent_period_status").select("id,allocated_cents,status").eq("org_id", org.id).eq("id", periodId).maybeSingle(),
  ]);
  if (pErr) return { error: "storage_failed", context: "rent period lookup", detail: pErr };
  if (sErr) return { error: "storage_failed", context: "rent period status lookup", detail: sErr };
  if (!period) return { error: "not_found" };
  return { period: period as Row, allocated: n(st?.allocated_cents), status: s(st?.status) };
}

async function openPeriodsOf(ctx: OrgContext, leaseId: string): Promise<OpenPeriod[] | AssembleFailure> {
  const { g, org } = ctx;
  const { data: statuses, error: sErr } = await g.from("rent_period_status").select("id,allocated_cents,status").eq("org_id", org.id).eq("lease_id", leaseId).in("status", ["late", "partial_late", "partial", "pending"]);
  if (sErr) return { error: "storage_failed", context: "open periods lookup", detail: sErr };
  const ids = ((statuses ?? []) as Row[]).map((r) => s(r.id));
  if (ids.length === 0) return [];
  const { data: rows, error: pErr } = await g.from("rent_periods").select("id,period,due_date,total_cents").eq("org_id", org.id).in("id", ids).order("period");
  if (pErr) return { error: "storage_failed", context: "open periods rows", detail: pErr };
  const allocated = new Map(((statuses ?? []) as Row[]).map((r) => [s(r.id), n(r.allocated_cents)]));
  return ((rows ?? []) as Row[])
    .map((r) => ({ period: day(r.period).slice(0, 7), dueDate: day(r.due_date), totalCents: n(r.total_cents), openCents: n(r.total_cents) - (allocated.get(s(r.id)) ?? 0) }))
    .filter((r) => r.openCents > 0);
}

export async function assemble(ctx: OrgContext, kind: DocumentKind, sourceId: string, today: string): Promise<Assembled | AssembleFailure> {
  const { g, org } = ctx;
  const settingsRow = await readSettings(ctx);
  const { lessor } = lessorOf(settingsRow, org.name);
  const done = (leaseId: string, t: Tenancy, data: KindData[DocumentKind], nameSuffix: string, on: string): Assembled => ({
    input: { kind, lessor, tenants: t.tenants.map((x) => x.name), place: t.place, on, data },
    leaseId,
    source: { type: KIND_SOURCE[kind], id: sourceId },
    nameSuffix,
    payload: { kind, leaseId, sourceId, on, lessor, tenants: t.tenants, place: t.place, data },
    needsPayment: NEEDS_PAYMENT[kind],
  });

  switch (kind) {
    case "rent_notice":
    case "rent_receipt": {
      const found = await periodRow(ctx, sourceId);
      if (isFailure(found)) return found;
      const t = await tenancy(ctx, s(found.period.lease_id));
      if (isFailure(t)) return t;
      const period = day(found.period.period).slice(0, 7);
      if (kind === "rent_notice") {
        const data: KindData["rent_notice"] = {
          period,
          dueDate: day(found.period.due_date),
          rentCents: n(found.period.rent_cents),
          chargesCents: n(found.period.charges_cents),
          otherCents: n(found.period.other_cents),
          otherLabel: s(found.period.other_label) || null,
          vatCents: n(found.period.vat_cents),
          totalCents: n(found.period.total_cents),
          allocatedCents: found.allocated,
          rfReference: s(t.lease.rf_reference) || null,
        };
        return done(s(found.period.lease_id), t, data, period, today);
      }
      if (found.allocated < n(found.period.total_cents)) return { error: "not_ready", reason: "unpaid" };
      const { data: allocs, error: aErr } = await g.from("payment_allocations").select("payment_id,amount_cents,reversed_at").eq("org_id", org.id).eq("rent_period_id", sourceId);
      if (aErr) return { error: "storage_failed", context: "allocations lookup", detail: aErr };
      const live = ((allocs ?? []) as Row[]).filter((a) => !a.reversed_at);
      const paymentIds = [...new Set(live.map((a) => s(a.payment_id)).filter(Boolean))];
      const { data: payments, error: payErr } = paymentIds.length > 0 ? await g.from("payments").select("id,received_on").eq("org_id", org.id).in("id", paymentIds) : { data: [], error: null };
      if (payErr) return { error: "storage_failed", context: "payments lookup", detail: payErr };
      const receivedOn = new Map(((payments ?? []) as Row[]).map((p) => [s(p.id), day(p.received_on)]));
      const data: KindData["rent_receipt"] = {
        period,
        totalCents: n(found.period.total_cents),
        allocations: live.map((a) => ({ on: receivedOn.get(s(a.payment_id)) || today, cents: n(a.amount_cents) })).sort((a, b) => a.on.localeCompare(b.on)),
      };
      return done(s(found.period.lease_id), t, data, period, today);
    }
    case "arrears_formal": {
      const { data: action, error } = await g.from("arrears_actions").select("id,lease_id,rent_period_id,stage,executed_at").eq("org_id", org.id).eq("id", sourceId).maybeSingle();
      if (error) return { error: "storage_failed", context: "arrears action lookup", detail: error };
      if (!action || s(action.stage) !== "formal") return { error: "not_found" };
      const found = await periodRow(ctx, s(action.rent_period_id));
      if (isFailure(found)) return found;
      const t = await tenancy(ctx, s(action.lease_id));
      if (isFailure(t)) return t;
      const open = await openPeriodsOf(ctx, s(action.lease_id));
      if (isFailure(open)) return open;
      const { data: steps } = await g.from("arrears_actions").select("stage,executed_at").eq("org_id", org.id).eq("rent_period_id", s(action.rent_period_id));
      const friendly = ((steps ?? []) as Row[]).find((x) => s(x.stage) === "friendly");
      const data: KindData["arrears_formal"] = {
        period: day(found.period.period).slice(0, 7),
        dueDate: day(found.period.due_date),
        totalCents: n(found.period.total_cents),
        openCents: n(found.period.total_cents) - found.allocated,
        on: today,
        friendlyOn: friendly ? day(friendly.executed_at) : null,
        formalOn: null,
        rfReference: s(t.lease.rf_reference) || null,
        openPeriods: open,
      };
      return done(s(action.lease_id), t, data, day(found.period.period).slice(0, 7), today);
    }
    case "arrears_mise_en_demeure":
    case "indexation_notice": {
      const { data: letter, error } = await g.from("registered_letters").select("id,template_key,related_type,related_id,dispatched_on,content").eq("org_id", org.id).eq("id", sourceId).maybeSingle();
      if (error) return { error: "storage_failed", context: "letter lookup", detail: error };
      if (!letter) return { error: "not_found" };
      const content = (letter.content ?? null) as Row | null;
      if (kind === "indexation_notice") {
        if (s(letter.template_key) !== "rent_adjustment" || s(letter.related_type) !== "lease") return { error: "not_found" };
        if (!content) return { error: "not_ready", reason: "no_content" };
        const t = await tenancy(ctx, s(letter.related_id));
        if (isFailure(t)) return t;
        const dispatchedOn = day(letter.dispatched_on) || day(content.dispatchedOn) || today;
        const data: KindData["indexation_notice"] = {
          dispatchedOn,
          currentRentCents: n(content.currentRentCents),
          proposedRentCents: n(content.proposedRentCents),
          ceilingMonthlyCents: n(content.ceilingMonthlyCents),
          bindingConstraint: s(content.bindingConstraint),
          lastAdjustmentOn: s(t.lease.last_adjustment_on) ? day(t.lease.last_adjustment_on) : null,
          leaseStartDate: day(t.lease.start_date),
        };
        return done(s(letter.related_id), t, data, dispatchedOn, dispatchedOn);
      }
      if (s(letter.template_key) !== "mise_en_demeure" || s(letter.related_type) !== "rent_period") return { error: "not_found" };
      const found = await periodRow(ctx, s(letter.related_id));
      if (isFailure(found)) return found;
      const leaseId = s(found.period.lease_id);
      const t = await tenancy(ctx, leaseId);
      if (isFailure(t)) return t;
      const dispatchedOn = day(letter.dispatched_on) || today;
      // The snapshot taken at dispatch when there is one; the rows as they stand otherwise.
      let openPeriods: OpenPeriod[];
      let friendlyOn: string | null;
      let formalOn: string | null;
      let openCents: number;
      if (content && Array.isArray(content.openPeriods)) {
        openPeriods = (content.openPeriods as Row[]).map((r) => ({ period: s(r.period), dueDate: s(r.dueDate), totalCents: n(r.totalCents), openCents: n(r.openCents) }));
        friendlyOn = s(content.friendlyOn) || null;
        formalOn = s(content.formalOn) || null;
        openCents = n(content.openCents);
      } else {
        const open = await openPeriodsOf(ctx, leaseId);
        if (isFailure(open)) return open;
        openPeriods = open;
        const { data: steps } = await g.from("arrears_actions").select("stage,executed_at").eq("org_id", org.id).eq("rent_period_id", s(letter.related_id));
        const stepOn = (stage: string) => ((steps ?? []) as Row[]).find((x) => s(x.stage) === stage);
        friendlyOn = stepOn("friendly") ? day(stepOn("friendly")!.executed_at) : null;
        formalOn = stepOn("formal") ? day(stepOn("formal")!.executed_at) : null;
        openCents = n(found.period.total_cents) - found.allocated;
      }
      const data: KindData["arrears_mise_en_demeure"] = {
        period: day(found.period.period).slice(0, 7),
        dueDate: day(found.period.due_date),
        totalCents: n(found.period.total_cents),
        openCents,
        on: dispatchedOn,
        friendlyOn,
        formalOn,
        rfReference: s(t.lease.rf_reference) || null,
        openPeriods,
      };
      return done(leaseId, t, data, day(found.period.period).slice(0, 7), dispatchedOn);
    }
    case "charges_statement": {
      const { data: cp, error } = await g.from("charge_periods").select("id,lease_id,year,regime,status,advances_billed_cents,actual_cents,issued_on,due_on").eq("org_id", org.id).eq("id", sourceId).maybeSingle();
      if (error) return { error: "storage_failed", context: "charge period lookup", detail: error };
      if (!cp) return { error: "not_found" };
      const t = await tenancy(ctx, s(cp.lease_id));
      if (isFailure(t)) return t;
      const { data: lines, error: lErr } = await g.from("charge_lines").select("id,label,category,building_total_cents,tantiemes,tantiemes_total,lot_share_cents,tenant_share_cents,blocked").eq("org_id", org.id).eq("charge_period_id", sourceId).order("created_at");
      if (lErr) return { error: "storage_failed", context: "charge lines lookup", detail: lErr };
      const rows = (lines ?? []) as Row[];
      const actual = n(cp.actual_cents);
      const advances = n(cp.advances_billed_cents);
      const data: KindData["charges_statement"] = {
        year: n(cp.year),
        regime: s(cp.regime) || s(t.lease.charges_regime) || "advances",
        issuedOn: cp.issued_on ? day(cp.issued_on) : null,
        dueOn: cp.due_on ? day(cp.due_on) : null,
        lines: rows.map((l) => ({
          label: s(l.label),
          category: s(l.category),
          buildingTotalCents: l.building_total_cents === null || l.building_total_cents === undefined ? null : n(l.building_total_cents),
          tantiemes: l.tantiemes === null || l.tantiemes === undefined ? null : n(l.tantiemes),
          tantiemesTotal: l.tantiemes_total === null || l.tantiemes_total === undefined ? null : n(l.tantiemes_total),
          lotShareCents: n(l.lot_share_cents),
          tenantShareCents: n(l.tenant_share_cents),
          blocked: l.blocked === true,
        })),
        actualCents: actual,
        blockedCents: rows.filter((l) => l.blocked === true).reduce((a, l) => a + n(l.lot_share_cents), 0),
        advancesCents: advances,
        balanceCents: actual - advances,
      };
      return done(s(cp.lease_id), t, data, String(n(cp.year)), today);
    }
    case "deposit_settlement": {
      const loaded = await loadSettlement(ctx, sourceId, today);
      if ("error" in loaded) return loaded.error === "not_found" ? { error: "not_found" } : { error: "storage_failed", context: loaded.context, detail: loaded.detail };
      if (!loaded.settlement || !loaded.deposit.keyHandoverOn) return { error: "not_ready", reason: "keys_out" };
      const t = await tenancy(ctx, loaded.deposit.leaseId);
      if (isFailure(t)) return t;
      const r = loaded.settlement;
      const data: KindData["deposit_settlement"] = {
        depositCents: loaded.deposit.amountCents,
        form: loaded.deposit.form,
        receivedOn: loaded.deposit.receivedOn,
        keyHandoverOn: loaded.deposit.keyHandoverOn,
        decompteIssuedOn: loaded.deposit.decompteIssuedOn,
        lines: r.lines.map((l) => ({ kind: l.kind, label: l.label, amountCents: l.amount, status: l.status, retainedCents: l.retained, justifiedOn: l.justifiedAt ?? null, deadline: l.justificationDeadline })),
        totalRetainedCents: r.totalRetained,
        firstTrancheCents: r.firstTrancheAmount,
        firstTrancheDueOn: r.firstTrancheDueAt,
        balanceCents: r.balanceAmount,
        balanceDueOn: r.balanceDueAt,
        releasedFirstTrancheCents: loaded.deposit.releasedFirstTrancheCents,
        releasedBalanceCents: loaded.deposit.releasedBalanceCents,
        outstandingCents: r.outstandingToTenant,
        penaltyMonths: r.penaltyMonths,
        penaltyCents: r.penaltyAccrued,
      };
      return done(loaded.deposit.leaseId, t, data, today, today);
    }
    case "lease_contract":
    case "housing_certificate": {
      const t = await tenancy(ctx, sourceId);
      if (isFailure(t)) return t;
      if (kind === "housing_certificate") {
        const data: KindData["housing_certificate"] = { tenants: t.tenants.map((x) => x.name), startDate: day(t.lease.start_date), endDate: t.lease.end_date ? day(t.lease.end_date) : null };
        return done(sourceId, t, data, today, today);
      }
      const { data: dep } = await g.from("deposits").select("form,amount_cents").eq("org_id", org.id).eq("lease_id", sourceId).order("created_at", { ascending: false }).limit(1).maybeSingle();
      const details = (t.lease.details ?? {}) as Row;
      const rent = n(t.lease.rent_cents);
      const depositCents = dep ? n(dep.amount_cents) : typeof details.depositMonths === "number" ? rent * details.depositMonths : 0;
      const depositMonths = typeof details.depositMonths === "number" ? details.depositMonths : rent > 0 && depositCents > 0 ? Math.max(1, Math.round(depositCents / rent)) : 0;
      const components = Array.isArray(t.lease.capital_investi) ? (t.lease.capital_investi as Row[]) : [];
      const cadastral = [s(t.property.cadastral_commune), s(t.property.cadastral_section), s(t.property.cadastral_number)].filter(Boolean).join(" ");
      const data: KindData["lease_contract"] = {
        leaseType: s(t.lease.lease_type) === "commercial" ? "commercial" : "residential",
        startDate: day(t.lease.start_date),
        endDate: t.lease.end_date ? day(t.lease.end_date) : null,
        rentCents: rent,
        chargesCents: n(t.lease.charges_cents),
        chargesRegime: s(t.lease.charges_regime) || "advances",
        paymentDay: n(t.lease.payment_day) || 1,
        rfReference: s(t.lease.rf_reference) || null,
        depositMonths,
        depositCents,
        depositForm: dep ? s(dep.form) : s(details.depositForm) || "cash",
        furnished: t.lease.furnished === true || t.unit.furnished === true,
        furnitureSupplementCents: n(t.lease.furniture_supplement_cents),
        colocation: t.lease.colocation === true,
        capitalComponents: components.map((c) => ({ year: n(c.year), cents: n(c.amount ?? c.cents), kind: s(c.kind) })),
        tenants: t.tenants.map((x) => ({ name: x.name, email: x.email })),
        unit: { label: s(t.unit.label), floor: s(t.unit.floor) || null, areaSqm: n(t.unit.area_sqm), rooms: n(t.unit.rooms), bedrooms: t.unit.bedrooms === null || t.unit.bedrooms === undefined ? null : n(t.unit.bedrooms) },
        energyClass: s(t.property.energy_class) || null,
        cadastral: cadastral || null,
      };
      return done(sourceId, t, data, day(t.lease.start_date), today);
    }
    case "edl_report": {
      const { data: session, error } = await g.from("edl_sessions").select("id,lease_id,kind,status,completed_at,key_handover_at,hash_manifest_sha256").eq("org_id", org.id).eq("id", sourceId).maybeSingle();
      if (error) return { error: "storage_failed", context: "inventory lookup", detail: error };
      if (!session) return { error: "not_found" };
      if (!s(session.hash_manifest_sha256)) return { error: "not_ready", reason: "unsealed" };
      const t = await tenancy(ctx, s(session.lease_id));
      if (isFailure(t)) return t;
      const { data: items, error: iErr } = await g.from("edl_items").select("id,room,category,condition,notes").eq("org_id", org.id).eq("session_id", sourceId);
      if (iErr) return { error: "storage_failed", context: "inventory items lookup", detail: iErr };
      const itemRows = (items ?? []) as Row[];
      const itemIds = itemRows.map((i) => s(i.id));
      const { data: media, error: mErr } = itemIds.length > 0 ? await g.from("edl_media").select("id,item_id,sha256,captured_at").eq("org_id", org.id).in("item_id", itemIds) : { data: [], error: null };
      if (mErr) return { error: "storage_failed", context: "inventory media lookup", detail: mErr };
      const mediaRows = (media ?? []) as Row[];
      const completed = session.completed_at ? day(session.completed_at) : null;
      const { data: meters } = await g.from("meters").select("id,kind,serial_number").eq("org_id", org.id).eq("property_id", s(t.unit.property_id));
      const meterRows = (meters ?? []) as Row[];
      const { data: readings } = completed && meterRows.length > 0
        ? await g.from("meter_readings").select("meter_id,read_on,value").eq("org_id", org.id).eq("source", "edl").eq("read_on", completed).in("meter_id", meterRows.map((m) => s(m.id)))
        : { data: [] };
      const meterLabel = new Map(meterRows.map((m) => [s(m.id), [s(m.kind), s(m.serial_number)].filter(Boolean).join(" ")]));
      const byItem = new Map<string, Row[]>();
      for (const m of mediaRows) {
        const list = byItem.get(s(m.item_id)) ?? [];
        list.push(m);
        byItem.set(s(m.item_id), list);
      }
      const roomsOrder = [...new Set(itemRows.map((i) => s(i.room)))];
      const itemIndex = new Map(itemRows.map((i) => [s(i.id), i]));
      const data: KindData["edl_report"] = {
        kind: s(session.kind),
        completedAt: completed,
        keyHandoverAt: session.key_handover_at ? day(session.key_handover_at) : null,
        signed: ["signed", "sealed"].includes(s(session.status)),
        manifestSha256: s(session.hash_manifest_sha256),
        rooms: roomsOrder.map((room) => ({
          room,
          items: itemRows.filter((i) => s(i.room) === room).map((i) => ({ category: s(i.category), condition: s(i.condition), notes: s(i.notes), photos: (byItem.get(s(i.id)) ?? []).length })),
        })),
        readings: ((readings ?? []) as Row[]).map((r) => ({ meter: meterLabel.get(s(r.meter_id)) ?? s(r.meter_id), value: String(r.value ?? ""), readOn: day(r.read_on) })),
        photos: mediaRows
          .map((m) => ({ item: itemIndex.get(s(m.item_id)), capturedAt: s(m.captured_at), sha256: s(m.sha256) }))
          .filter((p) => p.item)
          .map((p) => ({ room: s(p.item!.room), category: s(p.item!.category), capturedAt: p.capturedAt, sha256: p.sha256 })),
        tenants: t.tenants.map((x) => x.name),
      };
      return done(s(session.lease_id), t, data, completed ?? today, completed ?? today);
    }
  }
  return { error: "not_found" };
}
