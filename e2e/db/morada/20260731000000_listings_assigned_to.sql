-- Responsible agent per property. Reuses the existing listings RLS (members of
-- the agency can update), so assignment needs no new policy.
alter table public.listings
  add column if not exists assigned_to uuid references auth.users(id) on delete set null;
create index if not exists listings_assigned_to_idx on public.listings(assigned_to);
