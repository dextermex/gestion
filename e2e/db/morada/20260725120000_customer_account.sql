-- ============================================================================
-- Morada — Customer account platform (profiles, favourites, saved searches,
-- visits, messaging, documents, notifications)
-- ============================================================================
-- ADDITIVE ONLY. Creates NEW tables, NEW functions, NEW RLS policies and one
-- NEW Storage bucket. Nothing existing is renamed, altered or dropped.
--
-- Auth: uses Supabase Auth (auth.users). A profile row is auto-created on
-- sign-up from the user's metadata. Every customer table is scoped to
-- auth.uid(); agency-shared tables (visits, conversations, messages) are also
-- readable by the listing's agency via the existing crm_member_agencies()
-- helper, so the customer and Morada Pro see the same data.
-- ============================================================================

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;

-- ---------------------------------------------------------------------------
-- 1. profiles — one row per auth user
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  first_name         text not null default '',
  last_name          text not null default '',
  phone              text,
  avatar_url         text,
  preferred_language text not null default 'fr',
  account_type       text not null default 'customer'
                       check (account_type in ('customer', 'agent', 'admin')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
alter table public.profiles enable row level security;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.set_updated_at();

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = auth.uid());
drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert to authenticated with check (id = auth.uid());
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Auto-create a profile when a user signs up (reads sign-up metadata).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles (id, first_name, last_name, phone, preferred_language, account_type)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'first_name', ''),
    coalesce(new.raw_user_meta_data->>'last_name', ''),
    nullif(new.raw_user_meta_data->>'phone', ''),
    coalesce(nullif(new.raw_user_meta_data->>'preferred_language', ''), 'fr'),
    'customer'
  )
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 2. customer_favourites — the heart button, persisted per user
-- ---------------------------------------------------------------------------
create table if not exists public.customer_favourites (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  listing_id    uuid not null references public.listings (id) on delete cascade,
  folder        text,
  note          text,
  price_at_save integer,
  created_at    timestamptz not null default now(),
  unique (user_id, listing_id)
);
create index if not exists customer_favourites_user_idx on public.customer_favourites (user_id);
alter table public.customer_favourites enable row level security;

drop policy if exists customer_favourites_own on public.customer_favourites;
create policy customer_favourites_own on public.customer_favourites
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 3. saved_searches — persisted search + alert flag
-- ---------------------------------------------------------------------------
create table if not exists public.saved_searches (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  name           text not null,
  url            text not null default '',
  params         jsonb not null default '{}'::jsonb,
  alerts_enabled boolean not null default true,
  last_alert_at  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists saved_searches_user_idx on public.saved_searches (user_id);
alter table public.saved_searches enable row level security;

drop trigger if exists saved_searches_touch on public.saved_searches;
create trigger saved_searches_touch before update on public.saved_searches
  for each row execute function public.set_updated_at();

drop policy if exists saved_searches_own on public.saved_searches;
create policy saved_searches_own on public.saved_searches
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 4. visit_requests — shared with the listing's agency
-- ---------------------------------------------------------------------------
create table if not exists public.visit_requests (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  listing_id   uuid not null references public.listings (id) on delete cascade,
  agency_id    uuid references public.agencies (id) on delete set null,
  preferred_at timestamptz,
  message      text,
  status       text not null default 'requested'
                 check (status in ('requested', 'confirmed', 'cancelled', 'completed')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists visit_requests_user_idx on public.visit_requests (user_id);
create index if not exists visit_requests_agency_idx on public.visit_requests (agency_id);
alter table public.visit_requests enable row level security;

drop trigger if exists visit_requests_touch on public.visit_requests;
create trigger visit_requests_touch before update on public.visit_requests
  for each row execute function public.set_updated_at();

drop policy if exists visit_requests_customer_all on public.visit_requests;
create policy visit_requests_customer_all on public.visit_requests
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists visit_requests_agency_read on public.visit_requests;
create policy visit_requests_agency_read on public.visit_requests
  for select to authenticated using (agency_id in (select public.crm_member_agencies()));
drop policy if exists visit_requests_agency_update on public.visit_requests;
create policy visit_requests_agency_update on public.visit_requests
  for update to authenticated
  using (agency_id in (select public.crm_member_agencies()))
  with check (agency_id in (select public.crm_member_agencies()));

-- ---------------------------------------------------------------------------
-- 5. Messaging — customer_conversations + customer_messages (shared w/ agency)
-- ---------------------------------------------------------------------------
create table if not exists public.customer_conversations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  agency_id       uuid references public.agencies (id) on delete set null,
  listing_id      uuid references public.listings (id) on delete set null,
  subject         text not null default '',
  last_message_at timestamptz not null default now(),
  created_at      timestamptz not null default now()
);
create index if not exists customer_conversations_user_idx on public.customer_conversations (user_id);
create index if not exists customer_conversations_agency_idx on public.customer_conversations (agency_id);
alter table public.customer_conversations enable row level security;

create table if not exists public.customer_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.customer_conversations (id) on delete cascade,
  sender_role     text not null check (sender_role in ('customer', 'agency')),
  sender_user     uuid references auth.users (id) on delete set null,
  body            text not null,
  created_at      timestamptz not null default now()
);
create index if not exists customer_messages_conv_idx on public.customer_messages (conversation_id);
alter table public.customer_messages enable row level security;

-- Conversation visibility: the owning customer, or a member of its agency.
drop policy if exists conversations_customer_all on public.customer_conversations;
create policy conversations_customer_all on public.customer_conversations
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists conversations_agency_read on public.customer_conversations;
create policy conversations_agency_read on public.customer_conversations
  for select to authenticated using (agency_id in (select public.crm_member_agencies()));

-- Message visibility mirrors the parent conversation.
drop policy if exists messages_participant_read on public.customer_messages;
create policy messages_participant_read on public.customer_messages
  for select to authenticated using (
    exists (
      select 1 from public.customer_conversations c
      where c.id = conversation_id
        and (c.user_id = auth.uid() or c.agency_id in (select public.crm_member_agencies()))
    )
  );
drop policy if exists messages_customer_insert on public.customer_messages;
create policy messages_customer_insert on public.customer_messages
  for insert to authenticated with check (
    sender_role = 'customer'
    and sender_user = auth.uid()
    and exists (select 1 from public.customer_conversations c where c.id = conversation_id and c.user_id = auth.uid())
  );
drop policy if exists messages_agency_insert on public.customer_messages;
create policy messages_agency_insert on public.customer_messages
  for insert to authenticated with check (
    sender_role = 'agency'
    and exists (
      select 1 from public.customer_conversations c
      where c.id = conversation_id and c.agency_id in (select public.crm_member_agencies())
    )
  );

-- Keep last_message_at fresh + notify the other side.
create or replace function public.customer_message_after_insert()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid;
begin
  update public.customer_conversations set last_message_at = now() where id = new.conversation_id
    returning user_id into v_user;
  -- When an agency replies, drop a notification for the customer.
  if new.sender_role = 'agency' and v_user is not null then
    insert into public.customer_notifications (user_id, kind, title, body, link)
    values (v_user, 'message', 'New reply from an agency', left(new.body, 140), '/account/messages');
  end if;
  return new;
end; $$;

-- ---------------------------------------------------------------------------
-- 6. customer_documents — private files in Storage
-- ---------------------------------------------------------------------------
create table if not exists public.customer_documents (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  name         text not null,
  storage_path text not null,
  category     text not null default 'other'
                 check (category in ('identity', 'financing', 'rental', 'other')),
  size_bytes   bigint,
  mime_type    text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists customer_documents_user_idx on public.customer_documents (user_id);
alter table public.customer_documents enable row level security;

drop trigger if exists customer_documents_touch on public.customer_documents;
create trigger customer_documents_touch before update on public.customer_documents
  for each row execute function public.set_updated_at();

drop policy if exists customer_documents_own on public.customer_documents;
create policy customer_documents_own on public.customer_documents
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 7. customer_notifications
-- ---------------------------------------------------------------------------
create table if not exists public.customer_notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       text not null default 'system',
  title      text not null,
  body       text,
  link       text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists customer_notifications_user_idx on public.customer_notifications (user_id, read_at);
alter table public.customer_notifications enable row level security;

drop policy if exists customer_notifications_own on public.customer_notifications;
create policy customer_notifications_own on public.customer_notifications
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Message trigger (after the notifications table exists).
drop trigger if exists customer_messages_after_insert on public.customer_messages;
create trigger customer_messages_after_insert
  after insert on public.customer_messages
  for each row execute function public.customer_message_after_insert();

-- ---------------------------------------------------------------------------
-- 8. Storage bucket for customer documents (private, per-user path)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('customer-documents', 'customer-documents', false, 26214400,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists customer_docs_storage_all on storage.objects;
create policy customer_docs_storage_all on storage.objects
  for all to authenticated
  using (bucket_id = 'customer-documents' and (nullif(split_part(name, '/', 1), ''))::uuid = auth.uid())
  with check (bucket_id = 'customer-documents' and (nullif(split_part(name, '/', 1), ''))::uuid = auth.uid());
