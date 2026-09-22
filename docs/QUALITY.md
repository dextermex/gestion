# Quality: CI, end-to-end tests, monitoring

How the safety net around Morada Gestion works, so it can be kept working.
Everything here runs on every push and every pull request; nothing here
touches the hosted Supabase project or its data.

## What runs where

| Layer | Where | What it proves |
| --- | --- | --- |
| Typecheck, lint, unit and integration tests, production build | `.github/workflows/ci.yml`, job **checks** | The code compiles, follows the rules (including `react/no-unstable-nested-components`), the 254 vitest tests pass, `next build` succeeds. Each is its own named step, so a red run says which one. |
| Database security audit | job **e2e**, step *Database security audit* | On the assembled schema: every `gestion` table has row-level security on and a policy, `anon` has no usage, grant or executable function in `gestion`, the public invitation preview answers `unknown` to a made-up token, every definer function pins `search_path`, the media bucket is private. `e2e/db/rls-audit.sql`. |
| End-to-end, real browser, real backend | job **e2e**, step *End-to-end tests* | The built app (`next start`) against a throwaway local Supabase: sign-up, sign-in, sign-out, two accounts on one browser, Safari-style autofill, property creation, rental dossier to activation, tenant invitation accepted from the link by a new account, one conversation per tenancy on both portals (a normal message, a request with a photo inside the same conversation, the owner's reply from the chat, status and intervention from the request's card, a second request, more chat, the first request resolved, and the same chronology read by both sides after signing in again), cross-account isolation (a foreign workspace and a tenant account answered 404 and 403 on the request, conversation and tenancy routes), departure, the former tenant's history, and the typing checks (a field keeps the caret). Chromium desktop for everything, WebKit in an iPhone 14 viewport for the door and the typing checks. |

## The end-to-end database

The `gestion` schema delegates identity and permissions to Morada's
`public.agencies`, `public.crm_members` and `public.gestion_onboard`, so the
suite's database is built from **Morada's migrations first**, then this
repository's `supabase/applied` files, in production order:

- `e2e/db/base/base_public.sql` is Morada's `public` schema as it stood
  before its migration history begins: the first Morada migration already
  assumes `public.agencies`, `public.listings` and a handful of other tables
  and functions that were created before the repository kept migrations.
  The file recreates exactly those objects as the hosted project defines
  them today (a read-only catalog snapshot; `snapshot-base.sql` next to it
  holds the queries and the rule for deciding what belongs there). Later
  migrations that touch these tables are written `if not exists` and replay
  over it cleanly. Refresh it when a base table or function changes in
  production.
- `e2e/db/morada/` is a vendored copy of `dextermex/morada`'s
  `supabase/migrations` (its `MANIFEST.md` records the source commit). When
  Morada's schema changes, refresh it from a checkout and commit the result:
  `npm run e2e:morada:sync -- ../morada` (the base directory is left alone).
- `e2e/db/prepare.mjs` assembles `e2e/supabase/migrations/` (generated,
  ignored by git): a prelude (extensions, the realtime publication), the
  base snapshot, the Morada files, then `0001`…`0018` renamed with later
  timestamps. `0099_rollback` is never included.
- `e2e/supabase/config.toml` is the local stack's configuration: `gestion`
  exposed through the API as on the hosted project, e-mail confirmations off
  so a sign-up returns a session, disposable keys, no seed.

The app under test is built with `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` pointing at that stack (`supabase status -o
env`). The service-role key exists in the local stack, as in any Supabase,
but nothing in the app or the suite reads it: every row the tests see went
through the same policies as production.

### Running it locally

Needs Docker and the Supabase CLI (fetched by `npx`), plus `psql`.

```bash
npm run e2e:db:prepare          # assemble e2e/supabase/migrations
npm run e2e:db:start            # docker: postgres, gotrue, postgrest, storage, kong, realtime
eval "$(npm run -s e2e:db:env)" # exports API_URL, ANON_KEY, DB_URL…
E2E_DB_URL="$DB_URL" npm run e2e:db:audit
NEXT_PUBLIC_SUPABASE_URL="$API_URL" NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY" \
NEXT_PUBLIC_APP_URL=http://127.0.0.1:4321 npm run build
npx playwright install chromium   # once
npm run e2e                     # starts `next start -p 4321` itself
npm run e2e:db:stop
```

`E2E_WEBKIT=1 npm run e2e` adds the iPhone-sized WebKit project (needs
`npx playwright install --with-deps webkit`). A single file:
`npm run e2e -- e2e/tests/auth.spec.ts`. On failure the trace and screenshot
are in `test-results/`; in CI they are uploaded as the `playwright-report`
artifact.

### Writing a flow

`e2e/tests/helpers.ts` holds the moves (`signUp`, `signIn`, `createHouse`,
`letLot`, `inviteTenant`, `typeAndKeepFocus`…). Flows drive the screens by
their visible French labels, which come from the typed dictionaries: renaming
a label breaks the suite loudly rather than silently. Every account and
property name is unique per run (`mail("owner")`), because the database is
real and shared between the spec files. Files that build on each other's
state use `test.describe.configure({ mode: "serial" })` and one worker.

Three things the first runs taught:

- Leaving a wizard step saves the dossier before the next screen appears:
  move with `nextStep(page, "Suivant")` or `nextUntil(page, target)`, which
  wait for the next step's heading, never with a bare click followed by
  another click.
- Assert on headings and roles, not on loose text. The shell repeats phrases
  ("rien n'est enregistré" in the dataset switcher), and the framework's
  route announcer is an `alert` too.
- The floating "Bien démarrer" card covers the bottom-left of a laptop
  viewport and takes the clicks meant for what lies under it: call
  `foldGettingStarted(page)` before reaching for a control at the bottom of
  a page, as a person would fold it. The overlap itself is a usability point
  still to be addressed in the card, not in the tests.

## Error monitoring

`@sentry/nextjs`, errors only, off unless `NEXT_PUBLIC_SENTRY_DSN` is set.
Set it in Vercel for the production environment (and preview if wanted); a
local run without it sends nothing.

- `src/lib/monitoring.ts` is the one place the options live. No user object,
  no cookies, headers or request bodies, no session replay, no traces
  (`tracesSampleRate: 0`), no console breadcrumbs. Before an event leaves,
  e-mail addresses, IBANs, invitation tokens in URLs and Supabase tokens in
  link fragments are redacted (`redact()`, `scrub()`; covered by
  `src/lib/__tests__/monitoring.test.ts`).
- `src/instrumentation.ts` initialises the Node and edge runtimes and reports
  unhandled server errors (`onRequestError`); `src/instrumentation-client.ts`
  the browser; `src/app/global-error.tsx` catches what the root layout cannot.
- `next.config.ts` is wrapped with `withSentryConfig`; source maps are
  uploaded only when `SENTRY_AUTH_TOKEN` is present at build time (optional).

What to do with an alert: the event carries the route, the stack and the
release commit; it does not carry who was affected, by design. Reproduce
from the route and the commit.

## Keeping it green

- A red **checks** job names the failing step; run the same command locally
  (`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`).
- A red **audit** step means a migration weakened a guarantee: fix the
  migration, never the audit.
- A red **e2e** step: open the uploaded report, read the trace. If a label
  changed, update the helper; if the schema changed, refresh the vendored
  Morada copy or add the new `supabase/applied` file (the prepare script
  picks it up by name). A Morada migration failing on a missing `public`
  object means the base snapshot is behind production: refresh it with the
  queries in `e2e/db/base/snapshot-base.sql`.
- The suite does not replace a real device: Safari on an iPhone, and the
  production deployment, are still checked by hand after a release.
