-- Paid placement ("Top annonce", mobile.de-style): a boosted listing surfaces in
-- the sponsored slots at the top of matching search results until boosted_until.
-- Lives on the source-of-truth listings row; existing RLS applies (members
-- update their own listings; public read stays limited to published rows).
alter table public.listings
  add column if not exists boosted_until timestamptz,
  add column if not exists boost_tier text;
alter table public.listings drop constraint if exists listings_boost_tier_chk;
alter table public.listings add constraint listings_boost_tier_chk
  check (boost_tier is null or boost_tier in ('top7','top14','premium30'));
create index if not exists listings_boosted_idx
  on public.listings (boosted_until desc) where boosted_until is not null;
