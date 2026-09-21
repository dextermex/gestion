-- How e2e/db/base/base_public.sql was produced, so it can be refreshed.
--
-- Read-only catalog queries against the hosted Morada project (psql, or the
-- Supabase SQL editor). Each query prints DDL; paste the output into
-- base_public.sql in the order below. Nothing here writes anything.
--
-- Which objects belong in the base: the tables and functions of `public`
-- that no file in e2e/db/morada creates. Compare the catalog with the files:
--
--   grep -hoiE "create table (if not exists )?public\.[a-z_]+" e2e/db/morada/*.sql | sort -u
--   grep -hoiE "create (or replace )?function public\.[a-z_]+" e2e/db/morada/*.sql | sort -u
--
-- against `select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'`
-- and `select proname from pg_proc where pronamespace = 'public'::regnamespace`.
-- Policies and triggers on the base tables that a migration creates are left
-- to the migration; only the ones absent from every file are kept here
-- (grep the policy name across e2e/db/morada/*.sql to decide).

-- The base tables, once decided.
create temp table base_tables (name text) on commit drop;
insert into base_tables values
  ('agencies'), ('community_posts'), ('leads'), ('listing_images'), ('listings'),
  ('offers'), ('reactions'), ('swipes'), ('waitlist');

-- The base functions, once decided.
create temp table base_functions (name text) on commit drop;
insert into base_functions values
  ('_infer_type'), ('_import_from_parsed'), ('discover_feed'), ('increment_view'),
  ('join_waitlist'), ('market_stats'), ('record_swipe'), ('submit_lead'), ('submit_offer');

-- 1. Extensions, in the schema the hosted project keeps them in.
select format('create extension if not exists %I with schema %I;', e.extname, n.nspname)
from pg_extension e
join pg_namespace n on n.oid = e.extnamespace
where e.extname in ('pg_trgm', 'unaccent', 'pgcrypto', 'uuid-ossp')
order by 1;

-- 2. Tables with every column as it stands today (later migrations add
--    columns `if not exists`, which is then a no-op).
select format(E'create table if not exists public.%I (\n%s\n);', c.relname,
  string_agg(
    format('  %I %s%s%s', a.attname, format_type(a.atttypid, a.atttypmod),
      coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), ''),
      case when a.attnotnull then ' not null' else '' end),
    E',\n' order by a.attnum))
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join base_tables t on t.name = c.relname
join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
where n.nspname = 'public' and c.relkind = 'r'
group by c.relname
order by c.relname;

-- 3. Primary keys, unique keys and checks, then the foreign keys that point
--    at another base table (foreign keys towards later tables belong to the
--    migration that creates the target).
select format('alter table public.%I add constraint %I %s;', c.relname, k.conname, pg_get_constraintdef(k.oid))
from pg_constraint k
join pg_class c on c.oid = k.conrelid
join pg_namespace n on n.oid = c.relnamespace
join base_tables t on t.name = c.relname
where n.nspname = 'public'
  and k.contype in ('p', 'u', 'c', 'f')
  and (k.contype <> 'f' or k.confrelid in (
    select rc.oid from pg_class rc join base_tables rt on rt.name = rc.relname
    where rc.relnamespace = 'public'::regnamespace))
order by case k.contype when 'f' then 1 else 0 end, c.relname, k.contype, k.conname;

-- 4. Indexes that do not back a constraint, made idempotent.
select regexp_replace(pg_get_indexdef(i.indexrelid), '^CREATE (UNIQUE )?INDEX ', 'CREATE \1INDEX IF NOT EXISTS ') || ';'
from pg_index i
join pg_class c on c.oid = i.indrelid
join pg_class ic on ic.oid = i.indexrelid
join base_tables t on t.name = c.relname
where c.relnamespace = 'public'::regnamespace
  and not exists (select 1 from pg_constraint k where k.conindid = i.indexrelid)
order by ic.relname;

-- 5. Row-level security.
select format('alter table public.%I enable row level security;', c.relname)
from pg_class c
join base_tables t on t.name = c.relname
where c.relnamespace = 'public'::regnamespace and c.relrowsecurity
order by c.relname;

-- 6. Policies. Keep only the ones no migration file creates.
select format(E'drop policy if exists %I on public.%I;\ncreate policy %I on public.%I as %s for %s to %s%s%s;',
  p.policyname, p.tablename, p.policyname, p.tablename, lower(p.permissive), lower(p.cmd),
  array_to_string(p.roles, ', '),
  coalesce(' using (' || p.qual || ')', ''),
  coalesce(' with check (' || p.with_check || ')', ''))
from pg_policies p
join base_tables t on t.name = p.tablename
where p.schemaname = 'public'
order by p.tablename, p.policyname;

-- 7. Triggers on the base tables, for the comparison only: every one of them
--    is created by a migration today, so none is copied.
select pg_get_triggerdef(tg.oid) || ';'
from pg_trigger tg
join pg_class c on c.oid = tg.tgrelid
join base_tables t on t.name = c.relname
where c.relnamespace = 'public'::regnamespace and not tg.tgisinternal
order by c.relname, tg.tgname;

-- 8. Functions, verbatim.
select pg_get_functiondef(p.oid) || ';'
from pg_proc p
join base_functions f on f.name = p.proname
where p.pronamespace = 'public'::regnamespace
order by p.proname;

-- 9. Their execute grants to the API roles.
select format('grant execute on function public.%I(%s) to %s;', p.proname, pg_get_function_identity_arguments(p.oid),
  string_agg(distinct g.grantee::regrole::text, ', ' order by g.grantee::regrole::text))
from pg_proc p
join base_functions f on f.name = p.proname
cross join lateral aclexplode(p.proacl) g
where p.pronamespace = 'public'::regnamespace
  and g.privilege_type = 'EXECUTE'
  and g.grantee <> 0
  and g.grantee::regrole::text in ('anon', 'authenticated', 'service_role')
group by p.oid, p.proname
order by p.proname;
