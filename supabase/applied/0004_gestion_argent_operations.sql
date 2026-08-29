-- ===========================================================================
-- MORADA GESTION — 0004 ARGENT & OPERATIONS
--
-- ADDITIF. Ne crée que des objets dans le schéma `gestion`.
-- Ne touche à aucune table, fonction ou policy de `public`.
-- Prérequis : 0001_gestion_spine.sql.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- BANKING
-- ---------------------------------------------------------------------------
create table if not exists gestion.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  label text not null,
  iban text not null,
  bic text,
  -- VoP: the registered account-holder name, captured verbatim at onboarding.
  holder_name_verbatim text not null,
  kind text not null default 'operating'
    check (kind in ('operating','third_party_receiving','per_owner','syndicat')),
  -- Syndic client money: sums received for a syndicat go WITHOUT DELAY to an
  -- account in the syndicat's name (RGD 13.6.1975 art. 28) — never pooled.
  syndicat_name text,
  provider text not null default 'manual' check (provider in ('manual','camt','enable_banking','salt_edge')),
  provider_connection_id text,
  consent_expires_at timestamptz,
  created_at timestamptz not null default now(),
  check (kind <> 'syndicat' or syndicat_name is not null)
);
create index if not exists bank_accounts_org_idx on gestion.bank_accounts(org_id);

create table if not exists gestion.bank_imports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  bank_account_id uuid not null references gestion.bank_accounts(id) on delete cascade,
  source text not null check (source in ('camt053','csv','api')),
  file_name text,
  file_sha256 text,
  statement_from date,
  statement_to date,
  imported_at timestamptz not null default now(),
  tx_count int not null default 0
);

create table if not exists gestion.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  bank_account_id uuid not null references gestion.bank_accounts(id) on delete cascade,
  import_id uuid references gestion.bank_imports(id) on delete set null,
  booked_on date not null,
  value_date date,
  amount_cents integer not null,
  currency text not null default 'EUR',
  counterparty_name text not null default '',
  counterparty_iban text,
  remittance_info text not null default '',
  end_to_end_id text,
  bank_tx_id text,
  match_status text not null default 'unmatched'
    check (match_status in ('unmatched','auto','manual','review','ignored')),
  match_tier text check (match_tier in ('rf','iban_binding','subset_sum','fuzzy','manual')),
  match_confidence numeric(4,3),
  match_explain text,
  created_at timestamptz not null default now(),
  -- Stable dedupe across re-imports.
  unique (bank_account_id, bank_tx_id)
);
create index if not exists bank_tx_org_status_idx on gestion.bank_transactions(org_id, match_status);
create index if not exists bank_tx_booked_idx on gestion.bank_transactions(bank_account_id, booked_on desc);

-- Tier 2: learned payer-IBAN bindings — the tier that saves third-party
-- payers (parents, employers, housing subsidies). One keystroke in the
-- review queue converts a manual match into permanent automation.
create table if not exists gestion.iban_bindings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  payer_iban text not null,
  lease_id uuid not null references gestion.leases(id) on delete cascade,
  learned_from_tx_id uuid references gestion.bank_transactions(id) on delete set null,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (org_id, payer_iban, lease_id)
);

-- ---------------------------------------------------------------------------
-- PAYMENTS & ALLOCATIONS — paid-ness is a ledger derivation, never a boolean
-- ---------------------------------------------------------------------------
create table if not exists gestion.payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  lease_id uuid references gestion.leases(id) on delete set null,
  bank_transaction_id uuid references gestion.bank_transactions(id) on delete set null,
  received_on date not null,
  amount_cents integer not null check (amount_cents > 0),
  method text not null default 'transfer' check (method in ('transfer','cash','card','other')),
  note text,
  created_at timestamptz not null default now()
);
create index if not exists payments_lease_idx on gestion.payments(lease_id);

create table if not exists gestion.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  payment_id uuid not null references gestion.payments(id) on delete cascade,
  rent_period_id uuid not null references gestion.rent_periods(id) on delete restrict,
  amount_cents integer not null check (amount_cents > 0),
  allocated_at timestamptz not null default now(),
  allocated_by uuid,
  auto boolean not null default false,
  reversed_at timestamptz,
  reversed_by uuid
);
create index if not exists payment_allocations_period_idx on gestion.payment_allocations(rent_period_id);
create index if not exists payment_allocations_payment_idx on gestion.payment_allocations(payment_id);

-- Derived rent-period status (the only truth about paid-ness).
create or replace view gestion.rent_period_status as
select
  rp.id,
  rp.org_id,
  rp.lease_id,
  rp.period,
  rp.due_date,
  rp.total_cents,
  coalesce(sum(pa.amount_cents) filter (where pa.reversed_at is null), 0)::integer as allocated_cents,
  case
    when rp.written_off then 'written_off'
    when coalesce(sum(pa.amount_cents) filter (where pa.reversed_at is null), 0) >= rp.total_cents then 'paid'
    when coalesce(sum(pa.amount_cents) filter (where pa.reversed_at is null), 0) > 0
      then case when rp.due_date < current_date then 'partial_late' else 'partial' end
    when rp.due_date < current_date then 'late'
    when rp.period > current_date then 'upcoming'
    else 'pending'
  end as status
from gestion.rent_periods rp
left join gestion.payment_allocations pa on pa.rent_period_id = rp.id
group by rp.id;

-- ---------------------------------------------------------------------------
-- OWNER LEDGER & MANAGEMENT FEES
-- ---------------------------------------------------------------------------
create table if not exists gestion.mandates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  owner_contact_id uuid not null references gestion.contacts(id) on delete restrict,
  property_id uuid references gestion.properties(id) on delete cascade,
  fee_basis text not null default 'pct_of_rent' check (fee_basis in ('pct_of_rent','fixed_monthly')),
  fee_pct numeric(5,2),
  fee_fixed_cents integer,
  -- Owner approval threshold for works; emergencies may override up to limit.
  works_auto_approve_cents integer not null default 50000,
  emergency_override_cents integer not null default 150000,
  started_on date not null,
  ended_on date,
  created_at timestamptz not null default now()
);

create table if not exists gestion.owner_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  mandate_id uuid not null references gestion.mandates(id) on delete cascade,
  entry_on date not null,
  kind text not null check (kind in
    ('rent_collected','management_fee','expense','payout','deposit_movement','adjustment')),
  label text not null,
  amount_cents integer not null, -- signed: credit to owner positive
  vat_cents integer not null default 0,
  rent_period_id uuid references gestion.rent_periods(id) on delete set null,
  payment_id uuid references gestion.payments(id) on delete set null,
  -- Monthly décompte de gérance closes a period: entries become immutable.
  period_locked boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists owner_ledger_mandate_idx on gestion.owner_ledger_entries(mandate_id, entry_on desc);

-- Management fees are ALWAYS invoiced +17% VAT — the fee is taxable even
-- though residential letting is exempt.
create table if not exists gestion.management_fee_invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  mandate_id uuid not null references gestion.mandates(id) on delete cascade,
  period date not null,
  sequential_number text not null,
  net_cents integer not null,
  vat_rate_pct numeric(5,2) not null default 17,
  vat_cents integer not null,
  total_cents integer generated always as (net_cents + vat_cents) stored,
  issued_on date not null,
  document_id uuid,
  unique (org_id, sequential_number)
);

-- pain.001 payout files the manager uploads to their own e-banking, then
-- reconciled back from the outgoing statement — money never touches us.
create table if not exists gestion.payout_batches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  bank_account_id uuid not null references gestion.bank_accounts(id) on delete restrict,
  generated_at timestamptz not null default now(),
  pain001_document_id uuid,
  total_cents integer not null default 0,
  status text not null default 'generated'
    check (status in ('generated','uploaded_to_bank','reconciled'))
);

-- ---------------------------------------------------------------------------
-- ARREARS
-- ---------------------------------------------------------------------------
create table if not exists gestion.payment_plans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  lease_id uuid not null references gestion.leases(id) on delete cascade,
  agreed_on date not null,
  instalments jsonb not null default '[]',
  active boolean not null default true,
  broken_at timestamptz
);

create table if not exists gestion.arrears_actions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  lease_id uuid not null references gestion.leases(id) on delete cascade,
  rent_period_id uuid references gestion.rent_periods(id) on delete set null,
  stage text not null check (stage in ('friendly','formal','mise_en_demeure','justice_dossier')),
  executed_at timestamptz not null default now(),
  registered_letter_id uuid references gestion.registered_letters(id) on delete set null,
  confirmed_by uuid,
  dossier_document_id uuid
);
create index if not exists arrears_lease_idx on gestion.arrears_actions(lease_id);

-- ---------------------------------------------------------------------------
-- MAINTENANCE — artisan micro-portal is magic-link only, no account
-- ---------------------------------------------------------------------------
create table if not exists gestion.tickets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  unit_id uuid references gestion.units(id) on delete set null,
  property_id uuid references gestion.properties(id) on delete set null,
  lease_id uuid references gestion.leases(id) on delete set null,
  source text not null default 'manager' check (source in ('tenant','manager','edl_defect','owner')),
  category text not null default 'other' check (category in
    ('plumbing','electrics','heating','gas','appliances','locks_keys','damp_mould',
     'common_areas','exterior','administrative','other')),
  severity text not null default 'routine' check (severity in ('routine','priority','urgent','emergency')),
  status text not null default 'new' check (status in
    ('new','triaged','offered','scheduled','in_progress','pending_tenant','done','closed','cancelled')),
  title text not null,
  description text,
  sla_due_at timestamptz,
  pending_tenant_since timestamptz,
  closed_at timestamptz,
  satisfaction int check (satisfaction between 1 and 5),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tickets_org_status_idx on gestion.tickets(org_id, status);

create table if not exists gestion.work_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  ticket_id uuid not null references gestion.tickets(id) on delete cascade,
  artisan_contact_id uuid references gestion.contacts(id) on delete set null,
  magic_link_token text unique,
  magic_link_expires_at timestamptz,
  status text not null default 'offered' check (status in
    ('offered','declined','accepted','slots_proposed','scheduled','done','invoiced','paid')),
  proposed_slots jsonb not null default '[]',
  scheduled_at timestamptz,
  completion_photos jsonb not null default '[]',
  invoice_document_id uuid,
  amount_cents integer,
  vat_cents integer,
  -- Owner approval per mandate threshold; emergency override logged.
  owner_approval text not null default 'auto'
    check (owner_approval in ('auto','required','approved','rejected','emergency_override')),
  approved_by uuid,
  created_at timestamptz not null default now()
);

-- Recharge decision: legal hard blocks are non-overridable; vétusté grid
-- computes the tenant's residual share.
create table if not exists gestion.recharge_decisions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  work_order_id uuid references gestion.work_orders(id) on delete cascade,
  charge_category text not null,
  decision text not null check (decision in ('owner','tenant','split')),
  tenant_share_cents integer not null default 0,
  legal_block text,
  vetuste jsonb,
  rationale text not null
);

-- ---------------------------------------------------------------------------
-- SERVICE CHARGES / DÉCOMPTES
-- ---------------------------------------------------------------------------
create table if not exists gestion.charge_periods (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  lease_id uuid not null references gestion.leases(id) on delete cascade,
  year int not null,
  regime text not null check (regime in ('advances','forfait')),
  status text not null default 'open' check (status in ('open','draft','issued','disputed','settled')),
  advances_billed_cents integer not null default 0,
  actual_cents integer not null default 0,
  balance_cents integer generated always as (actual_cents - advances_billed_cents) stored,
  issued_on date,
  due_on date,
  unique (lease_id, year)
);

create table if not exists gestion.charge_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  charge_period_id uuid not null references gestion.charge_periods(id) on delete cascade,
  source text not null check (source in ('invoice','syndic_decompte','meter','estimate')),
  label text not null,
  category text not null,
  building_total_cents integer,
  tantiemes int,
  tantiemes_total int,
  lot_share_cents integer not null,
  tenant_share_cents integer not null,
  blocked boolean not null default false,
  block_reason text,
  provenance jsonb not null default '{}'
);

create table if not exists gestion.syndic_decomptes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  property_id uuid not null references gestion.properties(id) on delete cascade,
  year int not null,
  document_id uuid,
  ag_approved boolean not null default false,
  imported_at timestamptz not null default now(),
  lines jsonb not null default '[]'
);

-- ---------------------------------------------------------------------------
-- WORKFLOWS (the four state machines) & MESSAGING
-- ---------------------------------------------------------------------------
create table if not exists gestion.workflows (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  kind text not null check (kind in ('move_in','in_tenancy','rent_cycle','move_out')),
  unit_id uuid references gestion.units(id) on delete cascade,
  lease_id uuid references gestion.leases(id) on delete cascade,
  current_state text not null,
  state_history jsonb not null default '[]',
  blocked_reason text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists workflows_org_idx on gestion.workflows(org_id, kind);

create table if not exists gestion.conversations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  scope_type text not null check (scope_type in ('lease','ticket','mandate','contact','general')),
  scope_id uuid,
  subject text not null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz
);

create table if not exists gestion.messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  conversation_id uuid not null references gestion.conversations(id) on delete cascade,
  sender_kind text not null check (sender_kind in ('manager','tenant','owner','artisan','system')),
  sender_contact_id uuid references gestion.contacts(id) on delete set null,
  sender_user_id uuid,
  body text not null,
  lang text,
  translated jsonb,
  sent_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists messages_conversation_idx on gestion.messages(conversation_id, sent_at);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'bank_accounts','bank_imports','bank_transactions','iban_bindings',
    'payments','payment_allocations','mandates','owner_ledger_entries',
    'management_fee_invoices','payout_batches','payment_plans','arrears_actions',
    'tickets','work_orders','recharge_decisions','charge_periods','charge_lines',
    'syndic_decomptes','workflows','conversations','messages'
  ] loop
    execute format('alter table gestion.%I enable row level security', t);
  end loop;
end $$;

-- Finance family — per-command policies: SELECT needs the view permission,
-- every mutation (incl. DELETE, which has no WITH CHECK) needs edit.
do $$
declare t text;
begin
  foreach t in array array[
    'bank_accounts','bank_imports','bank_transactions','iban_bindings',
    'payments','payment_allocations','mandates','owner_ledger_entries',
    'management_fee_invoices','payout_batches','payment_plans','arrears_actions',
    'charge_periods','charge_lines','syndic_decomptes'
  ] loop
    execute format(
      'create policy %I_select on gestion.%I for select to authenticated
         using (gestion.can(org_id, ''gestion.finance.view''))', t, t);
    execute format(
      'create policy %I_insert on gestion.%I for insert to authenticated
         with check (gestion.can(org_id, ''gestion.finance.edit''))', t, t);
    execute format(
      'create policy %I_update on gestion.%I for update to authenticated
         using (gestion.can(org_id, ''gestion.finance.edit''))
         with check (gestion.can(org_id, ''gestion.finance.edit''))', t, t);
    execute format(
      'create policy %I_delete on gestion.%I for delete to authenticated
         using (gestion.can(org_id, ''gestion.finance.edit''))', t, t);
  end loop;
end $$;

-- Maintenance family
create policy tickets_select on gestion.tickets for select to authenticated
  using (gestion.can(org_id, 'gestion.maintenance.view'));
create policy tickets_insert on gestion.tickets for insert to authenticated
  with check (gestion.can(org_id, 'gestion.maintenance.edit'));
create policy tickets_update on gestion.tickets for update to authenticated
  using (gestion.can(org_id, 'gestion.maintenance.edit'))
  with check (gestion.can(org_id, 'gestion.maintenance.edit'));
create policy tickets_delete on gestion.tickets for delete to authenticated
  using (gestion.can(org_id, 'gestion.maintenance.edit'));
create policy work_orders_select on gestion.work_orders for select to authenticated
  using (gestion.can(org_id, 'gestion.maintenance.view'));
create policy work_orders_insert on gestion.work_orders for insert to authenticated
  with check (gestion.can(org_id, 'gestion.maintenance.edit'));
create policy work_orders_update on gestion.work_orders for update to authenticated
  using (gestion.can(org_id, 'gestion.maintenance.edit'))
  with check (gestion.can(org_id, 'gestion.maintenance.edit'));
create policy work_orders_delete on gestion.work_orders for delete to authenticated
  using (gestion.can(org_id, 'gestion.maintenance.edit'));
create policy recharge_decisions_select on gestion.recharge_decisions for select to authenticated
  using (gestion.can(org_id, 'gestion.finance.view'));
create policy recharge_decisions_insert on gestion.recharge_decisions for insert to authenticated
  with check (gestion.can(org_id, 'gestion.finance.edit'));
create policy recharge_decisions_update on gestion.recharge_decisions for update to authenticated
  using (gestion.can(org_id, 'gestion.finance.edit'))
  with check (gestion.can(org_id, 'gestion.finance.edit'));
create policy recharge_decisions_delete on gestion.recharge_decisions for delete to authenticated
  using (gestion.can(org_id, 'gestion.finance.edit'));

-- Workflows & messaging
create policy workflows_select on gestion.workflows for select to authenticated
  using (gestion.can(org_id, 'gestion.properties.view'));
create policy workflows_insert on gestion.workflows for insert to authenticated
  with check (gestion.can(org_id, 'gestion.properties.edit'));
create policy workflows_update on gestion.workflows for update to authenticated
  using (gestion.can(org_id, 'gestion.properties.edit'))
  with check (gestion.can(org_id, 'gestion.properties.edit'));
create policy workflows_delete on gestion.workflows for delete to authenticated
  using (gestion.can(org_id, 'gestion.properties.edit'));
create policy conversations_select on gestion.conversations for select to authenticated
  using (gestion.can(org_id, 'gestion.tenants.view'));
create policy conversations_insert on gestion.conversations for insert to authenticated
  with check (gestion.can(org_id, 'gestion.tenants.edit'));
create policy conversations_update on gestion.conversations for update to authenticated
  using (gestion.can(org_id, 'gestion.tenants.edit'))
  with check (gestion.can(org_id, 'gestion.tenants.edit'));
create policy conversations_delete on gestion.conversations for delete to authenticated
  using (gestion.can(org_id, 'gestion.tenants.edit'));
create policy messages_select on gestion.messages for select to authenticated
  using (gestion.can(org_id, 'gestion.tenants.view'));
create policy messages_insert on gestion.messages for insert to authenticated
  with check (gestion.can(org_id, 'gestion.tenants.edit'));
create policy messages_update on gestion.messages for update to authenticated
  using (gestion.can(org_id, 'gestion.tenants.edit'))
  with check (gestion.can(org_id, 'gestion.tenants.edit'));
create policy messages_delete on gestion.messages for delete to authenticated
  using (gestion.can(org_id, 'gestion.tenants.edit'));
