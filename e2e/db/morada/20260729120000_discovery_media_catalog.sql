-- Unified workspace media catalog + provenance on discovery_media, so the
-- "Ajouter des médias" picker can reuse existing files (listing photos/videos,
-- prior Discovery uploads) by REFERENCE instead of re-uploading.

alter table public.discovery_media
  add column if not exists source_type text not null default 'device_upload',
  add column if not exists is_primary boolean not null default false;
alter table public.discovery_media drop constraint if exists discovery_media_source_type_chk;
alter table public.discovery_media add constraint discovery_media_source_type_chk
  check (source_type in ('device_upload','listing_media','listing_video','catalog'));

-- Membership-guarded read-only catalog: listing photos + listing videos +
-- genuine Discovery uploads (references excluded to avoid duplicates). Never
-- exposes another workspace's media.
create or replace function public.workspace_media_catalog(
  p_agency uuid, p_kind text default 'all', p_listing uuid default null, p_q text default null
) returns table (
  source_type text, source_media_id uuid, listing_id uuid, listing_title jsonb,
  media_type text, url text, duration numeric, created_at timestamptz, origin text
) language sql security definer set search_path = public stable as $$
  with allowed as (select 1 where p_agency in (select public.crm_member_agencies()))
  select * from (
    -- listing photos
    select 'listing_media'::text, li.id, l.id, l.title, 'photo'::text, li.url,
           null::numeric, l.created_at, 'Bien'::text
    from public.listing_images li
    join public.listings l on l.id = li.listing_id
    where l.agency_id = p_agency and exists (select 1 from allowed)
      and p_kind in ('all','photo')
      and (p_listing is null or l.id = p_listing)
      and (p_q is null or l.title::text ilike '%'||p_q||'%' or l.commune ilike '%'||p_q||'%')
    union all
    -- listing videos (listings.video_url)
    select 'listing_video', null, l.id, l.title, 'video', l.video_url,
           null, l.created_at, 'Bien'
    from public.listings l
    where l.agency_id = p_agency and l.video_url is not null and exists (select 1 from allowed)
      and p_kind in ('all','video')
      and (p_listing is null or l.id = p_listing)
      and (p_q is null or l.title::text ilike '%'||p_q||'%')
    union all
    -- prior Discovery uploads (not references)
    select 'catalog', dm.id, dp.listing_id, l2.title,
           case when dm.media_type like 'video%' then 'video' else 'photo' end,
           coalesce(dm.public_url, dm.external_url), dm.duration, dm.created_at, 'Discovery'
    from public.discovery_media dm
    join public.discovery_posts dp on dp.id = dm.post_id
    left join public.listings l2 on l2.id = dp.listing_id
    where dp.agency_id = p_agency and exists (select 1 from allowed)
      and dm.storage_path is not null and dm.listing_media_id is null
      and coalesce(dm.public_url, dm.external_url) is not null
      and (p_listing is null or dp.listing_id = p_listing)
      and (p_kind = 'all'
           or (p_kind = 'video' and dm.media_type like 'video%')
           or (p_kind = 'photo' and dm.media_type not like 'video%'))
  ) cat
  order by created_at desc
  limit 400
$$;
