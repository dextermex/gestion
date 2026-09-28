-- 0024 · Crédits immobiliers et projets d'achat
-- Appliquée en production le 2026-09-28 (voir APPLIQUE.md). Rejouée
-- automatiquement sur la base jetable des tests de bout en bout.
--
-- Tout est additif :
--
-- 1. gestion.investment_loans : un crédit par bien (ou lot), solde enregistré,
--    taux, durée restante, assurance. Donnée de financement, jamais une preuve
--    de paiement.
--
-- 2. gestion.acquisition_projects : un projet d'achat et ses jalons (visite,
--    financement, compromis, rendez-vous notarial, acte, remise des clés),
--    étape et statut de financement contrôlés.
--
-- Chaque table est sous RLS sur le motif gestion.can (lecture
-- gestion.finance.view, insertion et mise à jour gestion.finance.edit), accordée
-- à authenticated seulement, sans suppression ni accès anon. Le déclencheur
-- updated_at sert la concurrence optimiste de l'API ; sa fonction n'est
-- exécutable par aucun rôle de l'API, anon ni authenticated (l'audit RLS le
-- vérifie pour anon), ce qui n'empêche pas le déclencheur de s'exécuter.
--
-- Réversible :
--   drop table gestion.investment_loans;
--   drop table gestion.acquisition_projects;
--   drop function gestion.investment_touch_updated_at();

create table if not exists gestion.investment_loans (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.agencies(id) on delete cascade,
 property_id uuid not null references gestion.properties(id) on delete cascade, unit_id uuid references gestion.units(id) on delete set null,
 name text not null, bank_name text not null, original_cents bigint not null check(original_cents>0), balance_cents bigint not null check(balance_cents>=0 and balance_cents<=original_cents*2), balance_date date not null,
 annual_rate_pct numeric(6,3) not null check(annual_rate_pct between 0 and 30), rate_type text not null check(rate_type in ('fixed','variable')), remaining_months int not null check(remaining_months between 0 and 600), insurance_cents bigint not null default 0 check(insurance_cents>=0), next_payment_date date, fixed_until date, notes text not null default '', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists gestion.acquisition_projects (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.agencies(id) on delete cascade,
 name text not null, address text not null, stage text not null, asking_price_cents bigint, expected_rent_cents bigint, bank_name text not null default '', financing_status text not null default 'research', notary_name text not null default '', next_action text not null default '', next_action_date date, viewing_date date, compromis_date date, finance_deadline date, notary_appointment_date date, deed_signed_date date, transfer_date date, handover_date date, notes text not null default '', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists investment_loans_org_idx on gestion.investment_loans(org_id);
create index if not exists acquisition_projects_org_idx on gestion.acquisition_projects(org_id);
alter table gestion.acquisition_projects drop constraint if exists acquisition_projects_stage_check;
alter table gestion.acquisition_projects add constraint acquisition_projects_stage_check check(stage in ('research','viewing','offer','compromis','deed_pending','deed_signed','handover','paused','archived'));
alter table gestion.acquisition_projects drop constraint if exists acquisition_projects_financing_status_check;
alter table gestion.acquisition_projects add constraint acquisition_projects_financing_status_check check(financing_status in ('research','submitted','pending','offer_received','accepted','refused','cash'));
create or replace function gestion.investment_touch_updated_at() returns trigger language plpgsql set search_path='' as $$ begin new.updated_at=now(); return new; end $$;
revoke all on function gestion.investment_touch_updated_at() from public, anon;
drop trigger if exists investment_loans_updated_at on gestion.investment_loans;
create trigger investment_loans_updated_at before update on gestion.investment_loans for each row execute function gestion.investment_touch_updated_at();
drop trigger if exists acquisition_projects_updated_at on gestion.acquisition_projects;
create trigger acquisition_projects_updated_at before update on gestion.acquisition_projects for each row execute function gestion.investment_touch_updated_at();
alter table gestion.investment_loans enable row level security; alter table gestion.acquisition_projects enable row level security;
revoke all on gestion.investment_loans, gestion.acquisition_projects from anon, authenticated;
grant select, insert, update on gestion.investment_loans, gestion.acquisition_projects to authenticated;
drop policy if exists investment_loans_view on gestion.investment_loans;
drop policy if exists investment_loans_insert on gestion.investment_loans;
drop policy if exists investment_loans_update on gestion.investment_loans;
drop policy if exists acquisition_projects_view on gestion.acquisition_projects;
drop policy if exists acquisition_projects_insert on gestion.acquisition_projects;
drop policy if exists acquisition_projects_update on gestion.acquisition_projects;
create policy investment_loans_view on gestion.investment_loans for select to authenticated using (gestion.can(org_id,'gestion.finance.view'));
create policy investment_loans_insert on gestion.investment_loans for insert to authenticated with check (gestion.can(org_id,'gestion.finance.edit'));
create policy investment_loans_update on gestion.investment_loans for update to authenticated using (gestion.can(org_id,'gestion.finance.edit')) with check (gestion.can(org_id,'gestion.finance.edit'));
create policy acquisition_projects_view on gestion.acquisition_projects for select to authenticated using (gestion.can(org_id,'gestion.finance.view'));
create policy acquisition_projects_insert on gestion.acquisition_projects for insert to authenticated with check (gestion.can(org_id,'gestion.finance.edit'));
create policy acquisition_projects_update on gestion.acquisition_projects for update to authenticated using (gestion.can(org_id,'gestion.finance.edit')) with check (gestion.can(org_id,'gestion.finance.edit'));
