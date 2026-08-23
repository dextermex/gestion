# Morada Gestion — Luxembourg Property-Management SaaS
## Full Strategy, Technical Specification and System Workflows

**Version 1.0 — 23 August 2026.** Prepared from five primary-source research briefs (tenancy law, tax/accounting, banking/reconciliation, competitive landscape, compliance/integrations) and four workflow-design passes. Every legal figure below is tagged **[V]** (verified against an official Luxembourg source) or **[U]** (unverified or in flux — do not hard-code without counsel or primary-source confirmation).

---

## 1. Decision and thesis

Build the gestion (property-management) product as a **separate application with shared identity** alongside Morada.lu, sold as SaaS to landlords and property managers, with a **tenant portal as the demand-side wedge** — and treat the Luxembourg compliance layer as the product, not a feature.

The reasoning, in order of weight:

1. **The back-office layer in Luxembourg is an unoccupied adjacency.** None of the four listing portals (athome, immotop, nextimmo, Wortimmo) offers a PMS, CRM or gestion locative product [V]. The only incumbent is Progetis (Orisha group), which sells on request, publishes no pricing, and serves syndics/agencies with a dated extranet. The German tools that define the modern category (immocloud, casavi, Objego) are German-only, DATEV-oriented, and explicitly do not support Luxembourg [V]. Rentila excludes Luxembourg; French tools are blocked by French tax logic [V]. There is no localised, modern, multilingual PMS for the Luxembourg market.
2. **Luxembourg law makes localisation a moat, not a checkbox.** A foreign PMS deployed here would recharge management fees to tenants (illegal), include CPI escalation clauses in residential leases (nullifiable), offer "landlord is selling" as a termination ground (invalid), and miss the deposit-return penalty clock (10% of monthly rent per commenced month of delay) [V]. Encoding these rules is roughly two person-years of legal-product work that generic competitors will not do for a ~66,000-unit market — which is precisely why the market stays open for a local player.
3. **The tenant portal is the flywheel.** Every tenancy managed in the system onboards 1–3 tenants who experience Morada as their housing interface (documents, requests, payments, attestations). Tenants churn into buyers and future landlords; the portal seeds the Morada.lu consumer brand from the demand side, the same way listings seed it from the supply side.
4. **Timing.** The agency revolt against athome's pricing opacity (FIL demanding tariff transparency; identical packs priced €9,500 vs €5,700; 11–30% annual increases) [V — Paperjam] means agencies are actively re-evaluating their software and portal stack for the first time in a decade. A gestion product is a lower-friction entry into those agencies than a listings pitch.

**What this is not.** It is not a syndic accounting ERP (Progetis's fortress; heavy, licensed, slow to win) and it is not a payments company (touching funds triggers CSSF payment-institution licensing [V]). Phase 1 is read-only on money: reconciliation, not collection.

### Market sizing (assumption-flagged)

| Quantity | Value | Status |
|---|---|---|
| Dwellings (2021 census) | 248,310 | [V] |
| Private-rental households | ~25% of 265,000 households → **~66,000 rental units** (range 60–75k) | [U — derived; census tenure has a 22% unknown gap] |
| Professionally-managed share | ~40–60% → **26,000–40,000 serviceable units** | [U — no source on penetration] |
| Agencies with an autorisation | est. 400–700 | [U] |
| Licensed syndics/administrateurs | est. 100–250 | [U] |
| Price benchmarks | €1–2/unit/mo private-landlord flat tier; €4–8/unit/mo with hard legal localisation (Smovin, GererSeul); €0.4–1.0/unit/mo pro ERP | [V vendor pricing; benchmark derivation E] |

At €4–6/unit/month (justified by legal localisation, per the Smovin/GererSeul precedent) and 15,000 units under management in 36 months, ARR is **€0.7–1.1M** — a real business in-market, and strategically decisive as the moat around Morada.lu's marketplace. The SaaS revenue is the floor; the strategic value (agency lock-in, tenant relationships, transaction data) is the ceiling.

---

## 2. Product architecture

### 2.1 Three surfaces, one spine

1. **Admin portal (managers/landlords)** — the immocloud-style navigation the user specified: Dashboard, Workflows, Objects, Tenancies, Meters, Operating costs, Contacts, Rent, Finance, Banking, Messaging, Rental contracts, Documents — plus Luxembourg-specific modules: Compliance calendar, Indexation engine, Deposit engine, AML/KYC.
2. **Tenant portal** (web + PWA, five languages FR/DE/EN/LU/PT) — the modernised Testa concept: one "New request" entry (technical/administrative inferred, not chosen), photo-first intake, tenant-visible SLA timers, self-service documents, payment status, move-in defect capture, exit checklist.
3. **Artisan micro-portal** — magic-link only, no account: accept/decline jobs, propose slots, upload completion photos and invoices. This is the realistic answer to Luxembourg trades working by phone/email/WhatsApp.

### 2.2 Stack and relationship to Morada

Separate codebase and Supabase project (EU region, Frankfurt or Paris [V — Supabase regions]), sharing with Morada.lu: single sign-on (one auth identity), the contact graph, and cross-links (a Morada listing can be created from a gestion vacancy; a gestion mandate can be won from a Morada lead). Clean boundary: the gestion schema owns leases, ledgers, EDLs, banking; Morada owns listings, discovery, marketplace messaging. Rationale for separation: different RLS threat model (financial data for competing agencies), different release cadence, and the option to sell gestion standalone.

Non-negotiable architecture rules established by the research:

- **All legal constants are data, never code.** Notice periods, deposit caps, the 5%/10%/24-month rent rules, revaluation coefficients, the art. 12(3) verbatim text, retention periods — all live in versioned `legal_params` tables with effective-date ranges. A legislative change is a data migration with a manager review queue, not a release.
- **Registered letter with AR is a first-class object.** Termination validity, mise en demeure effect, deposit-penalty clocks and contestations all hinge on AR-evidenced registered post [V]. `registered_letters` carries the content hash, dispatch proof, and AR scan; dependent workflows are gated on its state, and legal-effect dates derive from AR dates, not click dates.
- **Every legally significant artefact is hash-sealed** (SHA-256 at capture, PAdES-LTV with qualified timestamp for signed documents), immutable after signature, corrected only by appended addenda.
- **Append-only event log** backs every timeline, SLA computation, audit need and litigation export.

### 2.3 Data model (core entities)

`orgs` (management company; licence no., PI-insurance expiry) → `mandates` (owner contracts: fee basis, auto-approve limit) → `owners` (natural/legal; three-level ownership graph property → vehicle → natural persons with % and dates, because the 4%-amortisation two-building cap and the €10,000 abattement bite at taxpayer level [V]) → `properties`/`units` (cadastral ref, CPE record, capital-investi components, smoke-detector rows, meter registry) → `leases` (type residential|commercial drives divergent rule packs — deposit 2 vs 6 months, rent cap vs none, indexation regime, renewal calendar, VAT regime [V]) → `tenancies` → `tenants`/`colocataires` (+ mandatory pacte de colocation object) → financial spine: `rent_invoices` → `receivables` → `payments` → `payment_allocations` (ledger of allocations; paid-ness always derived, never a boolean) → `owner_ledger_entries` → `deposits` (five statutory forms) → compliance spine: `edl_sessions`/`edl_items`/`media_seals`, `defects`, `registered_letters`, `legal_deadlines`, `aml_records` (party → id_documents → ubo_chain → risk_rating → screening_events), `documents` with per-class retention clocks (10y accounting [V], 5y AML from end of relationship [V], 3-month hard delete for unsuccessful applicants, GDPR minimisation for the rest).

RLS posture: tenant scoped to own tenancies; artisan access only via short-lived scoped JWT; owner scoped to own mandates; visibility flags enforced at row level; manager internal notes on separate tables never exposed to tenant policies.

---

## 3. The Luxembourg compliance layer (what the product must get right)

This section is the specification of the moat. Sources: guichet.public.lu, logement.public.lu, pfi.public.lu (AED), impotsdirects.public.lu, Legilux, plus law-firm commentary where primary text was unreachable.

### 3.1 Residential lease engine (loi du 21.9.2006, amended by loi du 23 juillet 2024, in force 1.8.2024)

- Written lease **on pain of nullity** with **8 mandatory mentions** — the generator refuses to emit a signable lease without all eight populated [V].
- **Deposit max 2 months** (excl. charges); five permitted forms (cash, bank guarantee, third-party caution, insurance, State guarantee) and the landlord must accept the tenant's chosen permitted form [V]. Commercial: max 6 months [V].
- **Agency fee split 50/50** by operation of law — template enforces [V].
- **Rent ceiling: 5% p.a. of revalued capital investi**; revaluation coefficients from Ministry circulars (values [U] — ingest, never hard-code; Circulaire 3/25 is the source to obtain); décote de vétusté −2% per 2-year period beyond 15 years on the construction component [V]. Adjustments: max once per 24 months, max +10% per step (applies to pre-2024 leases from their next adjustment) [V]. **CPI escalation clauses in residential leases are prohibited** (relative nullity — effective until tenant objects by registered letter) — the engine refuses to create them [V].
- **Furnished supplement**: max 1.5%/month of furniture invoices <10 years old, itemised on pain of nullity — calculator with automatic invoice ageing [V].
- **Colocation** (new 2024 regime): single lease, joint and several liability, mandatory written pacte de colocation in the same signing envelope, 3-month departure notice to landlord and co-tenants, intermediate EDL on departure [V; exact article map 2bis–2sexies [U]].
- **Termination**: tenant 3 months; landlord 3 months (6 for besoin personnel); grounds exhaustive; **sale is not a ground** — blocked in product [V]. Besoin-personnel letters must reproduce **art. 12(3) verbatim on pain of nullity** — locked template partial [V]. Fixed-term leases renew indefinitely if notice misses the exact expiry (prorogation légale) — date-guard warnings [V]. Right of first refusal at ≥18 years' occupation, breach ≥1 year's rent [V].
- **Deposit return**: 50% within 1 month of key handover; balance within 1 month of the charge settlement; deductions justified by invoice/estimate within 1 month; penalty after mise en demeure: **+10% of monthly rent per commenced month** [V — one CHD dossier reading says 2 months for the first tranche; configurable constant, resolve against Legilux art. 5 [U]]. **No entry EDL → deposit cannot be applied to damage at all** — hard gate in the settlement engine [V].
- **Charges**: only actually-incurred, invoice-evidenced expenses for the tenant's benefit. **Hard blocks (never rechargeable to a residential tenant): management fees, building insurance, impôt foncier, energy-passport cost, meter rental/reading, major repairs, vétusté** [V]. Charge disputes go to the justice de paix, not the commission des loyers — router encodes jurisdiction [V]. Syndic AG-approved décomptes carry a presumption of justification [V].
- **Commission des loyers** is communal (communes <6,000 inhabitants route to the Ministry); contestation inadmissible in the lease's first 6 months; 1-month negotiation window after registered letter [V].

### 3.2 Commercial lease engine (loi du 3 février 2018)

Freely agreed duration (no French 3/6/9 — one widely-ranking Luxembourg site imports French rules; rejected as contaminated [V]); pas-de-porte void; renewal request by registered letter ≥6 months before expiry, landlord answers within 3 months; 9-year eviction-indemnity rule; deposit ≤6 months; contractual IPC indexation permitted and customary; VAT option available where the tenant deducts ≥50% (AED prior approval, applies from the month after the decision — never retroactive) [V].

### 3.3 Fiscal layer (the year-end pack)

The PMS produces, per property, per owner, per year, the exact modèle 190/210 dataset: months let, gross rents by category, expense ledger in the form's buckets, debt interest, the repairs->50%-of-rent spreading flag, and the amortisation schedule (2% normal / 4% accelerated with the max-2-buildings taxpayer-level counter / 6% grandfathered and VEFA-2024 cohorts / 6%→10% energy-renovation from 2026) with the abattement immobilier spécial computation (1% of the 4% base, capped €10,000/taxpayer) [V]. Non-residents: no withholding — declaration-based; the pack exports in Luxembourg categories plus raw form usable for Belgian/French/German residence-state returns [V]. Transparent vehicles file modèle 200 with allocation to members [V]. FAIA (Luxembourg SAF-T, v2.01) export is the single highest-value accounting integration — a legal obligation every fiduciaire understands [V]; Peppol/UBL (EN 16931) output unlocks public-sector landlords (B2G e-invoicing mandatory; B2B not yet [V]).

### 3.4 Regulatory perimeter

- Managing property for third parties requires an **autorisation d'établissement** (administrateur de biens; Ministère de l'Économie; House of Training exam or 3 years' management experience; mandatory PI insurance) [V]. The SaaS vendor itself does not need one, but its customers do — licence number and PI-expiry are first-class fields with escalating expiry alarms.
- **AML**: real-estate professionals are obliged entities supervised by the AED; letting intermediation in scope at **≥€10,000/month rent**; cash ≥€10,000 triggers; UBO >25%; PEP screening; 5-year retention; goAML STR filings [V]. Whether pure managers/syndics are in scope is [U] — ship a two-tier onboarding (light for ordinary tenants, full CDD auto-triggered on thresholds) and let counsel set the default.
- **GDPR/CNPD**: no Luxembourg tenant-file guidance exists — the conservative spec is the French CNIL list plus the Baloise rent-guarantee underwriting criteria as the necessity anchor. **Product-level blocks: no bank-statement uploads, no casier judiciaire** (classifier rejects before persistence); two-phase collection (nothing financial before a viewing); unsuccessful applicants hard-deleted at 3 months; no automated rejection (Art. 22); any cross-purpose tenant risk score triggers a mandatory DPIA — do not build one [V/U as detailed in research].
- **E-signature**: AES with strong audit trail (PAdES-LTV + qualified timestamp) suffices for leases, EDLs and mandates; QES (LuxTrust/Yousign) as an upgrade; **consumer-guarantor sureties are excluded from simple e-signature** — paper or QES-with-opinion route [V per Adobe Luxembourg legality analysis; confirm Civil Code art. 1325 treatment [U]].
- **Syndic client money**: sums received for a syndicat must go **without delay to an account in the syndicat's name** (RGD 13.6.1975 art. 28) — per-syndicat accounts enforced, never pooled [V]. No Hoguet-style regime found for letting agents' client money [U] — segregation ships as a product feature and contractual duty.

### 3.5 Compliance calendar (auto-generated tasks from data)

CPE expiry (10-year validity; class must appear in every ad — feed builder fails closed) [V]; smoke detectors (all dwellings since 1.1.2023, bedrooms + escape routes) [V]; RC locative renewals; syndic mandate max 3 years [V]; boiler service; manager PI insurance; décompte issuance deadlines; **vacancy clock building the INOL vacancy-tax defence file now** (tax [U] — adoption status unconfirmed; €3,000 year 1 escalating to €7,500 at 6+ months' vacancy if enacted).

---

## 4. The four core workflows (optimised)

Full state machines are in the workflow annexes; this section fixes the decisions.

### 4.1 Market-to-move-in

`DRAFT → MARKETING → SCREENING → LEASE → PRE_MOVE_IN → EDL → DEFECT_WINDOW → SETTLED`

- **Marketing**: unit onboarding checklist with publish blockers (CPE class, mandate, charges structure, rent-ceiling check with stored computation snapshot); syndication adapters — immotop first (public Indomio XML spec — the only portal you can integrate without a commercial conversation [V]), nextimmo second, athome as negotiated adapter with a manual copy-paste pack until then; OpenImmo export as the generic escape hatch. Leads captured in five languages with auto-acknowledgement and self-serve viewing booking.
- **Screening**: two-phase collection enforced structurally (the phase-1 table physically lacks financial columns); prohibited-document classifier purging bank statements and casiers before persistence; solvency shown as a fact banner (≥3× rent norm), never a score; human decision with stated reason, always; 3-month hard-delete cron for the unsuccessful.
- **Lease**: 8-mention completeness gate; deposit validator (2/6 months by lease type); 50/50 fee clause enforced; colocation lease + pacte in one linked envelope; furnished-supplement annex generated or the lease blocks; AES ceremony with OTP, QES upgrade, guarantor paper track in parallel; optional one-click AED registration pack (date certaine as a value-add).
- **Move-in (the flagship, replacing Testa's paper form)**: keys are **structurally blocked until the contradictory EDL is signed** — the legally fatal path (keys without EDL → deposit unusable) becomes impossible by construction. Guided room-by-room walkthrough (offline-capable, one- or two-device mirrored), fixed category taxonomy superset of Testa's (paint, floors, interior/exterior joinery, tiling, plumbing, electrics, heating, gas, appliances, keys), condition enum + minimum photo counts, every photo timestamped/geotagged/hash-chained; meters as first-class objects (photo + OCR + both-party tap-to-acknowledge — there is no meter API in Luxembourg [V], so dual-ack is the trust mechanism) with an auto-generated supplier handover pack; closing ceremony produces a sealed PAdES with embedded hash manifest.
- **Defect window (Testa modernised)**: opens at key handover, default 15 days (configurable, contractually referenced — Testa's window is contractual, not statutory [U]), permanent countdown banner; tenant reports a defect in under 60 seconds (room → category → photos → comment in any language, auto-translated → severity; URGENT pages the manager); manager triages accept/dispute/normal-wear with a visible reason within 5 business days; the batch compiles into a signed, sealed addendum to the EDL; accepted defects feed repair tickets directly. Late reports land in an out-of-window log rather than being refused.
- **Move-in admin bundle**: instant landlord **attestation de logement** (tenant must declare arrival at the commune within 8 days [V] — countdown in-app), smoke-detector gate, RC-locative capture, deposit receipt per statutory form.

### 4.2 In-tenancy operations

- **One request entry point** (class inferred): photo-first intake with AI category suggestion; severity triage with a genuine emergency path (24/7 escalation ladder, gas-smell short-circuit to emergency numbers before submission completes); self-service deflection cards ("reset boiler pressure") that close tickets as self-resolved; **tenant-visible SLA timers with real deadlines** — the single biggest gap vs Testa; "pending tenant" state pauses clocks; satisfaction close-loop feeding artisan quality scores.
- **Administrative catalogue with a self-service tier**: attestation de logement and rent certificates generated in seconds with QR verification (removes an estimated 30–40% of admin ticket volume and is the marketing headline); approval-gated tier for guarantor change, pets, sublet, add-colocataire (composite flow: docs → avenant e-signed by all → intermediate EDL); legal-form tier for termination notices and clause diplomatique, gated on the registered-letter chain.
- **Maintenance dispatch with zero artisan software**: magic-link offers (first-accept wins, TTL auto-escalation), slot negotiation with the tenant, completion photos, invoice OCR; owner approval thresholds per mandate with emergency override limits; the **recharge decision engine with non-overridable legal hard blocks** (§3.1) and a vétusté grid computing the tenant's residual share.
- **Charges & décompte**: advances vs forfait regimes; syndic décompte import wizard mapping copropriété tantièmes to the smaller tenant-recoverable subset with full line provenance; Techem/ista PDF ingestion (split, extract, match, expose each tenant only their page); advance adjustment proposals post-décompte; jurisdiction-correct dispute routing.
- **Indexation engine**: residential — statutory adjustment calendar (24 months, +10%, 5% ceiling) computed from capital-investi components against versioned coefficient tables, reasoned notice via registered letter, contestation flow with the commune-keyed commission registry; commercial — contractual IPC clause engine on STATEC series. **INDEXATION_LAG detection**: received amount equals the previous rent exactly → auto-match at old amount, open a shortfall, send the pre-filled "update your standing order" letter. A Luxembourg-payment-culture revenue-recovery feature no competitor has.

### 4.3 Rent collection and automatic payment recognition

The design goal is >90% auto-recognition at steady state without touching funds.

- **Provider-agnostic connector layer** (`BankProvider` interface): Enable Banking as default primary (documented LU coverage: BCEE, BGL, ING, BdL, SocGen, DB, Raiffeisen; business-account support; per-bank consent validity exposure [V]); **Salt Edge slotted as primary the moment it passes the go-live acceptance gate** — written confirmation of LU bank coverage, business-account connects on real accounts, ≥99% remittance fidelity, ≥95% payer-IBAN presence, stable transaction IDs, 30-day CAMT parity audit. Its public LU coverage page currently shows zero banks [V], so it stays dormant behind a flag until then. GoCardless Bank Account Data is winding down — excluded [V]. **CAMT.053 ingestion is permanent** (BIL publishes public implementation guidelines [V]) — fallback, enterprise feed, and consent-lapse continuity in one.
- **Consent-churn machine**: per-connection `consent_expires_at` from the bank (never a hard-coded 180 days), T-14/7/2/0 reminder ladder, automatic backfill with gap detection on renewal, manual-fallback mode with a CAMT upload CTA. Assume 10–25% churn per consent boundary.
- **Reference discipline manufactured at invoice time**: per-lease permanent RF creditor reference (ISO 11649) printed everywhere plus an **EPC QR code** on every avis d'échéance (tenant scans; IBAN, verbatim VoP-safe beneficiary name, amount, RF prefilled). Luxembourg retail apps have no structured-reference field, so the parser scans free text (checksum-validated RF regex, then EACT tags). **VoP gate**: since October 2025 every displayed IBAN is name-checked by the payer's bank [V] — the registered account-holder name is captured verbatim at onboarding and mismatch is a blocking error.
- **Matching cascade**: pre-classifiers (non-rent counterparties; INDEXATION_LAG; multi-unit subset-sum ≤6) → Tier 1 RF deterministic → Tier 2 learned payer-IBAN bindings (the only tier that saves third-party payers: parents, employers, housing subsidies) → Tier 3 weighted fuzzy (IBAN 0.45, amount 0.25/0.20/0.12, reference tokens 0.20, Jaro-Winkler name 0.15, date 0.10; auto-post at ≥0.85 with ≥0.15 margin over the runner-up — the margin rule is what saves two identical €1,450 studios in one building). Allocation ledger, never boolean paid: partials allocate FIFO and leave the residual open; overpayments become tenant credit; every auto-post reversible and audited. Review queue is keyboard-first with a one-keystroke IBAN-binding prompt that converts each manual match into permanent automation.
- **Arrears ladder** aligned with law: friendly (D+3) → formal (D+10) → mise en demeure by registered letter with AR evidence (D+24, manager-confirmed) → one-click justice-de-paix dossier export (D+45). Payment plans pause the ladder. **No utility-cutoff workflow exists anywhere in the product** (unlawful [V]).
- **Owner money without touching it**: owner ledgers at allocation time, monthly décompte de gérance with period locks, management-fee invoices always +17% VAT (the fee is taxable even though residential letting is exempt [V]), pain.001 payout files the manager uploads to their own e-banking, reconciled back from the outgoing statement. Dedicated third-party receiving accounts pushed as the onboarding default — one decision that is both the compte-de-tiers segregation story and the biggest matching-precision lever.
- **Realistic ramp**: month 1: 55–70% auto-match; month 3: ~80%; steady state 90–95%, capped by RF/QR adoption — if valid-reference share stalls below 50%, the fix is invoice UX, not matcher tuning.

### 4.4 End of tenancy

`NOTICE → PRE_EXIT → EDL → SETTLEMENT (50% at M+1 → balance after décompte) → CLOSE_OUT`

- **Notice intake both directions** with the validity engine: computed earliest lawful end date from AR receipt (not send date); prorogation-légale date guards on fixed terms; landlord ground validation blocking sale outright and auto-composing besoin-personnel letters with the locked art. 12(3) verbatim and evidence checklist; ≥18-year first-refusal interlock blocking sale marketing until the tenant's 1-month window resolves; colocation partial-departure child flow (dual notice fan-out, replacement-search evidence log, all-party avenant, intermediate EDL).
- **Pre-exit courtesy inspection** at end−35 days: a non-binding punch-list that converts would-be deductions into tenant-completed repairs — the strongest dispute-reduction and NPS feature in the flow, offered by no incumbent. Tenant exit checklist with the commune **departure declaration due the day before leaving** [V], supplier notifications, cleaning standard published in advance with photo examples.
- **Exit EDL as a photographic diff**: entry photos side-by-side with live camera per item; classification unchanged / normal wear-vétusté / tenant damage / improved; vétusté grid computing the deductible residual; sign-with-objections per line (objecting does not require refusing to sign — the key de-escalation); key handover timestamp is the legal anchor starting every deposit clock; huissier path generated when contested.
- **Deposit settlement engine**: versioned computation (deposit − arrears − justified damage − charge reserve); **1-month justification window enforced per line — unjustified lines auto-expire to FORFEITED**; staged release timers with a live penalty-exposure counter (10%/month); per-form handling (SEPA refund, bank-guarantee mainlevée letter, insurer/State-guarantee claim pack, guarantor notification); tenant-visible statement where every deduction links to its EDL line, photo pair and invoice; entry-EDL-missing gate zeroes damage deductions entirely.
- **Close-out**: final prorated décompte reconciles the reserve; archive freeze with per-class retention clocks and litigation holds; turnover work orders with cost provenance (no double recovery); vacancy clock and INOL defence file start at keys-back. Deceased-tenant path (lease continues for registered cohabitants ≥6 months [V]; comms to the deceased suppressed immediately) and abandoned-unit path (no self-help re-entry; huissier constat pack) are modelled, not improvised.

---

## 5. Go-to-market and monetisation

### 5.1 Sequencing

1. **Phase 0 (months 0–3): design partners.** 3–5 landlords/small managers (including the user's own portfolio) run the full lifecycle free. Deliverable: the four workflows proven on real tenancies, the reconciliation engine hitting ≥80% on real bank data, and the acceptance-gate conversation with Salt Edge and Enable Banking concluded in writing.
2. **Phase 1 (months 3–12): private landlords + small managers (1–50 units).** Self-serve, freemium below 3 units, €4–6/unit/month above. The tenant portal and the compliance engine are the pitch; the immocloud price ceiling (€0.80–2.00/unit effective) does not bind because immocloud cannot lawfully operate here and the localisation justifies the Smovin/GererSeul tier.
3. **Phase 2 (months 9–24): agencies.** The gestion module rides the athome-pricing resentment into agencies; listing syndication (immotop/nextimmo feeds) and the Morada.lu marketplace link make it a package no German or French tool can match. Per-seat + per-unit pricing; migration service (the real switching cost at pro tier is migration, not licence [V]).
4. **Phase 3 (18+ months, optional): syndic module** (per-syndicat accounts, AG machinery, appels de fonds — the RGD 1975 rules are specified in §3.4) only when agencies demand it; SDD collection via GoCardless master creditor-ID as a paid add-on once volume justifies the licensing analysis; deposit-alternative insurance partnership (a genuine white space in Luxembourg [V]) through a licensed broker, never direct distribution (CAA intermediation rules [V]).

### 5.2 Pricing architecture (initial hypothesis, to be tested in Phase 0)

| Tier | Target | Price | Includes |
|---|---|---|---|
| Free | ≤3 units | €0 | Core lifecycle, tenant portal, manual bank import |
| Landlord | 4–50 units | €5/unit/mo | Bank sync, reconciliation, indexation engine, tax pack |
| Professional | 50+ units / agencies | €4/unit/mo + €29/seat | Multi-mandate, owner statements, FAIA export, syndication feeds, API |
| Add-ons | — | — | QES signatures (per envelope), e-registered mail (per letter), SDD collection (bps), premium EDL (per report) |

Unit economics guardrail: at €5/unit/month, a 20-unit landlord pays €1,200/year — against which the product must demonstrably recover more (one avoided deposit-penalty month, one INDEXATION_LAG recovery, one avoided nullified notice). The ROI story is quantified in-product on the dashboard.

### 5.3 Risks and counters

| Risk | Likelihood | Counter |
|---|---|---|
| Progetis/Orisha modernises | Medium | Speed + tenant portal + private-landlord tier they ignore; their pricing opacity is our transparency wedge |
| athome launches gestion (Apax also owns idealista — capital and playbooks available [V]) | Medium | The compliance depth takes years; our tenant-portal data and agency trust compound; note the conflict: Apax owning both idealista and athome complicates any idealista-playbook framing |
| Salt Edge/Enable coverage gaps on a key bank (esp. BIL, POST) | High | CAMT.053 always-on; BIL direct developer portal; LUXHUB direct adapter as the nuclear option |
| Rent-ceiling reform (Observatoire proposal: ±7% corridor; PL 8184 cut to 3.5% [U]) | Medium | All constants are data; reform is a parameter update and a marketing moment ("we updated overnight") |
| AML scope widens to managers | Medium | Two-tier onboarding already built; flip the default |
| Slow SaaS adoption by conservative landlords | High | The tenant portal creates pull; the fiduciaire channel (tax pack + FAIA) creates push; free tier removes friction |

---

## 6. Build order (first two quarters)

**Q1:** Identity + org/mandate/property/lease core with the residential rules pack; lease generator with the 8-mention gate and AES signing; digital EDL (walkthrough, hash chain, meters, sealed PDF) + defect window; tenant portal v1 (requests with SLA timers, documents, attestation self-service); manual bank import (CAMT/CSV) + matching cascade + review queue.
**Q2:** Enable Banking AIS integration behind the connector interface + consent machine; rent run, avis with RF+QR, VoP onboarding; arrears ladder + registered-letter objects; charges/décompte with syndic import; indexation engine + INDEXATION_LAG; exit workflow + deposit settlement engine; owner statements; immotop feed adapter.

**The eight open items to resolve before freezing constants** (from the research briefs): (1) deposit first-tranche deadline 1 vs 2 months — read art. 5 on Legilux; (2) revaluation-coefficient publisher and current values — obtain Circulaire 3/25; (3) colocation article map and pacte mandatory/optional; (4) AED lease-registration fee (0.6% vs exempt/€12 conflict); (5) rent-ceiling reform status (PL 8184); (6) salubrité/habitability regime (possible per-unit occupancy caps and communal permits — potentially a whole module); (7) AML €10,000 letting threshold transposition; (8) smoke-detector duty split owner/occupant.

---

## Annexes

The four full workflow specifications (market-to-move-in; in-tenancy operations; rent collection & reconciliation; end-of-tenancy) and the five research briefs (tenancy law; fiscal/accounting; banking; competitive landscape; compliance/integrations) are archived in the project as companion documents. The Miro board "Morada Gestion Systems" visualises the system architecture and the four workflow state machines.
