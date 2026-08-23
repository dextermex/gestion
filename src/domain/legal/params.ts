/**
 * The legal-parameter registry.
 *
 * Architecture rule (Morada Gestion strategy §2.2): every legal constant is
 * DATA with an effective-date range and a verification status — never a
 * hard-coded literal inside an engine. A legislative change is a row update
 * (in production: the `legal_params` table, seeded from this file), not a
 * release.
 *
 * Verification statuses mirror the research briefs:
 *  - "verified"  — confirmed against an official Luxembourg source [V]
 *  - "uncertain" — unverified or in flux [U]; engines that consume an
 *                  uncertain param must surface that to the operator.
 */

export type ParamStatus = "verified" | "uncertain";

export interface LegalParam<T = number> {
  key: string;
  value: T;
  /** ISO date this value takes effect (inclusive). */
  effectiveFrom: string;
  /** ISO date this value stops applying (exclusive), null = open-ended. */
  effectiveTo: string | null;
  status: ParamStatus;
  source: string;
  note?: string;
}

export type LegalParamKey = keyof typeof CURRENT_VALUE_TYPES;

/** Type map so getParam() returns the right shape per key. */
const CURRENT_VALUE_TYPES = {
  // ── Residential lease (loi 21.9.2006, rev. 2024, in force 1.8.2024) ──
  "residential.deposit_max_months": 0 as number,
  "residential.notice_tenant_months": 0 as number,
  "residential.notice_landlord_months": 0 as number,
  "residential.notice_landlord_personal_need_months": 0 as number,
  "residential.rent_ceiling_pct_of_capital": 0 as number,
  "residential.rent_adjustment_min_interval_months": 0 as number,
  "residential.rent_adjustment_max_step_pct": 0 as number,
  "residential.agency_fee_split_tenant_share_pct": 0 as number,
  "residential.furnished_supplement_monthly_pct_of_furniture": 0 as number,
  "residential.furniture_invoice_max_age_years": 0 as number,
  "residential.colocation_departure_notice_months": 0 as number,
  "residential.deposit_first_tranche_months_after_keys": 0 as number,
  "residential.deposit_balance_months_after_decompte": 0 as number,
  "residential.deposit_justification_window_months": 0 as number,
  "residential.deposit_penalty_pct_of_monthly_rent_per_month": 0 as number,
  "residential.first_refusal_occupancy_years": 0 as number,
  "residential.first_refusal_breach_min_indemnity_months_rent": 0 as number,
  "residential.commission_loyers_inadmissible_first_months": 0 as number,
  "residential.decote_vetuste_pct_per_2y_beyond_15y": 0 as number,
  "residential.cohabitant_lease_continuation_min_months": 0 as number,

  // ── Commercial lease (loi 3.2.2018) ──
  "commercial.deposit_max_months": 0 as number,
  "commercial.renewal_request_min_months_before_expiry": 0 as number,
  "commercial.landlord_answer_months": 0 as number,
  "commercial.eviction_indemnity_occupancy_years": 0 as number,
  "commercial.preemption_occupancy_years": 0 as number,
  "commercial.preemption_window_months": 0 as number,
  "commercial.preemption_breach_min_indemnity_months_rent": 0 as number,
  "commercial.termination_notice_min_months": 0 as number,
  "commercial.sublet_refusal_window_days": 0 as number,
  "commercial.sursis_max_months": 0 as number,
  "commercial.min_lease_duration_for_scope_months": 0 as number,

  // ── Fiscal: amortisation (Art. 106 LIR + RGD; circ. 106/2) ──
  "amort.rate_normal_pct": 0 as number,
  "amort.rate_accelerated_pct": 0 as number,
  "amort.accelerated_window_years": 0 as number,
  "amort.accelerated_max_buildings_per_taxpayer": 0 as number,
  "amort.rate_grandfathered_pct": 0 as number,
  "amort.grandfathered_window_years": 0 as number,
  "amort.rate_vefa2024_pct": 0 as number,
  "amort.vefa2024_duration_years": 0 as number,
  "amort.vefa2024_base_cap_eur_per_year": 0 as number,
  "amort.rate_energy_pct": 0 as number,
  "amort.energy_window_years": 0 as number,
  "amort.land_default_share_pct": 0 as number,
  "amort.abattement_special_pct_of_4pct_base": 0 as number,
  "amort.abattement_special_cap_eur_per_taxpayer": 0 as number,

  // ── Fiscal: rental income (modèle 190/210) ──
  "tax.flat_deduction_pct_of_gross_rent": 0 as number,
  "tax.flat_deduction_cap_eur": 0 as number,
  "tax.flat_deduction_min_building_age_years": 0 as number,
  "tax.large_repairs_threshold_pct_of_annual_rent": 0 as number,
  "tax.large_repairs_spread_min_years": 0 as number,
  "tax.large_repairs_spread_max_years": 0 as number,
  "tax.social_rental_exemption_pct": 0 as number,
  "tax.top_marginal_rate_pct": 0 as number,

  // ── VAT ──
  "vat.standard_rate_pct": 0 as number,
  "vat.intermediate_rate_pct": 0 as number,
  "vat.reduced_rate_pct": 0 as number,
  "vat.super_reduced_rate_pct": 0 as number,
  "vat.option_min_tenant_deduction_pct": 0 as number,
  "vat.logement_max_advantage_eur": 0 as number,
  "vat.logement_mixed_use_min_residential_pct": 0 as number,
  "vat.logement_clawback_years": 0 as number,
  "vat.capital_goods_adjustment_years_immovable": 0 as number,
  "vat.simplified_invoice_max_incl_eur": 0 as number,

  // ── AML (loi 12.11.2004; AED supervision) ──
  "aml.letting_monthly_rent_threshold_eur": 0 as number,
  "aml.cash_threshold_eur": 0 as number,
  "aml.ubo_threshold_pct": 0 as number,
  "aml.retention_years_from_end_of_relationship": 0 as number,

  // ── Retention ──
  "retention.accounting_years": 0 as number,
  "retention.vat_invoice_years": 0 as number,
  "retention.unsuccessful_applicant_months": 0 as number,

  // ── Syndic / copropriété (RGD 13.6.1975) ──
  "syndic.mandate_max_years": 0 as number,
  "syndic.ag_convocation_min_days": 0 as number,
  "syndic.ag_repeat_convocation_min_days": 0 as number,
  "syndic.quarterly_provision_max_fraction_of_budget": 0 as number,
  "syndic.provision_max_fraction_no_permanent_advance": 0 as number,

  // ── Compliance calendar ──
  "compliance.cpe_validity_years": 0 as number,
  "compliance.commune_arrival_declaration_days": 0 as number,
  "compliance.defect_window_default_days": 0 as number,

  // ── Vacancy tax (INOL — reform in flux) ──
  "inol.trigger_vacancy_months": 0 as number,
  "inol.year1_eur": 0 as number,
  "inol.annual_increment_eur": 0 as number,
  "inol.cap_eur": 0 as number,
} as const;

/** Runtime list of every known parameter key (drives the admin registry screen). */
export const PARAM_KEYS = Object.keys(CURRENT_VALUE_TYPES) as LegalParamKey[];

const P = <T,>(
  key: string,
  value: T,
  status: ParamStatus,
  source: string,
  effectiveFrom = "2024-08-01",
  effectiveTo: string | null = null,
  note?: string,
): LegalParam<T> => ({ key, value, effectiveFrom, effectiveTo, status, source, note });

/**
 * The seed registry. Effective dates matter: getParam() resolves by date so
 * historical computations (e.g. a 2023 indexation) use the law then in force.
 */
export const LEGAL_PARAMS: LegalParam<number>[] = [
  // Residential — loi du 21 septembre 2006 as amended by loi du 23 juillet 2024
  P("residential.deposit_max_months", 3, "verified", "loi 21.9.2006 (pre-2024)", "2006-11-01", "2024-08-01"),
  P("residential.deposit_max_months", 2, "verified", "loi 23.7.2024, in force 1.8.2024"),
  P("residential.notice_tenant_months", 3, "verified", "loi 21.9.2006 art. 12", "2006-11-01"),
  P("residential.notice_landlord_months", 3, "verified", "loi 21.9.2006 art. 12", "2006-11-01"),
  P("residential.notice_landlord_personal_need_months", 6, "verified", "loi 21.9.2006 art. 12(3)", "2006-11-01"),
  P("residential.rent_ceiling_pct_of_capital", 5, "verified", "loi 21.9.2006 art. 3 (capital investi)", "2006-11-01"),
  P("residential.rent_adjustment_min_interval_months", 24, "verified", "loi 23.7.2024"),
  P("residential.rent_adjustment_max_step_pct", 10, "verified", "loi 23.7.2024 (replaces rule of thirds)"),
  P("residential.agency_fee_split_tenant_share_pct", 50, "verified", "loi 23.7.2024 — 50/50 split by operation of law"),
  P("residential.furnished_supplement_monthly_pct_of_furniture", 1.5, "verified", "loi 23.7.2024 — itemised on pain of nullity"),
  P("residential.furniture_invoice_max_age_years", 10, "verified", "loi 23.7.2024"),
  P("residential.colocation_departure_notice_months", 3, "verified", "loi 23.7.2024 colocation regime"),
  P("residential.deposit_first_tranche_months_after_keys", 1, "uncertain", "art. 5 — one CHD dossier reading says 2 months; resolve against Legilux", "2024-08-01", null, "Configurable constant; strategy open item #1"),
  P("residential.deposit_balance_months_after_decompte", 1, "verified", "loi 23.7.2024 deposit return procedure"),
  P("residential.deposit_justification_window_months", 1, "verified", "loi 23.7.2024 — deductions justified by invoice/estimate within 1 month"),
  P("residential.deposit_penalty_pct_of_monthly_rent_per_month", 10, "verified", "loi 23.7.2024 — +10% of monthly rent per commenced month after mise en demeure"),
  P("residential.first_refusal_occupancy_years", 18, "verified", "loi 21.9.2006 (2024 rev.)"),
  P("residential.first_refusal_breach_min_indemnity_months_rent", 12, "verified", "≥ 1 year's rent"),
  P("residential.commission_loyers_inadmissible_first_months", 6, "verified", "commission des loyers — contestation inadmissible in first 6 months", "2006-11-01"),
  P("residential.decote_vetuste_pct_per_2y_beyond_15y", 2, "verified", "décote de vétusté on construction component", "2006-11-01"),
  P("residential.cohabitant_lease_continuation_min_months", 6, "verified", "lease continues for registered cohabitants ≥ 6 months", "2006-11-01"),

  // Commercial — loi du 3 février 2018, Art. 1762-3 → 1762-13 C. civ.
  P("commercial.deposit_max_months", 6, "verified", "loi 3.2.2018 — garantie locative cap", "2018-03-01"),
  P("commercial.renewal_request_min_months_before_expiry", 6, "verified", "Art. 1762-10 — registered letter ≥ 6 months before expiry", "2018-03-01"),
  P("commercial.landlord_answer_months", 3, "verified", "Art. 1762-10", "2018-03-01"),
  P("commercial.eviction_indemnity_occupancy_years", 9, "verified", "Art. 1762-12 — refusal without cause on indemnity after 9 years", "2018-03-01"),
  P("commercial.preemption_occupancy_years", 18, "verified", "Art. 1762-13", "2018-03-01"),
  P("commercial.preemption_window_months", 1, "verified", "Art. 1762-13 — 1 month, extendable +1 for pending EU-bank loan", "2018-03-01"),
  P("commercial.preemption_breach_min_indemnity_months_rent", 12, "verified", "Art. 1762-13 — damages ≥ one year's rent", "2018-03-01"),
  P("commercial.termination_notice_min_months", 6, "verified", "loi 3.2.2018 — registered letter with AR", "2018-03-01"),
  P("commercial.sublet_refusal_window_days", 30, "verified", "loi 3.2.2018", "2018-03-01"),
  P("commercial.sursis_max_months", 9, "verified", "loi 3.2.2018 — stay of eviction, not appealable", "2018-03-01"),
  P("commercial.min_lease_duration_for_scope_months", 12, "uncertain", "leases < 1 year (pop-ups) excluded from scope (Molitor commentary; exact statutory month-threshold formulation to confirm on the 2018 law's text)", "2018-03-01"),

  // Amortisation — Art. 106(3)(4) LIR, RGD 19.11.1999 as amended, circ. 106/2
  P("amort.rate_normal_pct", 2, "verified", "circ. L.I.R. 106/2 — building completed ≥ 5 years ago", "2021-01-01"),
  P("amort.rate_accelerated_pct", 4, "verified", "circ. 106/2 — acquired/completed from 1.1.2021, < 5 years", "2021-01-01"),
  P("amort.accelerated_window_years", 5, "verified", "until 5 years after completion", "2021-01-01"),
  P("amort.accelerated_max_buildings_per_taxpayer", 2, "verified", "max 2 buildings or parts, residential letting, per taxpayer", "2021-01-01", null, "Open item #2: per-taxpayer vs household / lifetime vs per-year — circ. 106/2 12.08.2025"),
  P("amort.rate_grandfathered_pct", 6, "verified", "pre-2021 acquisitions, completion < 6 years; exhausted after tax year 2026", "2015-01-01", "2027-01-01"),
  P("amort.grandfathered_window_years", 6, "verified", "circ. 106/2 (2022)", "2015-01-01", "2027-01-01"),
  P("amort.rate_vefa2024_pct", 6, "verified", "2024 housing package — notarial deed in 2024, extended to 30.06.2025", "2024-01-01", null, "Uncertainty register #1: closed-cohort eligibility dates (transitional window to 30.09.2025?) — read loi du 22 mai 2024 + 2025 transitional bill; qualifying owners keep 6% for their full 6 years"),
  P("amort.vefa2024_duration_years", 6, "verified", "6 years on capped base", "2024-01-01"),
  P("amort.vefa2024_base_cap_eur_per_year", 250_000, "verified", "depreciation base capped at €250,000/year", "2024-01-01"),
  P("amort.rate_energy_pct", 6, "verified", "sustainable energy renovation — 6% up to tax year 2025", "2021-01-01", "2026-01-01"),
  P("amort.rate_energy_pct", 10, "verified", "gouvernement.lu Nouveautés 2026 — 10% from tax year 2026", "2026-01-01"),
  P("amort.energy_window_years", 9, "verified", "9 years from completion, then reverts to 2%; Klimabonus condition", "2021-01-01"),
  P("amort.land_default_share_pct", 20, "verified", "land may be valued at 20% of total incl. deed costs when unknown"),
  P("amort.abattement_special_pct_of_4pct_base", 1, "verified", "circ. L.I.R. 129e/1 du 9.01.2024", "2021-01-01"),
  P("amort.abattement_special_cap_eur_per_taxpayer", 10_000, "verified", "€10,000/taxpayer/year (€20,000 jointly-taxed couple)", "2021-01-01"),

  // Rental income tax
  P("tax.flat_deduction_pct_of_gross_rent", 35, "verified", "guichet.lu — déduction forfaitaire"),
  P("tax.flat_deduction_cap_eur", 2_700, "verified", "capped €2,700/year per building"),
  P("tax.flat_deduction_min_building_age_years", 15, "verified", "completion ≥ 15 years before start of tax year"),
  P("tax.large_repairs_threshold_pct_of_annual_rent", 50, "verified", "form 190/210 §B1 — spreading rule trigger"),
  P("tax.large_repairs_spread_min_years", 2, "verified", "spread over 2–5 years"),
  P("tax.large_repairs_spread_max_years", 5, "verified", "spread over 2–5 years"),
  P("tax.social_rental_exemption_pct", 90, "verified", "gestion locative sociale — 90% exempt since 2024", "2024-01-01"),
  P("tax.top_marginal_rate_pct", 45.78, "verified", "incl. solidarity surcharge (PwC)"),

  // VAT — loi TVA 12.2.1979
  P("vat.standard_rate_pct", 17, "verified", "standard rate (16% only in calendar 2023)", "2024-01-01"),
  P("vat.intermediate_rate_pct", 14, "verified", "Annexes A/B/C loi TVA", "2024-01-01"),
  P("vat.reduced_rate_pct", 8, "verified", "Annexes A/B/C loi TVA", "2024-01-01"),
  P("vat.super_reduced_rate_pct", 3, "verified", "TVA logement", "2024-01-01"),
  P("vat.option_min_tenant_deduction_pct", 50, "verified", "Art. 45 + RGD 7.3.1980 — tenant deducts ≥ 50%", "2024-08-01", null, "Uncertainty register #4: option granularity (per building/lot/lease) and treatment when the ratio later falls below 50% — read RGD 7.3.1980 directly"),
  P("vat.logement_max_advantage_eur", 50_000, "uncertain", "AED states €50,000; press claims €100,000 — verify before hard use", "2024-01-01", null, "Uncertainty register #6"),
  P("vat.logement_mixed_use_min_residential_pct", 75, "verified", "mixed-use qualifies fully if residential > 75%"),
  P("vat.logement_clawback_years", 2, "verified", "clawback if residential use lost within 2 years"),
  P("vat.capital_goods_adjustment_years_immovable", 10, "uncertain", "assumed 10 years — not re-confirmed on a primary page", "2024-01-01", null, "Uncertainty register #5"),
  P("vat.simplified_invoice_max_incl_eur", 100, "verified", "simplified invoice ≤ €100 incl. VAT, domestic only"),

  // AML
  P("aml.letting_monthly_rent_threshold_eur", 10_000, "verified", "AED — letting intermediation in scope at ≥ €10,000/month"),
  P("aml.cash_threshold_eur", 10_000, "verified", "AED sector guide 2018 — cash ≥ €10,000, single or linked"),
  P("aml.ubo_threshold_pct", 25, "verified", "beneficial owner > 25% shareholding"),
  P("aml.retention_years_from_end_of_relationship", 5, "verified", "loi 12.11.2004 — minimum 5 years from end of relationship"),

  // Retention
  P("retention.accounting_years", 10, "verified", "Art. 16 Code de commerce — storage in Luxembourg"),
  P("retention.vat_invoice_years", 10, "verified", "Art. 65(4)(2°) loi TVA"),
  P("retention.unsuccessful_applicant_months", 3, "verified", "GDPR minimisation — product rule, hard delete"),

  // Syndic — RGD 13.6.1975 (consolidated 6.12.2024)
  P("syndic.mandate_max_years", 3, "verified", "Art. 18 — max 3 years, renewable", "1975-06-13"),
  P("syndic.ag_convocation_min_days", 15, "verified", "Art. 3", "1975-06-13"),
  P("syndic.ag_repeat_convocation_min_days", 8, "verified", "Art. 11 — repeat assembly on same agenda", "1975-06-13"),
  P("syndic.quarterly_provision_max_fraction_of_budget", 0.25, "verified", "Art. 25 — ≤ ¼ of annual budget", "1975-06-13"),
  P("syndic.provision_max_fraction_no_permanent_advance", 0.5, "uncertain", "Art. 25 — ≤ ½ where no permanent advance stipulated (fiscal brief §7.2; confirm on the consolidated RGD text)", "1975-06-13"),

  // Compliance calendar
  P("compliance.cpe_validity_years", 10, "verified", "CPE 10-year validity; class must appear in every ad", "2008-01-01"),
  P("compliance.commune_arrival_declaration_days", 8, "verified", "tenant must declare arrival at the commune within 8 days", "2011-01-01"),
  P("compliance.defect_window_default_days", 15, "uncertain", "contractual, not statutory — configurable default", "2024-08-01", null, "Testa's window is contractual"),

  // INOL — reform in flux; adoption status unconfirmed (uncertainty register #10)
  P("inol.trigger_vacancy_months", 6, "uncertain", "impôt sur la non-occupation — 6+ consecutive months, if enacted"),
  P("inol.year1_eur", 3_000, "uncertain", "€3,000 year 1 (dossier)"),
  P("inol.annual_increment_eur", 900, "uncertain", "+€900/yr (dossier)"),
  P("inol.cap_eur", 7_500, "uncertain", "up to €7,500 (dossier)"),
];

export class LegalParamError extends Error {}

/**
 * Resolve a legal parameter as of a given date. Throws if no row covers the
 * date — a missing legal constant is a hard failure, never a silent default.
 */
export function getParam(key: LegalParamKey, onDate: string): LegalParam<number> {
  const candidates = LEGAL_PARAMS.filter(
    (p) =>
      p.key === key &&
      p.effectiveFrom <= onDate &&
      (p.effectiveTo === null || onDate < p.effectiveTo),
  );
  if (candidates.length === 0) {
    throw new LegalParamError(`No legal parameter "${key}" in force on ${onDate}`);
  }
  // Latest effectiveFrom wins when ranges overlap (a correction supersedes).
  candidates.sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  return candidates[0];
}

export function getParamValue(key: LegalParamKey, onDate: string): number {
  return getParam(key, onDate).value;
}

/** All params in force on a date — drives the admin "Legal parameters" screen. */
export function paramsInForce(onDate: string): LegalParam<number>[] {
  const seen = new Set<string>();
  const out: LegalParam<number>[] = [];
  const sorted = [...LEGAL_PARAMS].sort((a, b) =>
    a.effectiveFrom < b.effectiveFrom ? 1 : -1,
  );
  for (const p of sorted) {
    if (seen.has(p.key)) continue;
    if (p.effectiveFrom <= onDate && (p.effectiveTo === null || onDate < p.effectiveTo)) {
      seen.add(p.key);
      out.push(p);
    }
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}
