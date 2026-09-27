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
  address is prefilled at the email step and still confirmed by Auth.
- Password recovery emails return to `/connexion?mode=reset` (allow-listed as
  `https://app.morada.lu/connexion?**`), where the new design asks for a new
  password.
- The app root sends a signed-out visitor to `/connexion`.
- `/inscription?mode=phone` sends codes with `shouldCreateUser: false`.

## Journey

1. Phone number, Luxembourg selected. The searchable country dialog pins
   Luxembourg, Belgium, France, Germany and the Netherlands, followed by the
   remaining supported countries sorted by their translated names.
2. Six-digit SMS code. One real input supports paste and OS autofill; six visual
   cells show the digits. Edit number, error recovery and a 60-second resend
   cooldown are provided.
3. Landlord or tenant.
4. First and last name.
5. Email, added to the same authenticated phone account. Confirmation is sent;
   the UI distinguishes a pending email from a confirmed one.
6. Landlords can answer three optional questions: portfolio size, main challenge
   and time spent. “Skip for now” remains visible above the choices. Tenants
   bypass these questions.
7. Welcome and handoff to `/app` or `/locataire`. A tenant still needs an actual
   invitation to access a tenancy. Choosing a role grants no access.

There are no extra “you completed a step” interstitials. Saved account stages
resume after a refresh; unsaved text and optional answers are kept during
in-page back navigation, not persisted to browser storage. Preferences are
recorded for subsequent personalization; this change does not rearrange the
existing dashboard based on those answers.

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
