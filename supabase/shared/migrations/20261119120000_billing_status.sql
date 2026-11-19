-- One subscription status for both surfaces (Nov 2026). A workspace's
-- subscription lives at the store that sold it: Stripe for app.morada.lu,
-- Apple (through RevenueCat) for the iPhone app. Neither surface could see
-- the other's, so a landlord who paid on one was locked on the other. Each
-- store's webhook now records what it knows here, one row per workspace and
-- store, and both surfaces read it: the app in src/lib/data/billing.ts, the
-- web in its billing gate.
--
-- Written by the webhooks only (service role): the `revenuecat` Edge Function
-- for Apple, the web's Stripe webhook for Stripe. A member reads the rows of
-- their own workspaces and can change nothing. A subscription runs while its
-- status is `trialing` or `active` and its period has not ended; a failed
-- payment (`past_due`, `unpaid`) does not run: access closes until it is paid.
-- Nothing else is touched when it closes: every record of the workspace stays.

create table if not exists gestion.billing_status (
  org_id uuid not null references public.agencies(id) on delete cascade,
  source text not null check (source in ('stripe', 'apple')),
  status text not null check (status in ('trialing', 'active', 'past_due', 'unpaid', 'canceled', 'expired')),
  current_period_end timestamptz,
  product text,
  updated_at timestamptz not null default now(),
  primary key (org_id, source)
);

alter table gestion.billing_status enable row level security;
revoke all on gestion.billing_status from anon, authenticated;
grant select on gestion.billing_status to authenticated;

drop policy if exists billing_status_member_select on gestion.billing_status;
create policy billing_status_member_select on gestion.billing_status
  for select to authenticated
  using (exists (
    select 1 from public.crm_members m
    where m.agency_id = billing_status.org_id and m.user_id = auth.uid() and m.status = 'active'
  ));
