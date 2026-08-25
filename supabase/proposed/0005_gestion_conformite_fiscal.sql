-- ===========================================================================
-- MORADA GESTION — 0005 CONFORMITE & FISCAL
--
-- ADDITIF. Ne crée que des objets dans le schéma `gestion`.
-- Ne touche à aucune table, fonction ou policy de `public`.
-- Prérequis : 0001_gestion_spine.sql.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- LEGAL PARAMETERS (seeded from src/domain/legal/params.ts)
-- ---------------------------------------------------------------------------
create table if not exists gestion.legal_params (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  value_numeric numeric,
  value_text text,
  value_jsonb jsonb,
  effective_from date not null,
  effective_to date,
  status text not null default 'verified' check (status in ('verified','uncertain')),
  source text not null,
  note text,
  -- Review queue: a legislative change lands as a pending row an admin
  -- confirms; engines only read confirmed rows.
  confirmed boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists legal_params_key_idx on gestion.legal_params(key, effective_from desc);

-- Read-only to every authenticated user; writes via service role only.
alter table gestion.legal_params enable row level security;
create policy legal_params_read on gestion.legal_params for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- COMPLIANCE DEADLINES & VACANCY
-- ---------------------------------------------------------------------------
create table if not exists gestion.legal_deadlines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  kind text not null,
  label text not null,
  due_on date not null,
  related_type text not null,
  related_id uuid,
  related_label text not null default '',
  legal_basis text not null default '',
  severity text not null default 'action' check (severity in ('info','action','critical')),
  done_at timestamptz,
  waived_at timestamptz,
  waived_reason text,
  created_at timestamptz not null default now()
);
create index if not exists legal_deadlines_org_due_idx on gestion.legal_deadlines(org_id, due_on)
  where done_at is null and waived_at is null;

-- Vacancy clock: starts at keys-back; builds the INOL defence file
-- (marketing efforts, works, offers) whether or not the tax is enacted.
create table if not exists gestion.vacancy_periods (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  unit_id uuid not null references gestion.units(id) on delete cascade,
  started_on date not null,
  ended_on date,
  defence_evidence jsonb not null default '[]'
);
create index if not exists vacancy_unit_idx on gestion.vacancy_periods(unit_id);

-- ---------------------------------------------------------------------------
-- AML / KYC — two-tier onboarding; STR isolation (no tipping-off exposure)
-- ---------------------------------------------------------------------------
create table if not exists gestion.aml_parties (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  contact_id uuid not null references gestion.contacts(id) on delete cascade,
  tier text not null default 'light' check (tier in ('light','full_cdd')),
  triggers jsonb not null default '[]',
  risk_band text check (risk_band in ('low','medium','high')),
  risk_score int,
  risk_factors jsonb not null default '[]',
  assessed_at timestamptz,
  assessed_by uuid,
  next_review_on date,
  relationship_ended_on date,
  retention_until date,
  unique (org_id, contact_id)
);

create table if not exists gestion.id_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  aml_party_id uuid not null references gestion.aml_parties(id) on delete cascade,
  type text not null check (type in ('id_card','passport','residence_permit','company_extract','other')),
  number text not null,
  issuer text,
  expires_on date,
  document_id uuid
);

create table if not exists gestion.ubo_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  entity_contact_id uuid not null references gestion.contacts(id) on delete cascade,
  member_contact_id uuid not null references gestion.contacts(id) on delete cascade,
  share_pct numeric(7,4) not null,
  evidence_document_id uuid,
  rbe_checked_at timestamptz
);

create table if not exists gestion.screening_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  aml_party_id uuid not null references gestion.aml_parties(id) on delete cascade,
  kind text not null check (kind in ('pep','sanctions')),
  provider text not null,
  result text not null check (result in ('clear','hit','possible_hit')),
  disposition text,
  screened_at timestamptz not null default now()
);

-- STR filings: strictly isolated — never surfaces in tenant/owner portals.
create table if not exists gestion.str_filings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  aml_party_id uuid not null references gestion.aml_parties(id) on delete restrict,
  crf_reference text not null,
  filed_on date not null,
  filed_by uuid,
  notes text
);

-- ---------------------------------------------------------------------------
-- DOCUMENT VAULT — per-class retention clocks + litigation holds
-- ---------------------------------------------------------------------------
create table if not exists gestion.documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  class text not null check (class in
    ('lease','edl','invoice','receipt','deed','loan','subsidy','id_document',
     'decompte','registered_letter','insurance','bank_statement','tax','photo','other')),
  retention_class text not null default 'accounting_10y' check (retention_class in
    ('accounting_10y','aml_5y_from_end','applicant_3m','gdpr_minimised','permanent')),
  retention_until date,
  litigation_hold boolean not null default false,
  name text not null,
  storage_path text not null,
  mime text,
  size_bytes bigint,
  sha256 text,
  -- Sealed artefacts (signed EDL, signed lease) are immutable — corrections
  -- happen by appended addenda, never edits.
  sealed boolean not null default false,
  related_type text,
  related_id uuid,
  uploaded_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists documents_org_class_idx on gestion.documents(org_id, class);
create index if not exists documents_related_idx on gestion.documents(related_type, related_id);
create index if not exists documents_retention_idx on gestion.documents(retention_until)
  where litigation_hold = false;

-- ---------------------------------------------------------------------------
-- TAX PACKS (modèle 190/210 datasets, per property × owner × year)
-- ---------------------------------------------------------------------------
create table if not exists gestion.tax_packs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  property_id uuid not null references gestion.properties(id) on delete cascade,
  owner_contact_id uuid not null references gestion.contacts(id) on delete cascade,
  tax_year int not null,
  status text not null default 'draft' check (status in ('draft','ready','exported')),
  pack jsonb not null default '{}',
  generated_at timestamptz not null default now(),
  exported_at timestamptz,
  unique (property_id, owner_contact_id, tax_year)
);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'legal_deadlines','vacancy_periods','documents','tax_packs'
  ] loop
    execute format('alter table gestion.%I enable row level security', t);
  end loop;
end $$;

create policy deadlines_select on gestion.legal_deadlines for select to authenticated
  using (gestion.can(org_id, 'gestion.compliance.view'));
create policy deadlines_insert on gestion.legal_deadlines for insert to authenticated
  with check (gestion.can(org_id, 'gestion.compliance.edit'));
create policy deadlines_update on gestion.legal_deadlines for update to authenticated
  using (gestion.can(org_id, 'gestion.compliance.edit'))
  with check (gestion.can(org_id, 'gestion.compliance.edit'));
create policy deadlines_delete on gestion.legal_deadlines for delete to authenticated
  using (gestion.can(org_id, 'gestion.compliance.edit'));
create policy vacancy_select on gestion.vacancy_periods for select to authenticated
  using (gestion.can(org_id, 'gestion.properties.view'));
create policy vacancy_insert on gestion.vacancy_periods for insert to authenticated
  with check (gestion.can(org_id, 'gestion.properties.edit'));
create policy vacancy_update on gestion.vacancy_periods for update to authenticated
  using (gestion.can(org_id, 'gestion.properties.edit'))
  with check (gestion.can(org_id, 'gestion.properties.edit'));
create policy vacancy_delete on gestion.vacancy_periods for delete to authenticated
  using (gestion.can(org_id, 'gestion.properties.edit'));
create policy documents_select on gestion.documents for select to authenticated
  using (gestion.can(org_id, 'gestion.documents.view'));
create policy documents_insert on gestion.documents for insert to authenticated
  with check (gestion.can(org_id, 'gestion.documents.edit'));
create policy documents_update on gestion.documents for update to authenticated
  using (gestion.can(org_id, 'gestion.documents.edit'))
  with check (gestion.can(org_id, 'gestion.documents.edit'));
create policy documents_delete on gestion.documents for delete to authenticated
  using (gestion.can(org_id, 'gestion.documents.edit'));
create policy tax_packs_select on gestion.tax_packs for select to authenticated
  using (gestion.can(org_id, 'gestion.finance.view'));
create policy tax_packs_insert on gestion.tax_packs for insert to authenticated
  with check (gestion.can(org_id, 'gestion.finance.edit'));
create policy tax_packs_update on gestion.tax_packs for update to authenticated
  using (gestion.can(org_id, 'gestion.finance.edit'))
  with check (gestion.can(org_id, 'gestion.finance.edit'));
create policy tax_packs_delete on gestion.tax_packs for delete to authenticated
  using (gestion.can(org_id, 'gestion.finance.edit'));

-- AML family — dedicated permission; STR filings admin-only.
do $$
declare t text;
begin
  foreach t in array array[
    'aml_parties','id_documents','ubo_links','screening_events','str_filings'
  ] loop
    execute format('alter table gestion.%I enable row level security', t);
  end loop;
end $$;

create policy aml_parties_select on gestion.aml_parties for select to authenticated
  using (gestion.can(org_id, 'gestion.aml.view'));
create policy aml_parties_insert on gestion.aml_parties for insert to authenticated
  with check (gestion.can(org_id, 'gestion.aml.edit'));
create policy aml_parties_update on gestion.aml_parties for update to authenticated
  using (gestion.can(org_id, 'gestion.aml.edit'))
  with check (gestion.can(org_id, 'gestion.aml.edit'));
create policy aml_parties_delete on gestion.aml_parties for delete to authenticated
  using (gestion.can(org_id, 'gestion.aml.edit'));
create policy id_documents_select on gestion.id_documents for select to authenticated
  using (gestion.can(org_id, 'gestion.aml.view'));
create policy id_documents_insert on gestion.id_documents for insert to authenticated
  with check (gestion.can(org_id, 'gestion.aml.edit'));
create policy id_documents_update on gestion.id_documents for update to authenticated
  using (gestion.can(org_id, 'gestion.aml.edit'))
  with check (gestion.can(org_id, 'gestion.aml.edit'));
create policy id_documents_delete on gestion.id_documents for delete to authenticated
  using (gestion.can(org_id, 'gestion.aml.edit'));
create policy ubo_links_select on gestion.ubo_links for select to authenticated
  using (gestion.can(org_id, 'gestion.aml.view'));
create policy ubo_links_insert on gestion.ubo_links for insert to authenticated
  with check (gestion.can(org_id, 'gestion.aml.edit'));
create policy ubo_links_update on gestion.ubo_links for update to authenticated
  using (gestion.can(org_id, 'gestion.aml.edit'))
  with check (gestion.can(org_id, 'gestion.aml.edit'));
create policy ubo_links_delete on gestion.ubo_links for delete to authenticated
  using (gestion.can(org_id, 'gestion.aml.edit'));
create policy screening_events_select on gestion.screening_events for select to authenticated
  using (gestion.can(org_id, 'gestion.aml.view'));
create policy screening_events_insert on gestion.screening_events for insert to authenticated
  with check (gestion.can(org_id, 'gestion.aml.edit'));
create policy screening_events_update on gestion.screening_events for update to authenticated
  using (gestion.can(org_id, 'gestion.aml.edit'))
  with check (gestion.can(org_id, 'gestion.aml.edit'));
create policy screening_events_delete on gestion.screening_events for delete to authenticated
  using (gestion.can(org_id, 'gestion.aml.edit'));
-- No tipping-off: STR filings visible only to settings-level admins.
create policy str_filings_all on gestion.str_filings for all to authenticated
  using (gestion.can(org_id, 'gestion.settings.edit'))
  with check (gestion.can(org_id, 'gestion.settings.edit'));
