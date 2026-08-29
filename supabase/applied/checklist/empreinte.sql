-- ===========================================================================
-- EMPREINTE DE NON-REGRESSION — strictement en LECTURE SEULE
--
-- À exécuter sur la production JUSTE AVANT la migration, puis JUSTE APRES.
-- Les deux sorties doivent être identiques ligne pour ligne, à l'exception
-- de la ligne « schéma gestion », qui passe de absent à présent.
--
-- Ne crée rien, ne modifie rien, n'écrit rien. Aucun verrou pris.
-- ===========================================================================

with g_tables as (
  select schemaname, tablename from pg_tables
   where schemaname = 'public' and tablename like 'g\_%'
),
g_rows as (
  select coalesce(sum(
           (xpath('/row/c/text()',
             query_to_xml(format('select count(*) as c from %I.%I', schemaname, tablename),
                          false, true, '')))[1]::text::bigint), 0) as n
    from g_tables
)
select * from (
  -- Ce qui est vivant et ne doit pas bouger d'une ligne
  select 1 as ord, 'Comptes'      as domaine, 'auth.users'                as element, count(*)::text as valeur from auth.users
  union all
  select 1, 'Comptes',            'profiles',                    count(*)::text from public.profiles
  union all
  select 2, 'Marketplace',        'listings',                    count(*)::text from public.listings
  union all
  select 3, 'Agences',            'agencies (total)',            count(*)::text from public.agencies
  union all
  select 3, 'Agences',            'agencies kind=agency',        count(*)::text from public.agencies where kind = 'agency'
  union all
  select 4, 'CRM',                'crm_members',                 count(*)::text from public.crm_members
  union all
  select 4, 'CRM',                'crm_members actifs',          count(*)::text from public.crm_members where status = 'active'

  -- Les fonctions d'autorisation, comparées sur leur corps exact
  union all
  select 5, 'Permissions',        'corps de public.g_can',       md5(pg_get_functiondef('public.g_can(uuid,text)'::regprocedure))
  union all
  select 5, 'Permissions',        'corps de crm_has_perm',       md5(pg_get_functiondef('public.crm_has_perm(uuid,text)'::regprocedure))
  union all
  select 5, 'Permissions',        'corps de crm_has_role',       md5(pg_get_functiondef('public.crm_has_role(uuid,text[])'::regprocedure))
  union all
  select 5, 'Permissions',        'corps de crm_member_agencies', md5(pg_get_functiondef('public.crm_member_agencies()'::regprocedure))
  union all
  select 5, 'Permissions',        'corps de crm_role_defaults',  md5(pg_get_functiondef('public.crm_role_defaults(text)'::regprocedure))
  union all
  select 5, 'Permissions',        'corps de gestion_onboard',    md5(pg_get_functiondef('public.gestion_onboard(text,text)'::regprocedure))

  -- L'ancien /gestion, que l'on garde en repli
  union all
  select 6, 'Ancien /gestion',    'tables g_*',                  count(*)::text from g_tables
  union all
  select 6, 'Ancien /gestion',    'policies sur les g_*',        count(*)::text from pg_policies
   where schemaname = 'public' and tablename like 'g\_%'
  union all
  select 6, 'Ancien /gestion',    'lignes dans les g_*',         n::text from g_rows

  -- La structure de public dans son ensemble
  union all
  select 7, 'Structure public',   'empreinte des tables',        md5(coalesce(string_agg(tablename, ',' order by tablename), ''))
    from pg_tables where schemaname = 'public'
  union all
  select 7, 'Structure public',   'empreinte des fonctions',     md5(coalesce(string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ',' order by p.proname, pg_get_function_identity_arguments(p.oid)), ''))
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public'
  union all
  select 7, 'Structure public',   'empreinte des policies',      md5(coalesce(string_agg(tablename || '.' || policyname, ',' order by tablename, policyname), ''))
    from pg_policies where schemaname = 'public'
  union all
  select 7, 'Structure public',   'tables sans RLS',             coalesce(string_agg(tablename, ', ' order by tablename), '(aucune)')
    from pg_tables where schemaname = 'public' and not rowsecurity

  -- La seule ligne qui a le droit de changer
  union all
  select 8, 'Nouveau',            'schéma gestion',
         case when exists (select 1 from pg_namespace where nspname = 'gestion')
              then 'présent' else 'absent' end
) t
order by ord, element;
