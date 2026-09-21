-- Morada's `public` schema as it stood before its migration history begins.
--
-- The first file in dextermex/morada `supabase/migrations` (11 July 2026)
-- already assumes `public.agencies`, `public.listings` and a handful of other
-- tables and functions: they were created before the repository kept
-- migrations. This file recreates exactly those objects, as the hosted
-- project defines them today, so the migrations can be replayed on a fresh
-- database. Everything else in `public` comes from the migrations themselves.
--
-- Generated from the hosted project with e2e/db/base/snapshot-base.sql
-- (read-only catalog queries) on 2026-09-21. Columns, constraints, indexes
-- and policies that later migrations add are already present here; every
-- such migration statement is written `if not exists` / `drop ... if exists`
-- and replays cleanly. Policies and triggers the migrations create are left
-- to them. Applied by e2e/db/prepare.mjs right after its prelude, before the
-- vendored Morada files. Never applied to production from here.

-- Extensions the base and the migrations rely on, in the schemas the hosted
-- project has them in.
create extension if not exists pg_trgm with schema public;
create extension if not exists unaccent with schema public;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.agencies (
  id uuid default gen_random_uuid() not null,
  slug text not null,
  name text not null,
  logo_url text,
  phone text,
  email text,
  website text,
  address text,
  languages text[] default '{fr,en}'::text[] not null,
  created_at timestamp with time zone default now() not null,
  rating numeric,
  review_count integer,
  avg_response_min integer,
  city text,
  blurb jsonb default '{}'::jsonb not null,
  cover_url text,
  brand_color text,
  tagline jsonb default '{}'::jsonb not null,
  kind text default 'agency'::text not null,
  is_public boolean default true not null
);

create table if not exists public.community_posts (
  id uuid default gen_random_uuid() not null,
  agency_id uuid,
  kind text default 'tip'::text not null,
  title jsonb default '{}'::jsonb not null,
  body jsonb default '{}'::jsonb not null,
  media_url text,
  image_url text,
  like_count integer default 0 not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.leads (
  id uuid default gen_random_uuid() not null,
  listing_id uuid,
  agency_id uuid,
  name text not null,
  email text not null,
  phone text,
  message text,
  locale text default 'en'::text not null,
  source text default 'listing_form'::text not null,
  status text default 'new'::text not null,
  created_at timestamp with time zone default now() not null,
  discovery_post_id uuid
);

create table if not exists public.listing_images (
  id uuid default gen_random_uuid() not null,
  listing_id uuid not null,
  url text not null,
  alt text,
  sort_order integer default 0 not null
);

create table if not exists public.listings (
  id uuid default gen_random_uuid() not null,
  slug text not null,
  agency_id uuid,
  transaction text not null,
  property_type text not null,
  status text default 'published'::text not null,
  title jsonb default '{}'::jsonb not null,
  description jsonb default '{}'::jsonb not null,
  price integer not null,
  charges integer,
  rooms integer,
  bedrooms integer,
  bathrooms integer,
  surface_m2 numeric,
  land_m2 numeric,
  year_built integer,
  energy_class text,
  commune text not null,
  commune_slug text not null,
  quartier text,
  address text,
  lat double precision,
  lng double precision,
  features text[] default '{}'::text[] not null,
  is_featured boolean default false not null,
  is_new_build boolean default false not null,
  view_count integer default 0 not null,
  lead_count integer default 0 not null,
  published_at timestamp with time zone default now() not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  video_url text,
  video_status text default 'none'::text not null,
  source_url text,
  like_count integer default 0 not null,
  assigned_to uuid,
  details jsonb default '{}'::jsonb not null,
  boosted_until timestamp with time zone,
  boost_tier text
);

create table if not exists public.offers (
  id uuid default gen_random_uuid() not null,
  listing_id uuid,
  agency_id uuid,
  amount integer not null,
  financing text not null,
  timeline text,
  message text,
  name text not null,
  email text not null,
  phone text,
  locale text default 'en'::text not null,
  status text default 'new'::text not null,
  created_at timestamp with time zone default now() not null,
  user_id uuid
);

create table if not exists public.reactions (
  id uuid default gen_random_uuid() not null,
  session_id text not null,
  listing_id uuid,
  post_id uuid,
  kind text not null,
  media_kind text,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.swipes (
  id uuid default gen_random_uuid() not null,
  session_id text not null,
  listing_id uuid not null,
  direction text not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.waitlist (
  id uuid default gen_random_uuid() not null,
  email text not null,
  source text,
  user_agent text,
  created_at timestamp with time zone default now() not null
);

-- ---------------------------------------------------------------------------
-- Keys and checks
-- ---------------------------------------------------------------------------
alter table public.agencies add constraint agencies_pkey PRIMARY KEY (id);
alter table public.agencies add constraint agencies_slug_key UNIQUE (slug);
alter table public.agencies add constraint agencies_kind_check CHECK ((kind = ANY (ARRAY['agency'::text, 'owner'::text, 'manager'::text])));

alter table public.community_posts add constraint community_posts_pkey PRIMARY KEY (id);
alter table public.community_posts add constraint community_posts_kind_check CHECK ((kind = ANY (ARRAY['video'::text, 'image'::text, 'tip'::text, 'news'::text])));

alter table public.leads add constraint leads_pkey PRIMARY KEY (id);
alter table public.leads add constraint leads_status_check CHECK ((status = ANY (ARRAY['new'::text, 'contacted'::text, 'closed'::text])));

alter table public.listing_images add constraint listing_images_pkey PRIMARY KEY (id);

alter table public.listings add constraint listings_pkey PRIMARY KEY (id);
alter table public.listings add constraint listings_slug_key UNIQUE (slug);
alter table public.listings add constraint listings_boost_tier_chk CHECK (((boost_tier IS NULL) OR (boost_tier = ANY (ARRAY['top7'::text, 'top14'::text, 'premium30'::text]))));
alter table public.listings add constraint listings_energy_class_check CHECK ((energy_class = ANY (ARRAY['A+'::text, 'A'::text, 'B'::text, 'C'::text, 'D'::text, 'E'::text, 'F'::text, 'G'::text, 'I'::text, 'NC'::text])));
alter table public.listings add constraint listings_price_check CHECK ((price >= 0));
alter table public.listings add constraint listings_property_type_check CHECK ((property_type = ANY (ARRAY['apartment'::text, 'house'::text, 'studio'::text, 'penthouse'::text, 'duplex'::text, 'loft'::text, 'office'::text, 'commercial'::text, 'land'::text, 'garage'::text])));
alter table public.listings add constraint listings_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'archived'::text])));
alter table public.listings add constraint listings_transaction_check CHECK ((transaction = ANY (ARRAY['buy'::text, 'rent'::text])));
alter table public.listings add constraint listings_video_status_check CHECK ((video_status = ANY (ARRAY['none'::text, 'requested'::text, 'processing'::text, 'ready'::text])));

alter table public.offers add constraint offers_pkey PRIMARY KEY (id);
alter table public.offers add constraint offers_amount_check CHECK ((amount > 0));
alter table public.offers add constraint offers_financing_check CHECK ((financing = ANY (ARRAY['cash'::text, 'pre_approved'::text, 'mortgage_needed'::text])));
alter table public.offers add constraint offers_status_check CHECK ((status = ANY (ARRAY['new'::text, 'forwarded'::text, 'accepted'::text, 'declined'::text])));

alter table public.reactions add constraint reactions_pkey PRIMARY KEY (id);
alter table public.reactions add constraint reactions_check CHECK (((listing_id IS NOT NULL) OR (post_id IS NOT NULL)));
alter table public.reactions add constraint reactions_kind_check CHECK ((kind = ANY (ARRAY['like'::text, 'favourite'::text])));

alter table public.swipes add constraint swipes_pkey PRIMARY KEY (id);
alter table public.swipes add constraint swipes_direction_check CHECK ((direction = ANY (ARRAY['like'::text, 'pass'::text])));
alter table public.swipes add constraint swipes_session_id_listing_id_key UNIQUE (session_id, listing_id);

alter table public.waitlist add constraint waitlist_pkey PRIMARY KEY (id);
alter table public.waitlist add constraint waitlist_email_key UNIQUE (email);

-- Foreign keys among these tables (the ones towards later tables are added by the migrations).
alter table public.community_posts add constraint community_posts_agency_id_fkey FOREIGN KEY (agency_id) REFERENCES public.agencies(id) ON DELETE CASCADE;
alter table public.leads add constraint leads_agency_id_fkey FOREIGN KEY (agency_id) REFERENCES public.agencies(id) ON DELETE SET NULL;
alter table public.leads add constraint leads_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE SET NULL;
alter table public.listing_images add constraint listing_images_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE CASCADE;
alter table public.listings add constraint listings_agency_id_fkey FOREIGN KEY (agency_id) REFERENCES public.agencies(id) ON DELETE SET NULL;
alter table public.offers add constraint offers_agency_id_fkey FOREIGN KEY (agency_id) REFERENCES public.agencies(id) ON DELETE SET NULL;
alter table public.offers add constraint offers_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE SET NULL;
alter table public.reactions add constraint reactions_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE CASCADE;
alter table public.swipes add constraint swipes_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS leads_agency_idx ON public.leads USING btree (agency_id, created_at DESC);
CREATE INDEX IF NOT EXISTS leads_discovery_post_idx ON public.leads USING btree (discovery_post_id);
CREATE INDEX IF NOT EXISTS leads_listing_idx ON public.leads USING btree (listing_id);
CREATE INDEX IF NOT EXISTS listing_images_listing_idx ON public.listing_images USING btree (listing_id, sort_order);
CREATE INDEX IF NOT EXISTS listings_agency_idx ON public.listings USING btree (agency_id);
CREATE INDEX IF NOT EXISTS listings_assigned_to_idx ON public.listings USING btree (assigned_to);
CREATE INDEX IF NOT EXISTS listings_boosted_idx ON public.listings USING btree (boosted_until DESC) WHERE (boosted_until IS NOT NULL);
CREATE INDEX IF NOT EXISTS listings_price_idx ON public.listings USING btree (price);
CREATE INDEX IF NOT EXISTS listings_published_idx ON public.listings USING btree (published_at DESC);
CREATE INDEX IF NOT EXISTS listings_search_idx ON public.listings USING btree (status, transaction, property_type, commune_slug);
CREATE INDEX IF NOT EXISTS offers_agency_idx ON public.offers USING btree (agency_id, created_at DESC);
CREATE INDEX IF NOT EXISTS offers_user_idx ON public.offers USING btree (user_id);
CREATE INDEX IF NOT EXISTS reactions_session_idx ON public.reactions USING btree (session_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS reactions_listing_uniq ON public.reactions USING btree (session_id, listing_id, kind) WHERE (listing_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS reactions_post_uniq ON public.reactions USING btree (session_id, post_id, kind) WHERE (post_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS swipes_session_idx ON public.swipes USING btree (session_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Row-level security and the policies that predate the migrations
-- (the crm_* policies on these tables are created by the migrations)
-- ---------------------------------------------------------------------------
alter table public.agencies enable row level security;
alter table public.community_posts enable row level security;
alter table public.leads enable row level security;
alter table public.listing_images enable row level security;
alter table public.listings enable row level security;
alter table public.offers enable row level security;
alter table public.reactions enable row level security;
alter table public.swipes enable row level security;
alter table public.waitlist enable row level security;

drop policy if exists "public read agencies" on public.agencies;
create policy "public read agencies" on public.agencies as permissive for select to public using (true);

drop policy if exists "public read community posts" on public.community_posts;
create policy "public read community posts" on public.community_posts as permissive for select to public using (true);

drop policy if exists "anyone may submit a lead" on public.leads;
create policy "anyone may submit a lead" on public.leads as permissive for insert to public with check (true);

drop policy if exists "public read images of published listings" on public.listing_images;
create policy "public read images of published listings" on public.listing_images as permissive for select to public
  using ((EXISTS ( SELECT 1 FROM public.listings l WHERE ((l.id = listing_images.listing_id) AND (l.status = 'published'::text)))));

drop policy if exists "public read published listings" on public.listings;
create policy "public read published listings" on public.listings as permissive for select to public using ((status = 'published'::text));

drop policy if exists offers_owner_select on public.offers;
create policy offers_owner_select on public.offers as permissive for select to authenticated using ((user_id = auth.uid()));

drop policy if exists "anyone may record swipes" on public.swipes;
create policy "anyone may record swipes" on public.swipes as permissive for insert to public with check (true);

drop policy if exists "anyone can join waitlist" on public.waitlist;
create policy "anyone can join waitlist" on public.waitlist as permissive for insert to authenticated, anon
  with check (((email IS NOT NULL) AND ((length(email) >= 3) AND (length(email) <= 255)) AND (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'::text)));

-- ---------------------------------------------------------------------------
-- Functions that predate the migrations
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._infer_type(t text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
    when t ~* 'penthouse' then 'penthouse'
    when t ~* 'duplex|triplex' then 'duplex'
    when t ~* 'studio' then 'studio'
    when t ~* 'loft' then 'loft'
    when t ~* 'maison|house|villa|haus' then 'house'
    when t ~* 'terrain|land|grundst' then 'land'
    when t ~* 'bureau|office' then 'office'
    when t ~* 'commerce|commercial|local' then 'commercial'
    when t ~* 'garage|parking|emplacement' then 'garage'
    when t ~* 'appartement|apartment|wohnung|flat' then 'apartment'
    else 'apartment'
  end;
$function$;

CREATE OR REPLACE FUNCTION public._import_from_parsed(p_source text, p_agency_slug text)
 RETURNS TABLE(inserted integer, skipped integer)
 LANGUAGE plpgsql
AS $function$
declare
  v_agency uuid;
  v_ins int := 0;
  v_skip int := 0;
  rec record;
  g record;
  v_listing uuid;
  v_slug text;
  v_type text;
  v_commune text;
  v_commune_slug text;
  v_lat double precision;
  v_lng double precision;
  v_i int;
  v_url text;
begin
  select id into v_agency from public.agencies where slug = p_agency_slug;
  if v_agency is null then raise exception 'agency % not found', p_agency_slug; end if;

  for rec in select * from public._parsed where source = p_source loop
    -- must have a price and a title
    if rec.price is null or rec.price < 1000 or rec.title is null then
      v_skip := v_skip + 1; continue;
    end if;
    -- skip if already imported (by source_url)
    if exists (select 1 from public.listings where source_url = rec.src_url) then
      v_skip := v_skip + 1; continue;
    end if;

    -- resolve commune via gazetteer (longest-name match found in title/commune_raw)
    v_commune := null; v_commune_slug := null; v_lat := null; v_lng := null;
    select gz.name, gz.slug, gz.lat, gz.lng into g
    from public._gaz gz
    where lower(unaccent(coalesce(rec.commune_raw,''))) = lower(unaccent(gz.name))
    order by length(gz.name) desc limit 1;
    if g.name is null then
      -- fallback: search the title for any known locality
      select gz.name, gz.slug, gz.lat, gz.lng into g
      from public._gaz gz
      where rec.title ~* ('(^|[^a-z])' || regexp_replace(gz.name,'([().^$*+?{}\[\]\\|])','\\\1','g') || '([^a-z]|$)')
      order by length(gz.name) desc limit 1;
    end if;
    if g.name is null then
      v_skip := v_skip + 1; continue;  -- no locatable commune → skip rather than guess
    end if;
    v_commune := g.name; v_commune_slug := g.slug; v_lat := g.lat; v_lng := g.lng;

    v_type := coalesce(rec.ptype, public._infer_type(rec.title));

    v_slug := left(regexp_replace(lower(unaccent(rec.title)), '[^a-z0-9]+','-','g'), 60);
    v_slug := trim(both '-' from v_slug) || '-' || substr(md5(rec.src_url), 1, 6);

    insert into public.listings
      (slug, agency_id, transaction, property_type, status, title, description,
       price, bedrooms, rooms, surface_m2, year_built, commune, commune_slug,
       lat, lng, is_featured, source_url, published_at)
    values
      (v_slug, v_agency, rec.transaction, v_type, 'published',
       jsonb_build_object('fr', rec.title, 'en', rec.title),
       jsonb_build_object('fr', coalesce(rec.descr,''), 'en', coalesce(rec.descr,'')),
       rec.price, rec.bedrooms, rec.rooms, rec.surface, rec.year_built,
       v_commune, v_commune_slug, v_lat, v_lng, false, rec.src_url, now())
    returning id into v_listing;

    -- images (max 15)
    v_i := 0;
    if rec.imgs is not null then
      foreach v_url in array rec.imgs loop
        exit when v_i >= 15;
        insert into public.listing_images (listing_id, url, sort_order)
        values (v_listing, v_url, v_i);
        v_i := v_i + 1;
      end loop;
    end if;

    v_ins := v_ins + 1;
  end loop;

  return query select v_ins, v_skip;
end;
$function$;

CREATE OR REPLACE FUNCTION public.discover_feed(p_session text, p_limit integer DEFAULT 30)
 RETURNS TABLE(listing_id uuid, score numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with liked as (
    select l.property_type, l.commune_slug, l.price::numeric as price, l.bedrooms
    from reactions r join listings l on l.id = r.listing_id
    where r.session_id = p_session
    order by r.created_at desc
    limit 50
  ),
  prefs as (
    select
      (select count(*) from liked) as n,
      (select avg(price) from liked) as avg_price
  ),
  type_w as (select property_type, count(*)::numeric as w from liked group by 1),
  commune_w as (select commune_slug, count(*)::numeric as w from liked group by 1),
  beds_w as (select bedrooms, count(*)::numeric as w from liked where bedrooms is not null group by 1)
  select l.id,
    coalesce((select 3 * tw.w / nullif(p.n,0) from type_w tw where tw.property_type = l.property_type), 0)
    + coalesce((select 2.5 * cw.w / nullif(p.n,0) from commune_w cw where cw.commune_slug = l.commune_slug), 0)
    + case when p.avg_price is not null and l.price between p.avg_price * 0.65 and p.avg_price * 1.4 then 2 else 0 end
    + coalesce((select 1.2 * bw.w / nullif(p.n,0) from beds_w bw where abs(coalesce(bw.bedrooms,0) - coalesce(l.bedrooms,0)) <= 1), 0)
    + case when l.video_url is not null then 0.8 else 0 end
    + case when l.is_featured then 0.5 else 0 end
    + greatest(0, 1 - extract(epoch from now() - l.published_at) / 86400 / 60)
    + random() * 1.6
    as score
  from listings l, prefs p
  where l.status = 'published'
    and not exists (
      select 1 from reactions r
      where r.session_id = p_session and r.listing_id = l.id and r.kind = 'like'
        and r.created_at > now() - interval '2 days'
    )
  order by score desc
  limit p_limit;
$function$;

CREATE OR REPLACE FUNCTION public.increment_view(p_listing uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update listings set view_count = view_count + 1 where id = p_listing;
$function$;

CREATE OR REPLACE FUNCTION public.join_waitlist(p_email text, p_source text, p_ua text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_email is null or length(p_email) not between 3 and 255
     or p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return false;
  end if;
  insert into waitlist (email, source, user_agent)
  values (lower(p_email), left(p_source, 60), left(p_ua, 300))
  on conflict (email) do nothing;
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.market_stats(p_transaction text, p_property_type text DEFAULT NULL::text, p_commune_slug text DEFAULT NULL::text, p_min_bedrooms integer DEFAULT NULL::integer)
 RETURNS TABLE(n bigint, median_price numeric, p25_price numeric, p75_price numeric, median_ppm2 numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select count(*)::bigint,
         percentile_cont(0.5) within group (order by price),
         percentile_cont(0.25) within group (order by price),
         percentile_cont(0.75) within group (order by price),
         percentile_cont(0.5) within group (order by price / nullif(surface_m2, 0))
  from listings
  where status = 'published'
    and transaction = p_transaction
    and (p_property_type is null or property_type = p_property_type)
    and (p_commune_slug is null or commune_slug = p_commune_slug)
    and (p_min_bedrooms is null or bedrooms >= p_min_bedrooms);
$function$;

CREATE OR REPLACE FUNCTION public.record_swipe(p_session text, p_listing uuid, p_direction text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into swipes (session_id, listing_id, direction)
  values (p_session, p_listing, p_direction)
  on conflict (session_id, listing_id)
  do update set direction = excluded.direction, created_at = now();
$function$;

CREATE OR REPLACE FUNCTION public.submit_lead(p_listing uuid, p_name text, p_email text, p_phone text, p_message text, p_locale text, p_source text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_agency uuid;
  v_id uuid;
begin
  select agency_id into v_agency from listings where id = p_listing;
  insert into leads (listing_id, agency_id, name, email, phone, message, locale, source)
  values (p_listing, v_agency, p_name, p_email, p_phone, p_message, coalesce(p_locale,'en'), coalesce(p_source,'listing_form'))
  returning id into v_id;
  update listings set lead_count = lead_count + 1 where id = p_listing;
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.submit_offer(p_listing uuid, p_amount integer, p_financing text, p_timeline text, p_message text, p_name text, p_email text, p_phone text, p_locale text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_agency uuid; v_id uuid;
begin
  if p_amount is null or p_amount <= 0 or length(coalesce(p_name,'')) < 2
     or p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'validation';
  end if;
  select agency_id into v_agency from listings where id = p_listing;
  insert into offers (listing_id, agency_id, amount, financing, timeline, message, name, email, phone, locale, user_id)
  values (p_listing, v_agency, p_amount, p_financing, left(p_timeline,40), left(p_message,2000),
          left(p_name,120), left(p_email,200), left(p_phone,40), coalesce(left(p_locale,2),'en'), auth.uid())
  returning id into v_id;
  return v_id;
end;
$function$;

-- The same grants as the hosted project: every role may call the public functions.
grant execute on function public._infer_type(text) to anon, authenticated, service_role;
grant execute on function public._import_from_parsed(text, text) to anon, authenticated, service_role;
grant execute on function public.discover_feed(text, integer) to anon, authenticated, service_role;
grant execute on function public.increment_view(uuid) to anon, authenticated, service_role;
grant execute on function public.join_waitlist(text, text, text) to anon, authenticated, service_role;
grant execute on function public.market_stats(text, text, text, integer) to anon, authenticated, service_role;
grant execute on function public.record_swipe(text, uuid, text) to anon, authenticated, service_role;
grant execute on function public.submit_lead(uuid, text, text, text, text, text, text) to anon, authenticated, service_role;
grant execute on function public.submit_offer(uuid, integer, text, text, text, text, text, text, text) to anon, authenticated, service_role;
