-- ===========================================================================
-- FIXTURE — reproduit la surface de production nécessaire aux tests
--
-- Recopie fidèlement, depuis le projet lgmoocvumiuqjcqnrlej, ce dont les
-- migrations `gestion` dépendent : les rôles Supabase, le schéma auth, les
-- tables d'identité et les quatre fonctions de permission du CRM.
--
-- On y ajoute `public.g_can` dans sa version de production, ainsi que deux
-- tables `g_*`, uniquement pour prouver qu'elles ressortent intactes.
--
-- À exécuter sur une base JETABLE. Jamais sur la production.
-- ===========================================================================

create extension if not exists pgcrypto;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon')          then create role anon          nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role')  then create role service_role  nologin noinherit bypassrls; end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- auth
-- --------------------------------------------------------------------------
create schema if not exists auth;

create table if not exists auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text unique
);

create or replace function auth.uid()
returns uuid language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid;
$$;

grant usage on schema auth to anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- identité de l'écosystème
-- --------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text,
  last_name text,
  account_type text default 'customer',
  created_at timestamptz not null default now()
);

create table if not exists public.agencies (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  email text,
  kind text not null default 'agency' check (kind in ('agency', 'owner', 'manager')),
  is_public boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.crm_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agency_id uuid not null references public.agencies(id) on delete cascade,
  role text not null default 'viewer',
  display_name text,
  email text,
  status text not null default 'active',
  permissions jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (user_id, agency_id)
);

-- --------------------------------------------------------------------------
-- fonctions de permission, copiées telles quelles depuis la production
-- --------------------------------------------------------------------------
create or replace function public.crm_role_defaults(p_role text)
returns jsonb language sql immutable
set search_path to 'public', 'pg_temp'
as $function$
  select case p_role
    when 'admin' then '{
      "settings.edit":true,
      "gestion.properties.view":true,"gestion.properties.edit":true,"gestion.properties.delete":true,
      "gestion.tenants.view":true,"gestion.tenants.edit":true,
      "gestion.leases.view":true,"gestion.leases.edit":true,
      "gestion.finance.view":true,"gestion.finance.edit":true,
      "gestion.maintenance.view":true,"gestion.maintenance.edit":true,
      "gestion.documents.view":true,"gestion.documents.edit":true,
      "gestion.settings.edit":true}'::jsonb
    when 'agent' then '{"properties.create":true,"leads.view_own":true}'::jsonb
    when 'manager' then '{
      "gestion.properties.view":true,"gestion.properties.edit":true,
      "gestion.tenants.view":true,"gestion.tenants.edit":true,
      "gestion.leases.view":true,"gestion.leases.edit":true,
      "gestion.finance.view":true,"gestion.finance.edit":true,
      "gestion.maintenance.view":true,"gestion.maintenance.edit":true,
      "gestion.documents.view":true,"gestion.documents.edit":true}'::jsonb
    when 'accountant' then '{
      "gestion.properties.view":true,"gestion.tenants.view":true,"gestion.leases.view":true,
      "gestion.finance.view":true,"gestion.finance.edit":true,
      "gestion.maintenance.view":true,
      "gestion.documents.view":true,"gestion.documents.edit":true}'::jsonb
    when 'maintenance' then '{
      "gestion.properties.view":true,"gestion.tenants.view":true,
      "gestion.maintenance.view":true,"gestion.maintenance.edit":true,
      "gestion.documents.view":true,"gestion.documents.edit":true}'::jsonb
    when 'viewer' then '{
      "gestion.properties.view":true,"gestion.tenants.view":true,"gestion.leases.view":true,
      "gestion.finance.view":true,"gestion.maintenance.view":true,
      "gestion.documents.view":true}'::jsonb
    else '{}'::jsonb
  end;
$function$;

create or replace function public.crm_member_agencies()
returns setof uuid language sql stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select agency_id from public.crm_members
  where user_id = auth.uid() and status = 'active';
$function$;

create or replace function public.crm_has_perm(p_agency uuid, p_key text)
returns boolean language sql stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select coalesce((
    select case
      when m.role = 'owner' then true
      when m.permissions ? p_key then (m.permissions ->> p_key)::boolean
      else coalesce((public.crm_role_defaults(m.role) ->> p_key)::boolean, false)
    end
    from public.crm_members m
    where m.user_id = auth.uid() and m.agency_id = p_agency and m.status = 'active'
    limit 1
  ), false);
$function$;

create or replace function public.crm_has_role(p_agency uuid, p_roles text[])
returns boolean language sql stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1 from public.crm_members m
    where m.user_id = auth.uid() and m.agency_id = p_agency
      and m.status = 'active' and m.role = any(p_roles)
  );
$function$;

-- La fonction que les migrations d'origine auraient écrasée.
create or replace function public.g_can(p_org uuid, p_perm text)
returns boolean language sql stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select p_org in (select public.crm_member_agencies())
     and (public.crm_has_role(p_org, array['owner','admin'])
          or public.crm_has_perm(p_org, p_perm));
$function$;

-- Deux des vingt tables de l'ancien /gestion, pour vérifier qu'elles survivent.
create table if not exists public.g_properties (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  name text not null,
  commune text
);
create table if not exists public.g_leases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade
);
alter table public.g_properties enable row level security;
alter table public.g_leases     enable row level security;
create policy g_properties_select on public.g_properties for select to authenticated
  using (public.g_can(org_id, 'gestion.properties.view'));
create policy g_leases_select on public.g_leases for select to authenticated
  using (public.g_can(org_id, 'gestion.leases.view'));

grant select, insert, update, delete on all tables in schema public to authenticated;
