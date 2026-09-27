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
create or replace function gestion.investment_touch_updated_at() returns trigger language plpgsql set search_path='' as $$ begin new.updated_at=now(); return new; end $$;
drop trigger if exists investment_loans_updated_at on gestion.investment_loans;
create trigger investment_loans_updated_at before update on gestion.investment_loans for each row execute function gestion.investment_touch_updated_at();
drop trigger if exists acquisition_projects_updated_at on gestion.acquisition_projects;
create trigger acquisition_projects_updated_at before update on gestion.acquisition_projects for each row execute function gestion.investment_touch_updated_at();
alter table gestion.investment_loans enable row level security; alter table gestion.acquisition_projects enable row level security;
revoke all on gestion.investment_loans, gestion.acquisition_projects from anon, authenticated;
grant select, insert, update on gestion.investment_loans, gestion.acquisition_projects to authenticated;
create policy investment_loans_view on gestion.investment_loans for select to authenticated using (gestion.can(org_id,'gestion.finance.view'));
create policy investment_loans_insert on gestion.investment_loans for insert to authenticated with check (gestion.can(org_id,'gestion.finance.edit'));
create policy investment_loans_update on gestion.investment_loans for update to authenticated using (gestion.can(org_id,'gestion.finance.edit')) with check (gestion.can(org_id,'gestion.finance.edit'));
create policy acquisition_projects_view on gestion.acquisition_projects for select to authenticated using (gestion.can(org_id,'gestion.finance.view'));
create policy acquisition_projects_insert on gestion.acquisition_projects for insert to authenticated with check (gestion.can(org_id,'gestion.finance.edit'));
create policy acquisition_projects_update on gestion.acquisition_projects for update to authenticated using (gestion.can(org_id,'gestion.finance.edit')) with check (gestion.can(org_id,'gestion.finance.edit'));
