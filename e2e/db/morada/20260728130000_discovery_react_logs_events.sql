-- react() already dedups likes/favourites into discovery_metrics; also log them
-- to discovery_events so period-over-period analytics (deltas, the Statistics
-- tab) cover reactions, not just emit()-tracked events.
create or replace function public.react(
  p_session text, p_listing uuid, p_post uuid, p_kind text, p_media text
) returns integer
language plpgsql security definer set search_path to 'public'
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
        insert into discovery_events (post_id, agency_id, content_type, listing_id, session_id, event_type)
        select p_post, dp.agency_id, dp.content_type, dp.listing_id, left(p_session,64), p_kind
        from discovery_posts dp where dp.id = p_post;
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
