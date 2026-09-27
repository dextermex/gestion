# Handover to Astra: Morada Gestion

27 September 2026. Written at the end of the build sessions that delivered Slices 1 to 4B
and the Salt Edge bank connection. The product owner is Alexandre Decker: he decides the
scope of every slice and approves anything that touches production.

## In one paragraph

Morada Gestion is the Luxembourg property-management app of the Morada ecosystem
(Next.js 15, React 19, Tailwind 4, Supabase, Vercel), in four languages: French (the
reference), English, German and Luxembourgish. The code is ahead of production. Every push
deploys it, but the last two database migrations (0022 paper trail, 0023 deliveries) are
waiting for the owner's approval, e-mail is not configured, and error monitoring is off.
The Salt Edge bank connection now opens its consent journey in test mode; nothing has been
imported from a real bank yet. CI is green on the last commit.

## At a glance

| | |
|---|---|
| Repository | `dextermex/gestion`, one branch: `claude/morada-property-management-ve2hla`. It is the default branch. There is no `main` and no open pull request. |
| Production | `app.morada.lu`, Vercel project `morada-gestion` (team AURA SOCIETY LLC). Every push to the branch deploys it. |
| Second deployment | `morada-gestion-preview.vercel.app`, Vercel project `morada-gestion-preview`, same branch. **Not a sandbox: it uses the production database.** |
| Database | Supabase project `lgmoocvumiuqjcqnrlej`, **shared with Morada and Morada Pro**. This app owns the `gestion` schema; identity, workspaces and members come from Morada's tables. |
| Last commit | `79cdda1`, CI run 53 green: typecheck, lint, 339 unit tests, production build, RLS audit, 85 Playwright runs (62 tests on Chromium, a subset again on iPhone WebKit). |
| Not this repository | Vercel project `morada-gestion-web` (repository `dextermex/morada-gestion-web`) holds the `morada.lu` domains and has its own handover. |

## Read before changing anything

1. `CLAUDE.md`: the eight non-negotiables (legal constants are data, money in integer
   cents, legal effect from AR dates, design fidelity to Morada.lu, badge colour maps,
   engines over the active dataset, typed dictionaries, copy style).
2. `docs/STRATEGY.md`: the product spec, authoritative on scope. Its banking section
   predates what shipped (see Known risks and debts).
3. `docs/ARCHITECTURE.md`: layers, RLS model, the read seam, paper trail, delivery, banking.
4. `docs/QUALITY.md`: what CI checks and how to bring the E2E stack up locally.
5. `supabase/applied/APPLIQUE.md` (French): what is applied to production, when, and how
   each migration was audited before and verified after.
6. `docs/DESIGN-SYSTEM.md`, `docs/FISCAL-BRIEF.md` (legal brief and uncertainty register),
   `docs/DEPLOY.md`.

## The owner's standing rules

Given explicitly over the project and still in force. Several were written in French; the
meaning is kept here.

**Production and data**

- Nothing may break Morada, Morada Pro, Supabase, existing users, listings, agencies,
  data, RLS policies or migrations.
- No `DROP TABLE`, mass deletion or destructive replacement without his explicit
  agreement. Never delete, rename or overwrite an existing table without first checking
  what uses it. Do not change his production rows without agreement.
- A migration reaches production only on his explicit approval: re-audit first (schema
  drift, policies, the `g_can` hash), apply, verify, record the result in `APPLIQUE.md`.
  Files in `supabase/applied/` are replayed automatically on CI's throwaway database by
  `e2e/db/prepare.mjs`, never on production.
- Never touch `public.g_can`. The md5 of its `pg_get_functiondef` must stay
  `60d98f80cccaa74f02b4afb1ebd6b859`.
- Demo data must never be migrated, reused as real data, injected into the production
  database, or used as a fallback when real data is missing.

**Security**

- A user who edits a URL or an ID must never reach another user's data. RLS decides,
  server routes check, and the E2E flows forge IDs to prove it.
- No service-role key anywhere in the app. Never weaken a policy or reach for elevated
  access to make a test pass.
- Secrets live only in Vercel environment variables: never in the repository, never in a
  `NEXT_PUBLIC_*` variable.
- On Vercel, never create a project on another account to work around a problem.

**Scope and quality**

- The owner defines each slice. His last scope instruction before the banking work: do not
  start Slice 5 or unrelated features.
- Do not invent or machine-translate legally significant wording. Legal documents come
  from templates validated per language and per workspace. Only French templates exist.
- A bug is not fixed because database rows exist or an in-memory fake passes. The real
  flow has to work.
- Reuse the existing test infrastructure. No duplicated test systems, no unnecessary
  dependencies.
- Messaging: one conversation per lease, a tenant request is an item inside it. Do not
  create new backend models or duplicate conversations.
- Do not change the navigation or design of the Propriétaire (owner) space unless asked.

## Working conventions

- Commands: `npm run dev`, `npm run build`, `npm test` (vitest), `npm run lint`,
  `npm run typecheck`, `npm run e2e` (needs Docker, see `docs/QUALITY.md`).
- A push to the branch redeploys both Vercel projects in about two minutes and runs CI:
  the checks job takes about 2 minutes, the E2E job about 13.
- Commit messages are in French and authored as Alexandre Decker. A push that turns CI red
  is fixed forward straight away.
- Sample cabinets: Cabinet Reuter (French records, `src/lib/demo/data.ts`, the reference)
  and Cabinet Majerus (Lëtzebuergesch overlay, `data-lu.ts`, same ids and figures), picked
  from the sidebar, cookie `morada_dataset`. They never write. Real accounts read
  `data-real.ts` under the caller's own token, through the same `getDemo()` seam.
- Local look at a new account's empty screens without a session: `MORADA_PREVIEW_EMPTY=1`.
  Development only, never in a deployed environment.

## What exists

32 manager screens under `/app` (plus the bank return relay), the tenant portal under
`/locataire` (6 pages, bottom navigation on phones), sign-in at `/connexion`, and 58 API
routes that write, all under the caller's own Supabase token.

| Slice | Commit | What became real for live accounts |
|---|---|---|
| Before Slice 1 | up to `c8674ad` | Properties, lots, dossiers and leases through wizards; tenant portal and invitations; one conversation per lease with requests inside it (migration 0019); WhatsApp-style messages on phones; responsive pass for iPhone and Safari. |
| 1 | `c8674ad` | CSV bank statement import; matching cascade whose review queue writes payments (FIFO allocations) and payer IBAN bindings; arrears ladder recorded, with registered letters and AR dates. |
| 2 | `a9273e9` | Guarantees (retentions, décompte, releases, disputes); intervention lifecycle; charges décompte per lease and year; indexation letter by registered post, applied from the AR date. |
| 3 | `3aa142a` | Bills stored as documents plus expense records with real file uploads; owner document uploads; bounded server-side reads. Migrations 0020 and 0021, applied. |
| 4A | `081c827` | Paper trail: writable lessor and payment settings, per-workspace template validation, one PDF renderer, sealed documents (SHA-256) in the register, rent notices with RF reference and EPC QR code, quittances, arrears letters, indexation notice, charges statement, guarantee settlement, lease document, housing certificate, EDL report with a photo hash chain, audit journal. Migration 0022, **not applied**. |
| 4B | `a536335` | Delivery: an outbox row for every composed e-mail (`gestion.deliveries`), sending a generated document to the tenants of a lease, message notifications in both directions. Migration 0023, **not applied**. |
| Banking | `25c877d` to `79cdda1` | Salt Edge v6 consent journey working in test mode. See the Banking section. |

The only job that runs on a clock is the nightly rent roll: `gestion.roll_rent_periods()`
through pg_cron at 00:10 UTC (migration 0012).

## Production versus code

| Item | State | Consequence | What it takes |
|---|---|---|---|
| Migration 0022, paper trail | Proposed, not applied | Lessor settings, template validation, generated documents (the sealed EDL report included) and the audit journal cannot work on real accounts. | Owner approval, then the procedure written in `APPLIQUE.md`. |
| Migration 0023, deliveries | Proposed, not applied, needs 0022 | The delivery journal and the notification preferences cannot work. | The same, after 0022. |
| `RESEND_API_KEY`, `MORADA_MAIL_FROM` | Absent on both Vercel projects | Every e-mail, invitations included, is composed and logged as "not configured" and never leaves. | A Resend account, a verified sender on morada.lu (SPF, DKIM), two variables. |
| `NEXT_PUBLIC_SENTRY_DSN` | Absent | No error monitoring. Vercel runtime logs were not readable from the agent tools either. | One variable. Options and redaction live in `src/lib/monitoring.ts`. |
| `NEXT_PUBLIC_SUPABASE_*` | Not set on Vercel | None: `src/lib/supabase/config.ts` defaults to the production project. | Nothing. |

Environment variables set for the bank connection (targets Production and Preview on both
projects):

| Variable | Value |
|---|---|
| `SALTEDGE_APP_ID`, `SALTEDGE_SECRET` | Set. Values only in Vercel. |
| `SALTEDGE_FAKE_PROVIDERS` | `1`: lists Salt Edge's fake banks in the journey while the app is not Live. |
| `SALTEDGE_DEMO_PROVIDER` | `fake_client_xf`: the fake bank the sample cabinets' demonstration opens on. |

## Banking: Salt Edge

**Status on 26 September.** Salt Edge accepts the credentials (the health probe answers
`ok`), the connect request passes its validation, and the consent journey opens: the owner
confirmed it in the tab and popup versions. The current version, which shows the journey
in a dialog on the page, has not been confirmed by the owner yet, and no journey has been
completed through to the return. No real import has ever run.

**How it works**

- `POST /api/banking/connect` registers the Salt Edge customer (`morada-ws-<workspace id>`
  for a real workspace, `morada-demo-<user id>` for a sample cabinet), then opens a connect
  session with `customer_identifier`, consent scopes `accounts` and `transactions`,
  `attempt.return_to` set to `<origin>/app/banque/retour`, and when asked
  `provider.include_fake_providers` and `provider.code`.
- The button (`src/components/gestion/SaltEdgeConnect.tsx`) shows the returned URL in the
  house dialog, inside an iframe, with a link that opens the same journey in a tab.
- Salt Edge sends the visitor back to `/app/banque/retour`. Its relay
  (`src/components/gestion/BankReturnRelay.tsx`) passes the next address to the page around
  the frame, or to the tab's opener. A real account lands on `/app/banque?connexion=retour`,
  which syncs automatically (`/api/banking/sync` writes `gestion.bank_accounts` and
  `gestion.bank_transactions` under the caller's token, then runs the matching engine). A
  sample cabinet lands on `?connexion=demo`, which reads the fake connection live and stores
  nothing.
- A refusal shows Salt Edge's error class on the button, plus its field-level message for
  `WrongRequestFormat`.
- `GET /api/banking/health` is public and never prints a value. It shows the deployed
  commit, which variables exist, the return address, the demo provider and Salt Edge's own
  verdict on the credentials. Ask the owner to open it in a browser whenever the connection
  misbehaves: the agent sandbox could reach neither Salt Edge nor the deployed hosts.

**Salt Edge account settings (the owner's dashboard)**

- Status: not Live (Pending or Test). Only fake banks and sandboxes connect.
- "Allowed domains for redirect URLs": the advice was `app.morada.lu` and
  `morada-gestion-preview.vercel.app` (a blank field allows any domain). The owner changed
  it on 26 September; check what was saved.
- Activated providers (the owner's export of 26 September, 61 rows): 21 Luxembourg banks,
  every one a "client keys" variant (`..._oauth_client_lu`, manual registration), and 40
  sandboxes or fake banks. None of the Luxembourg ones can connect before Live.

**Open decisions**

1. **Licence model.** The `_client_` variants assume the client's own PSD2 licence and its
   own registration at each bank. A SaaS normally connects under Salt Edge's licence, where
   the same banks exist without `_client_`. Confirm with Salt Edge in writing before
   go-live. The banks that matter for landlords and agencies: Spuerkeess, BGL BNP Paribas,
   BIL, Banque de Luxembourg, POST Luxembourg, Raiffeisen, ING.
2. **Dialog or popup.** Bank login pages reached through OAuth usually refuse to render
   inside an iframe. Test one real OAuth bank as soon as the app is Live. If it refuses,
   open the journey in a popup window for those banks (a working popup version is in
   commit `1be0735`), or use the popup everywhere.
3. **Go-live.** Remove `SALTEDGE_FAKE_PROVIDERS` from both projects.

**Unverified**

- The first real import. Salt Edge v6 field names for accounts, transactions and the
  customer list are read defensively in `src/lib/banking/saltedge.ts` and `mapping.ts`,
  but only mocks have exercised them.
- The login of `fake_client_xf`. The hint on the button says `username` / `secret`, the
  documented fake-bank login.
- Demo customers keep their fake connections at Salt Edge; nothing cleans them up.
- The Salt Edge Secret was pasted into the build conversation. Rotate it in the Salt Edge
  dashboard once the integration is stable, then update both Vercel projects.

## Known risks and debts

- **Nothing but the rent roll runs on a clock.** Bank sync, consent-expiry reminders (the
  strategy's T-14/7/2/0 ladder), arrears steps and reminders all wait for a click. The app
  has no service key by design, so scheduling needs a real design: Salt Edge callbacks into
  a narrowly scoped security-definer function, or per-workspace jobs with bound tokens.
  Reconnecting or disconnecting a bank connection does not exist either.
- **No CAMT.053 import.** The strategy calls it permanent and the Banque screen's copy
  promises it; only CSV exists.
- **Legal uncertainty.** Eight open legal items close `docs/STRATEGY.md`. The
  `legal_params` table is empty and unread; the code registry
  (`src/domain/legal/params.ts`, with verified and uncertain flags) serves. Fiscalité and
  AML sit on those figures: do not extend them before the items are closed.
- **Legal documents are French only**, in an interface offered in four languages.
- **Banking docs are out of date.** `docs/STRATEGY.md` and the "Production wiring" part of
  `docs/ARCHITECTURE.md` describe Enable Banking as primary and Salt Edge as dormant, and
  the Banque intro string (`banque.connectBody`) still names Enable Banking. What shipped is
  the reverse.
- **Breadth tax.** Every screen carries four dictionaries and, for demo data, a
  Lëtzebuergesch dataset kept in compile-checked parity with the French one.
- **Long pages.** The lease sheet (`src/app/app/baux/[id]/page.tsx`, about 800 lines of
  stacked panels) would read better with tabs.
- **Bundle weight** of the shell (`Shell.tsx`, about 1,400 lines, plus the motion library
  on every page) has never been measured.

## Recommended next steps

In order, each small enough to verify on its own. None of them is approved yet: the owner
decides.

1. **Apply 0022, then 0023**, with the owner's approval and the `APPLIQUE.md` procedure:
   re-audit, apply, verify RLS and grants, replay the flows in a rolled-back transaction,
   record the result.
2. **Mail.** Resend key and verified sender, then check an invitation and a document send
   end to end.
3. **Sentry DSN.**
4. **Banking.** The owner runs both journeys (real workspace, sample cabinet) on the dialog
   version; settle dialog or popup; ask Salt Edge for Live under the right licence; remove
   the fake-bank switch.
5. **Automation layer**, design first: scheduled sync, consent expiry, arrears reminders,
   reconnect and disconnect.
6. **CAMT.053 import** next to the CSV import.
7. Then, as a cabinet asks for them: portfolio import from a spreadsheet, owner statements
   (relevé de gérance), e-signature of the lease and the EDL, and the fiscal pack on real
   rows (the Slice 5 candidate named in the Slice 4 proposal).

## Production snapshot, 25 September (before Slice 4)

Two owner-type workspaces, 9 properties, 8 active leases, 3 tenant accounts. 15 rent
periods opened by the nightly roll, 8 September rents unpaid. No payments, bank accounts
or bank operations. One arrears step recorded. No documents, bills or registered letters.
Two draft EDL sessions. Seven deposits pending. Taken from that day's audit and not
re-checked since.

## Agent environment notes

If you work from the same kind of sandbox:

- Outbound network blocked `saltedge.com`, `docs.saltedge.com`, `app.morada.lu` and the
  `vercel.app` hosts. `api.github.com` answered, which was enough to poll CI; npm worked.
- Vercel runtime logs returned 403 through the Vercel tools. The health endpoint, read in
  the owner's browser, was the only window on production behaviour.
- The Vercel tools read and write project environment variables (a sensitive variable
  cannot be edited with its `key` field in the request) and list deployments. Production
  audits and the approved migrations went through the Supabase tools.
- A hook blocked foreground `sleep`; waits ran as a small background script.
- A stop hook required every change to be committed and pushed before a turn ended.

## Glossary

- **Bail**: lease. **Dossier**: the draft lease, saved as the owner goes.
- **EDL (état des lieux)**: check-in or check-out inventory.
- **Décompte**: charges statement, or deposit settlement statement.
- **Mise en demeure**: formal notice, sent by registered letter.
- **AR (avis de réception)**: proof of receipt of a registered letter. Legal effects run
  from its date, never from a click.
- **RF reference**: ISO 11649 creditor reference that lets a rent transfer match on its own.
- **Quittance**: rent receipt. **Relevé de gérance**: owner statement (not built).
