-- Discovery feed goes end-to-end: the public TikTok-style feed now reads
-- published discovery_posts, and public reactions/engagement flow into
-- discovery_metrics (the agency-visible counters).

-- 1) Photo posts carry multiple ordered images. Video posts keep video_url +
--    a cover thumbnail; image_urls stays empty for them.
alter table public.discovery_posts
  add column if not exists image_urls text[] not null default '{}';

-- 1b) reactions.post_id used to point only at community_posts. It now records
--     reactions for discovery_posts too, and no single FK can cover both
--     tables — drop the constraint (the dedup unique index on
--     (session_id, post_id, kind) still guarantees one reaction per session).
alter table public.reactions drop constraint if exists reactions_post_id_fkey;

-- 2) The feed shows real view/like counts, so expose discovery_metrics
--    read-only for published posts. All writes still go through the RPCs.
drop policy if exists discovery_metrics_public_read on public.discovery_metrics;
create policy discovery_metrics_public_read on public.discovery_metrics
  for select to anon, authenticated
  using (
    post_id in (select id from public.discovery_posts where status = 'published')
  );

-- 3) react() dedups a session's reaction into `reactions` and bumps a like
--    counter. Teach it that a discovery post's counters live in
--    discovery_metrics (community_posts is the legacy surface). For discovery
--    both likes and favourites are counted; dedup still guarantees one per
--    session, so counts can't be inflated by re-tapping.
create or replace function public.react(
  p_session text, p_listing uuid, p_post uuid, p_kind text, p_media text
) returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_inserted boolean := false;
  v_count int := 0;
  v_is_discovery boolean := false;
begin
  if p_kind not in ('like','favourite') then raise exception 'bad_kind'; end if;

  if p_listing is not null then
    insert into reactions (session_id, listing_id, kind, media_kind)
    values (left(p_session,64), p_listing, p_kind, left(p_media,20))
    on conflict (session_id, listing_id, kind) where listing_id is not null do nothing;
    get diagnostics v_inserted = row_count;
    if v_inserted and p_kind = 'like' then
      update listings set like_count = like_count + 1 where id = p_listing;
    end if;
    select like_count into v_count from listings where id = p_listing;

  elsif p_post is not null then
    select exists(select 1 from discovery_posts where id = p_post) into v_is_discovery;

    insert into reactions (session_id, post_id, kind, media_kind)
    values (left(p_session,64), p_post, p_kind, left(p_media,20))
    on conflict (session_id, post_id, kind) where post_id is not null do nothing;
    get diagnostics v_inserted = row_count;

    if v_inserted then
      if v_is_discovery then
        update discovery_metrics
           set likes = likes + (p_kind = 'like')::int,
               favourites = favourites + (p_kind = 'favourite')::int,
               updated_at = now()
         where post_id = p_post;
      elsif p_kind = 'like' then
        update community_posts set like_count = like_count + 1 where id = p_post;
      end if;
    end if;

    if v_is_discovery then
      select likes into v_count from discovery_metrics where post_id = p_post;
    else
      select like_count into v_count from community_posts where id = p_post;
    end if;
  end if;

  return coalesce(v_count, 0);
end;
$$;
