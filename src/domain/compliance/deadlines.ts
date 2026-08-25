/**
 * Compliance calendar — deadlines auto-generated from data (strategy §3.5).
 * Every generator returns typed deadline objects; the calendar screen and the
 * notification engine consume them uniformly.
 */

import { ISODate, addDays, addMonths, addYears, diffDays } from "@/domain/dates";
import { getParamValue } from "@/domain/legal/params";

export type DeadlineKind =
  | "cpe_expiry"
  | "commune_arrival_declaration"
  | "commune_departure_declaration"
  | "smoke_detector_check"
  | "rc_locative_renewal"
  | "manager_pi_insurance"
  | "syndic_mandate_expiry"
  | "ag_convocation"
  | "boiler_service"
  | "decompte_issuance"
  | "deposit_first_tranche"
  | "deposit_balance"
  | "deposit_justification"
  | "renewal_request_window"
  | "landlord_answer"
  | "preemption_window"
  | "defect_window_end"
  | "inol_vacancy_trigger"
  | "licence_expiry";

export type DeadlineStatus = "upcoming" | "due_soon" | "overdue" | "done";

export interface Deadline {
  kind: DeadlineKind;
  label: string;
  dueAt: ISODate;
  relatedLabel: string;
  legalBasis: string;
  severity: "info" | "action" | "critical";
}

export function deadlineStatus(d: Deadline, asOf: ISODate, doneAt?: ISODate | null): DeadlineStatus {
  if (doneAt) return "done";
  const days = diffDays(asOf, d.dueAt);
  if (days < 0) return "overdue";
  if (days <= 30) return "due_soon";
  return "upcoming";
}

// ── Generators ──────────────────────────────────────────────────────────────

export function cpeExpiryDeadline(propertyLabel: string, cpeIssuedAt: ISODate): Deadline {
  const years = getParamValue("compliance.cpe_validity_years", cpeIssuedAt);
  return {
    kind: "cpe_expiry",
    label: "CPE (energy passport) expires, class must appear in every ad; the listing builder fails closed without it",
    dueAt: addYears(cpeIssuedAt, years),
    relatedLabel: propertyLabel,
    legalBasis: `CPE ${years}-year validity`,
    severity: "action",
  };
}

export function communeArrivalDeadline(tenantLabel: string, moveInDate: ISODate): Deadline {
  const days = getParamValue("compliance.commune_arrival_declaration_days", moveInDate);
  return {
    kind: "commune_arrival_declaration",
    label: `Tenant must declare arrival at the commune within ${days} days of moving in`,
    dueAt: addDays(moveInDate, days),
    relatedLabel: tenantLabel,
    legalBasis: "Déclaration d'arrivée, obligation within 8 days",
    severity: "action",
  };
}

export function communeDepartureDeadline(tenantLabel: string, moveOutDate: ISODate): Deadline {
  return {
    kind: "commune_departure_declaration",
    label: "Tenant departure declaration at the commune, due the day before leaving",
    dueAt: addDays(moveOutDate, -1),
    relatedLabel: tenantLabel,
    legalBasis: "Déclaration de départ",
    severity: "info",
  };
}

export function syndicMandateDeadline(syndicatLabel: string, mandateStart: ISODate): Deadline {
  const years = getParamValue("syndic.mandate_max_years", mandateStart);
  return {
    kind: "syndic_mandate_expiry",
    label: `Syndic mandate expires (max ${years} years, renewable), schedule the AG vote`,
    dueAt: addYears(mandateStart, years),
    relatedLabel: syndicatLabel,
    legalBasis: "RGD 13.6.1975 art. 18",
    severity: "critical",
  };
}

export function agConvocationDeadline(syndicatLabel: string, agDate: ISODate, isRepeat: boolean): Deadline {
  const days = isRepeat
    ? getParamValue("syndic.ag_repeat_convocation_min_days", agDate)
    : getParamValue("syndic.ag_convocation_min_days", agDate);
  return {
    kind: "ag_convocation",
    label: `AG convocations must be dispatched (≥ ${days} days before the assembly${isRepeat ? ", repeat assembly" : ""})`,
    dueAt: addDays(agDate, -days),
    relatedLabel: syndicatLabel,
    legalBasis: `RGD 13.6.1975 art. ${isRepeat ? "11" : "3"}`,
    severity: "critical",
  };
}

export function licenceExpiryDeadline(orgLabel: string, expiry: ISODate, what: string): Deadline {
  return {
    kind: "licence_expiry",
    label: `${what} expires, escalating alarm`,
    dueAt: expiry,
    relatedLabel: orgLabel,
    legalBasis: "Loi du 2.9.2011, autorisation d'établissement + mandatory PI insurance",
    severity: "critical",
  };
}

export function defectWindowEnd(unitLabel: string, keyHandover: ISODate, windowDays?: number): Deadline {
  const days = windowDays ?? getParamValue("compliance.defect_window_default_days", keyHandover);
  return {
    kind: "defect_window_end",
    label: `Move-in defect window closes (${days} days after key handover)`,
    dueAt: addDays(keyHandover, days),
    relatedLabel: unitLabel,
    legalBasis: "Contractual defect window (configurable, not statutory)",
    severity: "info",
  };
}

export interface VacancyClock {
  unitLabel: string;
  vacantSince: ISODate;
  monthsVacant: number;
  inolTriggerAt: ISODate;
  triggered: boolean;
  projectedTaxYear1Eur: number;
  note: string;
}

/**
 * INOL vacancy clock — the reform is [U] (adoption unconfirmed), but the
 * evidence trail must be built NOW: if enacted, 6+ months' continuous vacancy
 * per dwelling becomes a tax trigger (€3,000 year 1 → +€900/yr, cap €7,500).
 */
export function vacancyClock(unitLabel: string, vacantSince: ISODate, asOf: ISODate): VacancyClock {
  const triggerMonths = getParamValue("inol.trigger_vacancy_months", asOf);
  const inolTriggerAt = addMonths(vacantSince, triggerMonths);
  const monthsVacant = Math.max(0, Math.floor(diffDays(vacantSince, asOf) / 30.44));
  return {
    unitLabel,
    vacantSince,
    monthsVacant,
    inolTriggerAt,
    triggered: asOf >= inolTriggerAt,
    projectedTaxYear1Eur: getParamValue("inol.year1_eur", asOf),
    note: "INOL adoption status unconfirmed [U], the clock builds the defence file (marketing efforts, works, offers) regardless.",
  };
}
