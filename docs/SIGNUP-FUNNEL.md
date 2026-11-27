# Signup funnel

Implemented in `dextermex/gestion`, branch `codex/signup-funnel`.
The marketing repository is outside this change.

For production domains, branded Auth emails and the dashboard setup, follow
[SUPABASE-ACTIVATION.md](SUPABASE-ACTIVATION.md). Auth email links now default
to `https://app.morada.lu`, including when requested from a local app. An explicit
development URL can be configured for an isolated development project.

## Entry and architecture

Keep the funnel on **https://app.morada.lu/inscription**. A separate
`morada-funnel` repository would introduce another deployment and auth boundary
without improving the customer journey. Gestion already owns the destination,
the shared Morada session cookie and the workspace provisioner.

`/inscription` is the only account-creation page. `/connexion` is the only
sign-in page and renders the same design in login mode: email and password
(with “Forgot password?” in place), phone code, and Google or Apple where
configured. The retired “Bienvenue sur Morada Gestion” page (`WelcomeAuth`)
is deleted; nothing renders it as a fallback.

- `/connexion?onglet=inscription…` (older morada.lu CTAs, invitations and
  emails) redirects server-side to `/inscription`, keeping `next`, `lang`, an
  invited `email` and the `ref` placement tag.
- The marketing site links “Start for free” to `https://app.morada.lu/inscription`.
- Invitations open `/inscription?next=/invitation/…&email=…`; the invited
  address is prefilled at the email step and confirmed with the code before the
  password (the only sign-up that waits for it).
- Password recovery emails return to `/connexion?mode=reset` (allow-listed as
  `https://app.morada.lu/connexion?**`), where the new design asks for a new
  password.
- The app root sends a signed-out visitor to `/connexion`.
- `/inscription?mode=phone` sends codes with `shouldCreateUser: false`.

## Journey

Since 27 November 2026 the web runs the iPhone app's funnel (rebuilt in
October; the app's `app/(onboarding)` is the reference, and
`docs/WEB-ONBOARDING.md` Part A lists every screen and what it saves). Same
order, same questions, same answer keys, same saved shapes, so an account
started on one surface continues on the other. One question per step in the
funnel's centred column; a bar across the top runs through the whole journey
and is front-loaded like the app's (`src/lib/signup/journey.ts`: the account
steps fill half of it). Nothing about money appears before the offer screen.

The account (A.1):

1. Phone number, Luxembourg selected. The searchable country dialog pins
   Luxembourg, Belgium, France, Germany and the Netherlands, followed by the
   remaining supported countries sorted by their translated names.
2. Six-digit SMS code. One real input supports paste and OS autofill; six visual
   cells show the digits. Edit number, error recovery and a 60-second resend
   cooldown are provided.
3. Landlord or tenant (the web's own step: the app is for landlords; the web
   keeps it where the app asks for notifications, which a browser has no
   prompt for: the trial reminder is an e-mail).
4. First and last name.
5. Email, added to the same authenticated phone account (`email_change`).
   **Recorded, not verified in the funnel** (the owner's rule of October 2026,
   the app's): the confirmation mail goes out on its own, with its code and its
   link, and the funnel goes on. One exception: an account created to accept an
   invitation (`next=/invitation`) still waits for the code or the link
   (`funnelStep` in `src/lib/signup/model.ts`), because accepting the
   invitation reads the confirmed address. An address another account holds is
   answered like any other and the funnel goes on the same way.
6. Password (required, at least 8 characters, typed twice). Sign-in by e-mail
   and password works once the address is confirmed; phone login stays
   available. A tenant finishes here (welcome, then `/locataire` or the
   invitation): no question, no plan, no payment.

The questions (A.2), landlords only: eleven one-tap questions with an emoji per
answer, in the app's order and keys (`src/lib/signup/quiz.ts`): what you let
(`flats`, `houses`, `building`, `mixed`), for whom (`self`, `family`,
`clients`), how many lots (`1`, `2-5`, `6-10`, `11-20`, `21-50`, `0`), the
average rent (band `0` to `4`), where (`lu`, `be`, `fr`, `de`, `multi`), how
today (`spreadsheet`, `software`, `paper`, `starting`), the main difficulty
(`rent`, `documents`, `compliance`, `finances`, `maintenance`), the time spent
(`1`, `5`, `20`, `40`), how soon a late rent is noticed (`same_day`, `days`,
`month_end`, `never`), the goal (`rent`, `everything`, `time`, `tax`, `grow`),
where they heard of Morada (`instagram`, `tiktok`, `word`, `search`, `press`,
`other`). Arrow keys move between answers, Enter continues, Back is a button.
`?q=N` names the question: a reload stays put (the answers of the tab are kept
in `sessionStorage`, keys only) and the browser's Back walks the questions.
Then the interests: three groups of chips pre-filled from the answers
(`dashboardFromQuiz`, ported from the app's `src/lib/dashboard.ts`).

The plan (A.3): "Vous avez tout pour y arriver" (the goal and the first month as
a rising SVG curve), the reviews step (built, skipped while
`src/lib/signup/reviews.ts` holds no quote: the list is empty and only real,
owner-confirmed quotes may go in it), "Nous créons votre espace" (the figure
counts to 100 over four lines built from the answers while the account is
finished: `complete` with the answers, then `POST /api/espace/creer` opens the
management space, then `GET /api/abonnement/etat` is read), "Votre plan est
prêt" (what Morada will do about the difficulty named, no price).

The trial and the payment (A.4), only when `GET /api/abonnement/etat` answers
`configured: true` and `access: "locked"`; otherwise (no Stripe key, as in CI, a
subscription already running, no answer, or an invitation's account) the plan
goes straight to "Bienvenue". Three screens: "Nous voulons que vous essayiez
Morada gratuitement" (a real capture of the app's Accueil on the sample
workspace, `public/signup/home-<locale>.jpg`, copied from the iPhone app's
`assets/onboarding`), "Nous vous prévenons avant la fin de votre essai" (the
bell; by e-mail, two days before the end), then the offer: "Vos 30 premiers
jours sont offerts", three dated rows (today, in 28 days the reminder, in 30
days the subscription starts), one price line from `offerQuote`
(`src/lib/signup/offer.ts`) and "Tarif pour 3 lots · Comprendre mon tarif",
which opens a panel (the lots bracket, the rent band, yearly with "2 mois
offerts" or quarterly; the price changes at once). "Commencer mes 30 jours
gratuits" posts `/api/abonnement/checkout` with `{ source: "signup", units, band,
billing }` and opens Stripe Checkout; a 409 goes to "Bienvenue", any other
refusal is said on the screen. A workspace that already had its free days
(`trialOffered: false`) is told the subscription starts today. "Pas maintenant",
or a Checkout cancelled (`/inscription?etape=offre&retour=annule`), opens the
one-time offer once (a quarter off the first year, `WINBACK_PCT`), whose button
posts the same route with `winback: true`; "Non merci" leads to `/app`, which
shows the locked screen.

Bienvenue (`/inscription?etape=bienvenue`): "Ouvrir mon espace" opens
`/app/biens/nouveau?type=<apartment|house|building>&tour=1` when the questions
named lots (the type from the first question; `mixed` gives no type) and
`/app?tour=1` for "Pas encore de lot".

Addresses other pages link to: `/inscription?etape=offre` (the offer, for a
signed-in landlord whose sign-up is complete; with `retour=annule`, the
one-time offer instead), `/inscription?etape=bienvenue`. A complete landlord
arriving at `/inscription` without `etape` is sent to `/app`.

### Stages (server-side, `/api/signup/profile`)

`user_metadata.morada_signup.stage` records the last step the server accepted:
`role` → `email` → `password` → `tailor` (landlords) → `complete`
(`email_code` on accounts from before October 2026). `resumeStep()`
(`src/lib/signup/model.ts`) is the iPhone app's, word for word, with its two
departures from the web's former rules: an Apple or Google account
(`providerAccount`, read from Auth's own `app_metadata`) skips the phone and
the password, and a pending address counts as given (`emailGiven`). The route
accepts such an account where it asked for a verified phone, and `complete`
without a password for it.

The route refuses `password` and `complete` (409 `email_unconfirmed`) until
an address was given, and `complete` without `password_set_at`
(`password_required`). `email_confirmed` still needs Auth to report the address
confirmed (the invitation's case). The password is sent once, over HTTPS, to
Supabase Auth, which stores only its bcrypt hash; it is never logged or kept;
only the first one is set here (a change goes through the reset link).

What is saved, in the shapes the app writes (`src/lib/signup/stages.ts` there):

- `morada_signup.preferences = { properties, challenge, involvement }`, the
  web's own shape (`webProperties` turns `11-20` and `21-50` into `11+`).
- `morada_mobile.quiz = { kind, manageFor, units, where, today, late, goal,
  source, offer }` and `morada_mobile.dashboard` (`{ order, hidden, interests,
  horizon, watch }`), both with `complete`. Validated with strict zod enums of
  the app's keys: any other key or value is refused, nothing is free-form.
- `{ action: "offer", outcome, offer }` records `morada_mobile.quiz.offer`
  (`paywall`, `winback`, `declined`) and the price quoted
  (`morada_mobile.offer = { units, band, billing, addon: false }`), once the
  sign-up is complete and for a landlord only. Bookkeeping: access is the
  subscription's (`/api/abonnement/retour` records the trial's start).

The former plan step (`{ action: "plan", rhythm }`, `morada_signup.plan`) is
gone: the offer screen replaces it.

### Hosted template (manual)

The six-digit code needs the regenerated `supabase/templates/email_change.html`
(`node scripts/build-auth-emails.mjs`) pasted into Supabase: Authentication,
Emails, Templates, “Change email address”. Until then the email holds the
link only, which the page still detects.

Saved account stages resume after a refresh; unsaved text is kept during
in-page back navigation, never in browser storage. The questions' answers (keys
only, no name, number or address) are kept in the tab's `sessionStorage` until
the welcome, so a reload stays on its question. The web's home screen does not
read `morada_mobile.dashboard` yet; it is saved so the iPhone app finds it.

## Design

Following the design review, the opening screen uses a direct heading, one short
explanation and filled 64px fields. The primary action is 56px. The first screen
has no progress checklist or decorative reassurance badges. Later screens use
a small progress indicator; optional questions show their count once.

Mobile uses a single column with the first action towards the bottom, normal
document flow for keyboard/short-screen scrolling, 16px or larger inputs and
safe-area spacing. The desktop panel contains a custom glass key illustration.
Glass and motion are restrained; text entry stays opaque and readable. Reduced
motion, reduced transparency, high contrast and visible keyboard focus have
dedicated styles. FR/EN/DE/LU copies are checked against one TypeScript shape.

No fabricated testimonials, customer counts or completion-time claims appear.
Conversion improvement is a hypothesis to measure, not a measured result.

## Authentication and activation

The default remains the existing signup entry until the environment flag and
site key are supplied. Direct visits to the new signup page fail closed and
offer email registration if phone signup is unavailable.

Before enabling:

1. Configure an SMS provider in **the intended Supabase project**. Enable phone
   signup, use a six-digit template and configure SMS rate limits, geographic
   restrictions, provider spend limits and code expiry. The client cooldown is
   only UX; Supabase/provider limits must enforce abuse protection.
2. Create a Cloudflare Turnstile widget for the intended app hostname and
   previews. Store its **secret in Supabase Auth CAPTCHA settings** and its
   public site key in `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. The browser passes the
   single-use token as `captchaToken`; Supabase validates it. Do not consume the
   same token in a second Siteverify request.
3. **Coordinate the shared Auth CAPTCHA rollout.** Supabase CAPTCHA is global
   to the Morada project. This change adds tokens to Gestion's phone and email
   signup, password login, recovery and confirmation resend. The other Morada
   applications must support the same setting before it is enabled globally.
   Their code was intentionally not changed here.
4. Configure Auth email delivery and allowlist
   `https://app.morada.lu/inscription` for email-change confirmations.
   `NEXT_PUBLIC_APP_URL` controls this trusted redirect for previews/local
   environments. Keep secure email confirmation enabled.
5. Set `NEXT_PUBLIC_PHONE_SIGNUP_ENABLED=1` alongside the site key and rebuild.
   These are build-time public variables. No service-role key is needed.
   Without them the funnel shows “Sign-up is temporarily unavailable” rather
   than an email form.
6. In an isolated staging project, test an actual SMS, an incorrect and expired
   code, resend, an existing phone account, a duplicate email, email confirmation,
   recovery, logout/re-entry, and both app handoffs before production rollout.
   Verify the legacy invitation flow and sibling apps with CAPTCHA enabled.

The server validates the session with Supabase, requires a confirmed phone,
rejects cross-origin profile writes, validates all payloads, and updates only
the verified user's profile through RLS. Auth updates use that same user's
bearer token, never an elevated key. Account metadata is personalization,
not authorization. Supplied return paths are restricted to app, tenant and
invitation paths.

## Preview and checks

`npm run dev`, then open `/inscription/apercu?lang=en`.
This development-only route is explicitly labelled. It neither reads a live
session nor sends messages or saves accounts. Use **123456** as the preview
code. It returns 404 in production, irrespective of query parameters.

Automated checks cover phone normalization, country priority, unsafe redirects,
authenticated profile writes, prerequisite validation, pending email handling,
tenant isolation, single OTP submission, CAPTCHA failure, invalid verification
and preview isolation. The standard suite, lint, TypeScript and production
build are the project checks.

Browser review covers both complete branches, country search, invalid codes,
resend cooldown, retained names, translations, optional skipping and narrow
screens. Live SMS/Turnstile delivery and real-database E2E are separate staging
checks; the local environment has no Docker-backed Supabase stack.

Validated locally on 27 September 2026: 387 tests passed (43 files), full lint,
TypeScript and production build passed. Browser checks used 320px and 390px
portrait, 844×390 landscape, and 1440px desktop. A running production build
returned 404 for the preview and retained the existing root entry with phone
signup disabled.

For conversion measurement, record aggregate step views/completions, verification
failures, resend use and first-property activation through the existing
consent-aware analytics system. Do not send phone numbers, emails, names or OTPs.
No new analytics vendor or tracking was added by this change.

## References and asset provenance

- [Revolut phone signup](https://mobbin.com/screens/02bf58b7-50b0-479c-b4b9-bff2f27bf11b)
- [Revolut Business email form](https://mobbin.com/screens/adc0a150-79de-4d18-b4b3-b270baece09a)
- [Revolut signup journey](https://mobbin.com/flows/7291bae9-7b5a-4b40-a911-316447f4437c)
- [Supabase phone login](https://supabase.com/docs/guides/auth/phone-login)
- [Supabase CAPTCHA](https://supabase.com/docs/guides/auth/auth-captcha)
- [Cloudflare token validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
- Apple design, UI/UX Pro Max and GPT Taste skills supplied for this task. Their
  useful form, accessibility and visual-craft guidance was applied within the
  user's signup scope; marketing-page layouts and scroll effects were excluded.

The supplied CSS-Tricks article and Byq MCP endpoint returned HTTP 403 during
research. No claims about unseen material were used.

`public/signup-key.webp` is an original generated concept asset, optimized to
1000px WebP (about 48KB). It is not a Revolut or competitor asset. Generation
prompt:

> Use case: stylized-concept. Asset type: quiet premium signup illustration for Morada, a Luxembourg rental management app. Create a photorealistic luxury 3D product render of one sculptural house-shaped keyring and a single elegant modern door key. The house-shaped ring is thick polished translucent teal glass, subtly rounded, with an empty house-shaped opening. A restrained brushed champagne silver metal ring joins it to a solid satin terracotta key. Objects float diagonally at a gentle three-quarter angle, soft realistic caustics and long diffuse shadows. Background is a seamless pale warm ivory #faf7f2 studio cyclorama with no horizon, softly lit from top left. Colors only deep teal #10505c, terracotta #e8613c, ivory. Composition square, objects occupy center 60%, generous negative space around edges. It should feel like a refined industrial design object photographed for Revolut or a luxury technology brand, physically believable, not cartoon clay. No text, no letters, no logos, no badges, no sparkles, no confetti, no UI.

## Phone-first signup and returning-user login

The signup screen still starts with the phone number only. Continue opens a
native modal with the formatted number, “Confirm and send code” and “Change
number”. No SMS request is made before confirmation. The searchable country
picker becomes a bottom sheet on mobile. An incorrect code leaves the input
available with an inline error and focused correction, without another modal.

Google and Apple belong **at the email step**, after the phone has been verified
and the name saved. They call `auth.linkIdentity`, never `signInWithOAuth` in
signup. An ephemeral sessionStorage record contains the initiating account ID,
provider and timestamp (no email, phone, code or token). The callback checks the
same verified phone account and linked provider. A different account is signed
out locally and the flow stops. Cancellations/conflicts retain the email fallback.
We trust `user.email_confirmed_at`, not metadata or URL parameters, for the
confirmed-email label. Apple relay addresses are accepted normally. No accounts
are merged by application code. If the provider identity is already attached to
another account, the visitor can use the existing-account login route.

`/inscription?mode=login` is a distinct, quiet returning-user page: email,
Continue, Google, Apple, phone login and a create-account link. The email path
retains the existing password authentication and recovery. Phone-created accounts
can sign in by phone or their linked provider; no password is invented for them.
`/inscription?mode=phone` sends an SMS with `shouldCreateUser: false`.
`/connexion` renders this same login layout; `?legacy=1` no longer exists.

### Diagnosing a failed code request

The funnel names each Auth failure (`src/lib/signup/errors.ts`) and logs one
console line, `[morada-signup] <stage> failed { code, status }`, never the
number, address or provider message. The same request appears in Supabase
(Logs, Auth) with the provider's reason. Common causes:

| Console code | Supabase log | Fix |
|---|---|---|
| `sms_send_failed` + Twilio 21212 “Invalid From Number … VA…” | Phone provider set to **Twilio** with the Verify Service SID in the sender field | Authentication, Sign In / Providers, Phone: choose **Twilio Verify**, then Account SID, Auth Token, Verify Service SID (`VA…`) |
| `sms_send_failed` + Twilio 20003 | Wrong Account SID or Auth Token | Re-enter both (rotate the token if exposed) |
| `phone_provider_disabled` | Phone provider off | Enable Phone |
| `captcha_failed` | Turnstile secret missing or wrong | Attack Protection: Turnstile secret for the `Morada signup` widget |
| `over_sms_send_rate_limit` | Rate limit | Wait, or raise the SMS limit in Auth rate limits |

### Social provider activation (not performed)

1. Set up a Google Web OAuth client and an Apple Services ID. Register the
   Supabase project callback `/auth/v1/callback` in each provider. Store the
   provider credentials in Supabase Auth. For Apple web OAuth, arrange rotation
   of its client secret every six months and configure email relay delivery.
2. Enable **Manual Linking** in Supabase Auth, then test linking a real Google
   and Apple identity to a phone-created user. Record that the user ID stays
   unchanged. Test provider cancellation, a conflicting identity, private relay,
   email confirmation, refresh and returning login.
3. Allowlist the app's `/inscription` callback URLs, including `oauth=link` and
   `oauth=login`, locales and the specific deployment hosts. Keep redirects scoped
   to trusted origins. The app preserves sanitized invitation destinations.
4. Set the applicable `NEXT_PUBLIC_GOOGLE_SIGNIN_ENABLED` and
   `NEXT_PUBLIC_APPLE_SIGNIN_ENABLED` flags to `1`, and
   `NEXT_PUBLIC_SOCIAL_LINKING_ENABLED=1` after manual linking is tested.
   These enable email-step buttons. They never add social signup to the first screen.
5. Supabase OAuth sign-in can otherwise create a new user. To preserve phone-first
   creation even when an unknown visitor presses a social **login** button,
   coordinate the project-wide Before User Created hook in
   `docs/signup-social-guard.sql`. It rejects new Google/Apple users, without
   blocking identity linking or existing users. This file is a rollout artifact,
   not an applied migration. If another hook exists, compose the rules rather
   than replacing it. Test the hook against the sibling applications too.
6. Only after that guard is installed and tested, set
   `NEXT_PUBLIC_SOCIAL_LOGIN_ENABLED=1` to expose social login buttons. Without
   those flags the real UI does not offer unconfigured providers. The explicitly
   labelled development preview shows simulated providers with no real requests.

Phone OTP sign-in and confirmation of an email are **not enforced MFA**. This
branch does not add an AAL2 authorization requirement. True phone MFA would
require factor enrollment, a challenge after the first factor, recovery and
server/RLS enforcement across the shared applications; that policy remains a
separate decision. Email can still be pending when the existing flow completes.

Read-only check on 2026-09-27: the production-default Supabase URL in this
checkout reported email enabled, Google/Apple/phone disabled. No provider
settings, secrets, migrations or production data were changed.

References: [Supabase identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking),
[Google OAuth](https://supabase.com/docs/guides/auth/social-login/auth-google),
[Apple OAuth](https://supabase.com/docs/guides/auth/social-login/auth-apple),
[Before User Created hook](https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook).
The Google logo asset is the official
[Google Identity asset](https://developers.google.com/identity/branding-guidelines).
