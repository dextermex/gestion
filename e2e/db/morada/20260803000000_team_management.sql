-- ===========================================================================
-- Team management center: 6 roles, per-member custom permissions, join
-- requests, owner-only governance, member activity.
--
-- Principles (spec):
--  - Owner has every right, always; cannot be edited/disabled.
--  - Only the Owner can change roles, change permissions, transfer ownership.
--  - Everyone else has role DEFAULTS overridable per member (permissions jsonb).
--  - Nobody joins an agency silently: invitation or join request + decision.
-- ===========================================================================

/* 1. Roles + per-member permission overrides -------------------------------- */
alter table public.crm_members drop constraint if exists crm_members_role_check;
alter table public.crm_members add constraint crm_members_role_check
  check (role in ('owner','admin','agent','marketing','assistant','viewer'));

alter table public.crm_invites drop constraint if exists crm_invites_role_check;
alter table public.crm_invites add constraint crm_invites_role_check
  check (role in ('admin','agent','marketing','assistant','viewer'));

alter table public.crm_members
  add column if not exists permissions jsonb not null default '{}'::jsonb,
  add column if not exists phone text,
  add column if not exists last_seen_at timestamptz;

/* 2. Role defaults + effective permission check ----------------------------- */
create or replace function public.crm_role_defaults(p_role text)
returns jsonb language sql immutable as $$
  select case p_role
    when 'admin' then '{
      "properties.create":true,"properties.edit_own":true,"properties.edit_all":true,"properties.delete":true,"properties.publish":true,
      "discovery.publish":true,"discovery.edit_own":true,"discovery.edit_all":true,"discovery.delete":true,
      "leads.view_own":true,"leads.view_all":true,"leads.respond":true,
      "messages.view":true,"messages.respond":true,"messages.view_all":true,
      "visits.create":true,"visits.edit":true,"visits.delete":true,
      "offers.view":true,"offers.edit":true,
      "stats.view":true,"stats.export":true,
      "team.invite":true,"team.remove":true,
      "settings.edit":true}'::jsonb
    when 'agent' then '{
      "properties.create":true,"properties.edit_own":true,"properties.publish":true,
      "discovery.publish":true,"discovery.edit_own":true,
      "leads.view_own":true,"leads.respond":true,
      "messages.view":true,"messages.respond":true,
      "visits.create":true,"visits.edit":true,
      "offers.view":true}'::jsonb
    when 'marketing' then '{
      "discovery.publish":true,"discovery.edit_own":true,"discovery.edit_all":true,
      "messages.view":true,"stats.view":true}'::jsonb
    when 'assistant' then '{
      "leads.view_own":true,"messages.view":true,"messages.respond":true,
      "visits.create":true,"visits.edit":true,"offers.view":true}'::jsonb
    else '{}'::jsonb
  end;
$$;

-- Effective permission: owner => always true; else per-member override wins,
-- falling back to the role default. Used by RLS and by the app.
create or replace function public.crm_has_perm(p_agency uuid, p_key text)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
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
$$;
grant execute on function public.crm_has_perm(uuid, text) to authenticated;

/* 3. Owner-only governance guard on crm_members ----------------------------- *
 * The generic owner/admin UPDATE policy stays (display_name/status edits), but
 * role & permissions changes are hard-restricted to the agency owner at the
 * trigger level — so no client path can bypass it. */
create or replace function public.crm_members_guard()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_is_owner boolean;
begin
  if new.role is distinct from old.role
     or new.permissions is distinct from old.permissions then
    select exists (
      select 1 from public.crm_members
      where agency_id = old.agency_id and user_id = auth.uid()
        and role = 'owner' and status = 'active'
    ) into v_is_owner;
    if not v_is_owner then
      raise exception 'Only the owner can change roles or permissions';
    end if;
    if old.role = 'owner' and new.role is distinct from old.role then
      raise exception 'Use ownership transfer to change the owner';
    end if;
    if new.role = 'owner' and old.role <> 'owner' then
      raise exception 'Use ownership transfer to appoint an owner';
    end if;
  end if;
  if old.role = 'owner' and new.status = 'disabled' then
    raise exception 'The owner cannot be disabled';
  end if;
  return new;
end;
$$;
drop trigger if exists crm_members_guard_trg on public.crm_members;
create trigger crm_members_guard_trg
  before update on public.crm_members
  for each row execute function public.crm_members_guard();

/* 4. Join requests ---------------------------------------------------------- */
create table if not exists public.crm_join_requests (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  email text not null,
  phone text,
  message text,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists crm_join_requests_pending_uniq
  on public.crm_join_requests(agency_id, user_id) where status = 'pending';
alter table public.crm_join_requests enable row level security;

drop policy if exists join_requests_own on public.crm_join_requests;
create policy join_requests_own on public.crm_join_requests
  for select to authenticated using (user_id = auth.uid());
drop policy if exists join_requests_team_read on public.crm_join_requests;
create policy join_requests_team_read on public.crm_join_requests
  for select to authenticated
  using (crm_has_role(agency_id, array['owner']) or crm_has_perm(agency_id, 'team.invite'));

-- Request to join (insert + notify the agency) — SECURITY DEFINER so a
-- non-member can notify without any direct table grants.
create or replace function public.crm_request_join(
  p_agency uuid, p_name text, p_email text, p_phone text default null, p_message text default null
) returns uuid language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if exists (select 1 from public.crm_members where agency_id = p_agency and user_id = auth.uid()) then
    raise exception 'Already a member of this agency';
  end if;
  insert into public.crm_join_requests (agency_id, user_id, name, email, phone, message)
  values (p_agency, auth.uid(), coalesce(nullif(trim(p_name),''),'Someone'), p_email, p_phone, p_message)
  on conflict (agency_id, user_id) where status = 'pending' do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.crm_join_requests
    where agency_id = p_agency and user_id = auth.uid() and status = 'pending';
    return v_id; -- idempotent: an identical pending request already exists
  end if;
  insert into public.crm_notifications (agency_id, kind, title, body, link)
  values (p_agency, 'team',
    coalesce(nullif(trim(p_name),''),'Someone') || ' wants to join your agency',
    coalesce(nullif(p_message,''), p_email), '/pro/team');
  return v_id;
end;
$$;
grant execute on function public.crm_request_join(uuid, text, text, text, text) to authenticated;

-- Accept / decline (owner or team.invite). Accepting creates the member row.
create or replace function public.crm_decide_join(
  p_request uuid, p_accept boolean, p_role text default 'agent'
) returns void language plpgsql security definer
set search_path = public, pg_temp as $$
declare r record;
begin
  select * into r from public.crm_join_requests where id = p_request and status = 'pending';
  if r is null then raise exception 'Request not found or already decided'; end if;
  if not (crm_has_role(r.agency_id, array['owner']) or crm_has_perm(r.agency_id, 'team.invite')) then
    raise exception 'Not allowed to decide join requests';
  end if;
  if p_accept then
    if p_role not in ('admin','agent','marketing','assistant','viewer') then
      raise exception 'Invalid role';
    end if;
    insert into public.crm_members (user_id, agency_id, role, display_name, email, status, phone)
    values (r.user_id, r.agency_id, p_role, r.name, r.email, 'active', r.phone)
    on conflict do nothing;
  end if;
  update public.crm_join_requests
     set status = case when p_accept then 'accepted' else 'declined' end,
         decided_by = auth.uid(), decided_at = now()
   where id = p_request;
end;
$$;
grant execute on function public.crm_decide_join(uuid, boolean, text) to authenticated;

/* 5. Owner-only RPCs: permissions, roles, ownership transfer ---------------- */
create or replace function public.crm_set_member_permission(p_member uuid, p_key text, p_value boolean)
returns void language plpgsql security definer
set search_path = public, pg_temp as $$
declare m record;
begin
  select * into m from public.crm_members where id = p_member;
  if m is null then raise exception 'Member not found'; end if;
  if not crm_has_role(m.agency_id, array['owner']) then
    raise exception 'Only the owner can edit permissions';
  end if;
  if m.role = 'owner' then raise exception 'The owner always has every permission'; end if;
  update public.crm_members
     set permissions = jsonb_set(permissions, array[p_key], to_jsonb(p_value), true)
   where id = p_member;
end;
$$;
grant execute on function public.crm_set_member_permission(uuid, text, boolean) to authenticated;

create or replace function public.crm_set_member_role(p_member uuid, p_role text)
returns void language plpgsql security definer
set search_path = public, pg_temp as $$
declare m record;
begin
  select * into m from public.crm_members where id = p_member;
  if m is null then raise exception 'Member not found'; end if;
  if not crm_has_role(m.agency_id, array['owner']) then
    raise exception 'Only the owner can change roles';
  end if;
  if m.role = 'owner' or p_role = 'owner' then
    raise exception 'Use ownership transfer to change the owner';
  end if;
  if p_role not in ('admin','agent','marketing','assistant','viewer') then
    raise exception 'Invalid role';
  end if;
  -- Role change resets overrides so the new role's defaults apply cleanly.
  update public.crm_members set role = p_role, permissions = '{}'::jsonb where id = p_member;
end;
$$;
grant execute on function public.crm_set_member_role(uuid, text) to authenticated;

create or replace function public.crm_transfer_ownership(p_member uuid)
returns void language plpgsql security definer
set search_path = public, pg_temp as $$
declare m record;
begin
  select * into m from public.crm_members where id = p_member;
  if m is null then raise exception 'Member not found'; end if;
  if not crm_has_role(m.agency_id, array['owner']) then
    raise exception 'Only the owner can transfer ownership';
  end if;
  if m.role = 'owner' then raise exception 'This member is already the owner'; end if;
  update public.crm_members set role = 'admin'
   where agency_id = m.agency_id and role = 'owner';
  update public.crm_members set role = 'owner', permissions = '{}'::jsonb, status = 'active'
   where id = p_member;
end;
$$;
grant execute on function public.crm_transfer_ownership(uuid) to authenticated;

/* 6. Presence + member activity --------------------------------------------- */
create or replace function public.crm_touch_member()
returns void language sql security definer
set search_path = public, pg_temp as $$
  update public.crm_members set last_seen_at = now()
  where user_id = auth.uid() and status = 'active';
$$;
grant execute on function public.crm_touch_member() to authenticated;

-- Real, traceable activity for one member (agency-guarded). Sources that carry
-- an actor: CRM activities, Discovery posts, agency replies, calendar events.
create or replace function public.crm_member_activity(p_member uuid, p_limit int default 50)
returns table (at timestamptz, kind text, label text)
language plpgsql security definer
set search_path = public, pg_temp as $$
declare m record;
begin
  select * into m from public.crm_members where id = p_member;
  if m is null then raise exception 'Member not found'; end if;
  if not m.agency_id in (select public.crm_member_agencies()) then
    raise exception 'Not a member of this agency';
  end if;
  return query
  (select a.created_at, a.kind::text, a.body
     from public.crm_activities a
    where a.agency_id = m.agency_id and a.actor = m.user_id
  union all
   select p.created_at, 'discovery', 'Published on Discovery: ' || coalesce(nullif(p.title,''),'untitled')
     from public.discovery_posts p
    where p.agency_id = m.agency_id and p.created_by = m.user_id
  union all
   select cm.created_at, 'message', 'Replied to a client conversation'
     from public.customer_messages cm
     join public.customer_conversations cc on cc.id = cm.conversation_id
    where cc.agency_id = m.agency_id and cm.sender_user = m.user_id and cm.sender_role = 'agency'
  union all
   select e.created_at, 'event', 'Scheduled: ' || coalesce(nullif(e.title,''), e.kind)
     from public.crm_events e
    where e.agency_id = m.agency_id and e.created_by = m.user_id)
  order by 1 desc
  limit p_limit;
end;
$$;
grant execute on function public.crm_member_activity(uuid, int) to authenticated;

/* 7. Wire the most sensitive existing policy to permissions ----------------- */
drop policy if exists crm_listings_delete on public.listings;
create policy crm_listings_delete on public.listings
  for delete to authenticated
  using (crm_has_role(agency_id, array['owner']) or crm_has_perm(agency_id, 'properties.delete'));
