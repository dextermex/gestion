-- ===========================================================================
-- MORADA GESTION — 0002 FONDATIONS
--
-- ADDITIF. Ne crée que des objets dans le schéma `gestion`.
-- Ne touche à aucune table, fonction ou policy de `public`.
-- Prérequis : 0001_gestion_spine.sql.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 2. CONTACTS — one person/entity record, roles via join table (a person can
--    be owner of lot 3, tenant of lot 7 and guarantor of a third).
-- ---------------------------------------------------------------------------
create table if not exists gestion.contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
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
create index if not exists contacts_org_idx on gestion.contacts(org_id);
create index if not exists contacts_last_activity_idx on gestion.contacts(last_activity_at);
-- Archive-scoped uniqueness: freeing the email on archive keeps the live set deduped.
create unique index if not exists contacts_email_active_key
  on gestion.contacts(org_id, email) where (archived_at is null and email is not null);

create table if not exists gestion.contact_roles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  contact_id uuid not null references gestion.contacts(id) on delete cascade,
  role text not null check (role in ('owner','tenant','guarantor','artisan','supplier','notary','syndic','lead','other')),
  started_on date,
  ended_on date,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists contact_roles_contact_idx on gestion.contact_roles(contact_id);
create index if not exists contact_roles_role_idx on gestion.contact_roles(org_id, role);

-- ---------------------------------------------------------------------------
-- 3. CUSTOM FIELDS — typed EAV (per-agency vocabulary), lifted from the
--    open-source CRM pattern: typed columns, option rows, display flags.
-- ---------------------------------------------------------------------------
create table if not exists gestion.field_definitions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
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

create table if not exists gestion.field_options (
  id uuid primary key default gen_random_uuid(),
  field_id uuid not null references gestion.field_definitions(id) on delete cascade,
  label text not null,
  position int not null default 0,
  archived_at timestamptz
);
create index if not exists field_options_field_idx on gestion.field_options(field_id, position);

create table if not exists gestion.field_values (
  id uuid primary key default gen_random_uuid(),
  field_id uuid not null references gestion.field_definitions(id) on delete cascade,
  entity_id uuid not null,
  text_value text,
  number_value numeric(24,4),
  date_value date,
  bool_value boolean,
  option_id uuid references gestion.field_options(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (field_id, entity_id)
);
create index if not exists field_values_entity_idx on gestion.field_values(entity_id);

-- ---------------------------------------------------------------------------
-- 4. UNIVERSAL TIMELINE + EVENT OUTBOX + AUDIT
-- ---------------------------------------------------------------------------
-- One table for notes / calls / emails / meetings / tasks / system events;
-- nullable real FKs (never a stringly polymorphic pair); tasks carry dueAt,
-- completedAt AND an assignee (dispatching work is the core loop here).
create table if not exists gestion.activity (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  type text not null check (type in ('note','call','email','meeting','task','status_change','system')),
  subject text,
  body text,
  occurred_at timestamptz not null default now(),
  due_at timestamptz,
  completed_at timestamptz,
  contact_id uuid references gestion.contacts(id) on delete cascade,
  property_id uuid,
  unit_id uuid,
  lease_id uuid,
  ticket_id uuid,
  created_by uuid,
  assignee_id uuid,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists activity_org_created_idx on gestion.activity(org_id, created_at desc);
create index if not exists activity_contact_idx on gestion.activity(contact_id, created_at desc);
create index if not exists activity_lease_idx on gestion.activity(lease_id, created_at desc);
create index if not exists activity_due_idx on gestion.activity(due_at) where completed_at is null;

-- Transactional outbox: the event row commits with the domain write; workers
-- poll and fan out after commit. A row, not an HTTP call — it survives
-- the worker being down.
create table if not exists gestion.events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  type text not null,
  record_kind text not null,
  record_id uuid not null,
  payload jsonb not null default '{}',
  occurred_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts int not null default 0
);
create index if not exists events_unprocessed_idx on gestion.events(occurred_at) where processed_at is null;

create table if not exists gestion.audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  actor uuid,
  verb text not null,
  object_type text not null,
  object_id uuid,
  before jsonb,
  after jsonb,
  at timestamptz not null default now()
);
create index if not exists audit_org_at_idx on gestion.audit_log(org_id, at desc);

-- ---------------------------------------------------------------------------
-- 5. SAVED VIEWS (URL filter state re-serialised, shared or private)
-- ---------------------------------------------------------------------------
create table if not exists gestion.saved_views (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
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
alter table gestion.contacts enable row level security;
alter table gestion.contact_roles enable row level security;
alter table gestion.field_definitions enable row level security;
alter table gestion.field_options enable row level security;
alter table gestion.field_values enable row level security;
alter table gestion.activity enable row level security;
alter table gestion.events enable row level security;
alter table gestion.audit_log enable row level security;
alter table gestion.saved_views enable row level security;

create policy contacts_select on gestion.contacts for select to authenticated
  using (gestion.can(org_id, 'gestion.tenants.view'));
create policy contacts_insert on gestion.contacts for insert to authenticated
  with check (gestion.can(org_id, 'gestion.tenants.edit'));
create policy contacts_update on gestion.contacts for update to authenticated
  using (gestion.can(org_id, 'gestion.tenants.edit'))
  with check (gestion.can(org_id, 'gestion.tenants.edit'));
create policy contacts_delete on gestion.contacts for delete to authenticated
  using (gestion.can(org_id, 'gestion.properties.delete'));

create policy contact_roles_select on gestion.contact_roles for select to authenticated
  using (gestion.can(org_id, 'gestion.tenants.view'));
create policy contact_roles_insert on gestion.contact_roles for insert to authenticated
  with check (gestion.can(org_id, 'gestion.tenants.edit'));
create policy contact_roles_update on gestion.contact_roles for update to authenticated
  using (gestion.can(org_id, 'gestion.tenants.edit'))
  with check (gestion.can(org_id, 'gestion.tenants.edit'));
create policy contact_roles_delete on gestion.contact_roles for delete to authenticated
  using (gestion.can(org_id, 'gestion.tenants.edit'));

create policy field_defs_all on gestion.field_definitions for all to authenticated
  using (gestion.can(org_id, 'gestion.settings.edit'))
  with check (gestion.can(org_id, 'gestion.settings.edit'));
create policy field_options_all on gestion.field_options for all to authenticated
  using (exists (select 1 from gestion.field_definitions d
                 where d.id = field_id and gestion.can(d.org_id, 'gestion.settings.edit')))
  with check (exists (select 1 from gestion.field_definitions d
                      where d.id = field_id and gestion.can(d.org_id, 'gestion.settings.edit')));
create policy field_values_select on gestion.field_values for select to authenticated
  using (exists (select 1 from gestion.field_definitions d
                 where d.id = field_id and gestion.can(d.org_id, 'gestion.tenants.view')));
create policy field_values_insert on gestion.field_values for insert to authenticated
  with check (exists (select 1 from gestion.field_definitions d
                      where d.id = field_id and gestion.can(d.org_id, 'gestion.tenants.edit')));
create policy field_values_update on gestion.field_values for update to authenticated
  using (exists (select 1 from gestion.field_definitions d
                 where d.id = field_id and gestion.can(d.org_id, 'gestion.tenants.edit')))
  with check (exists (select 1 from gestion.field_definitions d
                      where d.id = field_id and gestion.can(d.org_id, 'gestion.tenants.edit')));
create policy field_values_delete on gestion.field_values for delete to authenticated
  using (exists (select 1 from gestion.field_definitions d
                 where d.id = field_id and gestion.can(d.org_id, 'gestion.tenants.edit')));

create policy activity_select on gestion.activity for select to authenticated
  using (gestion.can(org_id, 'gestion.properties.view'));
create policy activity_insert on gestion.activity for insert to authenticated
  with check (gestion.can(org_id, 'gestion.properties.view'));
-- Any member may log activity; only editors (or the author) may modify it.
create policy activity_update on gestion.activity for update to authenticated
  using (created_by = auth.uid() or gestion.can(org_id, 'gestion.tenants.edit'))
  with check (created_by = auth.uid() or gestion.can(org_id, 'gestion.tenants.edit'));

create policy events_select on gestion.events for select to authenticated
  using (gestion.can(org_id, 'gestion.settings.edit'));

create policy audit_select on gestion.audit_log for select to authenticated
  using (gestion.can(org_id, 'gestion.settings.edit'));

create policy saved_views_select on gestion.saved_views for select to authenticated
  using (org_id in (select gestion.member_orgs()) and (shared or owner_user_id = auth.uid()));
create policy saved_views_write on gestion.saved_views for all to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid() and org_id in (select gestion.member_orgs()));
