-- Period-based analytics for the Discovery Pro dashboard. Cumulative counters
-- live on discovery_metrics; time-windowed figures (deltas, the right-hand
-- Statistics/Interactions/Performance tabs, the "Période" filter) are derived
-- from the discovery_events log. Membership-guarded, read-only aggregation.

create index if not exists discovery_events_post_time_idx
  on public.discovery_events (post_id, created_at desc);

-- Workspace-level aggregation within [from, to), grouped by content type + event.
create or replace function public.discovery_period_stats(
  p_agency uuid, p_from timestamptz, p_to timestamptz
) returns table (content_type text, event_type text, n bigint, total numeric)
language sql security definer set search_path = public stable as $$
  select e.content_type, e.event_type, count(*)::bigint, coalesce(sum(e.value), 0)
  from public.discovery_events e
  where e.agency_id = p_agency
    and e.agency_id in (select public.crm_member_agencies())
    and e.created_at >= p_from and e.created_at < p_to
  group by e.content_type, e.event_type
$$;

-- Single-post aggregation within [from, to) — powers the detail panel tabs.
create or replace function public.discovery_post_stats(
  p_post uuid, p_from timestamptz, p_to timestamptz
) returns table (event_type text, n bigint, total numeric)
language sql security definer set search_path = public stable as $$
  select e.event_type, count(*)::bigint, coalesce(sum(e.value), 0)
  from public.discovery_events e
  where e.post_id = p_post
    and e.agency_id in (select public.crm_member_agencies())
    and e.created_at >= p_from and e.created_at < p_to
  group by e.event_type
$$;
