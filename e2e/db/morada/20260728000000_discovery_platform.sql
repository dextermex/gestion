-- ============================================================================
-- Discovery platform: split the channel into two products — Property (Biens)
-- and Community — with a structured media table, categories, optional
-- property links, a granular event log for analytics, scheduled publishing,
-- and the RLS to keep it all workspace-scoped.
-- ============================================================================

/* -------------------- 1. discovery_posts: new columns --------------------- */
alter table public.discovery_posts
  add column if not exists content_type text not null default 'property',
  add column if not exists category_slug text,
  add column if not exists author_member_id uuid references public.crm_members(id) on delete set null,
  add column if not exists language text not null default 'fr',
  add column if not exists tags text[] not null default '{}',
  add column if not exists duration_seconds int,
  add column if not exists cover_url text,
  add column if not exists processing_status text not null default 'ready';

-- Backfill content_type from the existing (optional) property link BEFORE the
-- conditional constraint below can bite.
update public.discovery_posts
  set content_type = case when listing_id is not null then 'property' else 'community' end;

-- Backfill a cover from whatever media the post already referenced.
update public.discovery_posts
  set cover_url = coalesce(cover_url, thumbnail_url, image_urls[1]);

/* -------------------- 2. discovery_posts: constraints --------------------- */
alter table public.discovery_posts drop constraint if exists discovery_posts_content_type_chk;
alter table public.discovery_posts add constraint discovery_posts_content_type_chk
  check (content_type in ('property','community'));

alter table public.discovery_posts drop constraint if exists discovery_posts_processing_chk;
alter table public.discovery_posts add constraint discovery_posts_processing_chk
  check (processing_status in ('ready','processing','failed'));

-- Replace whatever status CHECK exists (name unknown) with the extended set.
do $$
declare c text;
begin
  select conname into c
  from pg_constraint
  where conrelid = 'public.discovery_posts'::regclass and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%status%';
  if c is not null then
    execute format('alter table public.discovery_posts drop constraint %I', c);
  end if;
end $$;
alter table public.discovery_posts add constraint discovery_posts_status_chk
  check (status in ('draft','processing','scheduled','published','paused','archived','failed'));

-- A Property post must reference a real listing; a Community post may not.
alter table public.discovery_posts drop constraint if exists discovery_posts_property_listing_chk;
alter table public.discovery_posts add constraint discovery_posts_property_listing_chk
  check (content_type <> 'property' or listing_id is not null);

/* -------------------- 3. categories (extensible) -------------------------- */
create table if not exists public.discovery_categories (
  slug text primary key,
  label text not null,
  sort_order int not null default 0,
  is_active boolean not null default true
);
insert into public.discovery_categories (slug, label, sort_order) values
  ('marche','Marché immobilier',10), ('acheter','Acheter',20), ('vendre','Vendre',30),
  ('louer','Louer',40), ('investissement','Investissement',50), ('financement','Financement',60),
  ('architecture','Architecture',70), ('renovation','Rénovation',80), ('quartiers','Quartiers',90),
  ('interviews','Interviews',100), ('podcasts','Podcasts',110), ('conseils','Conseils',120),
  ('actualites','Actualités',130)
on conflict (slug) do nothing;

alter table public.discovery_posts drop constraint if exists discovery_posts_category_fk;
alter table public.discovery_posts add constraint discovery_posts_category_fk
  foreign key (category_slug) references public.discovery_categories(slug) on delete set null;

/* -------------------- 4. media table (source of truth) -------------------- */
create table if not exists public.discovery_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.discovery_posts(id) on delete cascade,
  media_type text not null check (media_type in ('photo','video','video_tour','floorplan','audio')),
  storage_bucket text not null,
  storage_path text not null,
  public_url text,
  sort_order int not null default 0,
  is_cover boolean not null default false,
  width int,
  height int,
  duration numeric,
  mime_type text,
  size_bytes bigint,
  processing_status text not null default 'ready'
    check (processing_status in ('ready','processing','failed')),
  created_at timestamptz not null default now()
);
create index if not exists discovery_media_post_order_idx
  on public.discovery_media (post_id, sort_order);

-- Keep discovery_posts.cover_url in sync with the chosen cover media.
create or replace function public.discovery_sync_cover() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_post uuid; v_cover text;
begin
  v_post := coalesce(new.post_id, old.post_id);
  select coalesce(public_url, storage_path) into v_cover
  from public.discovery_media
  where post_id = v_post and media_type in ('photo','floorplan','video')
  order by is_cover desc, (media_type = 'photo') desc, sort_order asc, created_at asc
  limit 1;
  update public.discovery_posts
    set cover_url = coalesce(v_cover, cover_url), updated_at = now()
  where id = v_post;
  return null;
end $$;
drop trigger if exists discovery_media_cover_sync on public.discovery_media;
create trigger discovery_media_cover_sync
  after insert or update or delete on public.discovery_media
  for each row execute function public.discovery_sync_cover();

/* -------------------- 5. optional multi-property links -------------------- */
create table if not exists public.discovery_post_properties (
  post_id uuid not null references public.discovery_posts(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  is_primary boolean not null default false,
  primary key (post_id, listing_id)
);

/* -------------------- 6. event log + aggregated metrics ------------------- */
create table if not exists public.discovery_events (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.discovery_posts(id) on delete cascade,
  agency_id uuid not null,
  content_type text not null,
  listing_id uuid,
  session_id text,
  event_type text not null,
  value numeric,
  created_at timestamptz not null default now()
);
create index if not exists discovery_events_post_kind_idx
  on public.discovery_events (post_id, event_type);
create index if not exists discovery_events_agency_time_idx
  on public.discovery_events (agency_id, created_at desc);

alter table public.discovery_metrics
  add column if not exists impressions bigint not null default 0,
  add column if not exists unique_views bigint not null default 0,
  add column if not exists watch_time_seconds bigint not null default 0,
  add column if not exists completions bigint not null default 0,
  add column if not exists photo_nav bigint not null default 0,
  add column if not exists shares bigint not null default 0,
  add column if not exists profile_clicks bigint not null default 0,
  add column if not exists related_clicks bigint not null default 0,
  add column if not exists messages bigint not null default 0,
  add column if not exists visit_requests bigint not null default 0,
  add column if not exists leads bigint not null default 0,
  add column if not exists conversions bigint not null default 0;

-- Public, deduped engagement beacon. Logs a raw event and rolls it into the
-- aggregated counters. Only fires for published posts.
create or replace function public.discovery_emit(
  p_post uuid, p_kind text, p_session text default null, p_value numeric default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_agency uuid; v_ctype text; v_listing uuid; v_is_unique boolean := false;
begin
  select agency_id, content_type, listing_id into v_agency, v_ctype, v_listing
  from public.discovery_posts where id = p_post and status = 'published';
  if v_agency is null then return; end if;

  if p_kind not in ('impression','view','watch_time','complete','photo_nav',
                    'share','detail_click','profile_click','related_click') then
    raise exception 'invalid_event_kind';
  end if;

  if p_kind = 'view' and p_session is not null then
    v_is_unique := not exists (
      select 1 from public.discovery_events
      where post_id = p_post and event_type = 'view' and session_id = left(p_session,64)
    );
  end if;

  insert into public.discovery_events
    (post_id, agency_id, content_type, listing_id, session_id, event_type, value)
  values (p_post, v_agency, v_ctype, v_listing, left(p_session,64), p_kind, p_value);

  update public.discovery_metrics m set
    impressions        = impressions + (p_kind = 'impression')::int,
    views              = views + (p_kind = 'view')::int,
    unique_views       = unique_views + (case when p_kind = 'view' and v_is_unique then 1 else 0 end),
    watch_time_seconds = watch_time_seconds + (case when p_kind = 'watch_time' then floor(coalesce(p_value,0))::bigint else 0 end),
    completions        = completions + (p_kind = 'complete')::int,
    photo_nav          = photo_nav + (p_kind = 'photo_nav')::int,
    shares             = shares + (p_kind = 'share')::int,
    detail_clicks      = detail_clicks + (p_kind = 'detail_click')::int,
    profile_clicks     = profile_clicks + (p_kind = 'profile_click')::int,
    related_clicks     = related_clicks + (p_kind = 'related_click')::int,
    updated_at = now()
  where m.post_id = p_post;
end $$;

/* -------------------- 7. migrate existing media --------------------------- */
-- Existing single video → a video media row (cover).
insert into public.discovery_media
  (post_id, media_type, storage_bucket, storage_path, public_url, sort_order, is_cover)
select id, 'video', 'discovery-videos', video_url, video_url, 0, true
from public.discovery_posts
where video_url is not null
  and not exists (select 1 from public.discovery_media dm where dm.post_id = discovery_posts.id);

-- Existing image_urls[] → ordered photo media rows.
insert into public.discovery_media
  (post_id, media_type, storage_bucket, storage_path, public_url, sort_order, is_cover)
select p.id, 'photo', 'discovery-thumbnails', img.url, img.url, (img.ord - 1)::int,
       (img.ord = 1 and p.video_url is null)
from public.discovery_posts p
cross join lateral unnest(p.image_urls) with ordinality as img(url, ord)
where coalesce(array_length(p.image_urls, 1), 0) > 0
  and not exists (select 1 from public.discovery_media dm where dm.post_id = p.id and dm.media_type = 'photo');

/* -------------------- 8. RLS --------------------------------------------- */
alter table public.discovery_media enable row level security;
alter table public.discovery_post_properties enable row level security;
alter table public.discovery_events enable row level security;
alter table public.discovery_categories enable row level security;

drop policy if exists discovery_media_member_all on public.discovery_media;
create policy discovery_media_member_all on public.discovery_media for all to authenticated
  using (post_id in (select id from public.discovery_posts
                     where agency_id in (select public.crm_member_agencies())))
  with check (post_id in (select id from public.discovery_posts
                          where agency_id in (select public.crm_member_agencies())));

drop policy if exists discovery_media_public_read on public.discovery_media;
create policy discovery_media_public_read on public.discovery_media for select to anon, authenticated
  using (post_id in (select id from public.discovery_posts where status = 'published'));

drop policy if exists dpp_member_all on public.discovery_post_properties;
create policy dpp_member_all on public.discovery_post_properties for all to authenticated
  using (post_id in (select id from public.discovery_posts
                     where agency_id in (select public.crm_member_agencies())))
  with check (post_id in (select id from public.discovery_posts
                          where agency_id in (select public.crm_member_agencies())));

drop policy if exists dpp_public_read on public.discovery_post_properties;
create policy dpp_public_read on public.discovery_post_properties for select to anon, authenticated
  using (post_id in (select id from public.discovery_posts where status = 'published'));

drop policy if exists discovery_categories_public_read on public.discovery_categories;
create policy discovery_categories_public_read on public.discovery_categories
  for select to anon, authenticated using (true);

-- Events are written only through discovery_emit() (SECURITY DEFINER); agencies
-- may read their own for analytics.
drop policy if exists discovery_events_member_read on public.discovery_events;
create policy discovery_events_member_read on public.discovery_events for select to authenticated
  using (agency_id in (select public.crm_member_agencies()));

/* -------------------- 9. audio bucket (podcasts) -------------------------- */
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('discovery-audio','discovery-audio', true, 104857600,
        array['audio/mpeg','audio/mp4','audio/aac','audio/wav','audio/webm','audio/ogg'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists discovery_audio_read on storage.objects;
create policy discovery_audio_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'discovery-audio');
drop policy if exists discovery_audio_write on storage.objects;
create policy discovery_audio_write on storage.objects for insert to authenticated
  with check (bucket_id = 'discovery-audio'
    and (nullif(split_part(name,'/',1),''))::uuid in (select public.crm_member_agencies()));
drop policy if exists discovery_audio_update on storage.objects;
create policy discovery_audio_update on storage.objects for update to authenticated
  using (bucket_id = 'discovery-audio'
    and (nullif(split_part(name,'/',1),''))::uuid in (select public.crm_member_agencies()));
drop policy if exists discovery_audio_delete on storage.objects;
create policy discovery_audio_delete on storage.objects for delete to authenticated
  using (bucket_id = 'discovery-audio'
    and (nullif(split_part(name,'/',1),''))::uuid in (select public.crm_member_agencies()));

/* -------------------- 10. scheduled auto-publish (pg_cron) ---------------- */
create extension if not exists pg_cron;
do $$ begin
  perform cron.unschedule('discovery-autopublish');
exception when others then null; end $$;
select cron.schedule('discovery-autopublish', '* * * * *', $cron$
  update public.discovery_posts
    set status = 'published',
        published_at = coalesce(published_at, scheduled_at)
  where status = 'scheduled' and scheduled_at is not null and scheduled_at <= now();
$cron$);
