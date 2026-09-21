-- ===========================================================================
-- MORADA GESTION — Phase 2: operations
-- Maintenance (work orders + vendors), supplier invoices, inspections
-- (états des lieux), and an honest transactional e-mail outbox.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. PERMISSIONS — maintenance keys join the same engine.
-- ---------------------------------------------------------------------------
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
      "gestion.maintenance.view":true,"gestion.maintenance.edit":true,
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
      "gestion.maintenance.view":true,"gestion.maintenance.edit":true,
      "gestion.documents.view":true,"gestion.documents.edit":true}'::jsonb
    when 'accountant' then '{
      "gestion.properties.view":true,
      "gestion.tenants.view":true,
      "gestion.leases.view":true,
      "gestion.finance.view":true,"gestion.finance.edit":true,
      "gestion.maintenance.view":true,
      "gestion.documents.view":true,"gestion.documents.edit":true}'::jsonb
    when 'maintenance' then '{
      "gestion.properties.view":true,
      "gestion.tenants.view":true,
      "gestion.maintenance.view":true,"gestion.maintenance.edit":true,
      "gestion.documents.view":true,"gestion.documents.edit":true}'::jsonb
    when 'viewer' then '{
      "gestion.properties.view":true,
      "gestion.tenants.view":true,
      "gestion.leases.view":true,
      "gestion.finance.view":true,
      "gestion.maintenance.view":true,
      "gestion.documents.view":true}'::jsonb
    else '{}'::jsonb
  end;
$$;

-- ---------------------------------------------------------------------------
-- 2. VENDORS
-- ---------------------------------------------------------------------------
create table if not exists public.g_vendors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  name text not null,
  specialty text not null default 'other',
  email text,
  phone text,
  address text not null default '',
  notes text not null default '',
  rating int check (rating between 1 and 5),
  details jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists g_vendors_org_idx on public.g_vendors(org_id);

-- ---------------------------------------------------------------------------
-- 3. WORK ORDERS — every problem becomes a numbered ticket with a workflow.
-- ---------------------------------------------------------------------------
create sequence if not exists public.g_wo_seq;

create table if not exists public.g_work_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  number text not null unique,
  property_id uuid references public.g_properties(id) on delete set null,
  unit_id uuid references public.g_units(id) on delete set null,
  lease_id uuid references public.g_leases(id) on delete set null,
  tenant_id uuid references public.g_tenants(id) on delete set null,
  vendor_id uuid references public.g_vendors(id) on delete set null,
  title text not null,
  description text not null default '',
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status text not null default 'new'
    check (status in ('new','quote','assigned','scheduled','in_progress','done','closed','cancelled')),
  scheduled_at timestamptz,
  estimate_cents integer check (estimate_cents >= 0),
  cost_cents integer check (cost_cents >= 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists g_work_orders_org_idx on public.g_work_orders(org_id, created_at desc);
create index if not exists g_work_orders_status_idx on public.g_work_orders(org_id, status);
create index if not exists g_work_orders_property_idx on public.g_work_orders(property_id);

create or replace function public.g_wo_number()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.number is null or new.number = '' then
    new.number := 'MG-' || to_char(now(), 'YYYY') || '-' ||
                  lpad(nextval('public.g_wo_seq')::text, 5, '0');
  end if;
  return new;
end;
$$;
drop trigger if exists g_wo_number_trg on public.g_work_orders;
create trigger g_wo_number_trg before insert on public.g_work_orders
  for each row execute function public.g_wo_number();

drop trigger if exists g_work_orders_touch on public.g_work_orders;
create trigger g_work_orders_touch before update on public.g_work_orders
  for each row execute function public.set_updated_at();
drop trigger if exists g_vendors_touch on public.g_vendors;
create trigger g_vendors_touch before update on public.g_vendors
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. INVOICES (supplier bills / expenses)
-- ---------------------------------------------------------------------------
create table if not exists public.g_invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  vendor_id uuid references public.g_vendors(id) on delete set null,
  property_id uuid references public.g_properties(id) on delete set null,
  unit_id uuid references public.g_units(id) on delete set null,
  work_order_id uuid references public.g_work_orders(id) on delete set null,
  number text not null default '',
  category text not null default 'other',
  invoice_date date not null default current_date,
  due_date date,
  amount_cents integer not null check (amount_cents > 0),
  vat_cents integer not null default 0 check (vat_cents >= 0),
  status text not null default 'received'
    check (status in ('received','approved','paid','rejected')),
  paid_at date,
  note text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists g_invoices_org_idx on public.g_invoices(org_id, invoice_date desc);
create index if not exists g_invoices_status_idx on public.g_invoices(org_id, status);
create index if not exists g_invoices_property_idx on public.g_invoices(property_id);

drop trigger if exists g_invoices_touch on public.g_invoices;
create trigger g_invoices_touch before update on public.g_invoices
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. INSPECTIONS (états des lieux)
-- ---------------------------------------------------------------------------
create table if not exists public.g_inspections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  unit_id uuid not null references public.g_units(id) on delete cascade,
  lease_id uuid references public.g_leases(id) on delete set null,
  kind text not null default 'move_in' check (kind in ('move_in','move_out','periodic')),
  status text not null default 'draft' check (status in ('draft','completed')),
  inspection_date date not null default current_date,
  notes text not null default '',
  completed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists g_inspections_org_idx on public.g_inspections(org_id, inspection_date desc);
create index if not exists g_inspections_unit_idx on public.g_inspections(unit_id);

create table if not exists public.g_inspection_items (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.g_inspections(id) on delete cascade,
  room text not null,
  element text not null,
  condition text not null default 'good' check (condition in ('good','fair','poor','damaged')),
  comment text not null default '',
  photos text[] not null default '{}',
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists g_inspection_items_idx on public.g_inspection_items(inspection_id, sort_order);

drop trigger if exists g_inspections_touch on public.g_inspections;
create trigger g_inspections_touch before update on public.g_inspections
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 6. E-MAIL OUTBOX — honest transactional mail: every message is a row with a
--    real status; nothing is ever "sent" unless a provider actually accepted it.
-- ---------------------------------------------------------------------------
create table if not exists public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  to_email text not null,
  subject text not null,
  body_text text not null,
  kind text not null default 'other',
  entity_type text,
  entity_id uuid,
  status text not null default 'queued'
    check (status in ('queued','sent','failed','not_configured')),
  error text,
  sent_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists email_outbox_org_idx on public.email_outbox(org_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 7. DOCUMENTS + TIMELINE grow the new entity types; members may add comments.
-- ---------------------------------------------------------------------------
alter table public.g_documents drop constraint if exists g_documents_entity_type_check;
alter table public.g_documents add constraint g_documents_entity_type_check
  check (entity_type in ('org','property','unit','tenant','lease','owner','payment',
                         'work_order','inspection','invoice','vendor'));

create policy g_activity_comment_insert on public.g_activity
  for insert to authenticated
  with check (kind = 'comment' and org_id in (select public.crm_member_agencies()));

-- Timeline writers for the new tables.
create or replace function public.g_track_ops()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_status_label text;
begin
  if tg_table_name = 'g_work_orders' then
    if tg_op = 'INSERT' then
      insert into public.g_activity (org_id, entity_type, entity_id, kind, body, actor)
      values (new.org_id, 'work_order', new.id, 'created',
              'Ticket ' || new.number || ' créé : ' || new.title, auth.uid());
      if new.property_id is not null then
        insert into public.g_activity (org_id, entity_type, entity_id, kind, body, actor)
        values (new.org_id, 'property', new.property_id, 'work_order',
                'Intervention ' || new.number || ' : ' || new.title, auth.uid());
      end if;
      if new.tenant_id is not null then
        insert into public.g_activity (org_id, entity_type, entity_id, kind, body, actor)
        values (new.org_id, 'tenant', new.tenant_id, 'work_order',
                'Demande ' || new.number || ' : ' || new.title, auth.uid());
      end if;
    elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
      v_status_label := case new.status
        when 'quote' then 'Devis demandé'
        when 'assigned' then 'Prestataire assigné'
        when 'scheduled' then 'Rendez-vous planifié'
        when 'in_progress' then 'Intervention en cours'
        when 'done' then 'Intervention terminée'
        when 'closed' then 'Ticket clôturé'
        when 'cancelled' then 'Ticket annulé'
        else 'Statut : ' || new.status end;
      insert into public.g_activity (org_id, entity_type, entity_id, kind, body, actor)
      values (new.org_id, 'work_order', new.id, 'status', v_status_label, auth.uid());
    end if;
  elsif tg_table_name = 'g_invoices' then
    if tg_op = 'INSERT' then
      insert into public.g_activity (org_id, entity_type, entity_id, kind, body, actor)
      values (new.org_id, 'invoice', new.id, 'created',
              'Facture enregistrée — ' || (new.amount_cents / 100.0)::numeric(12,2) || ' €', auth.uid());
      if new.property_id is not null then
        insert into public.g_activity (org_id, entity_type, entity_id, kind, body, actor)
        values (new.org_id, 'property', new.property_id, 'invoice',
                'Facture — ' || (new.amount_cents / 100.0)::numeric(12,2) || ' €'
                || case when new.category <> 'other' then ' (' || new.category || ')' else '' end,
                auth.uid());
      end if;
    elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
      insert into public.g_activity (org_id, entity_type, entity_id, kind, body, actor)
      values (new.org_id, 'invoice', new.id, 'status',
              case new.status
                when 'approved' then 'Facture approuvée'
                when 'paid' then 'Facture payée'
                when 'rejected' then 'Facture rejetée'
                else 'Statut : ' || new.status end,
              auth.uid());
    end if;
  elsif tg_table_name = 'g_inspections' then
    if tg_op = 'INSERT' then
      insert into public.g_activity (org_id, entity_type, entity_id, kind, body, actor)
      values (new.org_id, 'unit', new.unit_id, 'inspection',
              case new.kind when 'move_in' then 'État des lieux d''entrée créé'
                            when 'move_out' then 'État des lieux de sortie créé'
                            else 'Inspection créée' end,
              auth.uid());
    elsif tg_op = 'UPDATE' and new.status = 'completed' and old.status <> 'completed' then
      insert into public.g_activity (org_id, entity_type, entity_id, kind, body, actor)
      values (new.org_id, 'unit', new.unit_id, 'inspection',
              case new.kind when 'move_in' then 'État des lieux d''entrée finalisé'
                            when 'move_out' then 'État des lieux de sortie finalisé'
                            else 'Inspection finalisée' end,
              auth.uid());
    end if;
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists g_work_orders_track on public.g_work_orders;
create trigger g_work_orders_track after insert or update on public.g_work_orders
  for each row execute function public.g_track_ops();
drop trigger if exists g_invoices_track on public.g_invoices;
create trigger g_invoices_track after insert or update on public.g_invoices
  for each row execute function public.g_track_ops();
drop trigger if exists g_inspections_track on public.g_inspections;
create trigger g_inspections_track after insert or update on public.g_inspections
  for each row execute function public.g_track_ops();

-- Audit on the money-touching tables.
drop trigger if exists g_invoices_audit on public.g_invoices;
create trigger g_invoices_audit after insert or update or delete on public.g_invoices
  for each row execute function public.g_audit();
drop trigger if exists g_work_orders_audit on public.g_work_orders;
create trigger g_work_orders_audit after update or delete on public.g_work_orders
  for each row execute function public.g_audit();

-- ---------------------------------------------------------------------------
-- 8. RLS
-- ---------------------------------------------------------------------------
alter table public.g_vendors enable row level security;
alter table public.g_work_orders enable row level security;
alter table public.g_invoices enable row level security;
alter table public.g_inspections enable row level security;
alter table public.g_inspection_items enable row level security;
alter table public.email_outbox enable row level security;

create policy g_vendors_select on public.g_vendors for select to authenticated
  using (g_can(org_id, 'gestion.maintenance.view'));
create policy g_vendors_insert on public.g_vendors for insert to authenticated
  with check (g_can(org_id, 'gestion.maintenance.edit'));
create policy g_vendors_update on public.g_vendors for update to authenticated
  using (g_can(org_id, 'gestion.maintenance.edit'))
  with check (g_can(org_id, 'gestion.maintenance.edit'));
create policy g_vendors_delete on public.g_vendors for delete to authenticated
  using (g_can(org_id, 'gestion.maintenance.edit'));

create policy g_work_orders_select on public.g_work_orders for select to authenticated
  using (g_can(org_id, 'gestion.maintenance.view'));
create policy g_work_orders_insert on public.g_work_orders for insert to authenticated
  with check (g_can(org_id, 'gestion.maintenance.edit'));
create policy g_work_orders_update on public.g_work_orders for update to authenticated
  using (g_can(org_id, 'gestion.maintenance.edit'))
  with check (g_can(org_id, 'gestion.maintenance.edit'));
create policy g_work_orders_delete on public.g_work_orders for delete to authenticated
  using (g_can(org_id, 'gestion.maintenance.edit') and status in ('new','cancelled'));

create policy g_invoices_select on public.g_invoices for select to authenticated
  using (g_can(org_id, 'gestion.finance.view'));
create policy g_invoices_insert on public.g_invoices for insert to authenticated
  with check (g_can(org_id, 'gestion.finance.edit'));
create policy g_invoices_update on public.g_invoices for update to authenticated
  using (g_can(org_id, 'gestion.finance.edit'))
  with check (g_can(org_id, 'gestion.finance.edit'));
create policy g_invoices_delete on public.g_invoices for delete to authenticated
  using (g_can(org_id, 'gestion.finance.edit') and status = 'received');

create policy g_inspections_select on public.g_inspections for select to authenticated
  using (g_can(org_id, 'gestion.properties.view'));
create policy g_inspections_insert on public.g_inspections for insert to authenticated
  with check (g_can(org_id, 'gestion.properties.edit'));
create policy g_inspections_update on public.g_inspections for update to authenticated
  using (g_can(org_id, 'gestion.properties.edit'))
  with check (g_can(org_id, 'gestion.properties.edit'));
create policy g_inspections_delete on public.g_inspections for delete to authenticated
  using (g_can(org_id, 'gestion.properties.edit') and status = 'draft');

create policy g_inspection_items_select on public.g_inspection_items for select to authenticated
  using (exists (select 1 from public.g_inspections i
                 where i.id = inspection_id and g_can(i.org_id, 'gestion.properties.view')));
create policy g_inspection_items_write on public.g_inspection_items for all to authenticated
  using (exists (select 1 from public.g_inspections i
                 where i.id = inspection_id and g_can(i.org_id, 'gestion.properties.edit')
                   and i.status = 'draft'))
  with check (exists (select 1 from public.g_inspections i
                      where i.id = inspection_id and g_can(i.org_id, 'gestion.properties.edit')
                        and i.status = 'draft'));

create policy email_outbox_select on public.email_outbox for select to authenticated
  using (g_can(org_id, 'gestion.finance.view'));
create policy email_outbox_insert on public.email_outbox for insert to authenticated
  with check (g_can(org_id, 'gestion.finance.edit'));
create policy email_outbox_update on public.email_outbox for update to authenticated
  using (g_can(org_id, 'gestion.finance.edit'))
  with check (g_can(org_id, 'gestion.finance.edit'));
