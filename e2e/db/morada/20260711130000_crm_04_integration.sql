-- ============================================================================
-- Morada Pro CRM — Migration 4/4: Public-site integration & automations
-- ============================================================================
-- ADDITIVE ONLY. Requires migrations 1–3.
-- Adds AFTER INSERT triggers on the EXISTING public.leads / public.offers
-- tables (no column changes) that mirror new enquiries and binding offers into
-- the CRM inbox and notify the agency, an automation that drafts a transaction
-- when a lead is won, and realtime publication for live CRM updates.
--
-- ROLLBACK:
--   drop trigger crm_on_public_lead on public.leads;
--   drop trigger crm_on_public_offer on public.offers;
--   drop trigger crm_leads_won_tx on public.crm_leads;
--   drop function crm_import_public_lead, crm_import_public_offer, crm_lead_won_tx;
--   alter publication supabase_realtime drop table crm_leads, crm_notifications,
--     crm_messages, crm_tasks, crm_threads;
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Website enquiry → CRM lead + notification
-- ---------------------------------------------------------------------------
create or replace function public.crm_import_public_lead()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_lead uuid;
begin
  if new.agency_id is null then
    return new;
  end if;

  insert into public.crm_leads
    (agency_id, listing_id, source_lead_id, name, email, phone, message, source, stage)
  values
    (new.agency_id, new.listing_id, new.id, new.name, new.email, new.phone,
     coalesce(new.message, ''), 'website_enquiry', 'new')
  returning id into v_lead;

  insert into public.crm_notifications (agency_id, kind, title, body, link)
  values (
    new.agency_id, 'lead',
    'New enquiry from ' || new.name,
    coalesce(nullif(new.message, ''), 'Via the Morada marketplace'),
    '/pro/leads/' || v_lead
  );

  return new;
end;
$$;

drop trigger if exists crm_on_public_lead on public.leads;
create trigger crm_on_public_lead after insert on public.leads
  for each row execute function public.crm_import_public_lead();

-- ---------------------------------------------------------------------------
-- 2. Binding offer → CRM lead (stage "offer") + notification
-- ---------------------------------------------------------------------------
create or replace function public.crm_import_public_offer()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_lead uuid;
begin
  if new.agency_id is null then
    return new;
  end if;

  insert into public.crm_leads
    (agency_id, listing_id, source_offer_id, name, email, phone, message,
     source, stage, value_estimate, priority)
  values
    (new.agency_id, new.listing_id, new.id, new.name, new.email, new.phone,
     coalesce(new.message, ''), 'website_offer', 'offer', new.amount, 'high')
  returning id into v_lead;

  insert into public.crm_notifications (agency_id, kind, title, body, link)
  values (
    new.agency_id, 'offer',
    'Binding offer: € ' || to_char(new.amount, 'FM999G999G999'),
    new.name || ' · ' || new.financing,
    '/pro/leads/' || v_lead
  );

  return new;
end;
$$;

drop trigger if exists crm_on_public_offer on public.offers;
create trigger crm_on_public_offer after insert on public.offers
  for each row execute function public.crm_import_public_offer();

-- ---------------------------------------------------------------------------
-- 3. Automation: winning a lead drafts the transaction
-- ---------------------------------------------------------------------------
create or replace function public.crm_lead_won_tx()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if new.stage = 'won' and old.stage is distinct from 'won'
     and coalesce(new.value_estimate, 0) > 0
     and not exists (
       select 1 from public.crm_transactions where lead_id = new.id
     )
  then
    insert into public.crm_transactions
      (agency_id, lead_id, listing_id, kind, amount, commission_pct,
       commission_amount, status)
    values (
      new.agency_id, new.id, new.listing_id, 'sale', new.value_estimate, 3,
      round(new.value_estimate * 0.03), 'pending'
    );
    insert into public.crm_notifications (agency_id, kind, title, body, link)
    values (
      new.agency_id, 'transaction',
      'Deal won: ' || new.name,
      'A pending transaction was drafted automatically — review the commission.',
      '/pro/transactions'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists crm_leads_won_tx on public.crm_leads;
create trigger crm_leads_won_tx after update on public.crm_leads
  for each row execute function public.crm_lead_won_tx();

-- ---------------------------------------------------------------------------
-- 4. Realtime: stream CRM changes to signed-in members (RLS applies)
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['crm_leads','crm_notifications','crm_messages','crm_tasks','crm_threads']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;
      when undefined_object then null; -- publication missing on this environment
    end;
  end loop;
end;
$$;
