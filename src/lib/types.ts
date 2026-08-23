/**
 * UI domain types + status metadata. Convention (Morada gestion):
 * every enum owns a meta map { label, color } where color is a Tailwind
 * `bg-{c}-100 text-{c}-800` pair fed straight into <Badge className>.
 * Exceptions: red → text-red-700, neutral → bg-neutral-200 text-neutral-600.
 *
 * Labels come from the active dictionary: metas are FACTORIES over Dict so
 * every language renders from the same colour system.
 */

import type { Dict } from "@/lib/i18n/fr";
import { INTL_LOCALE, type Locale } from "@/lib/i18n/config";

export type Meta = { label: string; color: string };

// ─── Status enums ───────────────────────────────────────────────────────────

export type RentStatus = "paid" | "partial" | "pending" | "upcoming" | "late" | "written_off";
export type LeaseStatus = "draft" | "active" | "notice" | "ended";
export type LeaseTypeUi = "residential" | "commercial";
export type BankTxStatus = "unmatched" | "auto" | "manual" | "review" | "ignored";
export type TicketStatus =
  | "new" | "triaged" | "offered" | "scheduled" | "in_progress"
  | "pending_tenant" | "done" | "closed" | "cancelled";
export type TicketSeverity = "routine" | "priority" | "urgent" | "emergency";
export type DepositStatus =
  | "pending" | "held" | "release_pending" | "partially_released"
  | "released" | "forfeited" | "disputed";
export type EdlStatus = "draft" | "in_progress" | "signed" | "sealed" | "contested";
export type DeadlineStatusUi = "upcoming" | "due_soon" | "overdue" | "done";
export type AmlTier = "light" | "full_cdd";
export type RiskBandUi = "low" | "medium" | "high";
export type ContactRole =
  | "owner" | "tenant" | "guarantor" | "artisan" | "supplier"
  | "notary" | "syndic" | "lead" | "other";
export type WorkflowKind = "move_in" | "in_tenancy" | "rent_cycle" | "move_out";
export type MeterKind = "electricity" | "gas" | "water_cold" | "water_hot" | "heat";

// ─── Colour system (language-independent) ───────────────────────────────────

const RENT_COLORS: Record<RentStatus, string> = {
  paid: "bg-emerald-100 text-emerald-800",
  partial: "bg-amber-100 text-amber-800",
  pending: "bg-sky-100 text-sky-800",
  upcoming: "bg-sand-100 text-ink-soft",
  late: "bg-red-100 text-red-700",
  written_off: "bg-neutral-200 text-neutral-600",
};

const LEASE_COLORS: Record<LeaseStatus, string> = {
  draft: "bg-amber-100 text-amber-800",
  active: "bg-emerald-100 text-emerald-800",
  notice: "bg-orange-100 text-orange-800",
  ended: "bg-neutral-200 text-neutral-600",
};

const LEASE_TYPE_COLORS: Record<LeaseTypeUi, string> = {
  residential: "bg-brand-100 text-brand-800",
  commercial: "bg-violet-100 text-violet-800",
};

const BANK_TX_COLORS: Record<BankTxStatus, string> = {
  unmatched: "bg-amber-100 text-amber-800",
  auto: "bg-emerald-100 text-emerald-800",
  manual: "bg-emerald-100 text-emerald-800",
  review: "bg-orange-100 text-orange-800",
  ignored: "bg-neutral-200 text-neutral-600",
};

const MATCH_TIER_COLORS: Record<string, string> = {
  rf: "bg-emerald-100 text-emerald-800",
  iban_binding: "bg-sky-100 text-sky-800",
  subset_sum: "bg-violet-100 text-violet-800",
  fuzzy: "bg-amber-100 text-amber-800",
  manual: "bg-sand-100 text-ink-soft",
};

const TICKET_COLORS: Record<TicketStatus, string> = {
  new: "bg-amber-100 text-amber-800",
  triaged: "bg-sky-100 text-sky-800",
  offered: "bg-violet-100 text-violet-800",
  scheduled: "bg-sky-100 text-sky-800",
  in_progress: "bg-brand-100 text-brand-800",
  pending_tenant: "bg-sand-100 text-ink-soft",
  done: "bg-emerald-100 text-emerald-800",
  closed: "bg-neutral-200 text-neutral-600",
  cancelled: "bg-neutral-200 text-neutral-600",
};

const SEVERITY_COLORS: Record<TicketSeverity, string> = {
  routine: "bg-sand-100 text-ink-soft",
  priority: "bg-sky-100 text-sky-800",
  urgent: "bg-amber-100 text-amber-800",
  emergency: "bg-red-100 text-red-700",
};

const DEPOSIT_COLORS: Record<DepositStatus, string> = {
  pending: "bg-amber-100 text-amber-800",
  held: "bg-sky-100 text-sky-800",
  release_pending: "bg-orange-100 text-orange-800",
  partially_released: "bg-amber-100 text-amber-800",
  released: "bg-emerald-100 text-emerald-800",
  forfeited: "bg-neutral-200 text-neutral-600",
  disputed: "bg-red-100 text-red-700",
};

const EDL_COLORS: Record<EdlStatus, string> = {
  draft: "bg-amber-100 text-amber-800",
  in_progress: "bg-sky-100 text-sky-800",
  signed: "bg-emerald-100 text-emerald-800",
  sealed: "bg-brand-100 text-brand-800",
  contested: "bg-red-100 text-red-700",
};

const DEADLINE_COLORS: Record<DeadlineStatusUi, string> = {
  upcoming: "bg-sand-100 text-ink-soft",
  due_soon: "bg-amber-100 text-amber-800",
  overdue: "bg-red-100 text-red-700",
  done: "bg-emerald-100 text-emerald-800",
};

const AML_TIER_COLORS: Record<AmlTier, string> = {
  light: "bg-sand-100 text-ink-soft",
  full_cdd: "bg-violet-100 text-violet-800",
};

const RISK_COLORS: Record<RiskBandUi, string> = {
  low: "bg-emerald-100 text-emerald-800",
  medium: "bg-amber-100 text-amber-800",
  high: "bg-red-100 text-red-700",
};

const ROLE_COLORS: Record<ContactRole, string> = {
  owner: "bg-brand-100 text-brand-800",
  tenant: "bg-sky-100 text-sky-800",
  guarantor: "bg-violet-100 text-violet-800",
  artisan: "bg-amber-100 text-amber-800",
  supplier: "bg-sand-100 text-ink-soft",
  notary: "bg-sand-100 text-ink-soft",
  syndic: "bg-sand-100 text-ink-soft",
  lead: "bg-emerald-100 text-emerald-800",
  other: "bg-sand-100 text-ink-soft",
};

// ─── Meta factories (labels from the dictionary) ────────────────────────────

function withLabels<K extends string>(
  colors: Record<K, string>,
  labels: Record<K, string>,
): Record<K, Meta> {
  const out = {} as Record<K, Meta>;
  for (const k of Object.keys(colors) as K[]) {
    out[k] = { label: labels[k], color: colors[k] };
  }
  return out;
}

export const rentStatusMeta = (d: Dict) => withLabels(RENT_COLORS, d.status.rent);
export const leaseStatusMeta = (d: Dict) => withLabels(LEASE_COLORS, d.status.lease);
export const leaseTypeMeta = (d: Dict) => withLabels(LEASE_TYPE_COLORS, d.status.leaseType);
export const bankTxStatusMeta = (d: Dict) => withLabels(BANK_TX_COLORS, d.status.bankTx);
export const matchTierMeta = (d: Dict) =>
  withLabels(MATCH_TIER_COLORS, d.status.matchTier as Record<string, string>);
export const ticketStatusMeta = (d: Dict) => withLabels(TICKET_COLORS, d.status.ticket);
export const ticketSeverityMeta = (d: Dict) => withLabels(SEVERITY_COLORS, d.status.severity);
export const depositStatusMeta = (d: Dict) => withLabels(DEPOSIT_COLORS, d.status.deposit);
export const edlStatusMeta = (d: Dict) => withLabels(EDL_COLORS, d.status.edl);
export const deadlineStatusMeta = (d: Dict) => withLabels(DEADLINE_COLORS, d.status.deadline);
export const amlTierMeta = (d: Dict) => withLabels(AML_TIER_COLORS, d.status.amlTier);
export const riskBandMeta = (d: Dict) => withLabels(RISK_COLORS, d.status.risk);
export const contactRoleMeta = (d: Dict) => withLabels(ROLE_COLORS, d.status.role);

export const depositFormLabels = (d: Dict) => d.status.depositForm;
export const workflowStateLabel = (d: Dict, state: string): string =>
  (d.status.workflowState as Record<string, string>)[state] ?? state;

export const WORKFLOW_STATES: Record<WorkflowKind, string[]> = {
  move_in: ["DRAFT", "MARKETING", "SCREENING", "LEASE", "PRE_MOVE_IN", "EDL", "DEFECT_WINDOW", "SETTLED"],
  in_tenancy: ["ACTIVE", "REQUEST", "TRIAGE", "DISPATCH", "RESOLVED"],
  rent_cycle: ["INVOICED", "COLLECTED", "MATCHED", "ALLOCATED", "OWNER_PAID"],
  move_out: ["NOTICE", "PRE_EXIT", "EDL", "SETTLEMENT", "CLOSE_OUT"],
};

export const METER_UNITS: Record<MeterKind, string> = {
  electricity: "kWh",
  gas: "m³",
  water_cold: "m³",
  water_hot: "m³",
  heat: "kWh",
};

// ─── Formatting (locale-aware; fr-LU default keeps engine tests stable) ─────

/** Cents in, localized currency out — "1 850,00 €" (fr) / "€1,850.00" (en). */
export function euros(cents: number | null | undefined, locale: Locale = "fr"): string {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString(INTL_LOCALE[locale], { style: "currency", currency: "EUR" });
}

/** Whole-euro display for KPIs. */
export function eurosWhole(cents: number | null | undefined, locale: Locale = "fr"): string {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString(INTL_LOCALE[locale], {
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

export function formatDate(iso: string | null | undefined, locale: Locale = "fr"): string {
  if (!iso) return "—";
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  return d.toLocaleDateString(INTL_LOCALE[locale], { day: "numeric", month: "short", year: "numeric" });
}

export function formatMonth(isoMonth: string, locale: Locale = "fr"): string {
  const d = new Date(isoMonth.length === 7 ? `${isoMonth}-01T00:00:00` : isoMonth + "T00:00:00");
  const s = d.toLocaleDateString(INTL_LOCALE[locale], { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function formatNumber(n: number, locale: Locale = "fr"): string {
  return n.toLocaleString(INTL_LOCALE[locale]);
}

export function formatPct(pct: number, locale: Locale = "fr"): string {
  const v = Math.round(pct * 10) / 10;
  // French typography keeps the space before %; EN drops it.
  return locale === "en" ? `${v.toLocaleString(INTL_LOCALE[locale])}%` : `${v.toLocaleString(INTL_LOCALE[locale])} %`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}
