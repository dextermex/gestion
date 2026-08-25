-- ===========================================================================
-- MORADA GESTION — 0004 COMPLIANCE, AML, DOCUMENTS & FISCAL PACKS
--
-- • legal_params: EVERY legal constant is data with effective-date ranges —
--   a legislative change is a data migration with a manager review queue.
-- • Per-document-class retention clocks (10y accounting / 5y AML from end of
--   relationship / 3-month hard delete for unsuccessful applicants), never a
--   single account-level policy. Accounting records stay in Luxembourg
--   (data-residency requirement for hosting).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- LEGAL PARAMETERS (seeded from src/domain/legal/params.ts)
-- ---------------------------------------------------------------------------
create table if not exists public.legal_params (
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
create index if not exists legal_params_key_idx on public.legal_params(key, effective_from desc);

-- Read-only to every authenticated user; writes via service role only.
alter table public.legal_params enable row level security;
create policy legal_params_read on public.legal_params for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- COMPLIANCE DEADLINES & VACANCY
-- ---------------------------------------------------------------------------
create table if not exists public.g_legal_deadlines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
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
create index if not exists g_legal_deadlines_org_due_idx on public.g_legal_deadlines(org_id, due_on)
  where done_at is null and waived_at is null;

-- Vacancy clock: starts at keys-back; builds the INOL defence file
-- (marketing efforts, works, offers) whether or not the tax is enacted.
create table if not exists public.g_vacancy_periods (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  unit_id uuid not null references public.g_units(id) on delete cascade,
  started_on date not null,
  ended_on date,
  defence_evidence jsonb not null default '[]'
);
create index if not exists g_vacancy_unit_idx on public.g_vacancy_periods(unit_id);

-- ---------------------------------------------------------------------------
-- AML / KYC — two-tier onboarding; STR isolation (no tipping-off exposure)
-- ---------------------------------------------------------------------------
create table if not exists public.g_aml_parties (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  contact_id uuid not null references public.g_contacts(id) on delete cascade,
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

create table if not exists public.g_id_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  aml_party_id uuid not null references public.g_aml_parties(id) on delete cascade,
  type text not null check (type in ('id_card','passport','residence_permit','company_extract','other')),
  number text not null,
  issuer text,
  expires_on date,
  document_id uuid
);

create table if not exists public.g_ubo_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  entity_contact_id uuid not null references public.g_contacts(id) on delete cascade,
  member_contact_id uuid not null references public.g_contacts(id) on delete cascade,
  share_pct numeric(7,4) not null,
  evidence_document_id uuid,
  rbe_checked_at timestamptz
);

create table if not exists public.g_screening_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  aml_party_id uuid not null references public.g_aml_parties(id) on delete cascade,
  kind text not null check (kind in ('pep','sanctions')),
  provider text not null,
  result text not null check (result in ('clear','hit','possible_hit')),
  disposition text,
  screened_at timestamptz not null default now()
);

-- STR filings: strictly isolated — never surfaces in tenant/owner portals.
create table if not exists public.g_str_filings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  aml_party_id uuid not null references public.g_aml_parties(id) on delete restrict,
  crf_reference text not null,
  filed_on date not null,
  filed_by uuid,
  notes text
);

-- ---------------------------------------------------------------------------
-- DOCUMENT VAULT — per-class retention clocks + litigation holds
-- ---------------------------------------------------------------------------
create table if not exists public.g_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
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
create index if not exists g_documents_org_class_idx on public.g_documents(org_id, class);
create index if not exists g_documents_related_idx on public.g_documents(related_type, related_id);
create index if not exists g_documents_retention_idx on public.g_documents(retention_until)
  where litigation_hold = false;

-- ---------------------------------------------------------------------------
-- TAX PACKS (modèle 190/210 datasets, per property × owner × year)
-- ---------------------------------------------------------------------------
create table if not exists public.g_tax_packs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  property_id uuid not null references public.g_properties(id) on delete cascade,
  owner_contact_id uuid not null references public.g_contacts(id) on delete cascade,
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
    'g_legal_deadlines','g_vacancy_periods','g_documents','g_tax_packs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

create policy g_deadlines_select on public.g_legal_deadlines for select to authenticated
  using (public.g_can(org_id, 'gestion.compliance.view'));
create policy g_deadlines_insert on public.g_legal_deadlines for insert to authenticated
  with check (public.g_can(org_id, 'gestion.compliance.edit'));
create policy g_deadlines_update on public.g_legal_deadlines for update to authenticated
  using (public.g_can(org_id, 'gestion.compliance.edit'))
  with check (public.g_can(org_id, 'gestion.compliance.edit'));
create policy g_deadlines_delete on public.g_legal_deadlines for delete to authenticated
  using (public.g_can(org_id, 'gestion.compliance.edit'));
create policy g_vacancy_select on public.g_vacancy_periods for select to authenticated
  using (public.g_can(org_id, 'gestion.properties.view'));
create policy g_vacancy_insert on public.g_vacancy_periods for insert to authenticated
  with check (public.g_can(org_id, 'gestion.properties.edit'));
create policy g_vacancy_update on public.g_vacancy_periods for update to authenticated
  using (public.g_can(org_id, 'gestion.properties.edit'))
  with check (public.g_can(org_id, 'gestion.properties.edit'));
create policy g_vacancy_delete on public.g_vacancy_periods for delete to authenticated
  using (public.g_can(org_id, 'gestion.properties.edit'));
create policy g_documents_select on public.g_documents for select to authenticated
  using (public.g_can(org_id, 'gestion.documents.view'));
create policy g_documents_insert on public.g_documents for insert to authenticated
  with check (public.g_can(org_id, 'gestion.documents.edit'));
create policy g_documents_update on public.g_documents for update to authenticated
  using (public.g_can(org_id, 'gestion.documents.edit'))
  with check (public.g_can(org_id, 'gestion.documents.edit'));
create policy g_documents_delete on public.g_documents for delete to authenticated
  using (public.g_can(org_id, 'gestion.documents.edit'));
create policy g_tax_packs_select on public.g_tax_packs for select to authenticated
  using (public.g_can(org_id, 'gestion.finance.view'));
create policy g_tax_packs_insert on public.g_tax_packs for insert to authenticated
  with check (public.g_can(org_id, 'gestion.finance.edit'));
create policy g_tax_packs_update on public.g_tax_packs for update to authenticated
  using (public.g_can(org_id, 'gestion.finance.edit'))
  with check (public.g_can(org_id, 'gestion.finance.edit'));
create policy g_tax_packs_delete on public.g_tax_packs for delete to authenticated
  using (public.g_can(org_id, 'gestion.finance.edit'));

-- AML family — dedicated permission; STR filings admin-only.
do $$
declare t text;
begin
  foreach t in array array[
    'g_aml_parties','g_id_documents','g_ubo_links','g_screening_events','g_str_filings'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

create policy g_aml_parties_select on public.g_aml_parties for select to authenticated
  using (public.g_can(org_id, 'gestion.aml.view'));
create policy g_aml_parties_insert on public.g_aml_parties for insert to authenticated
  with check (public.g_can(org_id, 'gestion.aml.edit'));
create policy g_aml_parties_update on public.g_aml_parties for update to authenticated
  using (public.g_can(org_id, 'gestion.aml.edit'))
  with check (public.g_can(org_id, 'gestion.aml.edit'));
create policy g_aml_parties_delete on public.g_aml_parties for delete to authenticated
  using (public.g_can(org_id, 'gestion.aml.edit'));
create policy g_id_documents_select on public.g_id_documents for select to authenticated
  using (public.g_can(org_id, 'gestion.aml.view'));
create policy g_id_documents_insert on public.g_id_documents for insert to authenticated
  with check (public.g_can(org_id, 'gestion.aml.edit'));
create policy g_id_documents_update on public.g_id_documents for update to authenticated
  using (public.g_can(org_id, 'gestion.aml.edit'))
  with check (public.g_can(org_id, 'gestion.aml.edit'));
create policy g_id_documents_delete on public.g_id_documents for delete to authenticated
  using (public.g_can(org_id, 'gestion.aml.edit'));
create policy g_ubo_links_select on public.g_ubo_links for select to authenticated
  using (public.g_can(org_id, 'gestion.aml.view'));
create policy g_ubo_links_insert on public.g_ubo_links for insert to authenticated
  with check (public.g_can(org_id, 'gestion.aml.edit'));
create policy g_ubo_links_update on public.g_ubo_links for update to authenticated
  using (public.g_can(org_id, 'gestion.aml.edit'))
  with check (public.g_can(org_id, 'gestion.aml.edit'));
create policy g_ubo_links_delete on public.g_ubo_links for delete to authenticated
  using (public.g_can(org_id, 'gestion.aml.edit'));
create policy g_screening_events_select on public.g_screening_events for select to authenticated
  using (public.g_can(org_id, 'gestion.aml.view'));
create policy g_screening_events_insert on public.g_screening_events for insert to authenticated
  with check (public.g_can(org_id, 'gestion.aml.edit'));
create policy g_screening_events_update on public.g_screening_events for update to authenticated
  using (public.g_can(org_id, 'gestion.aml.edit'))
  with check (public.g_can(org_id, 'gestion.aml.edit'));
create policy g_screening_events_delete on public.g_screening_events for delete to authenticated
  using (public.g_can(org_id, 'gestion.aml.edit'));
-- No tipping-off: STR filings visible only to settings-level admins.
create policy g_str_filings_all on public.g_str_filings for all to authenticated
  using (public.g_can(org_id, 'gestion.settings.edit'))
  with check (public.g_can(org_id, 'gestion.settings.edit'));
