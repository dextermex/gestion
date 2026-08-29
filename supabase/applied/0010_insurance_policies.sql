-- 0010 · Assurances : le registre des polices
-- Appliqué le 2026-08-29 (migration `gestion_insurance_policies`).
--
-- Table additive gestion.insurance_policies (immeuble, PNO, garantie
-- loyers, RC pro), même motif RLS que le reste du schéma :
-- gestion.can(org_id, 'gestion.properties.view'/'edit') décide ligne par
-- ligne. Alimente la section Gestion locative > Assurances.
--
-- Réversible : drop table gestion.insurance_policies;

create table gestion.insurance_policies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  property_id uuid references gestion.properties(id) on delete set null,
  lease_id uuid references gestion.leases(id) on delete set null,
  kind text not null check (kind in ('building','pno','liability','rent_guarantee','pi','other')),
  provider text not null,
  policy_number text not null default '',
  premium_cents integer not null default 0 check (premium_cents >= 0),
  starts_on date,
  expires_on date,
  notes text not null default '',
  created_at timestamptz not null default now()
);
create index insurance_policies_org_idx on gestion.insurance_policies (org_id);
create index insurance_policies_property_idx on gestion.insurance_policies (property_id);
alter table gestion.insurance_policies enable row level security;
create policy insurance_policies_select on gestion.insurance_policies
  for select to authenticated using (gestion.can(org_id, 'gestion.properties.view'));
create policy insurance_policies_insert on gestion.insurance_policies
  for insert to authenticated with check (gestion.can(org_id, 'gestion.properties.edit'));
create policy insurance_policies_update on gestion.insurance_policies
  for update to authenticated using (gestion.can(org_id, 'gestion.properties.edit'))
  with check (gestion.can(org_id, 'gestion.properties.edit'));
create policy insurance_policies_delete on gestion.insurance_policies
  for delete to authenticated using (gestion.can(org_id, 'gestion.properties.edit'));
grant select, insert, update, delete on gestion.insurance_policies to authenticated;
