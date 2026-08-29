-- ===========================================================================
-- MORADA GESTION — 0003 PORTEFEUILLE & BAUX
--
-- ADDITIF. Ne crée que des objets dans le schéma `gestion`.
-- Ne touche à aucune table, fonction ou policy de `public`.
-- Prérequis : 0001_gestion_spine.sql.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- OWNERSHIP GRAPH
-- ---------------------------------------------------------------------------
create table if not exists gestion.ownership_vehicles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  name text not null,
  type text not null check (type in ('sci','senc','scs','scsp','sarl','sa','other')),
  -- Art. 175 LIR: transparent entities are taxed in the members' hands
  -- (modèle 200 établissement en commun, allocation to modèle 100).
  fiscally_transparent boolean not null default true,
  rcs_number text,
  rbe_registered boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists gestion.vehicle_members (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references gestion.ownership_vehicles(id) on delete cascade,
  contact_id uuid not null references gestion.contacts(id) on delete restrict,
  share_pct numeric(7,4) not null check (share_pct > 0 and share_pct <= 100),
  from_date date not null,
  to_date date,
  created_at timestamptz not null default now()
);
create index if not exists vehicle_members_vehicle_idx on gestion.vehicle_members(vehicle_id);

create table if not exists gestion.properties (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  name text not null,
  type text not null default 'apartment_building'
    check (type in ('apartment_building','house','mixed_use','commercial','apartment','office','other')),
  address jsonb not null default '{}',
  commune text,
  cadastral_commune text,
  cadastral_section text,
  cadastral_number text,
  construction_year int,
  completion_date date,
  -- CPE: class must appear in every ad; the feed builder fails closed.
  energy_class text check (energy_class in ('A+','A','B','C','D','E','F','G','H','I')),
  cpe_issued_on date,
  is_copropriete boolean not null default false,
  syndic_name text,
  syndic_mandate_start date,
  tantiemes int,
  tantiemes_total int,
  smoke_detectors_confirmed boolean not null default false,
  photo_url text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists properties_org_idx on gestion.properties(org_id);

-- Ownership rows: holder is EITHER a vehicle OR a contact (natural/legal).
create table if not exists gestion.property_ownership (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  property_id uuid not null references gestion.properties(id) on delete cascade,
  vehicle_id uuid references gestion.ownership_vehicles(id) on delete restrict,
  contact_id uuid references gestion.contacts(id) on delete restrict,
  share_pct numeric(7,4) not null check (share_pct > 0 and share_pct <= 100),
  usufruct boolean not null default false,
  bare_ownership boolean not null default false,
  from_date date not null,
  to_date date,
  check ((vehicle_id is null) <> (contact_id is null))
);
create index if not exists property_ownership_property_idx on gestion.property_ownership(property_id);

-- ---------------------------------------------------------------------------
-- FISCAL FACTS (per property — feeds the amortisation engine & modèle 190/210)
-- ---------------------------------------------------------------------------
create table if not exists gestion.property_acquisitions (
  property_id uuid primary key references gestion.properties(id) on delete cascade,
  org_id uuid not null references public.agencies(id) on delete cascade,
  acquired_on date not null,
  total_price_cents bigint not null check (total_price_cents >= 0),
  land_price_cents bigint,
  vat_paid_cents bigint not null default 0,
  deed_costs_cents bigint not null default 0,
  vefa2024_eligible boolean not null default false,
  notes text
);

create table if not exists gestion.capital_investments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  property_id uuid not null references gestion.properties(id) on delete cascade,
  spent_on date not null,
  amount_cents bigint not null check (amount_cents >= 0),
  kind text not null check (kind in ('construction','renovation','energy_renovation','improvement')),
  klimabonus_cents bigint not null default 0,
  works_completed_on date,
  description text
);
create index if not exists capital_investments_property_idx on gestion.capital_investments(property_id);

-- Materialised per-year amortisation decisions (engine output, kept for audit:
-- rate, base, regime and the taxpayer-slot allocation actually filed).
create table if not exists gestion.amortisation_schedules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  property_id uuid not null references gestion.properties(id) on delete cascade,
  taxpayer_contact_id uuid not null references gestion.contacts(id) on delete restrict,
  tax_year int not null,
  regime text not null check (regime in ('normal_2','accelerated_4','grandfathered_6','vefa2024_6','energy_renovation')),
  rate_pct numeric(5,2) not null,
  base_cents bigint not null,
  amount_cents bigint not null,
  abattement_cents bigint not null default 0,
  consumed_accelerated_slot boolean not null default false,
  computation jsonb not null default '{}',
  unique (property_id, taxpayer_contact_id, tax_year)
);

-- ---------------------------------------------------------------------------
-- UNITS & METERS
-- ---------------------------------------------------------------------------
create table if not exists gestion.units (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  property_id uuid not null references gestion.properties(id) on delete cascade,
  label text not null,
  kind text not null default 'dwelling'
    check (kind in ('dwelling','commercial','office','parking','cellar','other')),
  floor text,
  area_sqm numeric(8,2),
  rooms numeric(4,1),
  furnished boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists units_property_idx on gestion.units(property_id);

-- No meter API exists in Luxembourg — dual acknowledgement (tenant + manager
-- tap) is the trust mechanism on every reading.
create table if not exists gestion.meters (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  property_id uuid references gestion.properties(id) on delete cascade,
  unit_id uuid references gestion.units(id) on delete cascade,
  kind text not null check (kind in ('electricity','gas','water_cold','water_hot','heat')),
  serial_number text not null,
  ean_code text,
  supplier text,
  location_note text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (property_id is not null or unit_id is not null)
);
create index if not exists meters_unit_idx on gestion.meters(unit_id);

create table if not exists gestion.meter_readings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  meter_id uuid not null references gestion.meters(id) on delete cascade,
  read_on date not null,
  value numeric(14,3) not null,
  source text not null default 'manual' check (source in ('manual','edl','photo_ocr','import')),
  photo_document_id uuid,
  photo_sha256 text,
  tenant_ack_at timestamptz,
  manager_ack_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists meter_readings_meter_idx on gestion.meter_readings(meter_id, read_on desc);

-- ---------------------------------------------------------------------------
-- LEASES — the rule-pack object
-- ---------------------------------------------------------------------------
create table if not exists gestion.leases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  unit_id uuid not null references gestion.units(id) on delete restrict,
  seq int generated always as identity,
  lease_type text not null default 'residential' check (lease_type in ('residential','commercial')),
  status text not null default 'draft' check (status in ('draft','active','notice','ended')),
  start_date date not null,
  end_date date,
  signed_at timestamptz,
  rent_cents integer not null check (rent_cents >= 0),
  charges_cents integer not null default 0 check (charges_cents >= 0),
  charges_regime text not null default 'advances' check (charges_regime in ('advances','forfait')),
  payment_day int not null default 1 check (payment_day between 1 and 28),
  -- ISO 11649 permanent creditor reference, printed on every avis + EPC QR.
  rf_reference text,
  -- The 8 mandatory mentions (residential, on pain of nullity) — the
  -- generator refuses to emit a signable lease until all are populated.
  mentions jsonb not null default '{}',
  furnished boolean not null default false,
  furniture_supplement_cents integer not null default 0,
  furniture_invoice_total_cents integer not null default 0,
  colocation boolean not null default false,
  pacte_colocation_signed boolean not null default false,
  -- Capital investi components & the stored ceiling computation snapshot.
  capital_investi jsonb not null default '{}',
  rent_ceiling_check jsonb not null default '{}',
  -- Adjustment anchors for the 24-month/+10%/5% engine.
  last_adjustment_on date,
  previous_rent_cents integer,
  -- Commercial: contractual IPC clause (base index, frequency); residential
  -- leases must keep this empty — CPI clauses are nullifiable.
  indexation_clause jsonb not null default '{}',
  -- VAT (commercial only): exempt | opted with AED approval trail.
  vat_regime text not null default 'exempt' check (vat_regime in ('exempt','opted')),
  vat_option jsonb not null default '{}',
  details jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or end_date > start_date)
);
create index if not exists leases_org_idx on gestion.leases(org_id);
create index if not exists leases_unit_idx on gestion.leases(unit_id);
create unique index if not exists leases_rf_key on gestion.leases(org_id, rf_reference)
  where rf_reference is not null;

create table if not exists gestion.lease_parties (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  lease_id uuid not null references gestion.leases(id) on delete cascade,
  contact_id uuid not null references gestion.contacts(id) on delete restrict,
  role text not null check (role in ('tenant','colocataire','guarantor')),
  joint_liability boolean not null default true,
  moved_in_on date,
  moved_out_on date
);
create index if not exists lease_parties_lease_idx on gestion.lease_parties(lease_id);

-- ---------------------------------------------------------------------------
-- RENT PERIODS (receivables) — status DERIVED from allocations + due date
-- ---------------------------------------------------------------------------
create table if not exists gestion.rent_periods (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  lease_id uuid not null references gestion.leases(id) on delete cascade,
  period date not null, -- first day of month
  due_date date not null,
  rent_cents integer not null,
  charges_cents integer not null default 0,
  other_cents integer not null default 0,
  other_label text,
  vat_cents integer not null default 0,
  total_cents integer generated always as (rent_cents + charges_cents + other_cents + vat_cents) stored,
  written_off boolean not null default false,
  unique (lease_id, period)
);
create index if not exists rent_periods_org_period_idx on gestion.rent_periods(org_id, period);

-- ---------------------------------------------------------------------------
-- DEPOSITS — five statutory forms; settlement lines with justification clocks
-- ---------------------------------------------------------------------------
create table if not exists gestion.deposits (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  lease_id uuid not null references gestion.leases(id) on delete cascade,
  form text not null check (form in ('cash','bank_guarantee','third_party_caution','insurance','state_guarantee')),
  amount_cents integer not null check (amount_cents >= 0),
  received_on date,
  provider_ref text,
  status text not null default 'held'
    check (status in ('pending','held','release_pending','partially_released','released','forfeited','disputed')),
  key_handover_on date,
  decompte_issued_on date,
  mise_en_demeure_ar_on date,
  released_first_tranche_cents integer not null default 0,
  released_balance_cents integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists deposits_lease_idx on gestion.deposits(lease_id);

create table if not exists gestion.deposit_deductions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  deposit_id uuid not null references gestion.deposits(id) on delete cascade,
  kind text not null check (kind in ('arrears','damage','charge_reserve')),
  label text not null,
  amount_cents integer not null check (amount_cents >= 0),
  edl_item_id uuid,
  justification_document_id uuid,
  justified_at date,
  status text not null default 'pending'
    check (status in ('pending','justified','expired_forfeited','blocked_no_entry_edl'))
);

-- ---------------------------------------------------------------------------
-- REGISTERED LETTERS — first-class legal object. Legal-effect dates derive
-- from AR dates, never click dates; dependent workflows gate on state.
-- ---------------------------------------------------------------------------
create table if not exists gestion.registered_letters (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  template_key text not null,
  related_type text not null,
  related_id uuid not null,
  recipient_contact_id uuid references gestion.contacts(id) on delete set null,
  content_sha256 text not null,
  status text not null default 'draft'
    check (status in ('draft','dispatched','ar_received','returned_undelivered')),
  dispatched_on date,
  dispatch_proof_document_id uuid,
  ar_received_on date,
  ar_scan_document_id uuid,
  legal_effect_on date generated always as (ar_received_on) stored,
  created_at timestamptz not null default now()
);
create index if not exists registered_letters_related_idx
  on gestion.registered_letters(related_type, related_id);

-- Notice records (both directions) with the validity engine's verdict.
create table if not exists gestion.notice_records (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  lease_id uuid not null references gestion.leases(id) on delete cascade,
  direction text not null check (direction in ('tenant','landlord')),
  ground text not null check (ground in ('tenant_notice','landlord_personal_need','landlord_serious_ground')),
  registered_letter_id uuid references gestion.registered_letters(id) on delete set null,
  art12_verbatim_included boolean not null default false,
  earliest_lawful_end date,
  validity jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- EDL (états des lieux) — hash-chained photographic evidence
-- ---------------------------------------------------------------------------
create table if not exists gestion.edl_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  lease_id uuid not null references gestion.leases(id) on delete cascade,
  kind text not null check (kind in ('entry','intermediate','exit')),
  scheduled_at timestamptz,
  completed_at timestamptz,
  status text not null default 'draft'
    check (status in ('draft','in_progress','signed','sealed','contested')),
  sealed_pdf_document_id uuid,
  hash_manifest_sha256 text,
  -- Keys are structurally blocked until the contradictory EDL is signed:
  -- the legally fatal path (keys without EDL → deposit unusable) is
  -- impossible by construction.
  key_handover_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists edl_sessions_lease_idx on gestion.edl_sessions(lease_id);

create table if not exists gestion.edl_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  session_id uuid not null references gestion.edl_sessions(id) on delete cascade,
  room text not null,
  category text not null check (category in
    ('paint','floors','interior_joinery','exterior_joinery','tiling','plumbing',
     'electrics','heating','gas','appliances','keys','meters','other')),
  condition text not null check (condition in ('new','good','fair','poor','damaged')),
  notes text,
  vetuste_pct numeric(5,2),
  -- Exit diff: classification against the matching entry item.
  exit_classification text check (exit_classification in
    ('unchanged','normal_wear_vetuste','tenant_damage','improved')),
  entry_item_id uuid references gestion.edl_items(id) on delete set null,
  signed_with_objection boolean not null default false,
  objection_note text
);
create index if not exists edl_items_session_idx on gestion.edl_items(session_id);

create table if not exists gestion.edl_media (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  item_id uuid not null references gestion.edl_items(id) on delete cascade,
  storage_path text not null,
  sha256 text not null,
  captured_at timestamptz not null,
  geotag jsonb,
  -- Hash chain: each capture seals the previous one.
  prev_sha256 text
);

-- Defect window (move-in): contractual (default 15 days), countdown visible
-- to the tenant; late reports land in an out-of-window log, never refused.
create table if not exists gestion.defects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  lease_id uuid not null references gestion.leases(id) on delete cascade,
  edl_session_id uuid references gestion.edl_sessions(id) on delete set null,
  room text,
  category text,
  description text not null,
  severity text not null default 'normal' check (severity in ('normal','urgent')),
  reported_at timestamptz not null default now(),
  in_window boolean not null default true,
  status text not null default 'reported'
    check (status in ('reported','accepted','disputed','normal_wear','resolved')),
  manager_reason text,
  ticket_id uuid
);

-- ---------------------------------------------------------------------------
-- RLS — properties permission family for portfolio, leases family for leases
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'ownership_vehicles','vehicle_members','properties','property_ownership',
    'property_acquisitions','capital_investments','amortisation_schedules',
    'units','meters','meter_readings'
  ] loop
    execute format('alter table gestion.%I enable row level security', t);
  end loop;
end $$;

create policy vehicles_select on gestion.ownership_vehicles for select to authenticated
  using (gestion.can(org_id, 'gestion.properties.view'));
create policy vehicles_insert on gestion.ownership_vehicles for insert to authenticated
  with check (gestion.can(org_id, 'gestion.properties.edit'));
create policy vehicles_update on gestion.ownership_vehicles for update to authenticated
  using (gestion.can(org_id, 'gestion.properties.edit'))
  with check (gestion.can(org_id, 'gestion.properties.edit'));
create policy vehicles_delete on gestion.ownership_vehicles for delete to authenticated
  using (gestion.can(org_id, 'gestion.properties.edit'));
create policy vehicle_members_select on gestion.vehicle_members for select to authenticated
  using (exists (select 1 from gestion.ownership_vehicles v
                 where v.id = vehicle_id and gestion.can(v.org_id, 'gestion.properties.view')));
create policy vehicle_members_insert on gestion.vehicle_members for insert to authenticated
  with check (exists (select 1 from gestion.ownership_vehicles v
                      where v.id = vehicle_id and gestion.can(v.org_id, 'gestion.properties.edit')));
create policy vehicle_members_update on gestion.vehicle_members for update to authenticated
  using (exists (select 1 from gestion.ownership_vehicles v
                 where v.id = vehicle_id and gestion.can(v.org_id, 'gestion.properties.edit')))
  with check (exists (select 1 from gestion.ownership_vehicles v
                      where v.id = vehicle_id and gestion.can(v.org_id, 'gestion.properties.edit')));
create policy vehicle_members_delete on gestion.vehicle_members for delete to authenticated
  using (exists (select 1 from gestion.ownership_vehicles v
                 where v.id = vehicle_id and gestion.can(v.org_id, 'gestion.properties.edit')));

create policy properties_select on gestion.properties for select to authenticated
  using (gestion.can(org_id, 'gestion.properties.view'));
create policy properties_insert on gestion.properties for insert to authenticated
  with check (gestion.can(org_id, 'gestion.properties.edit'));
create policy properties_update on gestion.properties for update to authenticated
  using (gestion.can(org_id, 'gestion.properties.edit'))
  with check (gestion.can(org_id, 'gestion.properties.edit'));
create policy properties_delete on gestion.properties for delete to authenticated
  using (gestion.can(org_id, 'gestion.properties.delete'));

create policy ownership_select on gestion.property_ownership for select to authenticated
  using (gestion.can(org_id, 'gestion.properties.view'));
create policy ownership_insert on gestion.property_ownership for insert to authenticated
  with check (gestion.can(org_id, 'gestion.properties.edit'));
create policy ownership_update on gestion.property_ownership for update to authenticated
  using (gestion.can(org_id, 'gestion.properties.edit'))
  with check (gestion.can(org_id, 'gestion.properties.edit'));
create policy ownership_delete on gestion.property_ownership for delete to authenticated
  using (gestion.can(org_id, 'gestion.properties.edit'));
create policy acquisitions_select on gestion.property_acquisitions for select to authenticated
  using (gestion.can(org_id, 'gestion.finance.view'));
create policy acquisitions_insert on gestion.property_acquisitions for insert to authenticated
  with check (gestion.can(org_id, 'gestion.finance.edit'));
create policy acquisitions_update on gestion.property_acquisitions for update to authenticated
  using (gestion.can(org_id, 'gestion.finance.edit'))
  with check (gestion.can(org_id, 'gestion.finance.edit'));
create policy acquisitions_delete on gestion.property_acquisitions for delete to authenticated
  using (gestion.can(org_id, 'gestion.finance.edit'));
create policy capital_select on gestion.capital_investments for select to authenticated
  using (gestion.can(org_id, 'gestion.finance.view'));
create policy capital_insert on gestion.capital_investments for insert to authenticated
  with check (gestion.can(org_id, 'gestion.finance.edit'));
create policy capital_update on gestion.capital_investments for update to authenticated
  using (gestion.can(org_id, 'gestion.finance.edit'))
  with check (gestion.can(org_id, 'gestion.finance.edit'));
create policy capital_delete on gestion.capital_investments for delete to authenticated
  using (gestion.can(org_id, 'gestion.finance.edit'));
create policy amort_select on gestion.amortisation_schedules for select to authenticated
  using (gestion.can(org_id, 'gestion.finance.view'));
create policy amort_insert on gestion.amortisation_schedules for insert to authenticated
  with check (gestion.can(org_id, 'gestion.finance.edit'));
create policy amort_update on gestion.amortisation_schedules for update to authenticated
  using (gestion.can(org_id, 'gestion.finance.edit'))
  with check (gestion.can(org_id, 'gestion.finance.edit'));
create policy amort_delete on gestion.amortisation_schedules for delete to authenticated
  using (gestion.can(org_id, 'gestion.finance.edit'));

create policy units_select on gestion.units for select to authenticated
  using (gestion.can(org_id, 'gestion.properties.view'));
create policy units_insert on gestion.units for insert to authenticated
  with check (gestion.can(org_id, 'gestion.properties.edit'));
create policy units_update on gestion.units for update to authenticated
  using (gestion.can(org_id, 'gestion.properties.edit'))
  with check (gestion.can(org_id, 'gestion.properties.edit'));
create policy units_delete on gestion.units for delete to authenticated
  using (gestion.can(org_id, 'gestion.properties.edit'));
create policy meters_select on gestion.meters for select to authenticated
  using (gestion.can(org_id, 'gestion.properties.view'));
create policy meters_insert on gestion.meters for insert to authenticated
  with check (gestion.can(org_id, 'gestion.properties.edit'));
create policy meters_update on gestion.meters for update to authenticated
  using (gestion.can(org_id, 'gestion.properties.edit'))
  with check (gestion.can(org_id, 'gestion.properties.edit'));
create policy meters_delete on gestion.meters for delete to authenticated
  using (gestion.can(org_id, 'gestion.properties.edit'));
create policy meter_readings_select on gestion.meter_readings for select to authenticated
  using (gestion.can(org_id, 'gestion.properties.view'));
create policy meter_readings_insert on gestion.meter_readings for insert to authenticated
  with check (gestion.can(org_id, 'gestion.properties.edit'));
create policy meter_readings_update on gestion.meter_readings for update to authenticated
  using (gestion.can(org_id, 'gestion.properties.edit'))
  with check (gestion.can(org_id, 'gestion.properties.edit'));
create policy meter_readings_delete on gestion.meter_readings for delete to authenticated
  using (gestion.can(org_id, 'gestion.properties.edit'));

do $$
declare t text;
begin
  foreach t in array array[
    'leases','lease_parties','rent_periods','deposits','deposit_deductions',
    'registered_letters','notice_records','edl_sessions','edl_items','edl_media','defects'
  ] loop
    execute format('alter table gestion.%I enable row level security', t);
  end loop;
end $$;

create policy leases_select on gestion.leases for select to authenticated
  using (gestion.can(org_id, 'gestion.leases.view'));
create policy leases_insert on gestion.leases for insert to authenticated
  with check (gestion.can(org_id, 'gestion.leases.edit'));
create policy leases_update on gestion.leases for update to authenticated
  using (gestion.can(org_id, 'gestion.leases.edit'))
  with check (gestion.can(org_id, 'gestion.leases.edit'));
create policy leases_delete on gestion.leases for delete to authenticated
  using (gestion.can(org_id, 'gestion.leases.edit'));
create policy lease_parties_select on gestion.lease_parties for select to authenticated
  using (gestion.can(org_id, 'gestion.leases.view'));
create policy lease_parties_insert on gestion.lease_parties for insert to authenticated
  with check (gestion.can(org_id, 'gestion.leases.edit'));
create policy lease_parties_update on gestion.lease_parties for update to authenticated
  using (gestion.can(org_id, 'gestion.leases.edit'))
  with check (gestion.can(org_id, 'gestion.leases.edit'));
create policy lease_parties_delete on gestion.lease_parties for delete to authenticated
  using (gestion.can(org_id, 'gestion.leases.edit'));
create policy rent_periods_select on gestion.rent_periods for select to authenticated
  using (gestion.can(org_id, 'gestion.finance.view'));
create policy rent_periods_insert on gestion.rent_periods for insert to authenticated
  with check (gestion.can(org_id, 'gestion.finance.edit'));
create policy rent_periods_update on gestion.rent_periods for update to authenticated
  using (gestion.can(org_id, 'gestion.finance.edit'))
  with check (gestion.can(org_id, 'gestion.finance.edit'));
create policy rent_periods_delete on gestion.rent_periods for delete to authenticated
  using (gestion.can(org_id, 'gestion.finance.edit'));
create policy deposits_select on gestion.deposits for select to authenticated
  using (gestion.can(org_id, 'gestion.finance.view'));
create policy deposits_insert on gestion.deposits for insert to authenticated
  with check (gestion.can(org_id, 'gestion.finance.edit'));
create policy deposits_update on gestion.deposits for update to authenticated
  using (gestion.can(org_id, 'gestion.finance.edit'))
  with check (gestion.can(org_id, 'gestion.finance.edit'));
create policy deposits_delete on gestion.deposits for delete to authenticated
  using (gestion.can(org_id, 'gestion.finance.edit'));
create policy deposit_deductions_select on gestion.deposit_deductions for select to authenticated
  using (gestion.can(org_id, 'gestion.finance.view'));
create policy deposit_deductions_insert on gestion.deposit_deductions for insert to authenticated
  with check (gestion.can(org_id, 'gestion.finance.edit'));
create policy deposit_deductions_update on gestion.deposit_deductions for update to authenticated
  using (gestion.can(org_id, 'gestion.finance.edit'))
  with check (gestion.can(org_id, 'gestion.finance.edit'));
create policy deposit_deductions_delete on gestion.deposit_deductions for delete to authenticated
  using (gestion.can(org_id, 'gestion.finance.edit'));
create policy registered_letters_select on gestion.registered_letters for select to authenticated
  using (gestion.can(org_id, 'gestion.leases.view'));
create policy registered_letters_insert on gestion.registered_letters for insert to authenticated
  with check (gestion.can(org_id, 'gestion.leases.edit'));
create policy registered_letters_update on gestion.registered_letters for update to authenticated
  using (gestion.can(org_id, 'gestion.leases.edit'))
  with check (gestion.can(org_id, 'gestion.leases.edit'));
create policy registered_letters_delete on gestion.registered_letters for delete to authenticated
  using (gestion.can(org_id, 'gestion.leases.edit'));
create policy notice_records_select on gestion.notice_records for select to authenticated
  using (gestion.can(org_id, 'gestion.leases.view'));
create policy notice_records_insert on gestion.notice_records for insert to authenticated
  with check (gestion.can(org_id, 'gestion.leases.edit'));
create policy notice_records_update on gestion.notice_records for update to authenticated
  using (gestion.can(org_id, 'gestion.leases.edit'))
  with check (gestion.can(org_id, 'gestion.leases.edit'));
create policy notice_records_delete on gestion.notice_records for delete to authenticated
  using (gestion.can(org_id, 'gestion.leases.edit'));
create policy edl_sessions_select on gestion.edl_sessions for select to authenticated
  using (gestion.can(org_id, 'gestion.properties.view'));
create policy edl_sessions_insert on gestion.edl_sessions for insert to authenticated
  with check (gestion.can(org_id, 'gestion.properties.edit'));
create policy edl_sessions_update on gestion.edl_sessions for update to authenticated
  using (gestion.can(org_id, 'gestion.properties.edit'))
  with check (gestion.can(org_id, 'gestion.properties.edit'));
create policy edl_sessions_delete on gestion.edl_sessions for delete to authenticated
  using (gestion.can(org_id, 'gestion.properties.edit'));
create policy edl_items_select on gestion.edl_items for select to authenticated
  using (gestion.can(org_id, 'gestion.properties.view'));
create policy edl_items_insert on gestion.edl_items for insert to authenticated
  with check (gestion.can(org_id, 'gestion.properties.edit'));
create policy edl_items_update on gestion.edl_items for update to authenticated
  using (gestion.can(org_id, 'gestion.properties.edit'))
  with check (gestion.can(org_id, 'gestion.properties.edit'));
create policy edl_items_delete on gestion.edl_items for delete to authenticated
  using (gestion.can(org_id, 'gestion.properties.edit'));
create policy edl_media_select on gestion.edl_media for select to authenticated
  using (gestion.can(org_id, 'gestion.properties.view'));
create policy edl_media_insert on gestion.edl_media for insert to authenticated
  with check (gestion.can(org_id, 'gestion.properties.edit'));
create policy edl_media_update on gestion.edl_media for update to authenticated
  using (gestion.can(org_id, 'gestion.properties.edit'))
  with check (gestion.can(org_id, 'gestion.properties.edit'));
create policy edl_media_delete on gestion.edl_media for delete to authenticated
  using (gestion.can(org_id, 'gestion.properties.edit'));
create policy defects_select on gestion.defects for select to authenticated
  using (gestion.can(org_id, 'gestion.maintenance.view'));
create policy defects_insert on gestion.defects for insert to authenticated
  with check (gestion.can(org_id, 'gestion.maintenance.edit'));
create policy defects_update on gestion.defects for update to authenticated
  using (gestion.can(org_id, 'gestion.maintenance.edit'))
  with check (gestion.can(org_id, 'gestion.maintenance.edit'));
create policy defects_delete on gestion.defects for delete to authenticated
  using (gestion.can(org_id, 'gestion.maintenance.edit'));
