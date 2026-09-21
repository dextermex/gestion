-- ============================================================================
-- Morada Pro CRM — Migration 2/4: Core (contacts, leads, tasks, activities)
-- ============================================================================
-- ADDITIVE ONLY. Requires migration 1 (crm_01_foundation).
-- Creates NEW tables crm_contacts, crm_leads, crm_tasks, crm_activities with
-- agency-scoped RLS, plus audit triggers. Touches nothing pre-existing.
--
-- ROLLBACK: drop table crm_activities, crm_tasks, crm_leads, crm_contacts;
--           drop function crm_touch_updated_at, crm_log_lead_insert,
--                         crm_log_lead_stage, crm_log_task_done;
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.crm_contacts (
  id         uuid primary key default gen_random_uuid(),
  agency_id  uuid not null references public.agencies (id) on delete cascade,
  name       text not null,
  email      text,
  phone      text,
  kind       text not null default 'buyer'
             check (kind in ('buyer', 'seller', 'tenant', 'landlord', 'other')),
  notes      text not null default '',
  tags       text[] not null default '{}',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_contacts_agency_idx on public.crm_contacts (agency_id, name);
alter table public.crm_contacts enable row level security;

create table if not exists public.crm_leads (
  id              uuid primary key default gen_random_uuid(),
  agency_id       uuid not null references public.agencies (id) on delete cascade,
  contact_id      uuid references public.crm_contacts (id) on delete set null,
  listing_id      uuid references public.listings (id) on delete set null,
  source_lead_id  uuid references public.leads (id) on delete set null,
  source_offer_id uuid references public.offers (id) on delete set null,
  name            text not null,
  email           text,
  phone           text,
  message         text not null default '',
  source          text not null default 'manual',
  stage           text not null default 'new'
                  check (stage in ('new','contacted','qualified','viewing','offer','won','lost')),
  priority        text not null default 'normal' check (priority in ('low','normal','high')),
  assigned_to     uuid references auth.users (id) on delete set null,
  value_estimate  integer check (value_estimate is null or value_estimate >= 0),
  lost_reason     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists crm_leads_agency_stage_idx on public.crm_leads (agency_id, stage);
create index if not exists crm_leads_agency_updated_idx on public.crm_leads (agency_id, updated_at desc);
create index if not exists crm_leads_assigned_idx on public.crm_leads (assigned_to);
create index if not exists crm_leads_source_lead_idx on public.crm_leads (source_lead_id);
alter table public.crm_leads enable row level security;

create table if not exists public.crm_tasks (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references public.agencies (id) on delete cascade,
  lead_id      uuid references public.crm_leads (id) on delete cascade,
  contact_id   uuid references public.crm_contacts (id) on delete set null,
  title        text not null,
  notes        text not null default '',
  due_at       timestamptz,
  status       text not null default 'open' check (status in ('open', 'done')),
  assigned_to  uuid references auth.users (id) on delete set null,
  created_by   uuid references auth.users (id) on delete set null,
  completed_at timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists crm_tasks_agency_idx on public.crm_tasks (agency_id, status, due_at);
create index if not exists crm_tasks_lead_idx on public.crm_tasks (lead_id);
alter table public.crm_tasks enable row level security;

create table if not exists public.crm_activities (
  id         uuid primary key default gen_random_uuid(),
  agency_id  uuid not null references public.agencies (id) on delete cascade,
  lead_id    uuid references public.crm_leads (id) on delete cascade,
  contact_id uuid references public.crm_contacts (id) on delete cascade,
  kind       text not null default 'note'
             check (kind in ('note','call','email','viewing','stage_change','task_done','system')),
  body       text not null default '',
  meta       jsonb not null default '{}',
  actor      uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists crm_activities_lead_idx on public.crm_activities (lead_id, created_at desc);
create index if not exists crm_activities_agency_idx on public.crm_activities (agency_id, created_at desc);
alter table public.crm_activities enable row level security;

-- ---------------------------------------------------------------------------
-- 2. RLS (agency members; audit trail is append-only)
-- ---------------------------------------------------------------------------
drop policy if exists crm_contacts_rw on public.crm_contacts;
create policy crm_contacts_rw on public.crm_contacts
  for all to authenticated
  using (agency_id in (select public.crm_member_agencies()))
  with check (agency_id in (select public.crm_member_agencies()));

drop policy if exists crm_leads_rw on public.crm_leads;
create policy crm_leads_rw on public.crm_leads
  for all to authenticated
  using (agency_id in (select public.crm_member_agencies()))
  with check (agency_id in (select public.crm_member_agencies()));

drop policy if exists crm_tasks_rw on public.crm_tasks;
create policy crm_tasks_rw on public.crm_tasks
  for all to authenticated
  using (agency_id in (select public.crm_member_agencies()))
  with check (agency_id in (select public.crm_member_agencies()));

drop policy if exists crm_activities_select on public.crm_activities;
create policy crm_activities_select on public.crm_activities
  for select to authenticated
  using (agency_id in (select public.crm_member_agencies()));

drop policy if exists crm_activities_insert on public.crm_activities;
create policy crm_activities_insert on public.crm_activities
  for insert to authenticated
  with check (agency_id in (select public.crm_member_agencies()));
-- no update/delete policies: the timeline is append-only for members

-- ---------------------------------------------------------------------------
-- 3. Triggers: updated_at + automatic audit timeline
-- ---------------------------------------------------------------------------
create or replace function public.crm_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists crm_contacts_touch on public.crm_contacts;
create trigger crm_contacts_touch before update on public.crm_contacts
  for each row execute function public.crm_touch_updated_at();

drop trigger if exists crm_leads_touch on public.crm_leads;
create trigger crm_leads_touch before update on public.crm_leads
  for each row execute function public.crm_touch_updated_at();

create or replace function public.crm_log_lead_insert()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  insert into public.crm_activities (agency_id, lead_id, kind, body, meta, actor)
  values (
    new.agency_id, new.id, 'system',
    'Lead created',
    jsonb_build_object('source', new.source, 'stage', new.stage),
    auth.uid()
  );
  return new;
end;
$$;

drop trigger if exists crm_leads_log_insert on public.crm_leads;
create trigger crm_leads_log_insert after insert on public.crm_leads
  for each row execute function public.crm_log_lead_insert();

create or replace function public.crm_log_lead_stage()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if new.stage is distinct from old.stage then
    insert into public.crm_activities (agency_id, lead_id, kind, body, meta, actor)
    values (
      new.agency_id, new.id, 'stage_change',
      format('Stage: %s → %s', old.stage, new.stage),
      jsonb_build_object('from', old.stage, 'to', new.stage),
      auth.uid()
    );
  end if;
  if new.assigned_to is distinct from old.assigned_to and new.assigned_to is not null then
    insert into public.crm_activities (agency_id, lead_id, kind, body, meta, actor)
    values (
      new.agency_id, new.id, 'system', 'Lead reassigned',
      jsonb_build_object('assigned_to', new.assigned_to), auth.uid()
    );
  end if;
  return new;
end;
$$;

drop trigger if exists crm_leads_log_stage on public.crm_leads;
create trigger crm_leads_log_stage after update on public.crm_leads
  for each row execute function public.crm_log_lead_stage();

create or replace function public.crm_log_task_done()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if new.status = 'done' and old.status = 'open' and new.lead_id is not null then
    insert into public.crm_activities (agency_id, lead_id, kind, body, actor)
    values (new.agency_id, new.lead_id, 'task_done', new.title, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists crm_tasks_log_done on public.crm_tasks;
create trigger crm_tasks_log_done after update on public.crm_tasks
  for each row execute function public.crm_log_task_done();
