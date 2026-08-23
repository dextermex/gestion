/**
 * UI domain types + status metadata. Convention (Morada gestion):
 * every enum owns a `*_META` map { label, color } where color is a Tailwind
 * `bg-{c}-100 text-{c}-800` pair fed straight into <Badge className>.
 * Exceptions: red → text-red-700, neutral → bg-neutral-200 text-neutral-600.
 */

export type Locale = "fr" | "en" | "de" | "lu" | "pt";

export type Meta = { label: string; color: string };

// ─── Rent ───────────────────────────────────────────────────────────────────

export type RentStatus = "paid" | "partial" | "pending" | "upcoming" | "late" | "written_off";

export const RENT_STATUS_META: Record<RentStatus, Meta> = {
  paid: { label: "Payé", color: "bg-emerald-100 text-emerald-800" },
  partial: { label: "Partiel", color: "bg-amber-100 text-amber-800" },
  pending: { label: "En attente", color: "bg-sky-100 text-sky-800" },
  upcoming: { label: "À venir", color: "bg-sand-100 text-ink-soft" },
  late: { label: "En retard", color: "bg-red-100 text-red-700" },
  written_off: { label: "Passé en perte", color: "bg-neutral-200 text-neutral-600" },
};

// ─── Leases ─────────────────────────────────────────────────────────────────

export type LeaseStatus = "draft" | "active" | "notice" | "ended";

export const LEASE_STATUS_META: Record<LeaseStatus, Meta> = {
  draft: { label: "Brouillon", color: "bg-amber-100 text-amber-800" },
  active: { label: "Actif", color: "bg-emerald-100 text-emerald-800" },
  notice: { label: "Préavis", color: "bg-orange-100 text-orange-800" },
  ended: { label: "Terminé", color: "bg-neutral-200 text-neutral-600" },
};

export type LeaseTypeUi = "residential" | "commercial";

export const LEASE_TYPE_META: Record<LeaseTypeUi, Meta> = {
  residential: { label: "Habitation", color: "bg-brand-100 text-brand-800" },
  commercial: { label: "Commercial", color: "bg-violet-100 text-violet-800" },
};

// ─── Banking / matching ─────────────────────────────────────────────────────

export type BankTxStatus = "unmatched" | "auto" | "manual" | "review" | "ignored";

export const BANK_TX_STATUS_META: Record<BankTxStatus, Meta> = {
  unmatched: { label: "À rapprocher", color: "bg-amber-100 text-amber-800" },
  auto: { label: "Auto", color: "bg-emerald-100 text-emerald-800" },
  manual: { label: "Manuel", color: "bg-emerald-100 text-emerald-800" },
  review: { label: "À vérifier", color: "bg-orange-100 text-orange-800" },
  ignored: { label: "Ignorée", color: "bg-neutral-200 text-neutral-600" },
};

export const MATCH_TIER_META: Record<string, Meta> = {
  rf: { label: "RF", color: "bg-emerald-100 text-emerald-800" },
  iban_binding: { label: "IBAN lié", color: "bg-sky-100 text-sky-800" },
  subset_sum: { label: "Multi-factures", color: "bg-violet-100 text-violet-800" },
  fuzzy: { label: "Score", color: "bg-amber-100 text-amber-800" },
  manual: { label: "Manuel", color: "bg-sand-100 text-ink-soft" },
};

// ─── Tickets / work orders ──────────────────────────────────────────────────

export type TicketStatus =
  | "new" | "triaged" | "offered" | "scheduled" | "in_progress"
  | "pending_tenant" | "done" | "closed" | "cancelled";

export const TICKET_STATUS_META: Record<TicketStatus, Meta> = {
  new: { label: "Nouveau", color: "bg-amber-100 text-amber-800" },
  triaged: { label: "Qualifié", color: "bg-sky-100 text-sky-800" },
  offered: { label: "Proposé", color: "bg-violet-100 text-violet-800" },
  scheduled: { label: "Planifié", color: "bg-sky-100 text-sky-800" },
  in_progress: { label: "En cours", color: "bg-brand-100 text-brand-800" },
  pending_tenant: { label: "Attente locataire", color: "bg-sand-100 text-ink-soft" },
  done: { label: "Terminé", color: "bg-emerald-100 text-emerald-800" },
  closed: { label: "Clôturé", color: "bg-neutral-200 text-neutral-600" },
  cancelled: { label: "Annulé", color: "bg-neutral-200 text-neutral-600" },
};

export type TicketSeverity = "routine" | "priority" | "urgent" | "emergency";

export const TICKET_SEVERITY_META: Record<TicketSeverity, Meta> = {
  routine: { label: "Routine", color: "bg-sand-100 text-ink-soft" },
  priority: { label: "Prioritaire", color: "bg-sky-100 text-sky-800" },
  urgent: { label: "Urgent", color: "bg-amber-100 text-amber-800" },
  emergency: { label: "Urgence", color: "bg-red-100 text-red-700" },
};

// ─── Deposits ───────────────────────────────────────────────────────────────

export type DepositStatus =
  | "pending" | "held" | "release_pending" | "partially_released"
  | "released" | "forfeited" | "disputed";

export const DEPOSIT_STATUS_META: Record<DepositStatus, Meta> = {
  pending: { label: "En attente", color: "bg-amber-100 text-amber-800" },
  held: { label: "Détenue", color: "bg-sky-100 text-sky-800" },
  release_pending: { label: "Restitution en cours", color: "bg-orange-100 text-orange-800" },
  partially_released: { label: "Partiellement restituée", color: "bg-amber-100 text-amber-800" },
  released: { label: "Restituée", color: "bg-emerald-100 text-emerald-800" },
  forfeited: { label: "Retenue", color: "bg-neutral-200 text-neutral-600" },
  disputed: { label: "Litige", color: "bg-red-100 text-red-700" },
};

export const DEPOSIT_FORM_LABELS: Record<string, string> = {
  cash: "Espèces / virement",
  bank_guarantee: "Garantie bancaire",
  third_party_caution: "Caution tierce",
  insurance: "Assurance garantie",
  state_guarantee: "Garantie étatique",
};

// ─── EDL ────────────────────────────────────────────────────────────────────

export type EdlStatus = "draft" | "in_progress" | "signed" | "sealed" | "contested";

export const EDL_STATUS_META: Record<EdlStatus, Meta> = {
  draft: { label: "Brouillon", color: "bg-amber-100 text-amber-800" },
  in_progress: { label: "En cours", color: "bg-sky-100 text-sky-800" },
  signed: { label: "Signé", color: "bg-emerald-100 text-emerald-800" },
  sealed: { label: "Scellé", color: "bg-brand-100 text-brand-800" },
  contested: { label: "Contesté", color: "bg-red-100 text-red-700" },
};

// ─── Compliance ─────────────────────────────────────────────────────────────

export type DeadlineStatusUi = "upcoming" | "due_soon" | "overdue" | "done";

export const DEADLINE_STATUS_META: Record<DeadlineStatusUi, Meta> = {
  upcoming: { label: "À venir", color: "bg-sand-100 text-ink-soft" },
  due_soon: { label: "Échéance proche", color: "bg-amber-100 text-amber-800" },
  overdue: { label: "En retard", color: "bg-red-100 text-red-700" },
  done: { label: "Fait", color: "bg-emerald-100 text-emerald-800" },
};

// ─── AML ────────────────────────────────────────────────────────────────────

export type AmlTier = "light" | "full_cdd";

export const AML_TIER_META: Record<AmlTier, Meta> = {
  light: { label: "Allégé", color: "bg-sand-100 text-ink-soft" },
  full_cdd: { label: "CDD complète", color: "bg-violet-100 text-violet-800" },
};

export type RiskBandUi = "low" | "medium" | "high";

export const RISK_BAND_META: Record<RiskBandUi, Meta> = {
  low: { label: "Risque faible", color: "bg-emerald-100 text-emerald-800" },
  medium: { label: "Risque moyen", color: "bg-amber-100 text-amber-800" },
  high: { label: "Risque élevé", color: "bg-red-100 text-red-700" },
};

// ─── Contacts ───────────────────────────────────────────────────────────────

export type ContactRole =
  | "owner" | "tenant" | "guarantor" | "artisan" | "supplier"
  | "notary" | "syndic" | "lead" | "other";

export const CONTACT_ROLE_META: Record<ContactRole, Meta> = {
  owner: { label: "Propriétaire", color: "bg-brand-100 text-brand-800" },
  tenant: { label: "Locataire", color: "bg-sky-100 text-sky-800" },
  guarantor: { label: "Garant", color: "bg-violet-100 text-violet-800" },
  artisan: { label: "Artisan", color: "bg-amber-100 text-amber-800" },
  supplier: { label: "Fournisseur", color: "bg-sand-100 text-ink-soft" },
  notary: { label: "Notaire", color: "bg-sand-100 text-ink-soft" },
  syndic: { label: "Syndic", color: "bg-sand-100 text-ink-soft" },
  lead: { label: "Prospect", color: "bg-emerald-100 text-emerald-800" },
  other: { label: "Autre", color: "bg-sand-100 text-ink-soft" },
};

// ─── Workflows ──────────────────────────────────────────────────────────────

export type WorkflowKind = "move_in" | "in_tenancy" | "rent_cycle" | "move_out";

export const WORKFLOW_KIND_META: Record<WorkflowKind, { label: string; states: string[] }> = {
  move_in: {
    label: "Mise en location",
    states: ["DRAFT", "MARKETING", "SCREENING", "LEASE", "PRE_MOVE_IN", "EDL", "DEFECT_WINDOW", "SETTLED"],
  },
  in_tenancy: {
    label: "Vie du bail",
    states: ["ACTIVE", "REQUEST", "TRIAGE", "DISPATCH", "RESOLVED"],
  },
  rent_cycle: {
    label: "Cycle loyer",
    states: ["INVOICED", "COLLECTED", "MATCHED", "ALLOCATED", "OWNER_PAID"],
  },
  move_out: {
    label: "Sortie",
    states: ["NOTICE", "PRE_EXIT", "EDL", "SETTLEMENT", "CLOSE_OUT"],
  },
};

// ─── Meters ─────────────────────────────────────────────────────────────────

export type MeterKind = "electricity" | "gas" | "water_cold" | "water_hot" | "heat";

export const METER_KIND_META: Record<MeterKind, { label: string; unit: string }> = {
  electricity: { label: "Électricité", unit: "kWh" },
  gas: { label: "Gaz", unit: "m³" },
  water_cold: { label: "Eau froide", unit: "m³" },
  water_hot: { label: "Eau chaude", unit: "m³" },
  heat: { label: "Chauffage", unit: "kWh" },
};

// ─── Formatting (fr-LU canonical) ───────────────────────────────────────────

/** Cents in, "1 850,00 €" out. */
export function euros(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString("fr-LU", { style: "currency", currency: "EUR" });
}

/** Whole-euro display for KPIs. */
export function eurosWhole(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString("fr-LU", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });
}

export function toCents(input: string): number | null {
  const clean = input.replace(/\s/g, "").replace(",", ".");
  if (!clean) return null;
  const value = Number(clean);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  return d.toLocaleDateString("fr-LU", { day: "numeric", month: "short", year: "numeric" });
}

export function formatMonth(isoMonth: string): string {
  const d = new Date(isoMonth.length === 7 ? `${isoMonth}-01T00:00:00` : isoMonth + "T00:00:00");
  const s = d.toLocaleDateString("fr-LU", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function formatPct(pct: number): string {
  return `${Math.round(pct * 10) / 10} %`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}
