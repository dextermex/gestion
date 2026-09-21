-- ============================================================================
-- Morada Pro CRM — Migration 1/4: Foundation (membership, invites, permissions)
-- ============================================================================
-- ADDITIVE ONLY. This migration:
--   * creates NEW tables:      crm_members, crm_invites
--   * creates NEW functions:   crm_member_agencies, crm_has_role,
--                              crm_onboard, crm_accept_invite, crm_invite_member
--   * adds NEW RLS policies (all named crm_*) on EXISTING tables:
--       agencies (update by owner/admin members),
--       leads    (select/update by agency members),
--       offers   (select/update by agency members),
--       listings (select/insert/update by members, delete by owner/admin),
--       listing_images (select/insert/update/delete via parent listing)
-- It does NOT rename, alter, or drop any existing column, table, or policy,
-- and does NOT touch existing rows.
--
-- ROLLBACK (fully reversible):
--   drop the crm_* policies, then crm_invites, crm_members, and the functions.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Membership: connects auth.users to agencies with a role
-- ---------------------------------------------------------------------------
create table if not exists public.crm_members (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  agency_id    uuid not null references public.agencies (id) on delete cascade,
  role         text not null default 'agent' check (role in ('owner', 'admin', 'agent')),
  display_name text not null default '',
  email        text not null default '',
  status       text not null default 'active' check (status in ('active', 'disabled')),
  created_at   timestamptz not null default now(),
  unique (user_id, agency_id)
);
create index if not exists crm_members_user_idx on public.crm_members (user_id);
create index if not exists crm_members_agency_idx on public.crm_members (agency_id);
alter table public.crm_members enable row level security;

create table if not exists public.crm_invites (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references public.agencies (id) on delete cascade,
  email       text not null,
  role        text not null default 'agent' check (role in ('admin', 'agent')),
  token       uuid not null default gen_random_uuid() unique,
  invited_by  uuid references auth.users (id) on delete set null,
  accepted_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists crm_invites_agency_idx on public.crm_invites (agency_id);
alter table public.crm_invites enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Helper functions (security definer so policies never recurse)
-- ---------------------------------------------------------------------------
create or replace function public.crm_member_agencies()
returns setof uuid
language sql stable security definer
set search_path = public, pg_temp
as $$
  select agency_id from public.crm_members
  where user_id = auth.uid() and status = 'active';
$$;

create or replace function public.crm_has_role(p_agency uuid, p_roles text[])
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.crm_members
    where user_id = auth.uid()
      and agency_id = p_agency
      and status = 'active'
      and role = any (p_roles)
  );
$$;

revoke all on function public.crm_member_agencies() from public, anon;
grant execute on function public.crm_member_agencies() to authenticated;
revoke all on function public.crm_has_role(uuid, text[]) from public, anon;
grant execute on function public.crm_has_role(uuid, text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. RLS for the new tables
-- ---------------------------------------------------------------------------
drop policy if exists crm_members_select on public.crm_members;
create policy crm_members_select on public.crm_members
  for select to authenticated
  using (agency_id in (select public.crm_member_agencies()));

drop policy if exists crm_members_update on public.crm_members;
create policy crm_members_update on public.crm_members
  for update to authenticated
  using (public.crm_has_role(agency_id, array['owner', 'admin']))
  with check (public.crm_has_role(agency_id, array['owner', 'admin']));

drop policy if exists crm_members_delete on public.crm_members;
create policy crm_members_delete on public.crm_members
  for delete to authenticated
  using (public.crm_has_role(agency_id, array['owner', 'admin']) and role <> 'owner');

-- inserts happen only through the security-definer RPCs below

drop policy if exists crm_invites_select on public.crm_invites;
create policy crm_invites_select on public.crm_invites
  for select to authenticated
  using (public.crm_has_role(agency_id, array['owner', 'admin']));

drop policy if exists crm_invites_delete on public.crm_invites;
create policy crm_invites_delete on public.crm_invites
  for delete to authenticated
  using (public.crm_has_role(agency_id, array['owner', 'admin']));

-- ---------------------------------------------------------------------------
-- 4. Onboarding + invite RPCs
-- ---------------------------------------------------------------------------
create or replace function public.crm_onboard(p_agency_name text, p_display_name text)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_agency uuid;
  v_slug   text;
  v_email  text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if coalesce(trim(p_agency_name), '') = '' then
    raise exception 'agency_name_required';
  end if;

  select email into v_email from auth.users where id = auth.uid();

  v_slug := trim(both '-' from regexp_replace(lower(trim(p_agency_name)), '[^a-z0-9]+', '-', 'g'));
  if v_slug = '' then v_slug := 'agency'; end if;
  if exists (select 1 from public.agencies where slug = v_slug) then
    v_slug := v_slug || '-' || substr(gen_random_uuid()::text, 1, 6);
  end if;

  insert into public.agencies (slug, name, email)
  values (v_slug, trim(p_agency_name), v_email)
  returning id into v_agency;

  insert into public.crm_members (user_id, agency_id, role, display_name, email)
  values (
    auth.uid(), v_agency, 'owner',
    coalesce(nullif(trim(p_display_name), ''), split_part(coalesce(v_email, 'agent'), '@', 1)),
    coalesce(v_email, '')
  );

  return v_agency;
end;
$$;

create or replace function public.crm_accept_invite(p_token uuid, p_display_name text)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_invite record;
  v_email  text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select email into v_email from auth.users where id = auth.uid();

  select * into v_invite
  from public.crm_invites
  where token = p_token and accepted_at is null
  for update;

  if not found then
    raise exception 'invite_invalid';
  end if;
  if lower(v_invite.email) <> lower(coalesce(v_email, '')) then
    raise exception 'invite_email_mismatch';
  end if;
  if exists (
    select 1 from public.crm_members
    where user_id = auth.uid() and agency_id = v_invite.agency_id
  ) then
    update public.crm_invites set accepted_at = now() where id = v_invite.id;
    return v_invite.agency_id;
  end if;

  insert into public.crm_members (user_id, agency_id, role, display_name, email)
  values (
    auth.uid(), v_invite.agency_id, v_invite.role,
    coalesce(nullif(trim(p_display_name), ''), split_part(coalesce(v_email, 'agent'), '@', 1)),
    coalesce(v_email, '')
  );
  update public.crm_invites set accepted_at = now() where id = v_invite.id;

  return v_invite.agency_id;
end;
$$;

create or replace function public.crm_invite_member(p_agency uuid, p_email text, p_role text)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_token uuid;
begin
  if not public.crm_has_role(p_agency, array['owner', 'admin']) then
    raise exception 'forbidden';
  end if;
  if p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid_email';
  end if;
  if p_role not in ('admin', 'agent') then
    raise exception 'invalid_role';
  end if;

  insert into public.crm_invites (agency_id, email, role, invited_by)
  values (p_agency, lower(trim(p_email)), p_role, auth.uid())
  returning token into v_token;

  return v_token;
end;
$$;

revoke all on function public.crm_onboard(text, text) from public, anon;
grant execute on function public.crm_onboard(text, text) to authenticated;
revoke all on function public.crm_accept_invite(uuid, text) from public, anon;
grant execute on function public.crm_accept_invite(uuid, text) to authenticated;
revoke all on function public.crm_invite_member(uuid, text, text) from public, anon;
grant execute on function public.crm_invite_member(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Additive policies on EXISTING tables (agency members only; all crm_*)
-- ---------------------------------------------------------------------------
drop policy if exists crm_agencies_update on public.agencies;
create policy crm_agencies_update on public.agencies
  for update to authenticated
  using (public.crm_has_role(id, array['owner', 'admin']))
  with check (public.crm_has_role(id, array['owner', 'admin']));

drop policy if exists crm_leads_select on public.leads;
create policy crm_leads_select on public.leads
  for select to authenticated
  using (agency_id in (select public.crm_member_agencies()));

drop policy if exists crm_leads_update on public.leads;
create policy crm_leads_update on public.leads
  for update to authenticated
  using (agency_id in (select public.crm_member_agencies()))
  with check (agency_id in (select public.crm_member_agencies()));

drop policy if exists crm_offers_select on public.offers;
create policy crm_offers_select on public.offers
  for select to authenticated
  using (agency_id in (select public.crm_member_agencies()));

drop policy if exists crm_offers_update on public.offers;
create policy crm_offers_update on public.offers
  for update to authenticated
  using (agency_id in (select public.crm_member_agencies()))
  with check (agency_id in (select public.crm_member_agencies()));

drop policy if exists crm_listings_select on public.listings;
create policy crm_listings_select on public.listings
  for select to authenticated
  using (agency_id in (select public.crm_member_agencies()));

drop policy if exists crm_listings_insert on public.listings;
create policy crm_listings_insert on public.listings
  for insert to authenticated
  with check (agency_id in (select public.crm_member_agencies()));

drop policy if exists crm_listings_update on public.listings;
create policy crm_listings_update on public.listings
  for update to authenticated
  using (agency_id in (select public.crm_member_agencies()))
  with check (agency_id in (select public.crm_member_agencies()));

drop policy if exists crm_listings_delete on public.listings;
create policy crm_listings_delete on public.listings
  for delete to authenticated
  using (public.crm_has_role(agency_id, array['owner', 'admin']));

drop policy if exists crm_listing_images_all on public.listing_images;
create policy crm_listing_images_all on public.listing_images
  for all to authenticated
  using (exists (
    select 1 from public.listings l
    where l.id = listing_images.listing_id
      and l.agency_id in (select public.crm_member_agencies())
  ))
  with check (exists (
    select 1 from public.listings l
    where l.id = listing_images.listing_id
      and l.agency_id in (select public.crm_member_agencies())
  ));
