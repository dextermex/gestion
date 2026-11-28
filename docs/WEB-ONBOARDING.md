# Onboarding and subscriptions: what the web app needs to match the iPhone app

Written on 27 November 2026 from the app's code (branch
`claude/upbeat-cori-rkkas4`) and from the production database. It is meant for
whoever builds the same onboarding into app.morada.lu (`dextermex/gestion`).
Part A is the onboarding, screen by screen, with what each step saves. Part B
is how a payment is recorded today, and what the web must do so that a
landlord who pays on the web opens the iPhone app, and the reverse.

Pictures of every screen and two videos (the trial screens, and the first
entry into a new space) were shared with the owner on 25 November 2026.

## The short version

1. The funnel's order is: the account first, then eleven one-tap questions,
   then the plan, then three trial screens, then the payment, then a guided
   first entry into the space. Nothing about money appears before the paywall.
2. Everything the funnel learns is saved on the Supabase user, in two
   metadata objects: `morada_signup` (shared with the web, decides where an
   unfinished account resumes) and `morada_mobile` (the app's own: quiz
   answers, the price quoted, the trial start, the tour seen).
3. **Today no payment is recorded in the database, on either surface.** An
   Apple subscription is known only to Apple and RevenueCat. A Stripe
   subscription is known only to Stripe. The shared table
   `gestion.billing_status` is written in the app's repository but **not
   applied** to production, and the RevenueCat webhook that would fill it is
   **not deployed**.
4. Consequence, as of build 97: a landlord who pays on the web is locked out
   of the iPhone app, and a landlord who pays in the app is unknown to the web.
   Part B lists the five steps that fix both.

---

## Part A. The onboarding

### A.1 The account (screens 1 to 9)

| # | Screen | What the person does | What is saved |
|---|---|---|---|
| 1 | Welcome | "Commencer" or "J'ai déjà un compte". Language capsule top right. | Nothing. The language choice is kept on the device. |
| 2 | Sign-in sheet | Apple, Google, the phone, e-mail last. | Nothing until one is used. |
| 3 | "C'est parti" | Phone number with country, or Apple / Google under it. | Nothing yet. |
| 4 | Confirm the number | "Confirmer et envoyer". | Supabase sends an SMS code (Twilio Verify). |
| 5 | The code | Six cells, autofill from Messages, verifies by itself. | Supabase creates the account (`phone` provider). The app then stamps `morada_signup = { version: 1, stage: "role" }`. |
| 6 | Notifications | Activer (the real iOS prompt) or Pas maintenant. | The push token, in `gestion.push_devices`. |
| 7 | Name | First and last name. | `first_name`, `last_name`, role `landlord`, stage `email`. |
| 8 | E-mail | The address. Not verified in the funnel: the confirmation mail goes out on its own. | `auth.updateUser({ email })`, stage `password`. |
| 9 | Password | At least 8 characters, typed twice. | The password, `password_set_at`, stage `tailor`. |

An Apple or Google account skips the phone, the name and e-mail the provider
gave, and the password. Those are the app's two departures from the web's
rules, decided by the owner in October. The web's `resumeStep()` should mirror
them, or such an account is sent to a phone or a code on app.morada.lu.
`docs/WEB-PROMPT.md`, Appendix B, has the exact function.

### A.2 The questions (screens 10 to 21)

Eleven questions, one tap each, an emoji per answer, Cal AI's order. The bar
at the top runs through the whole funnel and is front-loaded: the account
steps fill half of it.

| # | Question | Answer keys (stored) | Used for |
|---|---|---|---|
| 10 | Que louez-vous ? | `flats`, `houses`, `building`, `mixed` | The first property's type (A.6). |
| 11 | Vous gérez pour… | `self`, `family`, `clients` | Kept for later tuning. |
| 12 | Combien de lots ? | `1`, `2-5`, `6-10`, `11-20`, `21-50`, `0` | **The price** (lots), and the web's `properties` preference (`11-20` and `21-50` become `11+`). `0` means no first-property form. |
| 13 | Et vos loyers, en moyenne ? | band `0` to `4` (under 1 000 €, 1 000 to 1 499, 1 500 to 1 999, 2 000 to 2 999, 3 000 and more) | **The price** (rent band). |
| 14 | Où sont vos biens ? | `lu`, `be`, `fr`, `de`, `multi` | Kept. |
| 15 | Comment gérez-vous aujourd'hui ? | `spreadsheet`, `software`, `paper`, `starting` | Kept. |
| 16 | Qu'est-ce qui vous pèse le plus ? | `rent`, `documents`, `compliance`, `finances`, `maintenance` | The web's `challenge` preference, and the order of Accueil's sections. |
| 17 | Combien de temps y passez-vous ? | `1`, `5`, `20`, `40` (hours a week) | The web's `involvement` preference. |
| 18 | Un loyer en retard, vous l'apprenez… | `same_day`, `days`, `month_end`, `never` | Adds the arrears watch unless "same day". |
| 19 | Votre objectif cette année ? | `rent`, `everything`, `time`, `tax`, `grow` | Kept. |
| 20 | Où avez-vous entendu parler de Morada ? | `instagram`, `tiktok`, `word`, `search`, `press`, `other` | Attribution. |
| 21 | Qu'est-ce qui compte pour vous ? | Chips, pre-filled from the answers | Accueil's sections and horizon, in `morada_mobile.dashboard`. |

Where it is saved:

- `morada_signup.preferences = { properties, challenge, involvement }`: the
  web's own shape, unchanged.
- `morada_mobile.quiz = { kind, manageFor, units, where, today, late, goal, source, offer }`.
- `morada_mobile.dashboard`: the sections of Accueil, in order.

### A.3 The plan (screens 22 to 25)

| # | Screen | Purpose |
|---|---|---|
| 22 | "Vous avez tout pour y arriver" | The goal and the first month as a rising curve. |
| 23 | Reviews | Landlords' quotes. Skipped while the list is empty. **Real quotes only**; the current list must be confirmed by the owner before launch. |
| 24 | "Nous créons votre espace" | A figure counting to 100 over four lines built from the answers, while the account is finished on the server (stage `complete`, `completed_at`, the preferences, the workspace). |
| 25 | "Votre plan est prêt" | What Morada will do about the difficulty named. No price. |

### A.4 The trial and the payment (screens 26 to 31)

| # | Screen | Content |
|---|---|---|
| 26 | Free trial | "Nous voulons que vous essayiez Morada gratuitement", a real picture of Accueil in an iPhone, "Aucun paiement aujourd'hui", "Essayer gratuitement". |
| 27 | Reminder | "Nous vous prévenons avant la fin de votre essai", a bell, "Continuer gratuitement". Raises the notification prompt only if it was never answered. |
| 28 | Offer | "Vos 30 premiers jours sont offerts". Three dated rows: today full access; in 28 days a reminder; in 30 days the subscription starts unless cancelled. One price line ("Essayez 30 jours gratuitement, puis **300 € par an** (25 € par mois)"). "Tarif pour 3 lots · Comprendre mon tarif". "Commencer mes 30 jours gratuits". "Aucun paiement aujourd'hui. Annulable à tout moment". |
| 29 | Comprendre mon tarif | A panel: the lots, the rent band, yearly or monthly. Changing them changes the price at once. |
| 30 | One-time offer | Shown when the offer is closed: a quarter off the first year, the same "Comprendre mon tarif" link, "Non merci". |
| 31 | Bienvenue | "Ouvrir mon espace". |

Rules that apply to the web as well:

- **The card is taken before the trial.** In the app it is Apple's sheet. On
  the web it should be Stripe Checkout in subscription mode with a 30-day
  trial. The charge on day 30 is automatic.
- **The price comes from one place.** The grid is in the web's
  `src/domain/billing/pricing.ts` and the app's `src/lib/pricing.ts` (copied,
  never changed in the app): a price per lot by rent band (10, 14, 19, 25,
  32 € a month), lower from the 6th, 16th and 31st lot (10, 20, 30 % off),
  a year is billed as 10 months.
- **The reminder is real.** The `notify` function sends it two days before
  the end ("trial.ending"), so "in 28 days" is true. A web trial needs the
  same reminder, by e-mail or push.
- What the app saves when the person accepts: `morada_mobile.offer =
  { units, band, billing, addon }` and `morada_mobile.trial_started_at`.
  These are bookkeeping only. **They do not give access**; see Part B.
- Declining both the offer and the one-time offer leads to the locked screen.

### A.5 The first entry into the space (screens 32 and 33)

Built from the owner's recording of Revolut's account tour, adapted so that
nothing is explained before it can be done.

1. **Action first.** Straight after "Bienvenue", the property form opens,
   with the type already chosen from question 10 (`flats` gives Appartement,
   `houses` Maison, `building` Immeuble, `mixed` asks). Skipped when question
   12 was "Pas encore de lot".
2. **Arrival.** Back on Accueil, the screen scales up from the centre, small
   and rounded to full size, about 1.3 s with a slight overshoot.
3. **One stop.** The screen dims except one action: the step that is open
   now (Bien on an empty space, Bail once a property exists, then Banque). A
   headline says what it is for and a thin white ring draws round it in 3 s.
   A tap on it opens it; a tap elsewhere moves on; "Passer" ends the tour.
4. **The setup card.** Lit alone, with a light travelling round its border,
   until it is tapped. It opens the five steps: account, first property,
   lease, bank, tenant invited. A step that depends on another (a lease needs
   a property, an invitation needs a lease) is greyed out and says what it
   waits for.
5. **It keeps going.** The card keeps its travelling light while a step is
   open. Each time the person returns with one more step done, the screen
   dims round the card again and names the next step.
6. **Reminders.** One and three days after the trial starts, a notification
   names the step still open (`setup.next` in `notify`).
7. Seen once per account: `morada_mobile.tour = 1`.

On the web the same pattern works as an overlay on the real page: a dim layer
with a cut-out round the target, the headline, the ring, then the checklist.

### A.6 Where an unfinished account resumes

`morada_signup.stage` moves `role`, `email`, `password`, `tailor`, `complete`.
`resumeStep()` reads it with what Auth verified (phone, e-mail) and sends the
person to the first missing step. Both surfaces must use the same function,
so an account started on one continues on the other.

---

## Part B. How a payment is recorded, and what the web must do

### B.1 What exists today

| | Apple (in the app) | Stripe (on the web) |
|---|---|---|
| Who takes the money | Apple, through RevenueCat | Stripe |
| Who knows the subscription | Apple and RevenueCat. RevenueCat's customer is the **Supabase user id** (the app calls `Purchases.logIn(user.id)`). Entitlement: `morada_pro`. Products: `lu.morada.gestion.<year/quarter/month>.u<lots>.b<band>`, plus `.winback`. | Stripe only. The web's gate asks Stripe on each request. |
| What the database holds | `morada_mobile.offer` and `trial_started_at` on the user: bookkeeping, not access. | Nothing. |
| Shared record | `gestion.billing_status`: **migration written, not applied** (checked 27 November: the table does not exist). | Same table, not written by anything yet. |

How the app decides who may enter (`src/lib/access.ts`): the app opens when
**either** RevenueCat says the entitlement is active **or** the workspace has
a running row in `gestion.billing_status`. Running means status `trialing` or
`active` and `current_period_end` not passed. Anything else locks: never
started, ended, payment failed. Nothing is deleted when it locks.

So today, with the table missing, the app reads "no web subscription" for
everyone, and a landlord who paid on the web lands on the locked screen.

### B.2 The shared record

One row per workspace and per store. The workspace is `public.agencies.id`,
the same id as `crm_members.agency_id`.

```
gestion.billing_status
  org_id              uuid   the workspace that is paid for
  source              text   'stripe' | 'apple'
  status              text   'trialing' | 'active' | 'past_due' | 'unpaid' | 'canceled' | 'expired'
  current_period_end  timestamptz   end of the paid or trial period
  product             text   the Stripe price or the Apple product id
  updated_at          timestamptz
  primary key (org_id, source)
```

Members of a workspace can read its rows. Nobody can write them from a
browser or a phone: only the two webhooks write, on the server.

### B.3 The five steps

1. **Apply the migration**
   `supabase/migrations/20261119120000_billing_status.sql` (in this
   repository) to production. It only adds the table and its read policy.
2. **Record Stripe in the table.** A Stripe webhook writes the `stripe` row
   on `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted` and `invoice.payment_failed`:
   - `org_id`: the workspace. Put it in the Checkout session's
     `subscription_data.metadata.org_id` when the subscription is created,
     and read it back from the subscription.
   - `status`: Stripe `trialing` and `active` as they are; `past_due` as
     `past_due`; `unpaid` and `incomplete` as `unpaid`; `canceled` as
     `canceled`; `incomplete_expired` as `expired`.
   - `current_period_end`: `trial_end` while trialing, otherwise
     `current_period_end` (Stripe gives seconds; store a timestamp).
   - Upsert on `(org_id, source)`.

   Where to run it: the web has no service-role key by rule, so the write
   cannot happen in the Next.js app. The clean place is a Supabase Edge
   Function `stripe`, beside the `revenuecat` one already written: it checks
   Stripe's signature with the webhook secret (a function secret) and writes
   with the service role, which never leaves Supabase. `supabase/functions/
   revenuecat/index.ts` is the model to copy.
3. **Record Apple in the table.** Deploy `supabase/functions/revenuecat`
   (written, not deployed), set its secret `REVENUECAT_WEBHOOK_AUTH`, and in
   RevenueCat (Project settings, Integrations, Webhooks) point the webhook at
   it with the same value as Authorization header. It writes the `apple` row
   for every workspace the paying user belongs to.
4. **The web's gate reads the table.** Open the workspace when either row
   runs, the same rule as the app (B.1). This replaces the call to Stripe on
   each request and lets an Apple subscriber into the web.
5. **Fill the table once for existing subscribers.** A one-time script that
   lists active Stripe subscriptions and writes their rows, so nobody who
   already pays is locked when the app goes live.

Until steps 1 and 2 are done, a web subscriber is locked in the iPhone app.
Until step 3 is done, an Apple subscriber is unknown to the web.

### B.4 Rules both surfaces keep

- A failed payment locks at once (no grace period, App Store Connect has
  none set; Stripe's retries should not keep access open either).
- The app never links to the web to pay (App Review 3.1.1). A workspace paid
  on the web simply opens in the app.
- The free days are promised only once per account: Apple decides for the
  app; the web should check the account never had a trial before offering
  one.
