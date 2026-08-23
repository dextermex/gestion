# Morada Gestion

**La gestion locative, simplement.** The property-management SaaS of the Morada ecosystem —
built for Luxembourg, where the compliance layer *is* the product, not a feature.

A sibling application to [Morada.lu](https://morada.lu): same design language, same identity,
its own codebase and its own Supabase project (strategy §2.2).

## What this is

Three surfaces, one spine (this repo ships the first):

1. **Admin portal** (this app) — immocloud-style navigation (Workflows, Biens, Baux,
   Compteurs, Charges, Contacts, Loyers, Finance, Banque, Messages, Contrats, Documents)
   plus the Luxembourg modules that are the moat: Conformité, Indexation, Garanties,
   AML/KYC, Fiscalité.
2. **Tenant portal** (web + PWA, FR/DE/EN/LU/PT) — Phase 2.
3. **Artisan micro-portal** (magic-link only, no account) — Phase 2.

## Architecture

```
src/
  domain/          Pure TypeScript engines — the backend's beating heart. No I/O,
                   fully unit-tested (113 tests). Every legal figure resolves through
                   the versioned legal-parameter registry, never a hard-coded literal.
    legal/         legal_params registry: effective-dated, [verified]/[uncertain] flags
    lease/         Residential/commercial rule packs, termination validity, renewal calendar
    indexation/    Capital investi + 5% ceiling, 24-month/+10% adjustments, IPC clauses,
                   INDEXATION_LAG detection
    deposits/      Settlement engine: 50%/balance clocks, 1-month justification windows,
                   10%/commenced-month penalty, no-entry-EDL hard gate
    fiscal/        Amortisation (2/4/6/10% regimes, max-2-buildings taxpayer slots,
                   abattement spécial), modèle 190/210 tax pack, VAT (option to tax,
                   exemption mentions, management fee always 17%)
    charges/       Recharge hard-blocks (7 never-rechargeable categories), vétusté grid,
                   syndic décompte tantièmes mapping
    banking/       ISO 11649 RF references, EPC QR payloads, VoP name check,
                   3-tier matching cascade (RF → IBAN bindings → weighted fuzzy with
                   the margin rule), FIFO allocation ledger
    arrears/       D+3/D+10/D+24/D+45 ladder, registered-letter gates, plan pause
    compliance/    Deadline generators (CPE, commune, syndic 3y/AG 15-8d, licences),
                   INOL vacancy clock
    aml/           Two-tier CDD triggers, UBO chain resolution (>25%), risk scoring,
                   5-years-from-end retention
  app/             Next.js App Router — French-only admin UI in the Morada design language
  components/      pro/ui.tsx (ported verbatim from Morada), gestion bits, shell
  lib/             Types + status metas, demo dataset, hooks
supabase/
  migrations/      Full schema: org spine with g_can() RLS, ownership graph, leases with
                   rule-pack fields, derived rent-period status, EDL hash chain,
                   registered letters, banking, owner ledger, AML suite, retention classes
docs/              STRATEGY.md, FISCAL-BRIEF.md, ARCHITECTURE.md, DESIGN-SYSTEM.md
```

### Non-negotiable rules (from the strategy)

- **All legal constants are data, never code** — `src/domain/legal/params.ts` seeds the
  `legal_params` table; every value carries its effective-date range, source and a
  `verified`/`uncertain` flag. Engines consuming an uncertain parameter surface it.
- **Registered letters are first-class objects** — legal-effect dates derive from AR
  dates, never click dates; dependent workflows gate on letter state.
- **Money is integer cents; paid-ness is derived** from the allocation ledger, never a
  boolean. Splits use the largest-remainder method — a ledger never leaks a cent.
- **Every legally significant artefact is hash-sealed** (SHA-256), immutable after
  signature, corrected only by appended addenda.
- **Keys are blocked until the entry EDL is signed** — the legally fatal path (keys
  without EDL → deposit unusable for damage) is impossible by construction.

## Running

```bash
npm install
npm run dev        # http://localhost:3000 — redirects to /app
npm test           # 113 domain-engine tests (vitest)
npm run build      # full production build (51 static pages)
```

The app currently runs on a typed **demo dataset** (`src/lib/demo/data.ts`, "today" =
23 Aug 2026) so every screen is navigable and every figure passes through the real
engines. Production wiring: create a Supabase project (EU region), run
`supabase db push`, and swap the demo layer for the `@supabase/supabase-js` client — the
schema, RLS policies and permission keys are ready and mirror Morada's crm spine
(`g_can()` ≙ `crm_has_perm`) so single-sign-on consolidation stays a rename.

## Provenance

- Design system, tokens, UI kit and shell geometry: ported verbatim from
  `dextermex/morada` (the canonical Morada.lu design language).
- CRM patterns (activity timeline, typed custom fields, facet-counted lists,
  archive→purge lifecycle, transactional outbox): adapted from the open-source
  [trycompai/crm](https://github.com/trycompai/crm) architecture, re-modelled for
  multi-role contacts and multi-tenancy.
- Legal layer: `docs/STRATEGY.md` (product spec) + `docs/FISCAL-BRIEF.md`
  (Luxembourg fiscal, accounting & lease-law brief 2026) — the uncertainty register
  lives there; open items are flagged `[uncertain]` in code and UI.
