-- Notifications for the mobile app (applied on 2026-10-02 to the Morada
-- project, statement by statement). Push devices, the per-person inbox,
-- the preferences, and the plumbing that wakes the `notify` Edge Function:
-- a vault secret, pg_net posts from row triggers, and a pg_cron tick.
-- Everything is additive. gestion.notifications is written by the function
-- only (service role); a person reads and marks their own rows.
--
-- user_id columns carry no foreign key to auth.users: adding one needs a
-- lock on auth.users that the hosted project did not grant in time. The
-- function treats a missing user as a dead row.

create table if not exists gestion.push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  token text not null unique,
  platform text not null check (platform in ('ios','android','web')),
  device_name text,
  app_version text,
  locale text,
  last_seen_at timestamptz not null default now(),
  disabled_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists push_devices_user_idx on gestion.push_devices(user_id) where disabled_at is null;
alter table gestion.push_devices enable row level security;
revoke all on gestion.push_devices from anon, authenticated;
grant select, insert, update, delete on gestion.push_devices to authenticated;
create policy push_devices_own on gestion.push_devices
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists gestion.notification_prefs (
  user_id uuid primary key,
  rent boolean not null default true,
  messages boolean not null default true,
  tickets boolean not null default true,
  deadlines boolean not null default true,
  bank boolean not null default true,
  digest boolean not null default true,
  account boolean not null default true,
  quiet_hours boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table gestion.notification_prefs enable row level security;
revoke all on gestion.notification_prefs from anon, authenticated;
grant select, insert, update on gestion.notification_prefs to authenticated;
create policy notification_prefs_own on gestion.notification_prefs
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists gestion.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  org_id uuid not null references public.agencies(id) on delete cascade,
  kind text not null,
  category text not null check (category in ('rent','messages','tickets','deadlines','bank','digest','account')),
  severity text not null default 'normal' check (severity in ('low','normal','high','critical')),
  title text not null,
  body text not null default '',
  href text,
  dedupe_key text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  push_after timestamptz not null default now(),
  pushed_at timestamptz,
  read_at timestamptz,
  unique (user_id, dedupe_key)
);
create index if not exists notifications_user_idx on gestion.notifications(user_id, created_at desc);
create index if not exists notifications_unread_idx on gestion.notifications(user_id) where read_at is null;
create index if not exists notifications_pending_push_idx on gestion.notifications(push_after) where pushed_at is null;
alter table gestion.notifications enable row level security;
revoke all on gestion.notifications from anon, authenticated;
grant select, update on gestion.notifications to authenticated;
create policy notifications_own_select on gestion.notifications
  for select to authenticated using (user_id = auth.uid());
create policy notifications_own_update on gestion.notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function gestion.notifications_unread()
returns integer language sql stable security invoker set search_path = '' as $$
  select count(*)::int from gestion.notifications where user_id = auth.uid() and read_at is null;
$$;
grant execute on function gestion.notifications_unread() to authenticated;

-- The shared secret between the database (cron, triggers) and the function.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'notify_secret') then
    perform vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'notify_secret', 'Shared secret for the notify Edge Function (cron and triggers).');
  end if;
end $$;

create or replace function gestion.notify_secret()
returns text language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'notify_secret' limit 1;
$$;
revoke all on function gestion.notify_secret() from public, anon, authenticated;

create or replace function gestion.notify_url()
returns text language sql immutable as $$
  select 'https://lgmoocvumiuqjcqnrlej.supabase.co/functions/v1/notify';
$$;

create or replace function gestion.notify_post(p_body jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'notify_secret' limit 1;
  if v_secret is null then return; end if;
  perform net.http_post(
    url := gestion.notify_url(),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', v_secret),
    body := p_body,
    timeout_milliseconds := 8000
  );
exception when others then
  null;
end $$;
revoke all on function gestion.notify_post(jsonb) from public, anon, authenticated;

create or replace function gestion.notify_row_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform gestion.notify_post(jsonb_build_object(
    'mode', 'event',
    'table', TG_TABLE_NAME,
    'op', TG_OP,
    'new', case when TG_OP = 'DELETE' then null else to_jsonb(NEW) end,
    'old', case when TG_OP = 'INSERT' then null else to_jsonb(OLD) end
  ));
  return coalesce(NEW, OLD);
end $$;
revoke all on function gestion.notify_row_event() from public, anon, authenticated;

create trigger notify_messages after insert on gestion.messages
  for each row when (new.sender_kind <> 'manager') execute function gestion.notify_row_event();
create trigger notify_payments after insert on gestion.payments
  for each row execute function gestion.notify_row_event();
create trigger notify_tickets after insert on gestion.tickets
  for each row when (new.source in ('tenant','owner','edl_defect')) execute function gestion.notify_row_event();
create trigger notify_portal_invites after update of accepted_at on gestion.portal_invites
  for each row when (old.accepted_at is null and new.accepted_at is not null) execute function gestion.notify_row_event();
create trigger notify_work_orders after update of status on gestion.work_orders
  for each row when (old.status is distinct from new.status and new.status in ('scheduled','done')) execute function gestion.notify_row_event();

create or replace function gestion.notify_recipients(p_org uuid)
returns table (user_id uuid, lang text)
language sql stable security definer set search_path = '' as $$
  select m.user_id, coalesce(p.preferred_language, 'fr')
    from public.crm_members m
    left join public.profiles p on p.id = m.user_id
   where m.agency_id = p_org and m.status = 'active' and m.user_id is not null;
$$;
revoke all on function gestion.notify_recipients(uuid) from public, anon, authenticated;

create or replace function gestion.notify_trials()
returns table (user_id uuid, lang text, trial_started_at timestamptz, org_id uuid)
language sql stable security definer set search_path = '' as $$
  select u.id,
         coalesce(p.preferred_language, 'fr'),
         (u.raw_user_meta_data -> 'morada_mobile' ->> 'trial_started_at')::timestamptz,
         (select m.agency_id from public.crm_members m where m.user_id = u.id and m.status = 'active' order by m.created_at limit 1)
    from auth.users u
    left join public.profiles p on p.id = u.id
   where (u.raw_user_meta_data -> 'morada_mobile' ->> 'trial_started_at') is not null;
$$;
revoke all on function gestion.notify_trials() from public, anon, authenticated;

-- Every fifteen minutes: pending pushes leave (quiet hours permitting); the
-- daily reminders run in the 08:00 slot in Luxembourg, deduplicated by day.
select cron.schedule('gestion-notify-tick', '*/15 * * * *', $$ select gestion.notify_post('{"mode":"tick"}'::jsonb) $$);
