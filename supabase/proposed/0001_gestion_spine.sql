-- ===========================================================================
-- MORADA GESTION — 0001 COLONNE VERTEBRALE
--
-- ADDITIF, NON DESTRUCTIF. Ce fichier :
--   • crée le schéma `gestion` (aucune collision possible avec `public`) ;
--   • y ajoute les fonctions d'autorisation, qui DELEGUENT au modèle de
--     permissions déjà en production (agencies + crm_members).
--
-- Ce fichier ne crée, ne modifie et ne supprime AUCUN objet de `public`.
-- En particulier il ne touche pas à `public.g_can`, `public.crm_role_defaults`,
-- `public.crm_has_perm`, `public.crm_has_role` ni `public.crm_member_agencies`.
-- Les vingt tables `g_*` de l'ancien Morada Gestion continuent de fonctionner
-- exactement comme aujourd'hui.
-- ===========================================================================

create schema if not exists gestion;

comment on schema gestion is
  'Morada Gestion (app.morada.lu). Identité et permissions viennent de public.agencies + public.crm_members.';

-- ---------------------------------------------------------------------------
-- 1. ACCES AU SCHEMA
--
-- `anon` n'obtient rien : aucune donnée de gestion n'est lisible sans session.
-- ---------------------------------------------------------------------------
grant usage on schema gestion to authenticated, service_role;
revoke all on schema gestion from anon, public;

-- ---------------------------------------------------------------------------
-- 2. ORGANISATIONS DE L'UTILISATEUR
--
-- Une organisation Gestion EST une `public.agencies`. Un cabinet de gestion
-- ou un propriétaire bailleur se distingue d'une agence par `kind`
-- ('owner' / 'manager' au lieu de 'agency'), contrainte qui existe déjà.
-- ---------------------------------------------------------------------------
create or replace function gestion.member_orgs()
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select public.crm_member_agencies();
$$;

comment on function gestion.member_orgs() is
  'Organisations dont l''utilisateur courant est membre actif. Délègue à public.crm_member_agencies().';

-- ---------------------------------------------------------------------------
-- 3. CLES DE PERMISSION PROPRES A GESTION
--
-- `public.crm_role_defaults` porte déjà les clés `gestion.*` pour les rôles
-- admin, manager, accountant, maintenance et viewer. Il lui manque les clés
-- conformité et LBC/FT introduites par la nouvelle application. Plutôt que de
-- remplacer une fonction de production, on complète ici, dans notre schéma.
-- ---------------------------------------------------------------------------
create or replace function gestion.role_extra_defaults(p_role text)
returns jsonb
language sql immutable
set search_path = ''
as $$
  select case p_role
    when 'manager' then
      '{"gestion.compliance.view":true,"gestion.compliance.edit":true,"gestion.aml.view":true}'::jsonb
    when 'accountant' then
      '{"gestion.compliance.view":true}'::jsonb
    when 'viewer' then
      '{"gestion.compliance.view":true}'::jsonb
    else '{}'::jsonb
  end;
$$;

comment on function gestion.role_extra_defaults(text) is
  'Clés gestion.compliance.* et gestion.aml.* absentes de public.crm_role_defaults. Complément, jamais un remplacement.';

-- ---------------------------------------------------------------------------
-- 4. LE PREDICAT UNIQUE DERRIERE TOUTES LES POLICIES
--
-- Même logique que `public.g_can`, mais dans notre schéma et sous un autre
-- nom : aucun `create or replace` ne peut donc atteindre la fonction de
-- production. L'ordre de résolution est :
--   1. être membre actif de l'organisation ;
--   2. rôle owner ou admin : accès complet ;
--   3. permission explicite portée par le membre ou par son rôle ;
--   4. à défaut, les clés Gestion complémentaires ci-dessus.
-- ---------------------------------------------------------------------------
create or replace function gestion.can(p_org uuid, p_perm text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_org in (select public.crm_member_agencies())
     and (
          public.crm_has_role(p_org, array['owner', 'admin'])
       or public.crm_has_perm(p_org, p_perm)
       or coalesce(
            (gestion.role_extra_defaults(
               (select m.role
                  from public.crm_members m
                 where m.user_id = auth.uid()
                   and m.agency_id = p_org
                   and m.status = 'active'
                 limit 1)
             ) ->> p_perm)::boolean,
            false)
     );
$$;

comment on function gestion.can(uuid, text) is
  'Prédicat RLS de Morada Gestion. Ne remplace jamais public.g_can, qui sert l''ancien /gestion.';

-- ---------------------------------------------------------------------------
-- 5. DROITS SUR LES TABLES
--
-- RLS activée table par table dans les fichiers suivants. Ces droits ne
-- donnent donc accès à rien par eux-mêmes : sans policy correspondante, une
-- table reste totalement fermée, y compris à `authenticated`.
-- ---------------------------------------------------------------------------
alter default privileges in schema gestion
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema gestion
  grant usage, select on sequences to authenticated;

-- ---------------------------------------------------------------------------
-- 6. RAPPEL D'EXPLOITATION
--
-- Pour que PostgREST serve ce schéma, il faut l'ajouter aux « Exposed
-- schemas » des réglages d'API Supabase (Settings > API > Exposed schemas),
-- puis appeler le client avec `.schema('gestion')`. Ce réglage est le seul
-- changement de configuration du projet, et il est réversible en un clic.
-- ---------------------------------------------------------------------------
