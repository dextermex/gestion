-- ===========================================================================
-- MORADA GESTION — Phase 1 foundation
-- One backbone, two layers: workspaces/memberships/permissions are the
-- existing spine (agencies + crm_members + crm_has_perm); this migration adds
-- the property-management domain (g_*), the universal timeline, and a generic
-- audit log. All money is integer cents; rent-period status is DERIVED from
-- allocations + due date, never hand-edited.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. WORKSPACES GENERALIZED
--    agencies = ecosystem workspaces. kind distinguishes a marketplace agency
--    from a Gestion org (single owner / professional manager); is_public
--    finally separates "listed in the public directory" from "is a workspace".
-- ---------------------------------------------------------------------------
alter table public.agencies
  add column if not exists kind text not null default 'agency'
    check (kind in ('agency', 'owner', 'manager')),
  add column if not exists is_public boolean not null default true;

-- Gestion-only roles join the member/invite role sets.
alter table public.crm_members drop constraint if exists crm_members_role_check;
alter table public.crm_members add constraint crm_members_role_check
  check (role in ('owner','admin','agent','marketing','assistant','viewer',
                  'manager','accountant','maintenance'));
alter table public.crm_invites drop constraint if exists crm_invites_role_check;
alter table public.crm_invites add constraint crm_invites_role_check
  check (role in ('admin','agent','marketing','assistant','viewer',
                  'manager','accountant','maintenance'));

-- Role defaults: existing CRM keys unchanged; gestion.* keys added.
create or replace function public.crm_role_defaults(p_role text)
returns jsonb
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$
  select case p_role
    when 'admin' then '{
      "properties.create":true,"properties.edit_own":true,"properties.edit_all":true,"properties.delete":true,"properties.publish":true,
      "discovery.publish":true,"discovery.edit_own":true,"discovery.edit_all":true,"discovery.delete":true,
      "leads.view_own":true,"leads.view_all":true,"leads.respond":true,
      "messages.view":true,"messages.respond":true,"messages.view_all":true,
      "visits.create":true,"visits.edit":true,"visits.delete":true,
      "offers.view":true,"offers.edit":true,
      "stats.view":true,"stats.export":true,
      "team.invite":true,"team.remove":true,
      "settings.edit":true,
      "gestion.properties.view":true,"gestion.properties.edit":true,"gestion.properties.delete":true,
      "gestion.tenants.view":true,"gestion.tenants.edit":true,
      "gestion.leases.view":true,"gestion.leases.edit":true,
      "gestion.finance.view":true,"gestion.finance.edit":true,
      "gestion.documents.view":true,"gestion.documents.edit":true,
      "gestion.settings.edit":true}'::jsonb
    when 'agent' then '{
      "properties.create":true,"properties.edit_own":true,"properties.publish":true,
      "discovery.publish":true,"discovery.edit_own":true,
      "leads.view_own":true,"leads.respond":true,
      "messages.view":true,"messages.respond":true,
      "visits.create":true,"visits.edit":true,
      "offers.view":true}'::jsonb
    when 'marketing' then '{
      "discovery.publish":true,"discovery.edit_own":true,"discovery.edit_all":true,
      "messages.view":true,"stats.view":true}'::jsonb
    when 'assistant' then '{
      "leads.view_own":true,"messages.view":true,"messages.respond":true,
      "visits.create":true,"visits.edit":true,"offers.view":true}'::jsonb
    when 'manager' then '{
      "messages.view":true,"messages.respond":true,
      "gestion.properties.view":true,"gestion.properties.edit":true,
      "gestion.tenants.view":true,"gestion.tenants.edit":true,
      "gestion.leases.view":true,"gestion.leases.edit":true,
      "gestion.finance.view":true,"gestion.finance.edit":true,
      "gestion.documents.view":true,"gestion.documents.edit":true}'::jsonb
    when 'accountant' then '{
      "gestion.properties.view":true,
      "gestion.tenants.view":true,
      "gestion.leases.view":true,
      "gestion.finance.view":true,"gestion.finance.edit":true,
      "gestion.documents.view":true,"gestion.documents.edit":true}'::jsonb
    when 'maintenance' then '{
      "gestion.properties.view":true,
      "gestion.tenants.view":true,
      "gestion.documents.view":true}'::jsonb
    when 'viewer' then '{
      "gestion.properties.view":true,
      "gestion.tenants.view":true,
      "gestion.leases.view":true,
      "gestion.finance.view":true,
      "gestion.documents.view":true}'::jsonb
    else '{}'::jsonb
  end;
$$;

-- Invite/join role whitelists follow the extended set.
create or replace function public.crm_invite_member(p_agency uuid, p_email text, p_role text)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_token uuid;
begin
  if not (public.crm_has_role(p_agency, array['owner', 'admin'])
          or public.crm_has_perm(p_agency, 'team.invite')) then
    raise exception 'You are not allowed to invite members';
  end if;
  if p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Invalid email address';
  end if;
  if p_role not in ('admin','agent','marketing','assistant','viewer',
                    'manager','accountant','maintenance') then
    raise exception 'Invalid role';
  end if;
  if exists (
    select 1 from public.crm_members m
    join auth.users u on u.id = m.user_id
    where m.agency_id = p_agency and lower(u.email) = lower(trim(p_email))
  ) then
    raise exception 'This person is already a member of the agency';
  end if;

  select token into v_token
  from public.crm_invites
  where agency_id = p_agency
    and lower(email) = lower(trim(p_email))
    and accepted_at is null
  order by created_at desc
  limit 1;

  if v_token is not null then
    update public.crm_invites
       set role = p_role, expires_at = now() + interval '14 days', invited_by = auth.uid()
     where token = v_token;
    return v_token;
  end if;

  insert into public.crm_invites (agency_id, email, role, invited_by)
  values (p_agency, lower(trim(p_email)), p_role, auth.uid())
  returning token into v_token;
  return v_token;
end;
$$;

create or replace function public.crm_decide_join(p_request uuid, p_accept boolean, p_role text default 'agent')
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  r record;
  v_agency_name text;
begin
  select * into r from public.crm_join_requests
  where id = p_request and status = 'pending'
  for update;
  if r is null then raise exception 'Request not found or already decided'; end if;
  if not (crm_has_role(r.agency_id, array['owner']) or crm_has_perm(r.agency_id, 'team.invite')) then
    raise exception 'Not allowed to decide join requests';
  end if;

  if p_accept then
    if p_role not in ('admin','agent','marketing','assistant','viewer',
                      'manager','accountant','maintenance') then
      raise exception 'Invalid role';
    end if;
    insert into public.crm_members (user_id, agency_id, role, display_name, email, status, phone)
    values (r.user_id, r.agency_id, p_role, r.name, r.email, 'active', r.phone)
    on conflict do nothing;
  end if;

  update public.crm_join_requests
     set status = case when p_accept then 'accepted' else 'declined' end,
         decided_by = auth.uid(), decided_at = now()
   where id = p_request;

  select name into v_agency_name from public.agencies where id = r.agency_id;
  insert into public.customer_notifications (user_id, kind, title, body, link)
  values (
    r.user_id, 'team',
    case when p_accept
      then 'Your request to join ' || coalesce(v_agency_name, 'the agency') || ' was accepted'
      else 'Your request to join ' || coalesce(v_agency_name, 'the agency') || ' was declined'
    end,
    case when p_accept then 'Open Morada Pro to get started.' else '' end,
    case when p_accept then '/pro' else '/pro/onboarding' end
  );
end;
$$;

-- Create a Gestion organization (private workspace, kind owner|manager).
create or replace function public.gestion_onboard(p_name text, p_kind text)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_org   uuid;
  v_slug  text;
  v_email text;
  v_first text;
  v_last  text;
  v_name  text;
begin
  if auth.uid() is null then raise exception 'Connectez-vous d''abord.'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Le nom de l''organisation est requis.'; end if;
  if p_kind not in ('owner', 'manager') then raise exception 'Type d''organisation invalide.'; end if;

  select email into v_email from auth.users where id = auth.uid();
  select first_name, last_name into v_first, v_last from public.profiles where id = auth.uid();
  v_name := coalesce(
    nullif(btrim(coalesce(v_first, '') || ' ' || coalesce(v_last, '')), ''),
    split_part(coalesce(v_email, 'membre'), '@', 1)
  );

  v_slug := trim(both '-' from regexp_replace(lower(trim(p_name)), '[^a-z0-9]+', '-', 'g'));
  if v_slug = '' then v_slug := 'gestion'; end if;
  if exists (select 1 from public.agencies where slug = v_slug) then
    v_slug := v_slug || '-' || substr(gen_random_uuid()::text, 1, 6);
  end if;

  insert into public.agencies (slug, name, email, kind, is_public)
  values (v_slug, trim(p_name), v_email, p_kind, false)
  returning id into v_org;

  insert into public.crm_members (user_id, agency_id, role, display_name, email)
  values (auth.uid(), v_org, 'owner', v_name, coalesce(v_email, ''));

  return v_org;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. PERMISSION HELPER — one predicate for every g_* policy.
-- ---------------------------------------------------------------------------
create or replace function public.g_can(p_org uuid, p_perm text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select p_org in (select public.crm_member_agencies())
     and (public.crm_has_role(p_org, array['owner','admin'])
          or public.crm_has_perm(p_org, p_perm));
$$;

-- ---------------------------------------------------------------------------
-- 3. DOMAIN TABLES
-- ---------------------------------------------------------------------------
create table if not exists public.g_owners (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  kind text not null default 'individual' check (kind in ('individual','company')),
  name text not null,
  email text,
  phone text,
  iban text,
  notes text not null default '',
  details jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists g_owners_org_idx on public.g_owners(org_id);

create table if not exists public.g_properties (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  owner_id uuid references public.g_owners(id) on delete set null,
  name text not null,
  address text not null default '',
  commune text not null default '',
  property_type text not null default 'apartment',
  year_built int,
  surface_m2 numeric,
  acquisition_value_cents bigint,
  current_value_cents bigint,
  energy jsonb not null default '{}',
  details jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists g_properties_org_idx on public.g_properties(org_id);

create table if not exists public.g_units (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  property_id uuid not null references public.g_properties(id) on delete cascade,
  label text not null,
  kind text not null default 'unit' check (kind in ('unit','parking','cellar','other')),
  surface_m2 numeric,
  rooms numeric,
  floor text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists g_units_property_idx on public.g_units(property_id);
create index if not exists g_units_org_idx on public.g_units(org_id);

create table if not exists public.g_tenants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  name text not null,
  email text,
  phone text,
  notes text not null default '',
  details jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists g_tenants_org_idx on public.g_tenants(org_id);

create table if not exists public.g_leases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  unit_id uuid not null references public.g_units(id) on delete restrict,
  status text not null default 'active' check (status in ('draft','active','notice','ended')),
  start_date date not null,
  end_date date,
  notice_months int,
  rent_cents integer not null check (rent_cents >= 0),
  charges_cents integer not null default 0 check (charges_cents >= 0),
  deposit_cents integer not null default 0 check (deposit_cents >= 0),
  deposit_status text not null default 'none'
    check (deposit_status in ('none','held','partially_returned','returned')),
  payment_day int not null default 1 check (payment_day between 1 and 28),
  -- Luxembourg-specific rules (indexation…) live in explicit configuration,
  -- never hardcoded in the engine.
  indexation jsonb not null default '{}',
  details jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or end_date > start_date)
);
create index if not exists g_leases_org_idx on public.g_leases(org_id);
create index if not exists g_leases_unit_idx on public.g_leases(unit_id);

create table if not exists public.g_lease_parties (
  id uuid primary key default gen_random_uuid(),
  lease_id uuid not null references public.g_leases(id) on delete cascade,
  tenant_id uuid not null references public.g_tenants(id) on delete cascade,
  role text not null default 'tenant' check (role in ('tenant','occupant','guarantor')),
  unique (lease_id, tenant_id, role)
);
create index if not exists g_lease_parties_tenant_idx on public.g_lease_parties(tenant_id);

create table if not exists public.g_rent_periods (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  lease_id uuid not null references public.g_leases(id) on delete cascade,
  period date not null,          -- first day of the month
  due_date date not null,
  rent_due_cents integer not null check (rent_due_cents >= 0),
  charges_due_cents integer not null default 0 check (charges_due_cents >= 0),
  other_due_cents integer not null default 0,
  allocated_cents integer not null default 0,
  written_off boolean not null default false,
  note text not null default '',
  created_at timestamptz not null default now(),
  unique (lease_id, period)
);
create index if not exists g_rent_periods_org_due_idx on public.g_rent_periods(org_id, due_date);

create table if not exists public.g_payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  lease_id uuid references public.g_leases(id) on delete set null,
  tenant_id uuid references public.g_tenants(id) on delete set null,
  amount_cents integer not null check (amount_cents > 0),
  received_at date not null default current_date,
  method text not null default 'transfer' check (method in ('transfer','cash','card','other')),
  reference text not null default '',
  note text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists g_payments_org_idx on public.g_payments(org_id, received_at desc);
create index if not exists g_payments_lease_idx on public.g_payments(lease_id);

create table if not exists public.g_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.g_payments(id) on delete cascade,
  rent_period_id uuid not null references public.g_rent_periods(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  unique (payment_id, rent_period_id)
);
create index if not exists g_payment_allocations_period_idx
  on public.g_payment_allocations(rent_period_id);

create table if not exists public.g_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  entity_type text not null default 'org'
    check (entity_type in ('org','property','unit','tenant','lease','owner','payment')),
  entity_id uuid,
  name text not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  tags text[] not null default '{}',
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists g_documents_org_idx on public.g_documents(org_id, created_at desc);
create index if not exists g_documents_entity_idx on public.g_documents(entity_type, entity_id);

-- Universal timeline — the UX signature: every entity's life in one stream.
create table if not exists public.g_activity (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  kind text not null,
  body text not null default '',
  meta jsonb not null default '{}',
  actor uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists g_activity_org_idx on public.g_activity(org_id, created_at desc);
create index if not exists g_activity_entity_idx
  on public.g_activity(entity_type, entity_id, created_at desc);

-- Generic ecosystem audit log (who did what, when, before/after).
-- org_id is intentionally NOT a foreign key: audit history must survive the
-- entities it describes (cascade deletes fire the audit triggers mid-cascade).
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  actor uuid,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_org_idx on public.audit_log(org_id, created_at desc);

-- Gestion tasks reuse crm_tasks, linkable to any gestion entity.
alter table public.crm_tasks
  add column if not exists entity_type text,
  add column if not exists entity_id uuid;

-- ---------------------------------------------------------------------------
-- 4. TRIGGERS — updated_at, derived allocations, audit, timeline.
-- ---------------------------------------------------------------------------
drop trigger if exists g_owners_touch on public.g_owners;
create trigger g_owners_touch before update on public.g_owners
  for each row execute function public.set_updated_at();
drop trigger if exists g_properties_touch on public.g_properties;
create trigger g_properties_touch before update on public.g_properties
  for each row execute function public.set_updated_at();
drop trigger if exists g_units_touch on public.g_units;
create trigger g_units_touch before update on public.g_units
  for each row execute function public.set_updated_at();
drop trigger if exists g_tenants_touch on public.g_tenants;
create trigger g_tenants_touch before update on public.g_tenants
  for each row execute function public.set_updated_at();
drop trigger if exists g_leases_touch on public.g_leases;
create trigger g_leases_touch before update on public.g_leases
  for each row execute function public.set_updated_at();

-- allocated_cents is maintained here and only here.
create or replace function public.g_alloc_sync()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if tg_op = 'INSERT' then
    update public.g_rent_periods
       set allocated_cents = allocated_cents + new.amount_cents
     where id = new.rent_period_id;
  elsif tg_op = 'DELETE' then
    update public.g_rent_periods
       set allocated_cents = greatest(0, allocated_cents - old.amount_cents)
     where id = old.rent_period_id;
  elsif tg_op = 'UPDATE' then
    update public.g_rent_periods
       set allocated_cents = greatest(0, allocated_cents - old.amount_cents)
     where id = old.rent_period_id;
    update public.g_rent_periods
       set allocated_cents = allocated_cents + new.amount_cents
     where id = new.rent_period_id;
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists g_alloc_sync_trg on public.g_payment_allocations;
create trigger g_alloc_sync_trg
  after insert or update or delete on public.g_payment_allocations
  for each row execute function public.g_alloc_sync();

-- Generic audit trigger for sensitive tables.
create or replace function public.g_audit()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  insert into public.audit_log (org_id, actor, action, entity_type, entity_id, before, after)
  values (
    coalesce(new.org_id, old.org_id),
    auth.uid(),
    tg_op,
    tg_table_name,
    coalesce(new.id, old.id),
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;
drop trigger if exists g_leases_audit on public.g_leases;
create trigger g_leases_audit after insert or update or delete on public.g_leases
  for each row execute function public.g_audit();
drop trigger if exists g_payments_audit on public.g_payments;
create trigger g_payments_audit after insert or update or delete on public.g_payments
  for each row execute function public.g_audit();
drop trigger if exists g_rent_periods_audit on public.g_rent_periods;
create trigger g_rent_periods_audit after update on public.g_rent_periods
  for each row execute function public.g_audit();
drop trigger if exists g_properties_audit on public.g_properties;
create trigger g_properties_audit after update or delete on public.g_properties
  for each row execute function public.g_audit();

-- Timeline writers (French bodies: the Gestion app speaks French first).
create or replace function public.g_track()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if tg_table_name = 'g_properties' then
    insert into public.g_activity (org_id, entity_type, entity_id, kind, body, actor)
    values (new.org_id, 'property', new.id, 'created', 'Bien ajouté au patrimoine', auth.uid());
  elsif tg_table_name = 'g_units' then
    insert into public.g_activity (org_id, entity_type, entity_id, kind, body, actor)
    values (new.org_id, 'unit', new.id, 'created', 'Unité créée : ' || new.label, auth.uid());
    insert into public.g_activity (org_id, entity_type, entity_id, kind, body, actor)
    values (new.org_id, 'property', new.property_id, 'unit_added', 'Unité ajoutée : ' || new.label, auth.uid());
  elsif tg_table_name = 'g_tenants' then
    insert into public.g_activity (org_id, entity_type, entity_id, kind, body, actor)
    values (new.org_id, 'tenant', new.id, 'created', 'Fiche locataire créée', auth.uid());
  elsif tg_table_name = 'g_leases' then
    insert into public.g_activity (org_id, entity_type, entity_id, kind, body, actor)
    values (new.org_id, 'lease', new.id, 'created',
            'Bail créé — loyer ' || (new.rent_cents / 100.0)::numeric(12,2) || ' €', auth.uid());
    insert into public.g_activity (org_id, entity_type, entity_id, kind, body, actor)
    values (new.org_id, 'unit', new.unit_id, 'lease_created', 'Nouveau bail sur cette unité', auth.uid());
  elsif tg_table_name = 'g_payments' then
    insert into public.g_activity (org_id, entity_type, entity_id, kind, body, actor)
    values (new.org_id, 'lease', coalesce(new.lease_id, new.id), 'payment',
            'Paiement enregistré — ' || (new.amount_cents / 100.0)::numeric(12,2) || ' €', auth.uid());
    if new.tenant_id is not null then
      insert into public.g_activity (org_id, entity_type, entity_id, kind, body, actor)
      values (new.org_id, 'tenant', new.tenant_id, 'payment',
              'Paiement reçu — ' || (new.amount_cents / 100.0)::numeric(12,2) || ' €', auth.uid());
    end if;
  elsif tg_table_name = 'g_documents' then
    insert into public.g_activity (org_id, entity_type, entity_id, kind, body, actor)
    values (new.org_id, new.entity_type, coalesce(new.entity_id, new.org_id), 'document',
            'Document ajouté : ' || new.name, auth.uid());
  end if;
  return new;
end;
$$;
drop trigger if exists g_properties_track on public.g_properties;
create trigger g_properties_track after insert on public.g_properties
  for each row execute function public.g_track();
drop trigger if exists g_units_track on public.g_units;
create trigger g_units_track after insert on public.g_units
  for each row execute function public.g_track();
drop trigger if exists g_tenants_track on public.g_tenants;
create trigger g_tenants_track after insert on public.g_tenants
  for each row execute function public.g_track();
drop trigger if exists g_leases_track on public.g_leases;
create trigger g_leases_track after insert on public.g_leases
  for each row execute function public.g_track();
drop trigger if exists g_payments_track on public.g_payments;
create trigger g_payments_track after insert on public.g_payments
  for each row execute function public.g_track();
drop trigger if exists g_documents_track on public.g_documents;
create trigger g_documents_track after insert on public.g_documents
  for each row execute function public.g_track();

-- ---------------------------------------------------------------------------
-- 5. BUSINESS RPCs — lease creation, schedule generation, payment recording.
-- ---------------------------------------------------------------------------
create or replace function public.g_generate_rent_periods(p_lease uuid, p_until date default null)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  l record;
  v_from date;
  v_until date;
  v_month date;
  v_count integer := 0;
begin
  select * into l from public.g_leases where id = p_lease;
  if l is null then raise exception 'Bail introuvable.'; end if;
  if not public.g_can(l.org_id, 'gestion.leases.edit') then
    raise exception 'Action non autorisée.';
  end if;

  v_from := date_trunc('month', l.start_date)::date;
  v_until := least(
    coalesce(l.end_date, 'infinity'::date),
    coalesce(p_until, (current_date + interval '12 months')::date)
  );

  v_month := v_from;
  while v_month <= v_until loop
    insert into public.g_rent_periods
      (org_id, lease_id, period, due_date, rent_due_cents, charges_due_cents)
    values (
      l.org_id, l.id, v_month,
      -- due day within the period month, capped at 28 by the lease constraint
      (v_month + (l.payment_day - 1))::date,
      l.rent_cents, l.charges_cents
    )
    on conflict (lease_id, period) do nothing;
    if found then v_count := v_count + 1; end if;
    v_month := (v_month + interval '1 month')::date;
  end loop;
  return v_count;
end;
$$;

create or replace function public.g_create_lease(
  p_org uuid,
  p_unit uuid,
  p_tenant uuid,
  p_start date,
  p_end date default null,
  p_rent_cents integer default 0,
  p_charges_cents integer default 0,
  p_deposit_cents integer default 0,
  p_payment_day integer default 1,
  p_guarantor uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
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
  if p_rent_cents < 0 or p_charges_cents < 0 or p_deposit_cents < 0 then
    raise exception 'Montant invalide.';
  end if;
  -- No two overlapping non-ended leases on one unit.
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
$$;

-- Record a payment. p_allocations: [{"rent_period_id": uuid, "amount_cents": n}]
-- or null → FIFO auto-allocation onto the lease's oldest open periods.
-- Any unallocated remainder stays visible on the payment (trop-perçu).
create or replace function public.g_record_payment(
  p_org uuid,
  p_lease uuid,
  p_amount_cents integer,
  p_received_at date default current_date,
  p_method text default 'transfer',
  p_reference text default '',
  p_note text default '',
  p_allocations jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_payment uuid;
  v_tenant uuid;
  v_remaining integer;
  a record;
  p record;
  v_alloc integer;
  v_sum integer := 0;
begin
  if not public.g_can(p_org, 'gestion.finance.edit') then
    raise exception 'Action non autorisée.';
  end if;
  if p_amount_cents <= 0 then raise exception 'Montant invalide.'; end if;
  if not exists (select 1 from public.g_leases where id = p_lease and org_id = p_org) then
    raise exception 'Bail introuvable dans cette organisation.';
  end if;

  select tenant_id into v_tenant
  from public.g_lease_parties
  where lease_id = p_lease and role = 'tenant'
  limit 1;

  insert into public.g_payments
    (org_id, lease_id, tenant_id, amount_cents, received_at, method, reference, note, created_by)
  values
    (p_org, p_lease, v_tenant, p_amount_cents, p_received_at,
     p_method, p_reference, p_note, auth.uid())
  returning id into v_payment;

  if p_allocations is not null then
    for a in select * from jsonb_to_recordset(p_allocations)
             as x(rent_period_id uuid, amount_cents integer)
    loop
      if a.amount_cents is null or a.amount_cents <= 0 then
        raise exception 'Allocation invalide.';
      end if;
      if not exists (
        select 1 from public.g_rent_periods
        where id = a.rent_period_id and lease_id = p_lease and org_id = p_org
      ) then
        raise exception 'Échéance introuvable pour ce bail.';
      end if;
      v_sum := v_sum + a.amount_cents;
      if v_sum > p_amount_cents then
        raise exception 'Le total alloué dépasse le montant du paiement.';
      end if;
      insert into public.g_payment_allocations (payment_id, rent_period_id, amount_cents)
      values (v_payment, a.rent_period_id, a.amount_cents);
    end loop;
  else
    -- FIFO: oldest open periods first.
    v_remaining := p_amount_cents;
    for p in
      select id, (rent_due_cents + charges_due_cents + other_due_cents - allocated_cents) as open_cents
      from public.g_rent_periods
      where lease_id = p_lease and written_off = false
        and (rent_due_cents + charges_due_cents + other_due_cents) > allocated_cents
      order by period
    loop
      exit when v_remaining <= 0;
      v_alloc := least(v_remaining, p.open_cents);
      insert into public.g_payment_allocations (payment_id, rent_period_id, amount_cents)
      values (v_payment, p.id, v_alloc);
      v_remaining := v_remaining - v_alloc;
    end loop;
  end if;

  return v_payment;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. RLS
-- ---------------------------------------------------------------------------
alter table public.g_owners enable row level security;
alter table public.g_properties enable row level security;
alter table public.g_units enable row level security;
alter table public.g_tenants enable row level security;
alter table public.g_leases enable row level security;
alter table public.g_lease_parties enable row level security;
alter table public.g_rent_periods enable row level security;
alter table public.g_payments enable row level security;
alter table public.g_payment_allocations enable row level security;
alter table public.g_documents enable row level security;
alter table public.g_activity enable row level security;
alter table public.audit_log enable row level security;

-- Patrimoine (owners live under the properties permission umbrella).
create policy g_owners_select on public.g_owners for select to authenticated
  using (g_can(org_id, 'gestion.properties.view'));
create policy g_owners_write on public.g_owners for insert to authenticated
  with check (g_can(org_id, 'gestion.properties.edit'));
create policy g_owners_update on public.g_owners for update to authenticated
  using (g_can(org_id, 'gestion.properties.edit'))
  with check (g_can(org_id, 'gestion.properties.edit'));
create policy g_owners_delete on public.g_owners for delete to authenticated
  using (g_can(org_id, 'gestion.properties.delete'));

create policy g_properties_select on public.g_properties for select to authenticated
  using (g_can(org_id, 'gestion.properties.view'));
create policy g_properties_insert on public.g_properties for insert to authenticated
  with check (g_can(org_id, 'gestion.properties.edit'));
create policy g_properties_update on public.g_properties for update to authenticated
  using (g_can(org_id, 'gestion.properties.edit'))
  with check (g_can(org_id, 'gestion.properties.edit'));
create policy g_properties_delete on public.g_properties for delete to authenticated
  using (g_can(org_id, 'gestion.properties.delete'));

create policy g_units_select on public.g_units for select to authenticated
  using (g_can(org_id, 'gestion.properties.view'));
create policy g_units_insert on public.g_units for insert to authenticated
  with check (g_can(org_id, 'gestion.properties.edit'));
create policy g_units_update on public.g_units for update to authenticated
  using (g_can(org_id, 'gestion.properties.edit'))
  with check (g_can(org_id, 'gestion.properties.edit'));
create policy g_units_delete on public.g_units for delete to authenticated
  using (g_can(org_id, 'gestion.properties.delete'));

create policy g_tenants_select on public.g_tenants for select to authenticated
  using (g_can(org_id, 'gestion.tenants.view'));
create policy g_tenants_insert on public.g_tenants for insert to authenticated
  with check (g_can(org_id, 'gestion.tenants.edit'));
create policy g_tenants_update on public.g_tenants for update to authenticated
  using (g_can(org_id, 'gestion.tenants.edit'))
  with check (g_can(org_id, 'gestion.tenants.edit'));
create policy g_tenants_delete on public.g_tenants for delete to authenticated
  using (g_can(org_id, 'gestion.tenants.edit'));

create policy g_leases_select on public.g_leases for select to authenticated
  using (g_can(org_id, 'gestion.leases.view'));
create policy g_leases_insert on public.g_leases for insert to authenticated
  with check (g_can(org_id, 'gestion.leases.edit'));
create policy g_leases_update on public.g_leases for update to authenticated
  using (g_can(org_id, 'gestion.leases.edit'))
  with check (g_can(org_id, 'gestion.leases.edit'));
create policy g_leases_delete on public.g_leases for delete to authenticated
  using (g_can(org_id, 'gestion.leases.edit') and status = 'draft');

create policy g_lease_parties_select on public.g_lease_parties for select to authenticated
  using (exists (select 1 from public.g_leases l
                 where l.id = lease_id and g_can(l.org_id, 'gestion.leases.view')));
create policy g_lease_parties_write on public.g_lease_parties for all to authenticated
  using (exists (select 1 from public.g_leases l
                 where l.id = lease_id and g_can(l.org_id, 'gestion.leases.edit')))
  with check (exists (select 1 from public.g_leases l
                      where l.id = lease_id and g_can(l.org_id, 'gestion.leases.edit')));

create policy g_rent_periods_select on public.g_rent_periods for select to authenticated
  using (g_can(org_id, 'gestion.finance.view'));
-- Periods are created/updated by SECURITY DEFINER functions; direct writes are
-- limited to finance editors and never touch derived allocated_cents honestly
-- (the allocation trigger owns it).
create policy g_rent_periods_update on public.g_rent_periods for update to authenticated
  using (g_can(org_id, 'gestion.finance.edit'))
  with check (g_can(org_id, 'gestion.finance.edit'));

create policy g_payments_select on public.g_payments for select to authenticated
  using (g_can(org_id, 'gestion.finance.view'));
create policy g_payments_delete on public.g_payments for delete to authenticated
  using (g_can(org_id, 'gestion.finance.edit'));

create policy g_payment_allocations_select on public.g_payment_allocations for select to authenticated
  using (exists (select 1 from public.g_payments p
                 where p.id = payment_id and g_can(p.org_id, 'gestion.finance.view')));
create policy g_payment_allocations_delete on public.g_payment_allocations for delete to authenticated
  using (exists (select 1 from public.g_payments p
                 where p.id = payment_id and g_can(p.org_id, 'gestion.finance.edit')));

create policy g_documents_select on public.g_documents for select to authenticated
  using (g_can(org_id, 'gestion.documents.view'));
create policy g_documents_insert on public.g_documents for insert to authenticated
  with check (g_can(org_id, 'gestion.documents.edit'));
create policy g_documents_delete on public.g_documents for delete to authenticated
  using (g_can(org_id, 'gestion.documents.edit'));

create policy g_activity_select on public.g_activity for select to authenticated
  using (org_id in (select public.crm_member_agencies()));

create policy audit_log_select on public.audit_log for select to authenticated
  using (crm_has_role(org_id, array['owner','admin']));
