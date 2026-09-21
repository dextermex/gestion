-- ============================================================================
-- Discover "Biens" — relevance-ranked feed (replaces strict filtering)
-- ============================================================================
-- discover_rank returns ALL published listings ordered by a relevance score
-- built ONLY from the explicitly-selected preferences, then a seeded-random
-- tie-break. This guarantees:
--   * no preferences  → every listing scores 0 → varied seeded-random feed
--   * one preference  → matching listings rank first, others follow (Level 2)
--   * many preferences → best (exact) matches first, closest alternatives next
-- The feed is therefore never empty while active listings exist. A listing is
-- never penalised for a criterion the user did not select.
--
-- Ordering is stable for a given seed → pagination is duplicate-free and the
-- order does not reshuffle while swiping.
--
-- ROLLBACK: drop function public.discover_rank(text,text[],text[],text[],integer,integer,integer,numeric,numeric,bigint,integer,integer);
-- ============================================================================

create or replace function public.discover_rank(
  p_transaction   text    default null,
  p_communes      text[]  default '{}',
  p_quartiers     text[]  default '{}',
  p_types         text[]  default '{}',
  p_min_price     integer default null,
  p_max_price     integer default null,
  p_min_bedrooms  integer default null,
  p_min_surface   numeric default null,
  p_max_surface   numeric default null,
  p_seed          bigint  default 0,
  p_limit         integer default 20,
  p_offset        integer default 0
)
returns table (id uuid, score integer)
language sql
stable
set search_path = public, pg_temp
as $$
  select id, score
  from (
    select
      l.id,
      (
        -- transaction: highest importance
        (case when p_transaction is not null and l.transaction = p_transaction then 100 else 0 end)
        -- location: commune (or expanded region slugs) OR quartier
        + (case
             when (coalesce(array_length(p_communes, 1), 0) > 0
                   or coalesce(array_length(p_quartiers, 1), 0) > 0)
                  and (l.commune_slug = any (p_communes) or l.quartier = any (p_quartiers))
             then 60 else 0 end)
        -- property type: OR within the selected set
        + (case when coalesce(array_length(p_types, 1), 0) > 0 and l.property_type = any (p_types)
                then 50 else 0 end)
        -- price range (only when a bound was given)
        + (case
             when (p_min_price is not null or p_max_price is not null)
                  and (p_min_price is null or l.price >= p_min_price)
                  and (p_max_price is null or l.price <= p_max_price)
             then 40 else 0 end)
        -- minimum bedrooms
        + (case when p_min_bedrooms is not null and l.bedrooms is not null and l.bedrooms >= p_min_bedrooms
                then 30 else 0 end)
        -- living-surface range
        + (case
             when (p_min_surface is not null or p_max_surface is not null)
                  and l.surface_m2 is not null
                  and (p_min_surface is null or l.surface_m2 >= p_min_surface)
                  and (p_max_surface is null or l.surface_m2 <= p_max_surface)
             then 20 else 0 end)
        -- quality nudges (never penalise; tiny, only breaks ties among equals)
        + (case when l.is_featured then 3 else 0 end)
        + (case when l.video_url is not null then 2 else 0 end)
      ) as score
    from public.listings l
    where l.status = 'published'
  ) ranked
  order by score desc, hashtextextended(id::text, p_seed)
  limit greatest(1, least(coalesce(p_limit, 20), 60))
  offset greatest(0, coalesce(p_offset, 0));
$$;

grant execute on function public.discover_rank(text, text[], text[], text[], integer, integer, integer, numeric, numeric, bigint, integer, integer) to anon, authenticated;
