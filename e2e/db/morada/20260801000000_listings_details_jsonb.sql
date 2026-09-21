-- Extended, extensible property attributes with no dedicated column
-- (deposit, commission, postal_code, country, floor, floors, wc, kitchens,
-- terrace_m2, balcony_m2, garden_m2, orientation, renovation_year, heating,
-- availability_date, condition, sub_type, hide_exact_address, virtual_tour_url,
-- price_on_request, owner_contact_id, price_history[]). One jsonb keeps the
-- schema clean, lives on the source-of-truth listings row (no duplication), and
-- inherits the existing listings RLS. Amenities continue to use features[].
alter table public.listings
  add column if not exists details jsonb not null default '{}'::jsonb;
