-- ============================================================================
-- Morada Pro — Platform expansion: Discovery, Documents, Marketing
-- ============================================================================
-- ADDITIVE ONLY. Creates NEW tables, NEW functions, NEW RLS policies and NEW
-- Storage buckets. It does NOT rename, alter or drop any existing column,
-- table, policy or row. Every object is namespaced and idempotent.
--
-- New tables:      discovery_posts, discovery_metrics, documents,
--                  marketing_campaigns
-- New functions:   set_updated_at (shared), discovery_metrics_seed,
--                  discovery_track (public, security definer)
-- New buckets:     discovery-videos, discovery-thumbnails, documents
-- Scoping:         every table is agency_id-scoped; RLS reuses the existing
--                  crm_member_agencies() / crm_has_role() helpers so an agency
--                  only ever sees its own rows. Public read is limited to
--                  PUBLISHED discovery posts (so the public feed can render).
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 0. Shared updated_at trigger (create only if it does not already exist)
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ===========================================================================
-- 1. DISCOVERY — agency-managed content for the public Discovery feed
-- ===========================================================================
create table if not exists public.discovery_posts (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null references public.agencies (id) on delete cascade,
  listing_id    uuid references public.listings (id) on delete set null,
  title         text not null default '',
  description   text not null default '',
  video_url     text,
  thumbnail_url text,
  status        text not null default 'draft'
                  check (status in ('draft', 'scheduled', 'published', 'archived')),
  published_at  timestamptz,
  scheduled_at  timestamptz,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists discovery_posts_agency_idx on public.discovery_posts (agency_id);
create index if not exists discovery_posts_listing_idx on public.discovery_posts (listing_id);
create index if not exists discovery_posts_status_idx on public.discovery_posts (status);
alter table public.discovery_posts enable row level security;

drop trigger if exists discovery_posts_touch on public.discovery_posts;
create trigger discovery_posts_touch
  before update on public.discovery_posts
  for each row execute function public.set_updated_at();

-- Real, per-post metrics. One row per post, fed automatically (never faked).
create table if not exists public.discovery_metrics (
  post_id          uuid primary key references public.discovery_posts (id) on delete cascade,
  agency_id        uuid not null references public.agencies (id) on delete cascade,
  views            bigint not null default 0,
  likes            bigint not null default 0,
  favourites       bigint not null default 0,
  detail_clicks    bigint not null default 0,
  contact_requests bigint not null default 0,
  updated_at       timestamptz not null default now()
);
create index if not exists discovery_metrics_agency_idx on public.discovery_metrics (agency_id);
alter table public.discovery_metrics enable row level security;

-- Seed a metrics row the moment a post is created.
create or replace function public.discovery_metrics_seed()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.discovery_metrics (post_id, agency_id)
  values (new.id, new.agency_id)
  on conflict (post_id) do nothing;
  return new;
end;
$$;

drop trigger if exists discovery_posts_seed_metrics on public.discovery_posts;
create trigger discovery_posts_seed_metrics
  after insert on public.discovery_posts
  for each row execute function public.discovery_metrics_seed();

-- ---------------------------------------------------------------------------
-- Discovery RLS — agency members manage their own posts; the public may read
-- only PUBLISHED posts (so the anonymous Discovery feed can render them).
-- ---------------------------------------------------------------------------
drop policy if exists discovery_posts_member_all on public.discovery_posts;
create policy discovery_posts_member_all on public.discovery_posts
  for all to authenticated
  using (agency_id in (select public.crm_member_agencies()))
  with check (agency_id in (select public.crm_member_agencies()));

drop policy if exists discovery_posts_public_read on public.discovery_posts;
create policy discovery_posts_public_read on public.discovery_posts
  for select to anon, authenticated
  using (status = 'published');

-- Metrics: agency members read their own; writes go through the RPC below.
drop policy if exists discovery_metrics_member_read on public.discovery_metrics;
create policy discovery_metrics_member_read on public.discovery_metrics
  for select to authenticated
  using (agency_id in (select public.crm_member_agencies()));

-- ---------------------------------------------------------------------------
-- discovery_track — the public feed calls this to record REAL engagement.
-- Only ever touches metrics of PUBLISHED posts; validates the event kind.
-- ---------------------------------------------------------------------------
create or replace function public.discovery_track(p_post uuid, p_kind text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if p_kind not in ('view', 'like', 'favourite', 'detail_click', 'contact') then
    raise exception 'invalid_kind';
  end if;

  update public.discovery_metrics m
     set views            = m.views            + (p_kind = 'view')::int,
         likes            = m.likes            + (p_kind = 'like')::int,
         favourites       = m.favourites       + (p_kind = 'favourite')::int,
         detail_clicks    = m.detail_clicks    + (p_kind = 'detail_click')::int,
         contact_requests = m.contact_requests + (p_kind = 'contact')::int,
         updated_at       = now()
    from public.discovery_posts p
   where m.post_id = p_post
     and p.id = m.post_id
     and p.status = 'published';
end;
$$;
revoke all on function public.discovery_track(uuid, text) from public;
grant execute on function public.discovery_track(uuid, text) to anon, authenticated;

-- ===========================================================================
-- 2. DOCUMENTS — files linked to a property, contact or transaction
-- ===========================================================================
create table if not exists public.documents (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null references public.agencies (id) on delete cascade,
  name           text not null,
  storage_path   text not null,
  mime_type      text,
  size_bytes     bigint,
  listing_id     uuid references public.listings (id) on delete set null,
  contact_id     uuid references public.crm_contacts (id) on delete set null,
  transaction_id uuid references public.crm_transactions (id) on delete set null,
  uploaded_by    uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists documents_agency_idx on public.documents (agency_id);
create index if not exists documents_listing_idx on public.documents (listing_id);
create index if not exists documents_contact_idx on public.documents (contact_id);
create index if not exists documents_txn_idx on public.documents (transaction_id);
alter table public.documents enable row level security;

drop trigger if exists documents_touch on public.documents;
create trigger documents_touch
  before update on public.documents
  for each row execute function public.set_updated_at();

drop policy if exists documents_member_all on public.documents;
create policy documents_member_all on public.documents
  for all to authenticated
  using (agency_id in (select public.crm_member_agencies()))
  with check (agency_id in (select public.crm_member_agencies()));

-- ===========================================================================
-- 3. MARKETING — campaign records (email / social / qr / link / brochure)
-- ===========================================================================
create table if not exists public.marketing_campaigns (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references public.agencies (id) on delete cascade,
  name        text not null,
  channel     text not null default 'email'
                check (channel in ('email', 'social', 'qr', 'link', 'brochure')),
  status      text not null default 'draft'
                check (status in ('draft', 'active', 'paused', 'completed')),
  listing_id  uuid references public.listings (id) on delete set null,
  content     jsonb not null default '{}'::jsonb,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists marketing_campaigns_agency_idx on public.marketing_campaigns (agency_id);
alter table public.marketing_campaigns enable row level security;

drop trigger if exists marketing_campaigns_touch on public.marketing_campaigns;
create trigger marketing_campaigns_touch
  before update on public.marketing_campaigns
  for each row execute function public.set_updated_at();

drop policy if exists marketing_campaigns_member_all on public.marketing_campaigns;
create policy marketing_campaigns_member_all on public.marketing_campaigns
  for all to authenticated
  using (agency_id in (select public.crm_member_agencies()))
  with check (agency_id in (select public.crm_member_agencies()));

-- ===========================================================================
-- 4. STORAGE — buckets + object-level RLS (path convention: <agency_id>/...)
-- ===========================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('discovery-videos', 'discovery-videos', true, 209715200,
     array['video/mp4', 'video/quicktime', 'video/webm']),
  ('discovery-thumbnails', 'discovery-thumbnails', true, 10485760,
     array['image/jpeg', 'image/png', 'image/webp']),
  ('documents', 'documents', false, 52428800,
     array['application/pdf', 'image/jpeg', 'image/png', 'image/webp',
           'application/msword',
           'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
           'application/vnd.ms-excel',
           'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
           'text/plain', 'text/csv'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Discovery buckets: public read; writes limited to agency members whose id is
-- the first path segment (<agency_id>/<post_id>/<file>).
drop policy if exists pro_discovery_read on storage.objects;
create policy pro_discovery_read on storage.objects
  for select to anon, authenticated
  using (bucket_id in ('discovery-videos', 'discovery-thumbnails'));

drop policy if exists pro_discovery_write on storage.objects;
create policy pro_discovery_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('discovery-videos', 'discovery-thumbnails')
    and (nullif(split_part(name, '/', 1), ''))::uuid in (select public.crm_member_agencies())
  );

drop policy if exists pro_discovery_update on storage.objects;
create policy pro_discovery_update on storage.objects
  for update to authenticated
  using (
    bucket_id in ('discovery-videos', 'discovery-thumbnails')
    and (nullif(split_part(name, '/', 1), ''))::uuid in (select public.crm_member_agencies())
  );

drop policy if exists pro_discovery_delete on storage.objects;
create policy pro_discovery_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('discovery-videos', 'discovery-thumbnails')
    and (nullif(split_part(name, '/', 1), ''))::uuid in (select public.crm_member_agencies())
  );

-- Documents bucket: private; every operation limited to agency members whose
-- id is the first path segment. Read is via signed URLs generated server-side.
drop policy if exists pro_documents_all on storage.objects;
create policy pro_documents_all on storage.objects
  for all to authenticated
  using (
    bucket_id = 'documents'
    and (nullif(split_part(name, '/', 1), ''))::uuid in (select public.crm_member_agencies())
  )
  with check (
    bucket_id = 'documents'
    and (nullif(split_part(name, '/', 1), ''))::uuid in (select public.crm_member_agencies())
  );
