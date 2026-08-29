-- ===========================================================================
-- TEST DE ROLLBACK — prouve que 0099 rend la base à son état d'avant
--
-- Prend une empreinte de `public` (tables, fonctions avec leur signature,
-- policies, et le corps exact de public.g_can), exécute le rollback, puis
-- rejoue l'empreinte et exige zéro différence dans les deux sens.
--
-- À exécuter sur la base jetable, après 01_checks.sql.
-- ===========================================================================

\set ON_ERROR_STOP on

create table if not exists public._empreinte_avant as
  select 'table:' || tablename as o from pg_tables where schemaname = 'public'
  union all
  select 'fn:' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
  union all
  select 'policy:' || tablename || '.' || policyname from pg_policies where schemaname = 'public'
  union all
  select 'corps_g_can:' || md5(pg_get_functiondef('public.g_can(uuid,text)'::regprocedure));

-- --------------------------------------------------------------------------
\i 0099_rollback.sql
-- --------------------------------------------------------------------------

do $$
declare perdu text; apparu text;
begin
  if exists (select 1 from pg_namespace where nspname = 'gestion') then
    raise exception 'le schéma gestion existe encore après le rollback';
  end if;

  with apres as (
    select 'table:' || tablename as o from pg_tables
      where schemaname = 'public' and tablename <> '_empreinte_avant'
    union all
    select 'fn:' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
    union all
    select 'policy:' || tablename || '.' || policyname from pg_policies where schemaname = 'public'
    union all
    select 'corps_g_can:' || md5(pg_get_functiondef('public.g_can(uuid,text)'::regprocedure))
  )
  select
    (select string_agg(b.o, ', ') from public._empreinte_avant b
      where b.o <> 'table:_empreinte_avant' and not exists (select 1 from apres a where a.o = b.o)),
    (select string_agg(a.o, ', ') from apres a
      where not exists (select 1 from public._empreinte_avant b where b.o = a.o))
  into perdu, apparu;

  if perdu is not null then raise exception 'le rollback a fait DISPARAITRE de public : %', perdu; end if;
  if apparu is not null then raise exception 'le rollback a LAISSE dans public : %', apparu; end if;

  raise notice 'rollback : schéma gestion supprimé, public strictement identique';
end $$;

drop table public._empreinte_avant;
