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

### A tenancy's lifecycle is not its document's compliance

`g_leases.status` says whether the tenancy is **in force**: `active` (someone has the
keys, rent falls due each month), `notice`, `ended`. Whether the written lease is
**complete** under the 2006/2024 law (the eight mentions, the deposit ceiling, the pacte
de colocation) is a different fact: `validateLeaseDraft` derives it from the recorded
data, the dossier and the lease sheet show it, and nothing stores it. Deriving the first
from the second is exactly the bug that once left a let property reading as vacant: a
residential lease recorded through the guided flow can never carry the capital investi
declaration. The document generator still refuses to print a non-compliant lease. A lease
has as many `g_lease_parties` as people who sign it; `colocation` is the owner's explicit
answer, never a head count.

### The rental dossier is a draft lease, saved as the owner goes

The guided rental (`/app/biens/locataire`, nine steps in `src/lib/gestion/rental-flow.ts`)
writes the dossier to the database from its first step: `POST /api/locations/save` →
`saveRentalDraft` creates or updates one `g_leases` row with `status = draft`, its people
as contacts and `g_lease_parties`, its guarantee as a `g_deposits` row, its payer account
as an `g_iban_bindings` row, and the flow's memory (which steps are completed, the step
saved from, the payer's name) in `details.dossier`. Every step offers Back, "Enregistrer et
continuer plus tard" and Next; both Next and save-later write the same request, so closing
the tab, refreshing or signing out loses nothing. A lot carries at most one dossier: a save
without a lease id continues the draft already on that lot rather than doubling it, and
"Ajouter un locataire" on such a lot redirects to it.

A draft never occupies its lot and owes nothing: the portfolio projection lists it under
`UnitLine.drafts`, the Biens card and the property sheet say "Dossier en préparation ·
X/9 étapes", and `dossierOf` (`src/lib/gestion/dossier.ts`) computes X from the rows plus
the memory (an inventory done from the property later counts; a rent cleared later reopens
its step; a row written before the flow kept a memory is read from its rows alone).
"Reprendre" reopens the flow at the first step not completed, with everything saved.
Only the ninth step, or "Activer la location" on the sheet, calls `activateLease`: it
refuses a dossier with nobody on it or no rent (`incomplete`), a lot already let
(`already_let`), and anything not a draft; otherwise it sets `active`, dates the
move-in and opens the ledger.

### One lot, one dossier, one tenancy: the rule lives in the database

Migration 0014 puts a trigger on `gestion.leases` (`leases_one_per_lot`, before insert
and before any change of `status` or `unit_id`, under an advisory lock per lot): at
most one draft per lot, at most one live lease (`active`, `notice`) per lot, and no
draft on a lot that is let. It refuses with a unique violation carrying a stable
message ("gestion: one draft dossier per lot", "gestion: lot already let") that
`saveRentalDraft` and `activateLease` translate. Rows that predate the rule are left
alone: a lot carrying a running tenancy and a stale draft keeps both, the sheet marks
the draft obsolete (no resume, no activation) and offers only to abandon it.

The lot's lifecycle, as every screen reads it: Libre, Brouillon (the dossier, resumed
by "Reprendre le dossier" wherever "Ajouter un locataire" used to be), Location active
(no second dossier, no add-tenant action), Départ (the seven-step flow below), Ancien
locataire in Historique, Libre again ("Ajouter un nouveau locataire"), a brand-new
dossier, a new tenancy on its own ledger. The former tenancy is never read or written
by the next one.

`discardDraft` abandons a dossier with everything that existed for it alone: parties,
guarantee, payer bindings, inventory sessions and items, insurance (the one row the
database sets to null rather than cascades, so it is deleted explicitly). The people
stay as contacts; the lot, the property and any other tenancy are untouched. The only
refusal is money: a period with an allocation or a payment on the row (`not_empty`).

### The departure is seven saved steps, and one confirmation

`/app/biens/depart` walks the date, the exit état des lieux (a journey of its own that
hands back to step 3), the meter readings (written on the meters, dated the departure),
the keys, what is still owed (with the count of future periods that will go), the
guarantee, and the confirmation. Each move saves where the departure stands in
`leases.details.departure` (`PATCH /api/baux/[id]`, `action: departure`); the tenancy
stays in force until `POST /api/baux/[id]/cloture` calls `closeLease`, which sets
`ended` and the end date, dates the move-out on the parties, drops the unpaid future
periods, records the deposit outcome and the key handover, and clears the departure
memory. The property sheet, the lease sheet and the Modifier menu offer the departure
on every running tenancy, as "Reprendre le départ" once one is under way.

The ledger keeps growing on its own: `gestion.roll_rent_periods()` (pg_cron, nightly)
applies the same month rule as `openLedger` to every live lease, inserting only what is
missing and never rewriting a period.

### The tenant portal is the same rows, read under the tenant's token

There is no tenant copy of anything. A tenant is a `contacts` row with a `user_id`
(their Morada account, the same `auth.users` as the owner's); `gestion.portal_tenant_lease`
says whether the signed-in account is a tenant party of a lease, and every `*_portal`
policy (0006, 0015) is that predicate applied to the lease's ledger, guarantee, états
des lieux, insurance, documents, interventions and threads. `my_home()`,
`my_lease_parties()` and `my_managers()` are the only doors to `leases`, `units`,
`properties`, `contacts` and the cabinet, each returning the restricted columns a tenant
may see; the tables themselves answer a tenant with nothing. Payments, bank rows,
internal notes and other tenants' contact details are behind no portal policy at all.

`src/lib/portal/tenant-space.ts` builds `TenantSpace` from those reads under the
visitor's own JWT (`getTenantView()` in `space.ts`), asking for the leases' and the
requests' own documents and threads by id; the four tenant pages render it and derive the
rest (`paymentsOf`, `rentSituation`, `alertsFor`). The home page is the latest tenancy in
force; another one running at the same time is listed as running (`others`), and only
ended ones are former (`past`). Late means due before today, the line the ledger's own
status draws. A tenant's request is a
`tickets` row (`source = tenant`) inserted under the tenant's token, its photos are
`documents` of the ticket in the lease's storage folder (`<org>/tickets/<lease>/`), and
its thread is the ticket-scoped `conversations` row opened with it, where both sides write
`messages`; the owner's Messages screen reads exactly these rows.

### One conversation per tenancy; a request is a message in it

Messages is a chat, not a ticket queue. Each tenancy has one `conversations` row
(`scope_type = 'lease'`, `scope_id = the lease`, one per lease by the partial unique index
`conversations_lease_one`, 0019), and both sides write `messages` on it: the tenant from
their space, the desk from `/app/messages`. Whoever writes first opens it
(`src/lib/portal/thread.ts`, `leaseConversation()`; a race is settled by the index and the
loser reads the winner's row); a tenancy nobody has written to yet is still listed at the
desk (`lease:<id>` stand-in, `POST /api/baux/[id]/messages` opens it on the first word).

A tenant's request is a `tickets` row (`source = tenant`) and, in the conversation, the
message that carries it (`messages.ticket_id`, 0019): the card in the chat reads the
ticket's title, status, description and photos (`documents` of the ticket in the lease's
storage folder, `<org>/tickets/<lease>/`); the message is only its place in the thread and
its read state. A conversation therefore holds normal messages and any number of requests
over time, in one chronology that both sides read from the same rows. The four statuses the
desk tracks (à traiter, en cours, résolue, refusée) are the ticket's own nine folded by
`requestStatusOf()` and written back by `ticketStatusFor()` (`new`, `in_progress`,
`done`, `cancelled`); the tenant's space reads the same column through `requestState()`.
Resolving or refusing dates `closed_at`; reopening clears it. Read/unread is
`messages.read_at`, marked when the desk opens the conversation, and says nothing about a
request. A request becomes an intervention only when the desk opens a `work_orders` row on
it ("Créer une intervention", idempotent; `isIntervention()` decides what Interventions
lists); the conversation and the photos are untouched.

Writes: the tenant's in `src/lib/portal/requests.ts` behind `POST /api/locataire/messages`
(a message, on the tenancy `my_home()` names, never on an id the client supplies),
`POST /api/locataire/demandes` (the ticket, then its anchor in the conversation) and
`/api/locataire/demandes/[id]/pieces` (photos); the desk's in
`src/lib/gestion/requests.ts` behind `POST /api/conversations/[id]/messages`,
`POST /api/conversations/[id]/lu`, `POST /api/baux/[id]/messages`,
`PATCH /api/demandes/[id]` (status), `POST /api/demandes/[id]/messages` (a reply where the
request sits) and `POST /api/demandes/[id]/intervention`. Every desk route looks the row up
in the active workspace under the caller's own token first, so an id from another
workspace answers 404 and nothing is written; the policies decide the rest (maintenance
for tickets and work orders, tenants for conversations and messages; on the portal side,
0019 lets a tenant read and write the conversation of any lease that is theirs, anchor only
their own ticket, and open nothing on a lease that is not theirs). The screens:
`src/components/gestion/MessagesCenter.tsx` (Conversations, the chat with request cards and
"Voir la demande", and Demandes, the tracking table whose rows open the conversation at the
request) and `src/components/gestion/TenantChat.tsx` (`/locataire/messages`; Demandes keeps
the list, a request's page links into the conversation). After the tenant leaves, the
conversation, its requests and its photos stay with the ended lease: the former tenant still
reads them and may still write, and can open no new request (the insert policies require a
lease in force); the next tenant of the lot gets a conversation of their own and sees none
of it. 0019 also folded the request-scoped threads of the first version into the tenancy's
conversation and gave every existing tenant request its anchor.

On a phone (below Tailwind's `lg`, 64rem) `MessagesCenter` shows one pane at a time, the way a
messaging app does: the list alone, most recent conversation first, and a conversation filling
the screen once tapped (header and composer fixed, the messages scrolling between them, a way
back to the list where it was left; Demandes the same way, as a list of rows that open the
conversation at the request). It is the same component and the same rows on every screen size:
which pane a phone shows is a class the stylesheet reads (`max-lg:hidden`, `PhoneView`), and a
laptop keeps the list and the open conversation side by side. Nothing about the data, the
policies or the API changes with the screen.

Invitations are `portal_invites` rows minted by `portal_invite_lease` (a party of a live
lease, an e-mail, a token returned once and never listed): sending again revokes the open
one of that lease (0017; a person on two lots keeps the other lot's link), `portal_revoke`
dates a revocation, and the five owner-side states (Non invité, envoyée, acceptée, expirée,
révoquée) derive from the row's dates in `inviteState()`. The link in the e-mail is built on
`APP_URL` (`NEXT_PUBLIC_APP_URL`, else the production origin), never on the request's Host
header.
`public.gestion_invite_preview` shows the link's holder enough to recognise the home
before signing in; `portal_accept` links the account to the contact inside one
transaction (row lock, idempotent for the same account, refused for another address,
another account or a used, revoked or expired link). The rental wizard reuses a contact
already known by its e-mail when it is the same person (a natural contact of that name,
whatever the case the address was typed in), so a returning tenant keeps one contact, one
account and their whole history; another person, or a company, on the same address is
never folded onto that card: the workspace keeps one live contact per address
(`contacts_email_active_key`) and the dossier answers `email_taken`. Every path that
writes a contact lower-cases the address. An account that is a tenant and has no workspace
(`gestion.is_tenant()`, the predicate behind `my_home()`) is sent to `/locataire` instead
of being provisioned a management space, and opens one on purpose
(`POST /api/espace/creer`). E-mail leaves through Resend when `RESEND_API_KEY` is set;
otherwise the invitation is still valid and the owner passes the link on.

### The door: two forms, and a session that is chosen, never assumed

`/connexion` is the only way in, for a manager and a tenant alike, and it runs against
the Morada account system (`auth.users`, the same sign-up shape as morada.lu). Four
rules keep two accounts on one browser from tripping over each other:

- **"Se connecter" and "Créer un compte" are two components with two states**, mounted
  one at a time and remounted on every switch. What a password manager put in one never
  travels into the other; an address is handed across only on purpose (an invitation
  link, or "this address already has an account", which opens sign-in on it).
- **Fields are read from the form at submit time**, not from React state: Safari fills
  saved credentials without firing input events, and a controlled input would submit
  empty strings over a visibly filled form. The fields say what they are (`email`,
  `current-password`, `new-password`, `given-name`, `family-name`) and nothing fights
  the password manager.
- **The account system's answers are read into stable outcomes** (`src/lib/auth/outcomes.ts`,
  by error code first, message second): wrong credentials, an unconfirmed address (with
  the confirmation link on offer again), too many attempts, an unreachable system, and an
  address that already has an account, whichever way Supabase says it (the
  `user_already_exists` error, or, with e-mail enumeration protection on, the look-alike
  user with no identity that would otherwise read as "check your inbox").
- **A visitor the cookie already identifies is shown that and chooses**: continue with
  that account, or "Utiliser un autre compte", which signs the previous account out
  everywhere (global scope, cookie and mirror cleared whatever the network did) before
  the forms appear. The door never bounces a signed-in visitor past itself, so a second
  account can always be created or signed into from it. Only a session arriving from a
  link (the confirmation e-mail) is followed automatically.

The session itself lives in the `morada_auth` cookie on `.morada.lu`
(`src/lib/sessionCookie.ts`), read and verified server-side on every request
(`getUser`, never a decoded token). A sign-out erases both the parent-domain cookie and
any host-only twin; a localStorage session is adopted into the cookie once, on the first
run after the switch, and never again: once the cookie has been the record on a browser,
its absence means signed out, so a stale mirror cannot sign the previous account back in.
morada.lu's own client still keeps its session in localStorage only (reference clone of
27 August 2026), so the two origins do not yet share a sign-in; a global sign-out on
either side still revokes the other's session server-side. The invitation page compares
the signed-in address with the invited one and `portal_accept` refuses any other account,
so a link opened on the wrong account is named, never attached.

### A field keeps the caret: two rules, two guards

Every input on every screen is typed into one key at a time, on a phone as much as on a
desk. Two things took the caret away after one character, and both are now forbidden
by construction:

- **No component is declared inside another component.** A `const Card = () => …` inside
  a wizard is a new component type on every render, so React unmounts and remounts
  everything under it, the field included, on each keystroke. Wrappers live at module
  scope (`WizardChrome.tsx`: `StepCard`, `WizardFooter`), and what changes is passed as
  props. The lint rule `react/no-unstable-nested-components` fails the build on any new
  one.
- **A dialog's focus effect runs on the open transition only.** `Modal` and the meter
  sheet move focus into the panel when they open and give it back when they close; that
  effect depends on `open` alone and reads `onClose` through `useLatest()`, because the
  inline handler every screen passes is a new function on each render and, as a
  dependency, it re-ran the effect (and its focus call) on every keystroke.
  `src/components/__tests__/focus.test.tsx` types into a dialog and a wizard step under
  jsdom, re-rendering the owner on each key, and asserts the caret stays.

`autoFocus` is used nowhere: on iOS it does not open the keyboard, and a field-level
workaround is not a fix.

### A building is read as a whole, and each lot as a sheet of its own

`/app/biens/[id]` renders a home (one lettable lot) as one sheet, and a building as a
whole: the photograph, the name, four figures (`buildingStats()` in
`src/lib/gestion/building.ts`: lots, occupied and free, occupancy rate, monthly total,
late rents) and its lots as cards (`LotGrid`, filtered by family, searched, shown as a
grid or a list). Every figure is derived from the portfolio projection, the same one the
Biens cards use, so a building can never disagree with its lots. A lot opens at
`/app/biens/[id]/lots/[unitId]` with the tabs of a home, computed on `lotCard()`: the
building's card cut down to that lot with `scope: "lot"`, so the shared tab renderers
(`sheet.tsx`) narrow their lookups to that lot's units. The tenancy, the wizard, the
departure, the tenant portal and the documents are the same rows and the same flows: a
building's "Location" link is sent to the lot it names. Lots carry a photograph of
their own (`units.photo_url`, 0016) in the property's storage folder; the tenant's home
shows it first.

### The ledger's calendar is one rule, and the checklist reads the rows

`src/lib/gestion/ledger.ts` decides which months a live lease's ledger holds and when
each one is owed (the payment day, never before the tenancy starts, never after its end);
`openLedger` writes it, `gestion.roll_rent_periods()` mirrors it nightly, and the portfolio
projection reads its "next due" from it, so a card, a sheet and the database agree on a
date. The getting-started card ticks what the account's rows attest (a property, a contact,
a running lease, a bank account, a received rent); a browser only remembers whether it is
collapsed or dismissed. A page restored from the browser's back-forward cache is refreshed
from the server on `pageshow`.

`scripts/e2e-real.mjs` runs the rental lifecycle on the real path, with a real Supabase
session, the app's own API routes and its server-rendered pages (PostgREST under RLS,
`getDemo()` → `buildRealData()`): a dossier saved and left from three steps, the property
read for "X/9 étapes" and "Reprendre" after a real browser reload, then the activation
and the occupied lot. It needs a disposable Supabase project and network access to it;
the unit suite (`lifecycle.test.ts`) covers the same functions offline.

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
studios out of the wrong ledger). Review-queue actions are written: a match becomes a
payment with FIFO allocations through `recordPaymentFifo` (`src/lib/banking/allocate.ts`,
the one writer manual payments and the matcher's auto-posts share), and, when asked, an
`iban_bindings` row, so each manual match becomes permanent automation; ignore and
reopen move the operation out of and back into the queue. Operations arrive through Salt
Edge when configured (`SALTEDGE_APP_ID` and `SALTEDGE_SECRET`, server only; while the Salt
Edge app is in its Pending or Test status only its fake banks answer, and
`SALTEDGE_FAKE_PROVIDERS=1` lists them in the consent journey; a sample cabinet runs the
same journey on `SALTEDGE_DEMO_PROVIDER`, `fakebank_simple_xf` by default, for a demo
customer of the signed-in account, reads the answer live on return and stores nothing; the
provider's class of refusal reaches the button and `/api/banking/health`), or through the
CSV statement import (`src/lib/banking/csv.ts`:
delimiter detection, headers in four languages, credit/debit or signed columns, every
European amount notation, a stable id per line so a file imported twice lands once), into
an existing account or a manual one named with its IBAN and registered holder.

### The arrears ladder is rows, not clicks

`arrears_actions` holds each step the desk recorded for a period (friendly, formal, mise
en demeure, justice file), and a mise en demeure carries its `registered_letters` row:
dispatched on a date, then `ar_received_on` when the AR comes back, from which
`legal_effect_on` derives. The Loyers page reads both, the ladder engine assesses what is
next, and the justice-de-paix file is refused until the AR is in hand (`POST
/api/baux/[id]/relances`, `PATCH /api/lettres/[id]`). The sample cabinets carry the same
rows; a sample plays the outcome and writes nothing.

### Operations are rows too: guarantees, interventions, décomptes, adjustments

The same shape holds for the rest of a tenancy's life. A guarantee moves only along
the transitions `src/lib/gestion/deposits.ts` allows (received, restitution open once
the keys are back, dispute declared and closed); its retentions are `deposit_deductions`
rows (damage without a signed entry `edl_sessions` row is written `blocked_no_entry_edl`
and retains nothing), a justification is a piece uploaded to the register for that very
line (a `documents` row of class `invoice` with its file in the bucket) and dated, and the
settlement engine re-run on the rows decides whether it landed in time; money leaves through `POST /api/garanties/[id]/liberation` alone, for the
engine's tranche amounts, the balance refused before `decompte_issued_on`. An
intervention is a `work_orders` row walking the table in `src/lib/gestion/interventions.ts`
(`PATCH /api/interventions/[id]`), the ticket's status and `closed_at` following each
step so the tenant's request and the desk's chantier never disagree, the artisan's invoice
uploaded with its step and pointed at by `invoice_document_id`. A charges décompte
is a `charge_periods` row per lease and year with its `charge_lines` computed once
through the recharge engine (`src/lib/gestion/charges.ts`: lot share by tantièmes or as
entered, tenant share zero on a residential hard block), the advances read from the
ledger's `charges_cents`; issuing it dates it and carries a positive balance onto the
first open `rent_periods` row of the month as `other_cents` / `other_label`. A
residential adjustment is a `registered_letters` row of template `rent_adjustment`
(`POST /api/baux/[id]/indexation/courrier`, one in flight per lease), and `POST
/api/baux/[id]/indexation` applies the engine's proposal only once that letter's AR is
recorded, from the first day of the month after the AR date
(`src/lib/gestion/indexation.ts`), never from a date the request names. The four pages
(Garanties, Interventions, Charges, Indexation) render sample and real accounts through
one path (`CHARGE_PERIODS`, `TICKETS[].workOrder`, `REGISTERED_LETTERS`); a sample
plays each outcome and writes nothing.

### Pieces are files, bills are rows, and a screen reads only what it shows

A piece in the register is a file in the private `gestion-media` bucket under
`<org>/documents/<uuid>.<ext>` and a `documents` row carrying its name, class, SHA-256,
size and the record it hangs off (`related_type` / `related_id`: a property, a lot, a
tenancy, a contact, a request, a retention line, a work order, a bill). `POST
/api/documents` (`src/lib/gestion/documents.ts`, `storeDocument`) writes both under the
caller's own token: the bucket's policy decides the folder (its first segment is the
workspace), the table's the row; a record that is not the workspace's answers not found,
a kind the bucket does not take 415, a file over 25 MB 413. The file is served by `GET
/api/documents/[id]/fichier`, a redirect to a 60-second signed address made only after
the row was read under the caller's token, so an id typed into an address opens nothing
of another workspace. The retention's justification and the artisan's invoice are such
pieces (`ownedDocument` checks that the piece was uploaded for the very line or work
order before the row points at it); a sample cabinet's documents are references and say
so on a real account.

A bill is a `gestion.bills` row (0020): direction, supplier contact, lot and property,
fiscal bucket as category, subject, number, dates, `amount_cents` the total and
`vat_cents` derived once from the rate (`src/lib/gestion/bills.ts`, `splitVat`),
`paid_on` set by `PATCH /api/finance/factures/[id]` and never in the future, its invoice
or receipt a piece related to the bill; `POST /api/finance/factures` stores the piece
first and discards it if the row is refused. The owner statements, fees and transfers
stay a sample play until mandates exist on real accounts.

The real loader (`src/lib/demo/data-real.ts`) reads what the screen asks through a
`ReadScope` (`src/lib/demo/scope.ts`), never a workspace whole. The shell
(`{ shell: true }`) reads the portfolio, the people, the tenancies and their parties, the
unread and review badges, and one paid period. A page with no scope reads the portfolio
and the last 24 months of history (rent periods, bank operations, requests, readings,
letters, bills), plus every arrear still owing whatever its age and every bank operation
still in the queue. A tenancy's sheet (`{ leaseId }`) reads its whole past; a property's
(`{ propertyId }`) its lots, their tenancies, requests, pieces and books; Messages
(`{ conversationId }`) one conversation in full (the one named, else the most recent), the
others through the `conversation_heads` view (last message, unread count) and read in
full when opened; Documents (`{ documents: { page, size } }`) one page of the register with
its count. Inventories count their items and photos through `edl_session_counts`. Both
views run as the caller (`security_invoker`). On a production project where 0020 is not
applied yet the previews are empty and there are no bills, the bill routes answer 503
`schema_outdated`, and nothing else changes.

### The paper trail: validated templates, one renderer, sealed pieces, a journal

Every document the application produces (`src/lib/documents/kinds.ts`: the notice of a
month and its receipt, the formal reminder and the mise en demeure, the adjustment
notice, the charges statement, the guarantee settlement, the contract, the housing
certificate, the inventory report) is made the same way. The wording is a template
written explicitly per language in `src/lib/documents/wording/<lang>.ts` (French only
today; nothing is translated on the fly, and a language without a template is refused),
each kind carrying a version, the notes that say what a validator validates and the
legal parameters it prints. A workspace validates a (kind, language, version) from
Réglages (`gestion.template_validations`, 0022) after opening its preview, the same
composer over fictitious values watermarked as such; a changed version asks again, and
`POST /api/documents/generer` answers `template_not_validated` until then. The lessor's
identity and the account tenants pay into are one row (`gestion.workspace_settings`),
saved from Réglages and checked once (`settings-rules.ts`: the IBAN by its ISO 7064
remainder, the holder kept as typed); a document that prints payment instructions is
refused with the fields still missing.

`assemble.ts` reads the rows the document is about under the caller's token (a source id
of another workspace answers not found) and `compose.ts` fills the template into a model
of blocks, every legal figure read from the registry as of the document's date with its
status; `render.tsx` draws the model with `@react-pdf/renderer` (the EPC payment code on
a notice through `qrcode`). The PDF is stored by `storeBytes` as a sealed `documents` row
related to the tenancy, with its SHA-256, and `gestion.generated_documents` records the
kind, language, template version, source and the hash of the data it was made from.
Asked again for the same source, the register hands the same document back; a new
version is explicit (`force`) and keeps the first. A receipt exists only for a period the
allocations say is paid, a settlement only once the keys are back, an inventory report
only once the session is sealed: `POST /api/edl/[id]/photos` stores each picture under
`<org>/edl/<session>/` chained to the previous one's fingerprint, `POST /api/edl/[id]/
sceller` hashes items and photos into one manifest (`manifest.ts`), fixes it on the
session and produces the report. The mise en demeure and the adjustment letter keep the
content they were sent with (`registered_letters.content`), so their documents are
regenerated from the snapshot, never from rows that moved since.

Tenants read what is theirs through the policies that already exist: the pieces related
to their lease (`documents_portal_select`), their files through the bucket's portal
policy extended to `<org>/documents/` objects whose row they may read, the account to pay
through `gestion.my_payment_instructions()` and nothing else of the settings. The base's
journal (`gestion.audit_log`, fed by `gestion.audit_row()` triggers on the tables with
legal effect) records every write with its actor; Réglages shows it.

### Delivery: an outbox, one sender, notifications both ways

Every e-mail the application composes is a row of `gestion.deliveries` (0023): its kind
(a document, a word from the desk, a word or a request from the tenant), the lease and
piece it is about, the address and language it went to, its subject and text, and what
became of it: `sent` through Resend when the deployment carries `RESEND_API_KEY`
(`src/lib/mail.ts`, one HTTP call, attachments as base64, the workspace's own address as
reply-to), `not_configured` when it does not (the row is still written, and Réglages says
so plainly), `rejected` or `unreachable` otherwise. The wording is the dictionaries' own,
in the reader's language (`src/lib/delivery/compose.ts`): a contact's recorded language
for a tenant, the workspace's document language for the desk. Nothing legally significant
is ever said in an e-mail: the document attached carries it, from its validated template.

A produced piece is mailed from its control (`POST /api/documents/[id]/envoyer`,
`sendDocumentByMail`): the PDF is read from the bucket under the manager's token and goes
to every tenant of the lease with an address, one outbox row each; a piece that is not a
lease's, or has no file, is not found. A word from the desk (`addManagerMessage`, from
the lease, the request or the conversation) tells the tenants when
`workspace_settings.notify_tenant_messages` allows it; a word or a request from the tenant
(`addTenantMessage`, `createTenantRequest`) tells the desk when `notify_manager_messages`
does, through two portal functions the tenant's token may call and nothing else:
`gestion.portal_notification_target(lease)` hands out the desk's address and the two
flags for the tenant's own lease, `gestion.portal_record_delivery(...)` leaves the outbox
row on that lease. Neither notification ever fails the write it follows. Réglages carries
the two toggles, the sender's state and the last fifty rows of the outbox.

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

## Quality gates

Continuous integration, the end-to-end suite against a throwaway local Supabase, the
database security audit and error monitoring are described in docs/QUALITY.md. In
one line: every push runs typecheck, lint, 330 tests and the build, then the real
flows (sign-up, sign-in, two accounts on one browser, property, rental dossier to
activation, invitation accepted by a new account, isolation, departure, typing) in a
real browser through the same policies as production.

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
