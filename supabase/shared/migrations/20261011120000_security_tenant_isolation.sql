-- Security audit 11 October 2026: tenant isolation and hardening.
--
-- Root cause of the main findings: linking rows (lease_parties, property_ownership,
-- tickets, messages, documents, storage paths, legacy g_lease_parties) are written
-- under a policy that checks only the org of the NEW row, while their foreign keys
-- point at a single column. A user who owns any org could therefore link their own
-- contact to another org's lease or property and pass the portal helpers, or write
-- a tenant-side row into another org. The fix binds every portal decision to the
-- org that owns the lease or property, at the last trusted decision point (the
-- SECURITY DEFINER helpers the policies call), and binds tenant-side inserts to the
-- lease's org. Legitimate rows always satisfy these conditions (a landlord links its
-- own contacts to its own leases), which the audit confirmed by counting mismatches.
--
-- Applied to production on 11 October 2026: sections 1 and 2 as migration
-- security_tenant_isolation_a; sections 3 to 7 the same day, statement by statement
-- (the deployed text is this file's, with ALTER POLICY in place of the drop and
-- create of "public read agencies").

-- ---------------------------------------------------------------------------
-- 1. Portal helpers: the link and the contact must belong to the lease's or
--    property's own org.
-- ---------------------------------------------------------------------------

create or replace function gestion.portal_tenant_lease(p_lease uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select exists (
    select 1
      from gestion.leases l
      join gestion.lease_parties lp on lp.lease_id = l.id and lp.org_id = l.org_id
      join gestion.contacts c on c.id = lp.contact_id and c.org_id = l.org_id
     where l.id = p_lease
       and lp.role in ('tenant', 'colocataire')
       and c.user_id = auth.uid()
  );
$function$;

create or replace function gestion.portal_owner_property(p_property uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select exists (
    select 1
      from gestion.properties p
      join gestion.property_ownership po on po.property_id = p.id and po.org_id = p.org_id
      join gestion.contacts c on c.id = po.contact_id and c.org_id = p.org_id
     where p.id = p_property
       and c.user_id = auth.uid()
       and (po.to_date is null or po.to_date >= current_date)
    union all
    select 1
      from gestion.properties p
      join gestion.property_ownership po on po.property_id = p.id and po.org_id = p.org_id
      join gestion.vehicle_members vm on vm.vehicle_id = po.vehicle_id
      join gestion.contacts c on c.id = vm.contact_id and c.org_id = p.org_id
     where p.id = p_property
       and c.user_id = auth.uid()
       and (po.to_date is null or po.to_date >= current_date)
       and (vm.to_date is null or vm.to_date >= current_date)
  );
$function$;

-- The org that owns a lease, for policies (definer: readable whatever the caller's rights).
create or replace function gestion.lease_org(p_lease uuid)
 returns uuid
 language sql
 stable security definer
 set search_path to ''
as $function$
  select org_id from gestion.leases where id = p_lease;
$function$;
revoke all on function gestion.lease_org(uuid) from public, anon;
grant execute on function gestion.lease_org(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Tenant-side inserts land only in the org that owns the lease.
-- ---------------------------------------------------------------------------

alter policy tickets_portal_insert on gestion.tickets
  with check (lease_id is not null and source = 'tenant'
              and org_id = gestion.lease_org(lease_id)
              and gestion.portal_tenant_live_lease(lease_id));

alter policy conversations_portal_insert on gestion.conversations
  with check (scope_type = 'lease' and scope_id is not null
              and org_id = gestion.lease_org(scope_id)
              and gestion.portal_tenant_lease(scope_id));

alter policy messages_portal_insert on gestion.messages
  with check (sender_kind = 'tenant' and sender_user_id = auth.uid()
              and (ticket_id is null or gestion.portal_tenant_ticket(ticket_id))
              and exists (
                select 1 from gestion.conversations cv
                 where cv.id = messages.conversation_id
                   and cv.org_id = messages.org_id
                   and ((cv.scope_type = 'lease' and cv.scope_id is not null and gestion.portal_tenant_lease(cv.scope_id))
                     or (cv.scope_type = 'ticket' and cv.scope_id is not null and gestion.portal_tenant_ticket(cv.scope_id)))));

alter policy documents_portal_insert on gestion.documents
  with check (related_type = 'ticket' and related_id is not null and class = 'photo' and uploaded_by = auth.uid()
              and exists (
                select 1 from gestion.tickets t
                 where t.id = documents.related_id
                   and t.org_id = documents.org_id
                   and t.lease_id is not null
                   and gestion.portal_tenant_live_lease(t.lease_id)));

alter policy gestion_media_portal_insert on storage.objects
  with check (bucket_id = 'gestion-media'
              and (storage.foldername(name))[2] = 'tickets'
              and gestion.media_org(name) = gestion.lease_org(gestion.media_segment(name, 3))
              and gestion.portal_tenant_live_lease(gestion.media_segment(name, 3)));

-- ---------------------------------------------------------------------------
-- 3. Private organisations are not listed to everyone. Marketplace agencies
--    (is_public, the default) stay public; members still read their own.
-- ---------------------------------------------------------------------------

drop policy if exists "public read agencies" on public.agencies;
create policy "public read agencies" on public.agencies
  for select to anon
  using (is_public);
drop policy if exists "member read agencies" on public.agencies;
create policy "member read agencies" on public.agencies
  for select to authenticated
  using (is_public or id in (select public.crm_member_agencies()));

-- ---------------------------------------------------------------------------
-- 4. The parties of a customer conversation cannot be changed after creation.
-- ---------------------------------------------------------------------------

create or replace function public.customer_conversations_pin()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
begin
  -- Clearing a party stays possible: agency_id is ON DELETE SET NULL.
  if (new.user_id is not null and new.user_id is distinct from old.user_id)
     or (new.agency_id is not null and new.agency_id is distinct from old.agency_id) then
    raise exception 'conversation parties are immutable';
  end if;
  return new;
end
$function$;
revoke all on function public.customer_conversations_pin() from public, anon, authenticated;
drop trigger if exists customer_conversations_pin on public.customer_conversations;
create trigger customer_conversations_pin before update on public.customer_conversations
  for each row execute function public.customer_conversations_pin();

-- ---------------------------------------------------------------------------
-- 5. Legacy g_* tables: a guarantor must belong to the lease's org, and the
--    owner portal only sees tenants of its own org's leases.
-- ---------------------------------------------------------------------------

create or replace function public.g_portal_owner_tenant(p_tenant uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1
    from public.g_lease_parties lp
    join public.g_leases l on l.id = lp.lease_id
    join public.g_tenants t on t.id = lp.tenant_id and t.org_id = l.org_id
    join public.g_units u on u.id = l.unit_id and u.org_id = l.org_id
    join public.g_properties p on p.id = u.property_id
    join public.g_owners o on o.id = p.owner_id
    where lp.tenant_id = p_tenant and o.user_id = auth.uid()
  );
$function$;

alter policy g_lease_parties_write on public.g_lease_parties
  using (exists (select 1 from public.g_leases l join public.g_tenants t on t.id = g_lease_parties.tenant_id and t.org_id = l.org_id
                  where l.id = g_lease_parties.lease_id and public.g_can(l.org_id, 'gestion.leases.edit')))
  with check (exists (select 1 from public.g_leases l join public.g_tenants t on t.id = g_lease_parties.tenant_id and t.org_id = l.org_id
                       where l.id = g_lease_parties.lease_id and public.g_can(l.org_id, 'gestion.leases.edit')));

-- g_create_lease: the deployed body, plus the guarantor's org check.
create or replace function public.g_create_lease(p_org uuid, p_unit uuid, p_tenant uuid, p_start date, p_end date default null::date, p_rent_cents integer default 0, p_charges_cents integer default 0, p_deposit_cents integer default 0, p_payment_day integer default 1, p_guarantor uuid default null::uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_lease uuid;
begin
  if not public.g_can(p_org, 'gestion.leases.edit') then
    raise exception 'Action non autorisée.';
  end if;
  if not exists (select 1 from public.g_units where id = p_unit and org_id = p_org) then
    raise exception 'Unité introuvable dans cette organisation.';
  end if;
  if not exists (select 1 from public.g_tenants where id = p_tenant and org_id = p_org) then
    raise exception 'Locataire introuvable dans cette organisation.';
  end if;
  if p_guarantor is not null and not exists (select 1 from public.g_tenants where id = p_guarantor and org_id = p_org) then
    raise exception 'Garant introuvable dans cette organisation.';
  end if;
  if p_rent_cents < 0 or p_charges_cents < 0 or p_deposit_cents < 0 then
    raise exception 'Montant invalide.';
  end if;
  if exists (
    select 1 from public.g_leases
    where unit_id = p_unit and status in ('active','notice')
      and (end_date is null or end_date >= p_start)
      and (p_end is null or start_date <= p_end)
  ) then
    raise exception 'Un bail actif existe déjà sur cette unité pour cette période.';
  end if;

  insert into public.g_leases
    (org_id, unit_id, start_date, end_date, rent_cents, charges_cents,
     deposit_cents, deposit_status, payment_day, status)
  values
    (p_org, p_unit, p_start, p_end, p_rent_cents, p_charges_cents,
     p_deposit_cents, case when p_deposit_cents > 0 then 'held' else 'none' end,
     greatest(1, least(28, p_payment_day)), 'active')
  returning id into v_lease;

  insert into public.g_lease_parties (lease_id, tenant_id, role)
  values (v_lease, p_tenant, 'tenant');
  if p_guarantor is not null then
    insert into public.g_lease_parties (lease_id, tenant_id, role)
    values (v_lease, p_guarantor, 'guarantor')
    on conflict do nothing;
  end if;

  perform public.g_generate_rent_periods(v_lease);
  return v_lease;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Hardening around the notification engine.
-- ---------------------------------------------------------------------------

-- The pg_net queue holds the internal notify secret in request headers while a call
-- waits. Its tables are granted to PUBLIC by the platform (supabase_admin), which the
-- project's roles cannot revoke; schema net is not exposed through the Data API, so it
-- stays out of reach of anon and authenticated callers.

-- A person marks their own notifications read; the engine alone writes their content.
revoke update on gestion.notifications from authenticated;
grant update (read_at) on gestion.notifications to authenticated;

-- One malformed trial date in someone's metadata must not stop everyone's reminders.
create or replace function gestion.notify_trials()
 returns table(user_id uuid, lang text, trial_started_at timestamp with time zone, org_id uuid)
 language sql
 stable security definer
 set search_path to ''
as $function$
  select u.id,
         coalesce(p.preferred_language, 'fr'),
         (u.raw_user_meta_data -> 'morada_mobile' ->> 'trial_started_at')::timestamptz,
         (select m.agency_id from public.crm_members m where m.user_id = u.id and m.status = 'active' order by m.created_at limit 1)
    from auth.users u
    left join public.profiles p on p.id = u.id
   where pg_catalog.pg_input_is_valid(u.raw_user_meta_data -> 'morada_mobile' ->> 'trial_started_at', 'timestamptz');
$function$;

-- ---------------------------------------------------------------------------
-- 7. Linking rows cannot point at another org's records at all (which the
--    helpers above already ignore, but which could still block the deletion
--    of a contact through its ON DELETE RESTRICT key). Existing rows: none
--    mismatched, counted 11 October 2026.
-- ---------------------------------------------------------------------------

create or replace function gestion.guard_link_org()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if tg_table_name = 'lease_parties' then
    if not exists (select 1 from gestion.leases where id = new.lease_id and org_id = new.org_id)
       or not exists (select 1 from gestion.contacts where id = new.contact_id and org_id = new.org_id) then
      raise exception 'lease party outside the organisation' using errcode = '42501';
    end if;
  elsif tg_table_name = 'property_ownership' then
    if not exists (select 1 from gestion.properties where id = new.property_id and org_id = new.org_id)
       or (new.contact_id is not null and not exists (select 1 from gestion.contacts where id = new.contact_id and org_id = new.org_id))
       or (new.vehicle_id is not null and not exists (select 1 from gestion.ownership_vehicles where id = new.vehicle_id and org_id = new.org_id)) then
      raise exception 'ownership outside the organisation' using errcode = '42501';
    end if;
  elsif tg_table_name = 'vehicle_members' then
    if not exists (select 1 from gestion.ownership_vehicles v join gestion.contacts c on c.org_id = v.org_id
                    where v.id = new.vehicle_id and c.id = new.contact_id) then
      raise exception 'vehicle member outside the organisation' using errcode = '42501';
    end if;
  end if;
  return new;
end
$function$;
revoke all on function gestion.guard_link_org() from public, anon, authenticated;

drop trigger if exists guard_link_org on gestion.lease_parties;
create trigger guard_link_org before insert or update on gestion.lease_parties
  for each row execute function gestion.guard_link_org();
drop trigger if exists guard_link_org on gestion.property_ownership;
create trigger guard_link_org before insert or update on gestion.property_ownership
  for each row execute function gestion.guard_link_org();
drop trigger if exists guard_link_org on gestion.vehicle_members;
create trigger guard_link_org before insert or update on gestion.vehicle_members
  for each row execute function gestion.guard_link_org();
