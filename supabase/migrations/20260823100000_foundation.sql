-- ===========================================================================
-- MORADA GESTION (standalone) — 0001 FOUNDATION
--
-- Self-contained workspace spine for the separate Gestion Supabase project.
-- Mirrors the Morada ecosystem conventions (agencies + crm_members +
-- crm_has_perm) with the same permission keys, so a future consolidation
-- into the shared identity project is a rename, not a redesign.
--
-- Design rules (strategy §2.2):
--   • All money is integer cents. Paid-ness is DERIVED from allocations.
--   • Every legally significant artefact is hash-sealed and immutable.
--   • Append-only event log backs every timeline and audit need.
--   • Legal constants are DATA (legal_params) with effective-date ranges.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. ORGS & MEMBERSHIP
-- ---------------------------------------------------------------------------
create table if not exists public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'manager' check (kind in ('owner','manager','agency','syndic')),
  -- Regulatory perimeter: the SaaS customer needs the licence, not the vendor.
  autorisation_number text,
  autorisation_expiry date,
  pi_insurance_provider text,
  pi_insurance_expiry date,
  vat_number text,
  rcs_number text,
  address jsonb not null default '{}',
  default_locale text not null default 'fr' check (default_locale in ('fr','en','de','lu','pt')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.org_members (
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'viewer'
    check (role in ('owner','admin','manager','accountant','maintenance','viewer')),
  -- Per-member permission overrides on top of role defaults.
  perms jsonb not null default '{}',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index if not exists org_members_user_idx on public.org_members(user_id);

-- Role defaults mirror morada's crm_role_defaults gestion.* keys.
create or replace function public.g_role_defaults(p_role text)
returns jsonb language sql immutable
set search_path to 'public', 'pg_temp'
as $$
  select case p_role
    when 'admin' then '{
      "gestion.properties.view":true,"gestion.properties.edit":true,"gestion.properties.delete":true,
      "gestion.tenants.view":true,"gestion.tenants.edit":true,
      "gestion.leases.view":true,"gestion.leases.edit":true,
      "gestion.finance.view":true,"gestion.finance.edit":true,
      "gestion.maintenance.view":true,"gestion.maintenance.edit":true,
      "gestion.documents.view":true,"gestion.documents.edit":true,
      "gestion.compliance.view":true,"gestion.compliance.edit":true,
      "gestion.aml.view":true,"gestion.aml.edit":true,
      "gestion.settings.edit":true}'::jsonb
    when 'manager' then '{
      "gestion.properties.view":true,"gestion.properties.edit":true,
      "gestion.tenants.view":true,"gestion.tenants.edit":true,
      "gestion.leases.view":true,"gestion.leases.edit":true,
      "gestion.finance.view":true,"gestion.finance.edit":true,
      "gestion.maintenance.view":true,"gestion.maintenance.edit":true,
      "gestion.documents.view":true,"gestion.documents.edit":true,
      "gestion.compliance.view":true,"gestion.compliance.edit":true,
      "gestion.aml.view":true}'::jsonb
    when 'accountant' then '{
      "gestion.properties.view":true,"gestion.tenants.view":true,"gestion.leases.view":true,
      "gestion.finance.view":true,"gestion.finance.edit":true,
      "gestion.documents.view":true,"gestion.compliance.view":true}'::jsonb
    when 'maintenance' then '{
      "gestion.properties.view":true,"gestion.tenants.view":true,
      "gestion.maintenance.view":true,"gestion.maintenance.edit":true,
      "gestion.documents.view":true}'::jsonb
    when 'viewer' then '{
      "gestion.properties.view":true,"gestion.tenants.view":true,"gestion.leases.view":true,
      "gestion.finance.view":true,"gestion.maintenance.view":true,
      "gestion.documents.view":true,"gestion.compliance.view":true}'::jsonb
    else '{}'::jsonb
  end;
$$;

create or replace function public.g_member_orgs()
returns setof uuid language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select org_id from public.org_members where user_id = auth.uid();
$$;

-- The single RLS predicate behind every g_* policy. `owner` short-circuits;
-- everyone else resolves role defaults + per-member overrides.
create or replace function public.g_can(p_org uuid, p_perm text)
returns boolean language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = p_org
      and m.user_id = auth.uid()
      and (
        m.role = 'owner'
        or coalesce((m.perms ->> p_perm)::boolean,
                    (public.g_role_defaults(m.role) ->> p_perm)::boolean,
                    false)
      )
  );
$$;

alter table public.orgs enable row level security;
alter table public.org_members enable row level security;

create policy orgs_select on public.orgs for select to authenticated
  using (id in (select public.g_member_orgs()));
create policy orgs_update on public.orgs for update to authenticated
  using (public.g_can(id, 'gestion.settings.edit'))
  with check (public.g_can(id, 'gestion.settings.edit'));
create policy org_members_select on public.org_members for select to authenticated
  using (org_id in (select public.g_member_orgs()));

-- ---------------------------------------------------------------------------
-- 2. CONTACTS — one person/entity record, roles via join table (a person can
--    be owner of lot 3, tenant of lot 7 and guarantor of a third).
-- ---------------------------------------------------------------------------
create table if not exists public.g_contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  kind text not null default 'natural' check (kind in ('natural','legal')),
  first_name text,
  last_name text,
  legal_name text,
  display_name text generated always as (
    coalesce(nullif(trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')), ''), legal_name, '—')
  ) stored,
  email text,
  phone text,
  language text not null default 'fr' check (language in ('fr','en','de','lu','pt')),
  nationality text,
  address jsonb not null default '{}',
  iban text,
  -- VoP: account-holder name verbatim as registered at the bank.
  bank_holder_name text,
  vat_number text,
  rcs_number text,
  source text not null default 'manual' check (source in ('manual','import','portal','lead','email')),
  notes text,
  last_activity_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists g_contacts_org_idx on public.g_contacts(org_id);
create index if not exists g_contacts_last_activity_idx on public.g_contacts(last_activity_at);
-- Archive-scoped uniqueness: freeing the email on archive keeps the live set deduped.
create unique index if not exists g_contacts_email_active_key
  on public.g_contacts(org_id, email) where (archived_at is null and email is not null);

create table if not exists public.g_contact_roles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  contact_id uuid not null references public.g_contacts(id) on delete cascade,
  role text not null check (role in ('owner','tenant','guarantor','artisan','supplier','notary','syndic','lead','other')),
  started_on date,
  ended_on date,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists g_contact_roles_contact_idx on public.g_contact_roles(contact_id);
create index if not exists g_contact_roles_role_idx on public.g_contact_roles(org_id, role);

-- ---------------------------------------------------------------------------
-- 3. CUSTOM FIELDS — typed EAV (per-agency vocabulary), lifted from the
--    open-source CRM pattern: typed columns, option rows, display flags.
-- ---------------------------------------------------------------------------
create table if not exists public.g_field_definitions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  entity text not null check (entity in ('contact','property','unit','lease','ticket')),
  key text not null,
  label text not null,
  type text not null check (type in ('text','long_text','number','date','checkbox','select','url','email','phone')),
  required boolean not null default false,
  show_on_sheet boolean not null default true,
  show_on_table boolean not null default false,
  show_on_filter boolean not null default false,
  position int not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, entity, key)
);

create table if not exists public.g_field_options (
  id uuid primary key default gen_random_uuid(),
  field_id uuid not null references public.g_field_definitions(id) on delete cascade,
  label text not null,
  position int not null default 0,
  archived_at timestamptz
);
create index if not exists g_field_options_field_idx on public.g_field_options(field_id, position);

create table if not exists public.g_field_values (
  id uuid primary key default gen_random_uuid(),
  field_id uuid not null references public.g_field_definitions(id) on delete cascade,
  entity_id uuid not null,
  text_value text,
  number_value numeric(24,4),
  date_value date,
  bool_value boolean,
  option_id uuid references public.g_field_options(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (field_id, entity_id)
);
create index if not exists g_field_values_entity_idx on public.g_field_values(entity_id);

-- ---------------------------------------------------------------------------
-- 4. UNIVERSAL TIMELINE + EVENT OUTBOX + AUDIT
-- ---------------------------------------------------------------------------
-- One table for notes / calls / emails / meetings / tasks / system events;
-- nullable real FKs (never a stringly polymorphic pair); tasks carry dueAt,
-- completedAt AND an assignee (dispatching work is the core loop here).
create table if not exists public.g_activity (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  type text not null check (type in ('note','call','email','meeting','task','status_change','system')),
  subject text,
  body text,
  occurred_at timestamptz not null default now(),
  due_at timestamptz,
  completed_at timestamptz,
  contact_id uuid references public.g_contacts(id) on delete cascade,
  property_id uuid,
  unit_id uuid,
  lease_id uuid,
  ticket_id uuid,
  created_by uuid,
  assignee_id uuid,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists g_activity_org_created_idx on public.g_activity(org_id, created_at desc);
create index if not exists g_activity_contact_idx on public.g_activity(contact_id, created_at desc);
create index if not exists g_activity_lease_idx on public.g_activity(lease_id, created_at desc);
create index if not exists g_activity_due_idx on public.g_activity(due_at) where completed_at is null;

-- Transactional outbox: the event row commits with the domain write; workers
-- poll and fan out after commit. A row, not an HTTP call — it survives
-- the worker being down.
create table if not exists public.g_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  type text not null,
  record_kind text not null,
  record_id uuid not null,
  payload jsonb not null default '{}',
  occurred_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts int not null default 0
);
create index if not exists g_events_unprocessed_idx on public.g_events(occurred_at) where processed_at is null;

create table if not exists public.g_audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  actor uuid,
  verb text not null,
  object_type text not null,
  object_id uuid,
  before jsonb,
  after jsonb,
  at timestamptz not null default now()
);
create index if not exists g_audit_org_at_idx on public.g_audit_log(org_id, at desc);

-- ---------------------------------------------------------------------------
-- 5. SAVED VIEWS (URL filter state re-serialised, shared or private)
-- ---------------------------------------------------------------------------
create table if not exists public.g_saved_views (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  entity text not null,
  name text not null,
  shared boolean not null default false,
  filters jsonb not null default '{}',
  owner_user_id uuid not null,
  created_at timestamptz not null default now(),
  unique (org_id, entity, owner_user_id, name)
);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.g_contacts enable row level security;
alter table public.g_contact_roles enable row level security;
alter table public.g_field_definitions enable row level security;
alter table public.g_field_options enable row level security;
alter table public.g_field_values enable row level security;
alter table public.g_activity enable row level security;
alter table public.g_events enable row level security;
alter table public.g_audit_log enable row level security;
alter table public.g_saved_views enable row level security;

create policy g_contacts_select on public.g_contacts for select to authenticated
  using (public.g_can(org_id, 'gestion.tenants.view'));
create policy g_contacts_insert on public.g_contacts for insert to authenticated
  with check (public.g_can(org_id, 'gestion.tenants.edit'));
create policy g_contacts_update on public.g_contacts for update to authenticated
  using (public.g_can(org_id, 'gestion.tenants.edit'))
  with check (public.g_can(org_id, 'gestion.tenants.edit'));
create policy g_contacts_delete on public.g_contacts for delete to authenticated
  using (public.g_can(org_id, 'gestion.properties.delete'));

create policy g_contact_roles_select on public.g_contact_roles for select to authenticated
  using (public.g_can(org_id, 'gestion.tenants.view'));
create policy g_contact_roles_insert on public.g_contact_roles for insert to authenticated
  with check (public.g_can(org_id, 'gestion.tenants.edit'));
create policy g_contact_roles_update on public.g_contact_roles for update to authenticated
  using (public.g_can(org_id, 'gestion.tenants.edit'))
  with check (public.g_can(org_id, 'gestion.tenants.edit'));
create policy g_contact_roles_delete on public.g_contact_roles for delete to authenticated
  using (public.g_can(org_id, 'gestion.tenants.edit'));

create policy g_field_defs_all on public.g_field_definitions for all to authenticated
  using (public.g_can(org_id, 'gestion.settings.edit'))
  with check (public.g_can(org_id, 'gestion.settings.edit'));
create policy g_field_options_all on public.g_field_options for all to authenticated
  using (exists (select 1 from public.g_field_definitions d
                 where d.id = field_id and public.g_can(d.org_id, 'gestion.settings.edit')))
  with check (exists (select 1 from public.g_field_definitions d
                      where d.id = field_id and public.g_can(d.org_id, 'gestion.settings.edit')));
create policy g_field_values_select on public.g_field_values for select to authenticated
  using (exists (select 1 from public.g_field_definitions d
                 where d.id = field_id and public.g_can(d.org_id, 'gestion.tenants.view')));
create policy g_field_values_insert on public.g_field_values for insert to authenticated
  with check (exists (select 1 from public.g_field_definitions d
                      where d.id = field_id and public.g_can(d.org_id, 'gestion.tenants.edit')));
create policy g_field_values_update on public.g_field_values for update to authenticated
  using (exists (select 1 from public.g_field_definitions d
                 where d.id = field_id and public.g_can(d.org_id, 'gestion.tenants.edit')))
  with check (exists (select 1 from public.g_field_definitions d
                      where d.id = field_id and public.g_can(d.org_id, 'gestion.tenants.edit')));
create policy g_field_values_delete on public.g_field_values for delete to authenticated
  using (exists (select 1 from public.g_field_definitions d
                 where d.id = field_id and public.g_can(d.org_id, 'gestion.tenants.edit')));

create policy g_activity_select on public.g_activity for select to authenticated
  using (public.g_can(org_id, 'gestion.properties.view'));
create policy g_activity_insert on public.g_activity for insert to authenticated
  with check (public.g_can(org_id, 'gestion.properties.view'));
-- Any member may log activity; only editors (or the author) may modify it.
create policy g_activity_update on public.g_activity for update to authenticated
  using (created_by = auth.uid() or public.g_can(org_id, 'gestion.tenants.edit'))
  with check (created_by = auth.uid() or public.g_can(org_id, 'gestion.tenants.edit'));

create policy g_events_select on public.g_events for select to authenticated
  using (public.g_can(org_id, 'gestion.settings.edit'));

create policy g_audit_select on public.g_audit_log for select to authenticated
  using (public.g_can(org_id, 'gestion.settings.edit'));

create policy g_saved_views_select on public.g_saved_views for select to authenticated
  using (org_id in (select public.g_member_orgs()) and (shared or owner_user_id = auth.uid()));
create policy g_saved_views_write on public.g_saved_views for all to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid() and org_id in (select public.g_member_orgs()));
