-- ============================================================================
-- Discover "Biens" backend filtering + seeded-random ordering
-- ============================================================================
-- Additive. Creates public.discover_search(...) returning ordered listing ids
-- for the Discover property feed. Filters entirely at the database level:
--   transaction (single) AND location (commune_slug OR quartier)
--   AND property_type (OR) AND price range AND min bedrooms AND surface range.
-- Ordering is a deterministic seeded shuffle (hashtextextended(id, seed)) so the
-- order is random per session but STABLE across pagination for the same seed.
-- Security invoker (default) → the caller's RLS applies; only published listings
-- the anon/public role may read are returned, and the body also pins status.
--
-- ROLLBACK: drop function public.discover_search(text,text[],text[],text[],int,int,int,numeric,numeric,bigint,int,int);
-- ============================================================================

create or replace function public.discover_search(
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
returns setof uuid
language sql
stable
set search_path = public, pg_temp
as $$
  select id
  from public.listings
  where status = 'published'
    and (p_transaction is null or transaction = p_transaction)
    and (coalesce(array_length(p_types, 1), 0) = 0 or property_type = any (p_types))
    and (
      (coalesce(array_length(p_communes, 1), 0) = 0
        and coalesce(array_length(p_quartiers, 1), 0) = 0)
      or commune_slug = any (p_communes)
      or quartier = any (p_quartiers)
    )
    and (p_min_price is null or price >= p_min_price)
    and (p_max_price is null or price <= p_max_price)
    and (p_min_bedrooms is null or (bedrooms is not null and bedrooms >= p_min_bedrooms))
    and (p_min_surface is null or (surface_m2 is not null and surface_m2 >= p_min_surface))
    and (p_max_surface is null or (surface_m2 is not null and surface_m2 <= p_max_surface))
  order by hashtextextended(id::text, p_seed)
  limit greatest(1, least(coalesce(p_limit, 20), 60))
  offset greatest(0, coalesce(p_offset, 0));
$$;

grant execute on function public.discover_search(text, text[], text[], text[], integer, integer, integer, numeric, numeric, bigint, integer, integer) to anon, authenticated;
