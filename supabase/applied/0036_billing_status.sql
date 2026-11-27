-- ===========================================================================
-- 0036 · Statut d'abonnement partagé : un seul enregistrement pour les deux
-- surfaces (décision du propriétaire, 19 et 27 novembre 2026).
--
-- Prérequis : 0001 (schéma gestion et ses droits), public.agencies et
-- public.crm_members (Morada).
--
-- L'abonnement d'un espace vit chez le magasin qui l'a vendu : Stripe pour
-- app.morada.lu, Apple (par RevenueCat) pour l'app iPhone. Chaque webhook
-- inscrit ici ce qu'il sait, une ligne par espace et par magasin, et les deux
-- surfaces la lisent : l'app dans src/lib/data/billing.ts, le web dans
-- src/lib/billing/access.ts.
--
-- Écrite par les webhooks seulement, côté serveur, avec le rôle de service :
-- la fonction `stripe` (supabase/shared/functions/stripe) pour Stripe, la
-- fonction `revenuecat` pour Apple. Un membre lit les lignes de ses propres
-- espaces et ne peut rien y changer ; `anon` n'y a aucun accès. Un
-- abonnement court tant que son statut est `trialing` ou `active` et que sa
-- période n'est pas finie ; un paiement échoué (`past_due`, `unpaid`) ne
-- court pas. Rien d'autre n'est touché quand l'accès se ferme : toutes les
-- données de l'espace restent.
--
-- Reprise telle quelle de la migration de l'app
-- (supabase/shared/migrations/20261119120000_billing_status.sql), rendue
-- rejouable et complétée des droits du rôle de service.
--
-- Réversible :
--   drop table gestion.billing_status;
-- ===========================================================================

create table if not exists gestion.billing_status (
  org_id uuid not null references public.agencies(id) on delete cascade,
  source text not null check (source in ('stripe', 'apple')),
  status text not null check (status in ('trialing', 'active', 'past_due', 'unpaid', 'canceled', 'expired')),
  current_period_end timestamptz,
  product text,
  updated_at timestamptz not null default now(),
  primary key (org_id, source)
);

alter table gestion.billing_status enable row level security;

-- Les droits par défaut du schéma (0001) donneraient l'écriture à
-- `authenticated` : ils sont retirés, seule la lecture reste.
revoke all on gestion.billing_status from public, anon, authenticated;
grant select on gestion.billing_status to authenticated;
grant select, insert, update, delete on gestion.billing_status to service_role;

drop policy if exists billing_status_member_select on gestion.billing_status;
create policy billing_status_member_select on gestion.billing_status
  for select to authenticated
  using (exists (
    select 1 from public.crm_members m
    where m.agency_id = billing_status.org_id and m.user_id = auth.uid() and m.status = 'active'
  ));
