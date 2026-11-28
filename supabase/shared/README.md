# Backend partagé (schéma `gestion` + Edge Functions)

Ce dossier est la **source de vérité** du backend commun aux deux surfaces de
Morada Gestion :

- **app.morada.lu** — l'application web (ce dépôt, `dextermex/gestion`) ;
- **l'app iPhone** — `dextermex/morada-mobile-app` (Expo/React Native).

Les deux lisent et écrivent le même schéma `gestion` du projet Supabase commun,
chacune sous le JWT de l'utilisateur. Décision du propriétaire (2026-11-19) :
**le backend (schéma Postgres + Edge Functions) vit ici**, pas dans l'app mobile
ni dans le site vitrine. L'app mobile redevient un pur client.

## Pourquoi ces fichiers ne sont PAS dans `supabase/applied/`

`e2e/db/prepare.mjs` n'applique en CI que les fichiers `supabase/applied/NNNN_*.sql`
(préfixe à quatre chiffres) sur une pile Supabase locale. Les migrations ci-dessous :

- portent un nom horodaté (`20261002120000_…`), pas numéroté — la CI les ignore ;
- ont été **appliquées à la main, instruction par instruction, sur le projet hébergé**
  (ce que disent leurs en-têtes), car elles dépendent d'extensions de plateforme
  (`vault`, `pg_cron`, `pg_net`) et de secrets du Vault que la pile locale n'a pas.

Elles sont donc conservées ici comme **copie canonique et registre**, pas comme
migrations rejouées en CI. Les promouvoir un jour dans le jeu numéroté testé par la
CI (en étendant la base e2e aux extensions nécessaires) est un chantier distinct.

## Provenance

Copié octet pour octet depuis `dextermex/morada-mobile-app` au commit
`a92f806a41e289d6d84ae83e8ae87b1c76baaa5f` (2026-11-19). Tant que l'app mobile n'a
pas retiré son propre `supabase/`, ce répertoire en est le double ; après quoi il en
est l'unique original.

## Migrations (`migrations/`)

| Fichier | État (selon l'en-tête / le commit d'origine) | Objet |
|---|---|---|
| `20261002120000_notifications_mobile.sql` | **Appliquée** le 2026-10-02 (hébergé, instruction par instruction) | `push_devices`, `notification_prefs`, `notifications` + fonctions `notify_*`, déclencheurs sur `messages`/`payments`/`tickets`/`portal_invites`/`work_orders`, tick `pg_cron`. Dépend de `vault`, `pg_net`, `pg_cron`. |
| `20261010120000_referrals_mobile.sql` | **Appliquée** (constatée au catalogue le 2026-11-19 : `referral_codes`, `referral_uses`) | `referral_codes`, `referral_uses` + RPC `referral_code()` / `redeem_referral()`. |
| `20261011120000_security_tenant_isolation.sql` | **Appliquée** le 2026-10-11 (hébergé, instruction par instruction) | **Correctif d'isolation inter-locataires de l'audit du 11 oct.** : `portal_tenant_lease`/`portal_owner_property` liés à l'organisation, inserts portail liés à l'org, déclencheurs `guard_link_org`, `agencies` restreint à `is_public`, gardes des tables héritées `g_*`, durcissement des notifications. **Ne pas ré-appliquer** : c'est ce que l'audit mené dans ce dépôt (même date) avait re-dérivé en doublon. |
| `20261119120000_billing_status.sql` | **NON appliquée** (2026-11-19) | `gestion.billing_status` : un seul statut d'abonnement pour les deux surfaces (Stripe côté web, Apple/RevenueCat côté app). Écrite par les webhooks (service role) ; lue par les deux surfaces. Reprise dans le jeu numéroté sous `supabase/applied/0036_billing_status.sql` (rejouable, droits explicites), que la CI rejoue : c'est ce fichier-là qu'on applique. |

État de production constaté au catalogue le 2026-11-19 : les trois migrations
d'octobre sont appliquées, `billing_status` ne l'est pas ; `bank` (v6), `notify`
(v8) et `scan-receipt` (v5) sont déployées, `revenuecat` ne l'est pas. Les
sections 1, 2 et 7 de la migration d'isolement sont reprises, à l'identique,
dans `supabase/applied/0030_integrite.sql`, que la CI rejoue.

## Edge Functions (`functions/`)

Déployées sur le projet hébergé par `supabase functions deploy`. Source désormais
canonique ici.

| Fonction | Objet |
|---|---|
| `bank/` (`index.ts`, `matching.ts`) | Import/rapprochement bancaire (Salt Edge). |
| `notify/` (`index.ts`, `templates.ts`) | Moteur de notifications (push + inbox) réveillé par `pg_net`/`pg_cron` ; gabarits FR/EN/DE/LU. |
| `revenuecat/` (`index.ts`) | Webhook RevenueCat (abonnements Apple), écrit la ligne `apple` de `gestion.billing_status`. Secret `REVENUECAT_WEBHOOK_AUTH`. |
| `stripe/` (`index.ts`, `logic.ts`) | Webhook Stripe (abonnements web), écrit la ligne `stripe` de `gestion.billing_status` : signature vérifiée (HMAC-SHA256, tolérance de 5 min) avec le secret `STRIPE_WEBHOOK_SECRET`, événements `customer.subscription.created/updated/deleted` et `invoice.payment_failed`, abonnements portant `morada_app=gestion` seulement. Déployée sans vérification de JWT. `logic.ts` est pur et testé depuis vitest (`src/lib/billing/__tests__/stripe-webhook.test.ts`). |
| `scan-receipt/` (`index.ts`) | Reconnaissance de reçu (OCR/LLM) pour l'app. |

## Suites (division du travail)

1. **App mobile** (`morada-mobile-app`) : retirer son `supabase/` (migrations + functions),
   rester un pur client lisant le schéma `gestion`.
2. **Ce dépôt (web)** : `billing_status` est câblé (fonction `stripe` en écriture, porte
   `src/lib/billing/access.ts` en lecture) ; reste à appliquer 0036, déployer `stripe` et
   `revenuecat`, et déclarer les deux webhooks.
3. **Toute évolution future** du schéma `gestion` ou des Edge Functions se fait **ici**.
4. Facultatif : promouvoir ces migrations dans le jeu numéroté testé en CI une fois la
   base e2e dotée de `vault`/`pg_cron`/`pg_net`.

Ces fichiers `.ts` (Deno) et `.sql` sont exclus du typecheck et du lint de l'app Next
(`tsconfig.json`, `eslint.config.mjs`) : ce n'est pas du code de l'app web.
