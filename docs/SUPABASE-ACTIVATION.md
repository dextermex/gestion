# Morada Auth: production setup

Project: `morada` (`lgmoocvumiuqjcqnrlej`). App: `https://app.morada.lu`.
The project is shared with the marketing site and Morada Pro. Preserve their
existing redirect entries, providers, hooks and mail settings.

## 1. Fix the localhost destination

Open [Authentication → URL Configuration](https://supabase.com/dashboard/project/lgmoocvumiuqjcqnrlej/auth/url-configuration).

- Set **Site URL** to `https://app.morada.lu`. This is the default when a request
  has no accepted redirect. Do not leave it at `http://localhost:3000`.
- Add `https://app.morada.lu/inscription` and
  `https://app.morada.lu/inscription?**` to Redirect URLs. The second entry covers
  the locale, OAuth intent and sanitized invitation query parameters on this path.
- Add `https://app.morada.lu/connexion` and `https://app.morada.lu/connexion?**`
  for legacy confirmations and invitations.
- Retain `https://morada.lu/auth/reset` and `https://www.morada.lu/auth/reset`
  for the existing password reset screen,
  as well as existing legitimate marketing and Pro callbacks. The reset screen
  is owned by the main site; this branch does not invent an app reset endpoint.
- Use explicit hosts. Do not add a wildcard covering arbitrary Vercel tenants.
- Save. Localhost is appropriate only as an explicit development redirect in a
  development project, never as the production Site URL.

In Vercel's **morada-gestion** project, set the Production variable
`NEXT_PUBLIC_APP_URL=https://app.morada.lu` and redeploy. Public variables are
baked into the build. This branch also defaults Auth email links to the production
app even when the sender runs locally; opt into a local destination explicitly
only while testing. Production rejects loopback and insecure HTTP configuration.

Use the live app for final tests. `/inscription/apercu` is a development-only,
simulated design preview and never sends SMS or creates accounts.

## 2. Install the branded emails

Open [Authentication → Email Templates](https://supabase.com/dashboard/project/lgmoocvumiuqjcqnrlej/auth/templates).
The current Free-project dashboard requires custom SMTP before template editing
is available. Configure the existing email provider in step 3 first; a plan
upgrade is not required if custom SMTP is used.
Copy the corresponding HTML body from this repository:

| Supabase template | Body |
|---|---|
| Confirm sign up | `supabase/templates/confirmation.html` |
| Change email address | `supabase/templates/email_change.html` |
| Reset password | `supabase/templates/recovery.html` |
| Magic link | `supabase/templates/magic_link.html` |

The matching subject is in `supabase/templates/subjects.json`. Bodies and subjects
choose FR/EN/DE/LU from `preferred_language` and default to French. Save each
template and use the dashboard preview before an actual delivery test.

**Change email address is the important template for phone-first signup:** adding
an email to the authenticated phone user uses that template, not Confirm sign up.
Keep email confirmation and secure email change enabled. The CTA and fallback
link use `{{ .ConfirmationURL }}`, preserving the real single-use verification
token and the configured redirect. Do not replace this with a plain site URL.

`docs/auth-email-preview.html` is a safe English design preview, without a token.
Regenerate the templates with `node scripts/build-auth-emails.mjs` after edits.
The emails use inline styles and table layout for mail clients, with no tracking
pixels, external font dependencies or JavaScript. Test Gmail, Apple Mail and a
mobile inbox after saving them; a browser preview is not an inbox rendering test.

## 3. Use a Morada sender

Use **Morada <accounts@notify.morada.lu>** for account verification, sign-in and
password recovery. The user requested a dedicated sending subdomain; reserve it
for transactional account mail and keep marketing campaigns on a separate sender.
This separates mail streams and helps protect the main domain's reputation, but
does not guarantee complete reputation isolation or inbox placement.

No email provider is configured yet. The proposed provider is Resend. Add
`notify.morada.lu` as the sending domain there, then copy its exact verification
records to Cloudflare (the authoritative DNS provider for `morada.lu`). Enable
sending only; do not alter the root domain's inbound MX records or enable inbound
mail unless a separate requirement calls for it.

After Resend shows the subdomain as verified, open **SMTP Settings** under
Authentication → Emails and configure:

| Setting | Value |
|---|---|
| Sender email | `accounts@notify.morada.lu` |
| Sender name | `Morada` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | A Resend sending API key restricted to this domain |

The user must create and enter credentials directly in the provider/Supabase
dashboards, not in Git or chat. The sender subdomain is not an application host;
confirmation redirects remain `https://app.morada.lu/inscription`.

Complete the provider's exact SPF, DKIM and DMARC DNS instructions; preserve
existing DNS records and do not create a second SPF policy at the same name.
Disable email click tracking for authentication links. The provider must show the
sending domain as verified before switching the From address. The app's separate
Resend configuration for rental documents does not configure Supabase Auth mail.

The sender domain, Auth API hostname and final app destination are different:

- The **From** address comes from SMTP.
- The button initially opens Supabase's verification endpoint.
- After verification, the user returns to `app.morada.lu`.

A `*.supabase.co/auth/v1/verify` link is expected. A branded Auth endpoint such as
`auth.morada.lu` is an optional Supabase custom-domain feature, not required to
fix localhost. Do not change API URLs or OAuth callbacks until that custom domain
is provisioned and verified; it can involve a paid add-on.

## 4. Activate phone signup, then social linking

1. In [Sign In / Providers](https://supabase.com/dashboard/project/lgmoocvumiuqjcqnrlej/auth/providers),
   configure **Phone** with a supported SMS provider, enable it, and use six-digit
   codes. Set provider budget/geographic limits and Supabase rate limits.
2. Configure Cloudflare Turnstile for `app.morada.lu`. Put its secret in Supabase
   Auth CAPTCHA settings and public site key in Vercel's
   `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. Confirm that the shared marketing/Pro Auth
   clients send CAPTCHA tokens before enabling this project-wide setting.
3. Enable phone signup in Vercel with `NEXT_PUBLIC_PHONE_SIGNUP_ENABLED=1`, then
   rebuild after a real SMS/confirmation test in staging.
4. Configure **Google** and **Apple** in Auth Providers. Register
   `https://lgmoocvumiuqjcqnrlej.supabase.co/auth/v1/callback` as their provider
   callback. Use Google Web OAuth credentials and an Apple Services ID plus
   its secret. Apple web secrets require scheduled rotation. Enter secrets only
   in the provider/Supabase dashboards.
5. Enable **Manual Linking** in Supabase. Test linking to the already verified
   phone user and confirm its UUID stays the same. Then enable the configured
   provider flags and `NEXT_PUBLIC_SOCIAL_LINKING_ENABLED=1` in Vercel.
6. Before enabling `NEXT_PUBLIC_SOCIAL_LOGIN_ENABLED=1`, install and activate the
   Before User Created hook in `docs/signup-social-guard.sql`. Inspect existing
   Auth hooks first and compose any existing rules. This guard prevents the
   returning-user social button from creating an OAuth-only new account. Because
   Auth is shared, validate this rule against sibling apps before activation.

**Do not enable OAuth Server for this flow.** That feature makes Morada an OAuth
provider for other applications. Its `/oauth/consent` screen is not implemented
and is not needed for signing into Morada with Google or Apple.

Phone verification plus confirming an email is not enforced two-factor
authentication on every login. AAL2 MFA is a separate implementation and policy.

## 5. Verify on the deployed domain

Use an address and phone number you own. Check confirmation, incorrect/expired
SMS code, resend, email confirmation, returning phone/provider login and password
recovery. Open an email on a second device: the return URL must be the live app,
not localhost. Confirm that the sender is Morada, that the inbox reports valid
SPF/DKIM, and that email linking keeps the same Auth user. Do not resend old
localhost links: request a new message after saving settings.

## Activation status

Verified in the signed-in production dashboard on 2026-09-27:

- **Saved:** Site URL changed from `http://localhost:3000` to
  `https://app.morada.lu`. The six exact callback entries in step 1 were added;
  the allowlist had previously been empty. No existing entry was removed.
- **Vercel application URL:** `NEXT_PUBLIC_APP_URL=https://app.morada.lu`
  was saved as a Production config variable on `morada-gestion` and deployed.
- **Email delivery:** custom SMTP is disabled. Supabase currently uses its
  default templates and requires SMTP setup (or a paid plan) to edit them.
  The branded templates are committed but are **not installed** in hosted Auth.
- **Phone:** still disabled in Supabase. Twilio Verify is selected in the open
  setup panel, but credential entry and saving remain with the user. The actual
  Twilio service named Morada has SMS enabled, six-digit codes, custom-code
  generation off and Fraud Guard on. Twilio's service list says sending to any
  recipient requires an upgraded account and an approved Primary Compliance
  Profile. These account requirements must be completed before public signup.
- **Sender:** the user selected a separate sending subdomain. The intended
  address is `accounts@notify.morada.lu`; it is not activated. Resend account
  setup, domain verification, SMTP and branded-template installation remain.
- **Google, Apple and Manual Linking:** disabled. Email confirmation remains on;
  anonymous sign-in remains off. No provider secrets or permissions were changed.
- **Deployment configuration:** the `morada-gestion` project had an install
  override that cloned the production branch over the selected Git commit.
  This removed the signup branch's new dependency declaration and caused
  `Can't resolve 'libphonenumber-js/min'`. The project now uses `npm ci`, also
  pinned in `vercel.json`, so each build installs its own lockfile. Code is
  deployed to `app.morada.lu/inscription` through merged PR #3; production phone
  activation remains gated on the provider setup above. Existing marketing links
  to `/connexion?onglet=inscription` will redirect into the new funnel when the
  phone flag and Turnstile public key are enabled.

Real SMS, OAuth and inbox delivery remain unverified. No production rows or
database schemas were changed. The phone and social UI flags remain gated until
provider setup and end-to-end checks are complete.

References: [redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls),
[email templates](https://supabase.com/docs/guides/auth/auth-email-templates),
[custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp),
[Resend SMTP](https://resend.com/docs/send-with-supabase-smtp),
[sending subdomains](https://resend.com/docs/knowledge-base/is-it-better-to-send-emails-from-a-subdomain-or-the-root-domain),
[OAuth Server](https://supabase.com/docs/guides/auth/oauth-server).
