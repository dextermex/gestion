-- Discovery publication backend: reference a property's own media without
-- duplicating files, a full granular event vocabulary, and real attribution of
-- leads / visits / messages coming from Discovery into the CRM + metrics.

/* ---- 1. discovery_media: allow referencing listing media (no copy) -------- */
alter table public.discovery_media alter column storage_path drop not null;
alter table public.discovery_media
  add column if not exists listing_media_id uuid references public.listing_images(id) on delete set null,
  add column if not exists external_url text;
-- Every media row must have at least one source.
alter table public.discovery_media drop constraint if exists discovery_media_source_chk;
alter table public.discovery_media add constraint discovery_media_source_chk
  check (storage_path is not null or external_url is not null or listing_media_id is not null);

/* ---- 2. discovery_emit: full event vocabulary (§17) ---------------------- */
create or replace function public.discovery_emit(
  p_post uuid, p_kind text, p_session text default null, p_value numeric default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_agency uuid; v_ctype text; v_listing uuid; v_is_view boolean; v_is_unique boolean := false;
begin
  select agency_id, content_type, listing_id into v_agency, v_ctype, v_listing
  from public.discovery_posts where id = p_post and status = 'published';
  if v_agency is null then return; end if;

  if p_kind not in (
    'impression','view','media_view_started','media_view_25','media_view_50','media_view_75',
    'media_view_completed','complete','media_swiped','photo_nav','share','share_clicked',
    'property_clicked','detail_click','profile_click','related_click',
    'favorite_added','favorite_removed','contact_clicked','watch_time'
  ) then raise exception 'invalid_event_kind'; end if;

  v_is_view := p_kind in ('view','media_view_started');
  if v_is_view and p_session is not null then
    v_is_unique := not exists (
      select 1 from public.discovery_events
      where post_id = p_post and event_type in ('view','media_view_started') and session_id = left(p_session,64)
    );
  end if;

  insert into public.discovery_events (post_id, agency_id, content_type, listing_id, session_id, event_type, value)
  values (p_post, v_agency, v_ctype, v_listing, left(p_session,64), p_kind, p_value);

  -- Aggregate ONLY pure-engagement counters here; favourites are owned by
  -- react(), and messages/visits/leads by the attribution triggers below —
  -- so nothing is double-counted.
  update public.discovery_metrics m set
    impressions        = impressions + (p_kind = 'impression')::int,
    views              = views + (v_is_view)::int,
    unique_views       = unique_views + (case when v_is_view and v_is_unique then 1 else 0 end),
    watch_time_seconds = watch_time_seconds + (case when p_kind = 'watch_time' then floor(coalesce(p_value,0))::bigint else 0 end),
    completions        = completions + (p_kind in ('media_view_completed','complete'))::int,
    photo_nav          = photo_nav + (p_kind in ('media_swiped','photo_nav'))::int,
    shares             = shares + (p_kind in ('share','share_clicked'))::int,
    detail_clicks      = detail_clicks + (p_kind in ('property_clicked','detail_click'))::int,
    profile_clicks     = profile_clicks + (p_kind = 'profile_click')::int,
    related_clicks     = related_clicks + (p_kind = 'related_click')::int,
    updated_at = now()
  where m.post_id = p_post;
end $$;

/* ---- 3. attribution columns --------------------------------------------- */
alter table public.leads
  add column if not exists discovery_post_id uuid references public.discovery_posts(id) on delete set null;
alter table public.visit_requests
  add column if not exists discovery_post_id uuid references public.discovery_posts(id) on delete set null;
alter table public.customer_conversations
  add column if not exists discovery_post_id uuid references public.discovery_posts(id) on delete set null;

create index if not exists leads_discovery_post_idx on public.leads (discovery_post_id);
create index if not exists visit_requests_discovery_post_idx on public.visit_requests (discovery_post_id);

/* ---- 4. attribution triggers → metrics + events ------------------------- */
create or replace function public.discovery_attr_lead() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.discovery_post_id is not null then
    update public.discovery_metrics set leads = leads + 1, updated_at = now() where post_id = new.discovery_post_id;
    insert into public.discovery_events (post_id, agency_id, content_type, listing_id, event_type)
    select new.discovery_post_id, dp.agency_id, dp.content_type, dp.listing_id, 'lead_created'
    from public.discovery_posts dp where dp.id = new.discovery_post_id;
  end if;
  return new;
end $$;
drop trigger if exists discovery_attr_lead_trg on public.leads;
create trigger discovery_attr_lead_trg after insert on public.leads
  for each row execute function public.discovery_attr_lead();

create or replace function public.discovery_attr_visit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.discovery_post_id is not null then
    update public.discovery_metrics set visit_requests = visit_requests + 1, updated_at = now() where post_id = new.discovery_post_id;
    insert into public.discovery_events (post_id, agency_id, content_type, listing_id, event_type)
    select new.discovery_post_id, dp.agency_id, dp.content_type, dp.listing_id, 'viewing_requested'
    from public.discovery_posts dp where dp.id = new.discovery_post_id;
  end if;
  return new;
end $$;
drop trigger if exists discovery_attr_visit_trg on public.visit_requests;
create trigger discovery_attr_visit_trg after insert on public.visit_requests
  for each row execute function public.discovery_attr_visit();

create or replace function public.discovery_attr_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_post uuid; v_agency uuid; v_ctype text; v_listing uuid;
begin
  if new.sender_role <> 'customer' then return new; end if;
  select cc.discovery_post_id into v_post from public.customer_conversations cc where cc.id = new.conversation_id;
  if v_post is not null then
    update public.discovery_metrics set messages = messages + 1, updated_at = now() where post_id = v_post;
    select agency_id, content_type, listing_id into v_agency, v_ctype, v_listing from public.discovery_posts where id = v_post;
    insert into public.discovery_events (post_id, agency_id, content_type, listing_id, event_type)
    values (v_post, v_agency, v_ctype, v_listing, 'message_sent');
  end if;
  return new;
end $$;
drop trigger if exists discovery_attr_message_trg on public.customer_messages;
create trigger discovery_attr_message_trg after insert on public.customer_messages
  for each row execute function public.discovery_attr_message();
