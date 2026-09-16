# Morada Gestion — Architecture

## The one-sentence version

A pure, fully-tested TypeScript domain layer encodes Luxembourg letting law and fiscality
as *data-driven engines*; a Supabase schema with row-level security persists the domain;
a four-language (FR/EN/DE/LU) Next.js admin portal in the Morada design language renders everything
**through the engines** — never around them.

## Layers

```
┌─────────────────────────────────────────────────────────────┐
│  src/app/app/*            18 admin modules (Next.js, RSC)   │  UI computes via engines
├─────────────────────────────────────────────────────────────┤
│  src/lib                  types + status metas + demo data  │  swappable data seam
├─────────────────────────────────────────────────────────────┤
│  src/domain               pure engines, zero I/O, 113 tests │  the product's truth
│    └ legal/params.ts      versioned legal-parameter registry│
├─────────────────────────────────────────────────────────────┤
│  supabase/migrations      schema + RLS (g_can predicate)    │  production persistence
└─────────────────────────────────────────────────────────────┘
```

### Why the engines are pure

Every legally significant computation (a rent ceiling, a deposit penalty, an amortisation
schedule, a matching decision) must be: unit-testable against the statute, replayable for
audit ("show me the computation snapshot that justified this notice"), and identical in
the UI, in background jobs and in exports. Pure functions over explicit inputs are the
only architecture that guarantees all three.

### The legal-parameter registry

`getParam(key, onDate)` resolves a constant **as of a date** — a 2023 computation uses the
3-month deposit cap, a 2025 one uses 2 months; the energy amortisation rate flips 6→10%
at `2026-01-01` in data, not in an if-statement. Every row carries `status:
"verified" | "uncertain"` mirroring the research brief; engines and screens surface
uncertain values (the Conformité page lists them). A legislative change = a new row with
an `effective_from`, reviewed in the admin queue (`legal_params.confirmed`).

### Money

Integer cents everywhere. Derived amounts round half-up at the last step. Splits
(co-owners, tantièmes) use the largest-remainder method so parts always sum exactly —
`splitExact()` is the only splitting primitive allowed near a ledger.

### Paid-ness is derived

`g_rent_periods` has no `paid` boolean. The `g_rent_period_status` view derives
paid/partial/late/upcoming from non-reversed allocations + due date. Partial payments
allocate FIFO and leave residuals open; overpayments become tenant credit; every
auto-post is reversible (`reversed_at`) and audited.

### Registered letters gate legal effect

`g_registered_letters.legal_effect_on` is a **generated column from `ar_received_on`**.
Notice validity, mise en demeure effect and deposit-penalty clocks all read the AR date;
nothing legal ever derives from a click timestamp.

### The matching cascade (Banque)

Pre-classifiers (INDEXATION_LAG, subset-sum ≤6, non-rent) → Tier 1 deterministic RF
(ISO 11649, checksum-recovered from free text because Luxembourg retail apps have no
structured-reference field) → Tier 2 learned payer-IBAN bindings (the only tier that
captures third-party payers) → Tier 3 weighted fuzzy with the **margin rule** (auto-post
at ≥0.85 only with ≥0.15 margin over the runner-up — what keeps two identical €1,450
studios out of the wrong ledger). Review-queue actions suggest an IBAN binding so each
manual match becomes permanent automation.

### RLS model

One `security definer` predicate — `g_can(org_id, perm)` — behind every policy, resolving
role defaults (`g_role_defaults`) plus per-member overrides. Permission keys are the same
`gestion.*` strings as the Morada monorepo's `crm_has_perm`, so consolidating onto shared
identity later is a rename, not a redesign. STR filings are gated to
`gestion.settings.edit` only (no tipping-off). Manager-internal notes live in tables the
tenant-portal policies never reference.

### The CRM lift (from trycompai/crm, adapted)

- **Activity timeline**: one table for notes/calls/emails/meetings/tasks/system events,
  real nullable FKs (never a stringly polymorphic pair), `due_at`/`completed_at` **and
  `assignee_id`** (dispatching work is the core loop here — their `createdById`-only model
  was the one thing to invert).
- **Custom fields**: typed EAV (`text/number/date/bool/option`) with option rows,
  soft-archive, per-field display flags — every agency wants three fields you didn't
  think of.
- **Archive → purge lifecycle** with archive-scoped unique indexes (email frees on
  archive, live set stays deduped).
- **Transactional outbox** (`g_events`): the event row commits with the domain write;
  workers fan out after commit. A row, not an HTTP call.
- **Multi-role contacts**: `g_contact_roles` join table (owner of lot 3, tenant of
  lot 7) — their single `companyId` FK was explicitly rejected.

### Demo data seam

`src/lib/demo/data.ts` is a typed, engine-consistent portfolio ("today" = 2026-08-23):
an SCI with a 60/40 split, a jointly-taxed couple, a Belgian non-resident with a VEFA-2024
studio and an energy-renovated office building (exercising every amortisation regime and
the slot allocator), a colocation, a commercial lease with an active VAT option, an
indexation-lag payment, a review-queue third-party payer, a deposit settlement with a
pending justification, and a vacancy past the INOL threshold. Pages call the real engines
over this data — swapping in Supabase changes the data source, not a single computation.

## Production wiring (next)

1. Create the Supabase project (EU — Frankfurt/Paris), `supabase db push`.
2. Seed `legal_params` from `src/domain/legal/params.ts`.
3. Port Morada's `authClient.ts` pattern (single authenticated client, `morada_auth`
   storage key) for shared identity.
4. Replace `src/lib/demo` reads with `db().from("g_*")` per Morada's `api.ts` conventions
   (`.select("id")` after writes — RLS zero-rows must never read as success).
5. Banking: CAMT.053 ingestion first (permanent), Enable Banking behind the
   `BankProvider` interface, consent ladder T-14/7/2/0.
6. Tenant portal + artisan magic-link portal (Phase 2 of the strategy).

## Patrimoine: the object, not the module

An owner thinks about Appartement 3B, not about Baux then Garanties then
Compteurs. So the left rail names two things under Patrimoine — Biens and
Interventions — and everything else about a property is read from the
property.

**The projection.** `src/lib/gestion/portfolio.ts` turns `DemoData` into one
property-shaped view: lots, the lease in force on each, this month's period
from the ledger, occupancy, monthly total, the next due date. Both Patrimoine
screens read it, so a card and a sheet can never disagree, and a sample
cabinet and a real account compute identically because both arrive as
`DemoData`. It derives; nothing here is stored.

**Where the old modules live now.** The routes all still exist and still
answer to their name in ⌘K; they simply left the rail:

| Register | Read from |
| --- | --- |
| Baux | property → Location, and `/app/baux/[id]` as the rental dossier |
| Compteurs | property → Technique |
| Garanties, Indexation, États des lieux | property → Location, per lease |
| Assurances | property → Technique (building, PNO), Location (rent guarantee) |
| Charges | the lease's `charges_cents`, plus Finances for the syndic décompte |
| Interventions | portfolio-wide under Patrimoine, and per property — same rows |

**One lease path.** `src/lib/gestion/lease.ts` owns tenancy creation. The
quick-add dialog and the guided flow on a vacant lot both call it, so the
legal engine, the deposit and the rent ledger behave identically whichever
door the owner came through. An active lease with a rent and a due day IS the
monthly obligation: `createLease` opens the rent periods itself, and there is
no second switch anywhere to "start tracking" a rent.

**Media.** `properties.photo_url` holds a path into the private
`gestion-media` bucket (migration 0011), never a URL. `src/lib/gestion/media.ts`
signs those paths in one batched call per render under the caller's own token;
a property with no photograph draws the placeholder in `PropertyPhoto.tsx`
rather than a gap.

## The write layer: edit, end, archive

The audit that opened this work found a product that could only ever
accumulate: ten routes, all inserts, no way to correct anything. That is now
closed.

**One button.** Every change to a property goes through `Modifier` on its
sheet, grouped the way an owner thinks (`src/lib/gestion/property-menu.ts`
builds it). Nine of the entries are flat forms described as data
(`src/lib/gestion/editors.ts`) and rendered by one client component, so there
is a single save path and every editor behaves identically. Photos, payer
accounts, indexation and archiving own their own small interfaces because
they are not forms.

**Money is never rewritten backwards.** `repriceOpenPeriods` is the rule:
a rent change or an applied indexation re-prices periods from a chosen month
forward, and only those with nothing allocated against them. A month the
tenant paid, or part-paid, is the record of what happened. The endpoints
return how many periods moved so the owner is told rather than trusting it.

**Indexation is decided by the engine, not the request.** `/api/baux/[id]/
indexation` re-runs `proposeResidentialAdjustment` server-side and applies its
answer; the amount in the body is ignored entirely, and a proposal the engine
refuses comes back with the engine's reason.

**A departure closes, it never deletes.** `/api/baux/[id]/cloture` sets the
lease to `ended`, stamps `lease_parties.moved_out_on`, releases the lot, and
removes only the future periods nobody paid. Everything else stays: the
tenancy keeps its payments, its inventory and its documents and becomes the
property's history. `Historique` lists tenancies numbered in the order they
began — Location 1, Location 2 — each whole and read-only, with an explicit
`Corriger` rather than an edit in passing. Two tenancies are never merged.

**Nothing is deleted anywhere.** A property leaves the portfolio through
`archived_at`, and only once no lease is running on it.
