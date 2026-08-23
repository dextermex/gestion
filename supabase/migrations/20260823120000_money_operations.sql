-- ===========================================================================
-- MORADA GESTION — 0003 MONEY & OPERATIONS
--
-- Read-only on money (Phase 1: reconciliation, not collection — touching
-- funds triggers CSSF payment-institution licensing). Provider-agnostic
-- connector layer; CAMT.053 ingestion is permanent (fallback, enterprise
-- feed and consent-lapse continuity in one).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- BANKING
-- ---------------------------------------------------------------------------
create table if not exists public.g_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
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
create index if not exists g_bank_accounts_org_idx on public.g_bank_accounts(org_id);

create table if not exists public.g_bank_imports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  bank_account_id uuid not null references public.g_bank_accounts(id) on delete cascade,
  source text not null check (source in ('camt053','csv','api')),
  file_name text,
  file_sha256 text,
  statement_from date,
  statement_to date,
  imported_at timestamptz not null default now(),
  tx_count int not null default 0
);

create table if not exists public.g_bank_transactions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  bank_account_id uuid not null references public.g_bank_accounts(id) on delete cascade,
  import_id uuid references public.g_bank_imports(id) on delete set null,
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
create index if not exists g_bank_tx_org_status_idx on public.g_bank_transactions(org_id, match_status);
create index if not exists g_bank_tx_booked_idx on public.g_bank_transactions(bank_account_id, booked_on desc);

-- Tier 2: learned payer-IBAN bindings — the tier that saves third-party
-- payers (parents, employers, housing subsidies). One keystroke in the
-- review queue converts a manual match into permanent automation.
create table if not exists public.g_iban_bindings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  payer_iban text not null,
  lease_id uuid not null references public.g_leases(id) on delete cascade,
  learned_from_tx_id uuid references public.g_bank_transactions(id) on delete set null,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (org_id, payer_iban, lease_id)
);

-- ---------------------------------------------------------------------------
-- PAYMENTS & ALLOCATIONS — paid-ness is a ledger derivation, never a boolean
-- ---------------------------------------------------------------------------
create table if not exists public.g_payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  lease_id uuid references public.g_leases(id) on delete set null,
  bank_transaction_id uuid references public.g_bank_transactions(id) on delete set null,
  received_on date not null,
  amount_cents integer not null check (amount_cents > 0),
  method text not null default 'transfer' check (method in ('transfer','cash','card','other')),
  note text,
  created_at timestamptz not null default now()
);
create index if not exists g_payments_lease_idx on public.g_payments(lease_id);

create table if not exists public.g_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  payment_id uuid not null references public.g_payments(id) on delete cascade,
  rent_period_id uuid not null references public.g_rent_periods(id) on delete restrict,
  amount_cents integer not null check (amount_cents > 0),
  allocated_at timestamptz not null default now(),
  allocated_by uuid,
  auto boolean not null default false,
  reversed_at timestamptz,
  reversed_by uuid
);
create index if not exists g_payment_allocations_period_idx on public.g_payment_allocations(rent_period_id);
create index if not exists g_payment_allocations_payment_idx on public.g_payment_allocations(payment_id);

-- Derived rent-period status (the only truth about paid-ness).
create or replace view public.g_rent_period_status as
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
from public.g_rent_periods rp
left join public.g_payment_allocations pa on pa.rent_period_id = rp.id
group by rp.id;

-- ---------------------------------------------------------------------------
-- OWNER LEDGER & MANAGEMENT FEES
-- ---------------------------------------------------------------------------
create table if not exists public.g_mandates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  owner_contact_id uuid not null references public.g_contacts(id) on delete restrict,
  property_id uuid references public.g_properties(id) on delete cascade,
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

create table if not exists public.g_owner_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  mandate_id uuid not null references public.g_mandates(id) on delete cascade,
  entry_on date not null,
  kind text not null check (kind in
    ('rent_collected','management_fee','expense','payout','deposit_movement','adjustment')),
  label text not null,
  amount_cents integer not null, -- signed: credit to owner positive
  vat_cents integer not null default 0,
  rent_period_id uuid references public.g_rent_periods(id) on delete set null,
  payment_id uuid references public.g_payments(id) on delete set null,
  -- Monthly décompte de gérance closes a period: entries become immutable.
  period_locked boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists g_owner_ledger_mandate_idx on public.g_owner_ledger_entries(mandate_id, entry_on desc);

-- Management fees are ALWAYS invoiced +17% VAT — the fee is taxable even
-- though residential letting is exempt.
create table if not exists public.g_management_fee_invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  mandate_id uuid not null references public.g_mandates(id) on delete cascade,
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
create table if not exists public.g_payout_batches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  bank_account_id uuid not null references public.g_bank_accounts(id) on delete restrict,
  generated_at timestamptz not null default now(),
  pain001_document_id uuid,
  total_cents integer not null default 0,
  status text not null default 'generated'
    check (status in ('generated','uploaded_to_bank','reconciled'))
);

-- ---------------------------------------------------------------------------
-- ARREARS
-- ---------------------------------------------------------------------------
create table if not exists public.g_payment_plans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  lease_id uuid not null references public.g_leases(id) on delete cascade,
  agreed_on date not null,
  instalments jsonb not null default '[]',
  active boolean not null default true,
  broken_at timestamptz
);

create table if not exists public.g_arrears_actions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  lease_id uuid not null references public.g_leases(id) on delete cascade,
  rent_period_id uuid references public.g_rent_periods(id) on delete set null,
  stage text not null check (stage in ('friendly','formal','mise_en_demeure','justice_dossier')),
  executed_at timestamptz not null default now(),
  registered_letter_id uuid references public.g_registered_letters(id) on delete set null,
  confirmed_by uuid,
  dossier_document_id uuid
);
create index if not exists g_arrears_lease_idx on public.g_arrears_actions(lease_id);

-- ---------------------------------------------------------------------------
-- MAINTENANCE — artisan micro-portal is magic-link only, no account
-- ---------------------------------------------------------------------------
create table if not exists public.g_tickets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  unit_id uuid references public.g_units(id) on delete set null,
  property_id uuid references public.g_properties(id) on delete set null,
  lease_id uuid references public.g_leases(id) on delete set null,
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
create index if not exists g_tickets_org_status_idx on public.g_tickets(org_id, status);

create table if not exists public.g_work_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  ticket_id uuid not null references public.g_tickets(id) on delete cascade,
  artisan_contact_id uuid references public.g_contacts(id) on delete set null,
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
create table if not exists public.g_recharge_decisions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  work_order_id uuid references public.g_work_orders(id) on delete cascade,
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
create table if not exists public.g_charge_periods (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  lease_id uuid not null references public.g_leases(id) on delete cascade,
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

create table if not exists public.g_charge_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  charge_period_id uuid not null references public.g_charge_periods(id) on delete cascade,
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

create table if not exists public.g_syndic_decomptes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  property_id uuid not null references public.g_properties(id) on delete cascade,
  year int not null,
  document_id uuid,
  ag_approved boolean not null default false,
  imported_at timestamptz not null default now(),
  lines jsonb not null default '[]'
);

-- ---------------------------------------------------------------------------
-- WORKFLOWS (the four state machines) & MESSAGING
-- ---------------------------------------------------------------------------
create table if not exists public.g_workflows (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  kind text not null check (kind in ('move_in','in_tenancy','rent_cycle','move_out')),
  unit_id uuid references public.g_units(id) on delete cascade,
  lease_id uuid references public.g_leases(id) on delete cascade,
  current_state text not null,
  state_history jsonb not null default '[]',
  blocked_reason text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists g_workflows_org_idx on public.g_workflows(org_id, kind);

create table if not exists public.g_conversations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  scope_type text not null check (scope_type in ('lease','ticket','mandate','contact','general')),
  scope_id uuid,
  subject text not null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz
);

create table if not exists public.g_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  conversation_id uuid not null references public.g_conversations(id) on delete cascade,
  sender_kind text not null check (sender_kind in ('manager','tenant','owner','artisan','system')),
  sender_contact_id uuid references public.g_contacts(id) on delete set null,
  sender_user_id uuid,
  body text not null,
  lang text,
  translated jsonb,
  sent_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists g_messages_conversation_idx on public.g_messages(conversation_id, sent_at);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'g_bank_accounts','g_bank_imports','g_bank_transactions','g_iban_bindings',
    'g_payments','g_payment_allocations','g_mandates','g_owner_ledger_entries',
    'g_management_fee_invoices','g_payout_batches','g_payment_plans','g_arrears_actions',
    'g_tickets','g_work_orders','g_recharge_decisions','g_charge_periods','g_charge_lines',
    'g_syndic_decomptes','g_workflows','g_conversations','g_messages'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Finance family
do $$
declare t text;
begin
  foreach t in array array[
    'g_bank_accounts','g_bank_imports','g_bank_transactions','g_iban_bindings',
    'g_payments','g_payment_allocations','g_mandates','g_owner_ledger_entries',
    'g_management_fee_invoices','g_payout_batches','g_payment_plans','g_arrears_actions',
    'g_charge_periods','g_charge_lines','g_syndic_decomptes'
  ] loop
    execute format(
      'create policy %I_all on public.%I for all to authenticated
         using (public.g_can(org_id, ''gestion.finance.view''))
         with check (public.g_can(org_id, ''gestion.finance.edit''))', t, t);
  end loop;
end $$;

-- Maintenance family
create policy g_tickets_all on public.g_tickets for all to authenticated
  using (public.g_can(org_id, 'gestion.maintenance.view'))
  with check (public.g_can(org_id, 'gestion.maintenance.edit'));
create policy g_work_orders_all on public.g_work_orders for all to authenticated
  using (public.g_can(org_id, 'gestion.maintenance.view'))
  with check (public.g_can(org_id, 'gestion.maintenance.edit'));
create policy g_recharge_decisions_all on public.g_recharge_decisions for all to authenticated
  using (public.g_can(org_id, 'gestion.finance.view'))
  with check (public.g_can(org_id, 'gestion.finance.edit'));

-- Workflows & messaging
create policy g_workflows_all on public.g_workflows for all to authenticated
  using (public.g_can(org_id, 'gestion.properties.view'))
  with check (public.g_can(org_id, 'gestion.properties.edit'));
create policy g_conversations_all on public.g_conversations for all to authenticated
  using (public.g_can(org_id, 'gestion.tenants.view'))
  with check (public.g_can(org_id, 'gestion.tenants.edit'));
create policy g_messages_all on public.g_messages for all to authenticated
  using (public.g_can(org_id, 'gestion.tenants.view'))
  with check (public.g_can(org_id, 'gestion.tenants.edit'));
