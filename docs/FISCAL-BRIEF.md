# Luxembourg Property Letting — Fiscal, Accounting & Lease-Law Brief (2026)

**Purpose:** input spec for a property-management SaaS. Facts sourced to Luxembourg primary/official sources where possible. Uncertain items are flagged explicitly in each section and consolidated at the end.

> In-code mapping: every figure below lives in `src/domain/legal/params.ts` (seeded to the
> `legal_params` table) with its effective-date range and a `verified`/`uncertain` status.
> Engines never hard-code a legal constant.

---

## 1. Rental income — Luxembourg-resident private landlord

### 1.1 Category & rate
- **VERIFIED.** Income from letting immovable property held in private wealth is its own income category: *revenus nets provenant de la location de biens* (Art. 10 no. 6 LIR). Net income = gross rents − *frais d'obtention*. Aggregated with other income and taxed at the progressive scale. Top marginal ≈ **45.78%** incl. solidarity surcharge.
- **VERIFIED.** No separate "flat tax". No social contributions on rental income for individuals.

### 1.2 Deductible *frais d'obtention* (actual-cost method)
Deductible without ceiling: debt interest (no cap when the loan finances the let property); maintenance and repair; property management / concierge / syndic fees; impôt foncier and communal charges not recharged to tenant; insurance premiums; utilities not reimbursed by tenant; owner's share of the copropriété fonds de réserve/travaux contributions; amortissement.

**Large repairs spreading rule — VERIFIED:** repair expenditure in a year exceeding **50% of the annual rent** may be spread over **2 to 5 years** (form 190/210 §B1/B2). → `taxpack.ts`.

### 1.3 Flat deduction (*déduction forfaitaire*)
- **35% of gross rent, capped at €2,700/year per building**, only where the building's completion is **≥15 years** before the start of the tax year.
- Does **not** replace: debt interest, impôt foncier, management fees, communal charges — separately deductible on top. → `taxpack.ts` comparison engine.

### 1.4 Depreciation (*amortissement*) — current regime
Art. 106(3)(4) LIR; RGD 19.11.1999 as amended; circulaires L.I.R. n° 106/2, 129e/1.

| Situation | Rate | Duration / limit | Status |
|---|---|---|---|
| Normal, completed ≥5 years ago | **2%** | Indefinite | VERIFIED |
| Accelerated, completed <5 years (acquired/completed from 1.1.2021) | **4%** | 5 yrs after completion; **max 2 buildings per taxpayer** | VERIFIED |
| Grandfathered pre-2021, completion <6 years | **6%** | 6 years; exhausted after tax year 2026 | VERIFIED |
| Energy renovation (<9 years, Klimabonus received) | **6%** → **10% from tax year 2026** | 9 years, then 2% | VERIFIED |
| VEFA 2024 housing package (deed 2024, extended 30.06.2025) | **6%** | 6 years, base capped **€250,000/year** | VERIFIED (cohort closure = uncertainty #1) |

**Base:** acquisition price excluding land + deed costs + investments; land unknown → **20% of total incl. deed costs**. Klimabonus deducted from the energy base.

**Abattement immobilier spécial:** 1% of the base amortised at 4%, capped **€10,000/taxpayer/year** (€20,000 jointly taxed). → `amortisation.ts` (`planTaxpayerYear` allocates slots taxpayer-wide).

**Social rental management:** net income **90% exempt** since 2024.

### 1.5 Forms
Modèle 100 (main return, due 31.12 N+1) · modèle 190/210 (one per property, 4 pages — the pack builder emits exactly its dataset) · modèle 200 (transparent vehicles, allocation to members).

### 1.6 Year-end data the PMS must produce
Cadastral ref, acquisition split land/building/VAT/deed costs, ownership graph with dates, months let, gross rents by category (dwelling / garage / furniture supplement / retained deposits / recharges), expense ledger in the form's buckets, >50% repairs flag + spreading schedule, amortisation schedule with taxpayer-level slot counter, Klimabonus netting, abattement computation, flat-vs-itemised comparison, loan interest certificate, 10-year document vault. → `buildTaxPack()`.

---

## 2. Non-resident landlords

- Luxembourg-source immovable income taxed by **assessment** (modèle 100, 31.12 N+1). **No withholding tax on rent**, no payer obligation.
- Assimilation option (Art. 157ter LIR) — 90%/50% thresholds **[uncertainty #12]**.
- Treaties: situs-state taxation; residence state relieves by exemption-with-progression (BE, DE) or Luxembourg-tax credit (FR 2018 treaty).
- **PMS implication:** dual-jurisdiction pack — Luxembourg 190/210 categories + raw export for BE cadre III / FR 2047+2044 / DE Anlage V, with **depreciation isolated** (a Luxembourg-only concept). → `nonResidentExport` in `taxpack.ts`.

---

## 3. SCI and other ownership vehicles

- **Tax transparency (Art. 175 LIR):** société civile/SCI, SENC, SCS, SCSp, GIE — income determined collectively (modèle 200), taxed in members' hands.
- Société civile: min 2 associates, RCS filing, joint (not solidary) liability, no accounts publication. RBE registration required (loi 13.1.2019).
- Requalification risk when activity becomes commercial **[uncertain]**.
- **PMS implication:** three-level ownership graph (property → vehicle → natural persons with % and dates) because the max-2-buildings rule and €10,000 abattement bite at the **individual taxpayer** level. → `g_ownership_vehicles`, `g_vehicle_members`, `g_property_ownership`.

---

## 4. VAT

### 4.1 Rates
Standard **17%** · intermediate 14% · reduced 8% · super-reduced 3% (2023's 16/13/7 was temporary).

### 4.2 Letting
Exempt (Art. 44(1)(g)); **residential letting always exempt in practice** — input VAT is a cost, capitalised into the depreciation base.

### 4.3 Option to tax
Art. 45 + RGD 7.3.1980: tenant must be a taxable person deducting **≥50%**; **prior AED approval** (1 month); VAT from the **first day of the month following the decision — never retroactive**; sales need approval before the deed. Granularity per building/lot/lease **[uncertainty #4]**; capital-goods adjustment 10 years **[uncertainty #5]**. → `assessVatOption()`, `rentVat()`.

### 4.4 Management fees
Place of supply = where the building is; management/agency/syndic fees **always 17%**, even when the letting is exempt — for a residential landlord this VAT is a sunk cost. → `managementFeeVat()`.

### 4.5 TVA logement
3% for principal-residence creation/renovation; max advantage **€50,000** per dwelling (press claims €100,000 — **[uncertainty #6]**); >75% residential rule; 2-year clawback.

---

## 5. Commercial leases (loi du 3 février 2018)

Freely agreed duration (NO French 3/6/9 — tevaxia.lu rejected as contaminated); pas-de-porte **void de plein droit** (pre-1.3.2018 leases unaffected); deposit ≤ **6 months**; renewal request by registered letter **≥6 months** before expiry, landlord answers within **3 months**; **9-year** eviction-indemnity rule; sub-letting refusal window 30 days; sursis ≤ 9 months; **18-year** pre-emption (1-month window, +1 for pending EU-bank loan, breach ≥ 1 year's rent); notice ≥ **6 months** by registered letter; rent free, indexation only by express clause on the STATEC IPC. → `lease/rules.ts`, `commercialRenewalCalendar()`.

### 5b. Residential leases (loi 21.9.2006, rev. 2024, in force 1.8.2024)

| Item | Residential | Commercial |
|---|---|---|
| Deposit | **Max 2 months** (5 statutory forms, tenant's choice binds) | Max 6 months |
| Agency commission | **50/50 by law** | Free |
| Rent ceiling | **5% p.a. of revalued capital investi** (colocation: combined) | None |
| Rent increase | Max **+10%** per step, max one per **24 months** | Free |
| CPI clauses | **Prohibited** (relative nullity) | Permitted, customary |
| Colocation | Single lease + written pacte, joint liability, 3-month departure notice | N/A |
| Termination | Grounds exhaustive; **sale is not a ground**; besoin personnel = 6 months + art. 12(3) verbatim | 2018-law regime |
| Deposit return | 50% at M+1 of keys; balance at M+1 of décompte; justification 1 month or forfeited; **+10%/commenced month** after mise en demeure | Contract |
| VAT | Always exempt | Option available |

`lease_type` drives all of it — one lease object, a rules table per type. → the whole `domain/` layer.

### 5c. Lease registration
Optional since 1.1.2017 (date certaine value-add). Rates **[uncertainty #13]**.

---

## 6. Invoicing, e-invoicing, archiving

- Mandatory invoice content per AED incl. **exemption reason** for exempt letting (cite Art. 44(1)(g)); simplified invoice ≤ €100 incl. → `validateInvoiceContent()`.
- **B2G e-invoicing mandatory** (EN 16931, UBL/CII over Peppol); **no B2B mandate yet** — build Peppol-native anyway.
- Retention: **10 years** accounting (Art. 16 Code de commerce — **stored in Luxembourg**) and VAT records; **5 years** AML from end of relationship; PSDC route for evidential dematerialisation. → `g_documents.retention_class`.

---

## 7. Accounting plan & professional licence

- **PCN 2019** alignment for owner reporting (fiduciaire-ready exports); FAIA (SAF-T v2.01) as the highest-value integration; SCI exempt from PCN/eCDF.
- **Autorisation d'établissement required for customers** (administrateur de biens — Ministère de l'Économie; House of Training exam or 3 years' management experience; **mandatory PI insurance**, minimum cover [uncertainty #7]). Licence number and PI expiry are first-class org fields with escalating alarms.
- **Syndic client money:** RGD 13.6.1975 art. 28 — funds to an account **in the syndicat's name, without delay**, never pooled; mandate max 3 years (art. 18); AG convocation ≥15 days (art. 3), 8 days repeat (art. 11); provisions ≤¼ budget (art. 25). Letting-agent client money: no Hoguet equivalent found **[uncertainty #8]** — segregation ships as product + contract.
- Property-tax reform (IFON/IMOB/**INOL**) **[uncertainty #10]** — the vacancy clock and defence file build now: €3,000 year 1, +€900/yr to €7,500, at 6+ months' vacancy if enacted.

---

## 8. AML / KYC

- Real-estate professionals are obliged entities under the loi du 12.11.2004; AED supervises (Service contrôle blanchiment).
- Scope: sale mandates; **letting intermediation ≥ €10,000/month**; **cash ≥ €10,000** (single or linked); UBO **>25%**; PEP screening; goAML STR filings; retention **5 years from end of relationship**. Pure managers/syndics **[uncertainty #9]** — two-tier onboarding ships, counsel flips the default.
- **Software implications** (all implemented): light tier for ordinary tenants, full CDD auto-triggers (`resolveCddTier`), UBO chain resolution (`resolveUbo`), risk bands with review intervals, per-document-class retention clocks, STR isolation (no tipping-off exposure — admin-only RLS).

---

## Consolidated uncertainty register

| # | Point | In-code marker |
|---|---|---|
| 1 | VEFA-2024 cohort closure dates | `amort.rate_vefa2024_pct` note |
| 2 | Max-2-buildings: taxpayer vs household, lifetime vs per-year | `amort.accelerated_max_buildings_per_taxpayer` note |
| 3 | Commercial duration/rent-review (tevaxia contamination rejected) | `lease/rules.ts` commercial pack |
| 4 | VAT option granularity | `vat.option_min_tenant_deduction_pct` note |
| 5 | Capital-goods adjustment period (assumed 10y) | `vat.capital_goods_adjustment_years_immovable` = uncertain |
| 6 | TVA logement ceiling €50k vs €100k | `vat.logement_max_advantage_eur` = uncertain |
| 7 | PI insurance minimum cover | org fields; no minimum encoded |
| 8 | Client-money regime for letting agents | Finance page note |
| 9 | AML scope for pure managers/syndics | `aml/engine.ts` configurable default |
| 10 | IFON/IMOB/INOL adoption status | `inol.*` params = uncertain |
| 11 | Luxembourg B2B e-invoicing date | Peppol-native anyway |
| 12 | Non-resident assimilation thresholds | not hard-coded |
| 13 | Voluntary lease registration duty | not hard-coded |
| 14 | PCN mapping for mandant funds | to settle with a fiduciaire |

Also carried as open items from the strategy build order: deposit first-tranche deadline 1 vs 2 months (`residential.deposit_first_tranche_months_after_keys` = **uncertain, configurable**), revaluation coefficients (Circulaire 3/25 to ingest — `SEED_REVALUATION_TABLE.status = "uncertain"`), colocation article map, AED registration fee, PL 8184 rent-ceiling reform, salubrité regime, smoke-detector duty split.
