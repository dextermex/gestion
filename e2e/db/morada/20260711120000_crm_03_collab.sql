-- ============================================================================
-- Morada Pro CRM — Migration 3/4: Collaboration
--                  (calendar, messages, notifications, transactions, analytics)
-- ============================================================================
-- ADDITIVE ONLY. Requires migrations 1 & 2.
-- Creates NEW tables crm_events, crm_threads, crm_messages, crm_notifications,
-- crm_transactions; the crm_analytics() RPC; message bookkeeping triggers.
--
-- ROLLBACK: drop function crm_analytics, crm_after_message;
--           drop table crm_transactions, crm_notifications, crm_messages,
--                      crm_threads, crm_events;
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Calendar events
-- ---------------------------------------------------------------------------
create table if not exists public.crm_events (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references public.agencies (id) on delete cascade,
  title       text not null,
  kind        text not null default 'viewing'
              check (kind in ('viewing', 'meeting', 'call', 'other')),
  lead_id     uuid references public.crm_leads (id) on delete set null,
  listing_id  uuid references public.listings (id) on delete set null,
  starts_at   timestamptz not null,
  ends_at     timestamptz,
  location    text not null default '',
  notes       text not null default '',
  assigned_to uuid references auth.users (id) on delete set null,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at)
);
create index if not exists crm_events_agency_time_idx on public.crm_events (agency_id, starts_at);
alter table public.crm_events enable row level security;

drop policy if exists crm_events_rw on public.crm_events;
create policy crm_events_rw on public.crm_events
  for all to authenticated
  using (agency_id in (select public.crm_member_agencies()))
  with check (agency_id in (select public.crm_member_agencies()));

-- ---------------------------------------------------------------------------
-- 2. Internal team messages
-- ---------------------------------------------------------------------------
create table if not exists public.crm_threads (
  id              uuid primary key default gen_random_uuid(),
  agency_id       uuid not null references public.agencies (id) on delete cascade,
  subject         text not null,
  lead_id         uuid references public.crm_leads (id) on delete set null,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create index if not exists crm_threads_agency_idx on public.crm_threads (agency_id, last_message_at desc);
alter table public.crm_threads enable row level security;

create table if not exists public.crm_messages (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references public.crm_threads (id) on delete cascade,
  agency_id   uuid not null references public.agencies (id) on delete cascade,
  sender      uuid references auth.users (id) on delete set null,
  sender_name text not null default '',
  body        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists crm_messages_thread_idx on public.crm_messages (thread_id, created_at);
alter table public.crm_messages enable row level security;

drop policy if exists crm_threads_rw on public.crm_threads;
create policy crm_threads_rw on public.crm_threads
  for all to authenticated
  using (agency_id in (select public.crm_member_agencies()))
  with check (agency_id in (select public.crm_member_agencies()));

drop policy if exists crm_messages_select on public.crm_messages;
create policy crm_messages_select on public.crm_messages
  for select to authenticated
  using (agency_id in (select public.crm_member_agencies()));

drop policy if exists crm_messages_insert on public.crm_messages;
create policy crm_messages_insert on public.crm_messages
  for insert to authenticated
  with check (
    agency_id in (select public.crm_member_agencies())
    and sender = auth.uid()
    and exists (
      select 1 from public.crm_threads t
      where t.id = thread_id and t.agency_id = crm_messages.agency_id
    )
  );
-- messages are immutable for members (no update/delete policies)

-- Bump the thread timestamp whenever a message lands
create or replace function public.crm_after_message()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  update public.crm_threads set last_message_at = new.created_at where id = new.thread_id;
  return new;
end;
$$;

drop trigger if exists crm_messages_after on public.crm_messages;
create trigger crm_messages_after after insert on public.crm_messages
  for each row execute function public.crm_after_message();

-- ---------------------------------------------------------------------------
-- 3. Notifications (broadcast to the agency when user_id is null)
-- ---------------------------------------------------------------------------
create table if not exists public.crm_notifications (
  id         uuid primary key default gen_random_uuid(),
  agency_id  uuid not null references public.agencies (id) on delete cascade,
  user_id    uuid references auth.users (id) on delete cascade,
  kind       text not null default 'info',
  title      text not null,
  body       text not null default '',
  link       text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists crm_notifications_agency_idx
  on public.crm_notifications (agency_id, created_at desc);
alter table public.crm_notifications enable row level security;

drop policy if exists crm_notifications_select on public.crm_notifications;
create policy crm_notifications_select on public.crm_notifications
  for select to authenticated
  using (
    agency_id in (select public.crm_member_agencies())
    and (user_id is null or user_id = auth.uid())
  );

drop policy if exists crm_notifications_update on public.crm_notifications;
create policy crm_notifications_update on public.crm_notifications
  for update to authenticated
  using (
    agency_id in (select public.crm_member_agencies())
    and (user_id is null or user_id = auth.uid())
  )
  with check (
    agency_id in (select public.crm_member_agencies())
    and (user_id is null or user_id = auth.uid())
  );
-- inserts come from security-definer triggers/functions only

-- ---------------------------------------------------------------------------
-- 4. Transactions (closed deals & commissions)
-- ---------------------------------------------------------------------------
create table if not exists public.crm_transactions (
  id                uuid primary key default gen_random_uuid(),
  agency_id         uuid not null references public.agencies (id) on delete cascade,
  lead_id           uuid references public.crm_leads (id) on delete set null,
  listing_id        uuid references public.listings (id) on delete set null,
  kind              text not null default 'sale' check (kind in ('sale', 'rental')),
  amount            integer not null check (amount >= 0),
  commission_pct    numeric not null default 3 check (commission_pct >= 0 and commission_pct <= 100),
  commission_amount integer not null default 0 check (commission_amount >= 0),
  status            text not null default 'pending'
                    check (status in ('pending', 'signed', 'completed', 'cancelled')),
  closed_at         timestamptz,
  created_at        timestamptz not null default now()
);
create index if not exists crm_transactions_agency_idx
  on public.crm_transactions (agency_id, created_at desc);
alter table public.crm_transactions enable row level security;

drop policy if exists crm_transactions_rw on public.crm_transactions;
create policy crm_transactions_rw on public.crm_transactions
  for all to authenticated
  using (agency_id in (select public.crm_member_agencies()))
  with check (agency_id in (select public.crm_member_agencies()));

-- ---------------------------------------------------------------------------
-- 5. Analytics RPC (aggregates server-side, member-gated)
-- ---------------------------------------------------------------------------
create or replace function public.crm_analytics(p_agency uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  result jsonb;
begin
  if p_agency not in (select public.crm_member_agencies()) then
    raise exception 'forbidden';
  end if;

  select jsonb_build_object(
    'stages', (
      select coalesce(jsonb_object_agg(stage, n), '{}'::jsonb)
      from (select stage, count(*) n from public.crm_leads
            where agency_id = p_agency group by stage) s
    ),
    'pipeline_value', (
      select coalesce(sum(value_estimate), 0) from public.crm_leads
      where agency_id = p_agency and stage not in ('won', 'lost')
    ),
    'won_90d', (
      select count(*) from public.crm_leads
      where agency_id = p_agency and stage = 'won'
        and updated_at > now() - interval '90 days'
    ),
    'lost_90d', (
      select count(*) from public.crm_leads
      where agency_id = p_agency and stage = 'lost'
        and updated_at > now() - interval '90 days'
    ),
    'leads_by_month', (
      select coalesce(jsonb_agg(jsonb_build_object('month', m, 'n', n) order by m), '[]'::jsonb)
      from (
        select to_char(date_trunc('month', created_at), 'YYYY-MM') m, count(*) n
        from public.crm_leads
        where agency_id = p_agency and created_at > now() - interval '6 months'
        group by 1
      ) x
    ),
    'tasks_open', (
      select count(*) from public.crm_tasks
      where agency_id = p_agency and status = 'open'
    ),
    'tasks_overdue', (
      select count(*) from public.crm_tasks
      where agency_id = p_agency and status = 'open'
        and due_at is not null and due_at < now()
    ),
    'commission_pending', (
      select coalesce(sum(commission_amount), 0) from public.crm_transactions
      where agency_id = p_agency and status in ('pending', 'signed')
    ),
    'commission_completed', (
      select coalesce(sum(commission_amount), 0) from public.crm_transactions
      where agency_id = p_agency and status = 'completed'
    ),
    'enquiries_30d', (
      select count(*) from public.leads
      where agency_id = p_agency and created_at > now() - interval '30 days'
    ),
    'offers_open', (
      select count(*) from public.offers
      where agency_id = p_agency and status = 'new'
    )
  ) into result;

  return result;
end;
$$;

revoke all on function public.crm_analytics(uuid) from public, anon;
grant execute on function public.crm_analytics(uuid) to authenticated;
