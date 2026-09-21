-- The database's own guarantees, checked on the assembled schema before the
-- browser suite runs (and runnable against any copy of the schema):
--
--   * every table of the `gestion` schema has row-level security on and at
--     least one policy, so no table answers a query unfiltered;
--   * `anon` reaches nothing in `gestion`: no schema usage, no table grant,
--     no execute on a portal function;
--   * the only door open without a session is the public invitation
--     preview, and for a made-up token it answers "unknown";
--   * every security-definer function of `gestion` pins its search_path;
--   * the media bucket exists and is private.
--
-- Any failure raises; the run is red. On success the last line reads
-- "RLS AUDIT PASSED".
\set ON_ERROR_STOP on

do $$
declare
  r record;
  n int;
  preview jsonb;
begin
  -- 1. Row-level security on every table, with a policy.
  for r in
    select c.relname, c.relrowsecurity,
           (select count(*) from pg_policy p where p.polrelid = c.oid) as policies
      from pg_class c
      join pg_namespace s on s.oid = c.relnamespace
     where s.nspname = 'gestion' and c.relkind in ('r', 'p')
  loop
    if not r.relrowsecurity then
      raise exception 'gestion.% has row-level security OFF', r.relname;
    end if;
    if r.policies = 0 then
      raise exception 'gestion.% has row-level security on but no policy: it answers nobody, or worse, everybody through a definer', r.relname;
    end if;
  end loop;
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'gestion' and c.relkind in ('r', 'p');
  if n < 60 then
    raise exception 'only % tables in schema gestion: the schema was not assembled in full', n;
  end if;
  raise notice 'rls: % tables, all with security on and at least one policy', n;

  -- 2. anon reaches nothing.
  if has_schema_privilege('anon', 'gestion', 'USAGE') then
    raise exception 'anon has USAGE on schema gestion';
  end if;
  select count(*) into n from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'gestion';
  if n > 0 then
    raise exception 'anon holds % table grants in schema gestion', n;
  end if;
  for r in
    select p.oid::regprocedure as fn
      from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'gestion'
  loop
    if has_function_privilege('anon', r.fn, 'EXECUTE') then
      raise exception 'anon may execute %', r.fn;
    end if;
  end loop;
  raise notice 'anon: no usage, no grants, no executable function in gestion';

  -- 3. The one public door, and what it says to a stranger.
  if not has_function_privilege('anon', 'public.gestion_invite_preview(text)', 'EXECUTE') then
    raise exception 'public.gestion_invite_preview is not executable by anon: invitation links would be blank before sign-in';
  end if;
  select public.gestion_invite_preview('0000000000000000000000000000000000000000000000000000000000000000') into preview;
  if coalesce(preview ->> 'state', '') <> 'unknown' then
    raise exception 'a made-up invitation token previews as %, expected unknown', preview;
  end if;
  raise notice 'invitation preview: open to anon, unknown token answers unknown';

  -- 4. Definer functions pin their search_path (no object lookup through the caller''s path).
  for r in
    select p.oid::regprocedure as fn, p.proconfig
      from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'gestion' and p.prosecdef
  loop
    if r.proconfig is null or not exists (select 1 from unnest(r.proconfig) c where c like 'search_path=%') then
      raise exception 'security definer % does not pin search_path', r.fn;
    end if;
  end loop;
  raise notice 'definer functions: search_path pinned';

  -- 5. The media bucket is there and private.
  select count(*) into n from storage.buckets where id = 'gestion-media' and public = false;
  if n <> 1 then
    raise exception 'storage bucket gestion-media missing or public';
  end if;
  raise notice 'storage: gestion-media present and private';

  -- 6. The portal predicates and doors exist, as the app expects them.
  for r in
    select unnest(array[
      'gestion.portal_tenant_lease(uuid)', 'gestion.portal_tenant_live_lease(uuid)', 'gestion.portal_tenant_property(uuid)',
      'gestion.my_home()', 'gestion.my_lease_parties()', 'gestion.my_managers()', 'gestion.is_tenant()',
      'gestion.portal_invite_lease(uuid,uuid)', 'gestion.portal_revoke(uuid)', 'gestion.portal_accept(text)', 'gestion.can(uuid,text)'
    ]) as fn
  loop
    if to_regprocedure(r.fn) is null then
      raise exception 'expected function % is missing', r.fn;
    end if;
  end loop;
  raise notice 'portal functions: all present';

  raise notice 'RLS AUDIT PASSED';
end
$$;
