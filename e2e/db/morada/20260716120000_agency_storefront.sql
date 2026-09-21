-- Agency public storefront ("Vitrine publique sur Morada") customization.
-- Additive, nullable columns only — safe to roll back.

alter table public.agencies
  add column if not exists cover_url text,
  add column if not exists brand_color text,
  add column if not exists tagline jsonb not null default '{}'::jsonb;

comment on column public.agencies.cover_url is 'Storefront cover/banner image URL.';
comment on column public.agencies.brand_color is 'Storefront accent colour (hex, e.g. #14636f).';
comment on column public.agencies.tagline is 'Localized one-line storefront tagline ({en,fr,de,pt,lu}).';
