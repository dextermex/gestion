-- 0012 · Le grand livre se prolonge tout seul
-- Appliqué le 2026-09-16 (migration `gestion_rent_periods_roll_forward`).
--
-- Un bail actif ouvre ses échéances à sa création : du mois de début (au
-- plus tôt douze mois en arrière) jusqu'au mois prochain. Rien ne les
-- prolongeait ensuite : deux mois après la création, le mois courant
-- n'existait plus dans le grand livre et le suivi des loyers s'arrêtait.
--
-- Cette fonction applique la même règle que `openLedger` (src/lib/gestion/
-- lease.ts) à tous les baux en cours (active, notice), chaque nuit, par
-- pg_cron. Elle n'écrit que des lignes manquantes (`on conflict do nothing`
-- sur la clé unique (lease_id, period)) : une échéance existante, payée ou
-- non, n'est jamais réécrite. Elle ne dépasse jamais la date de fin d'un
-- bail, ni son mois de début.
--
-- Additif et réversible :
--   select cron.unschedule('gestion-roll-rent-periods');
--   drop function gestion.roll_rent_periods(date);

create or replace function gestion.roll_rent_periods(as_of date default current_date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted integer;
begin
  with live as (
    select l.id, l.org_id, l.start_date, l.end_date, l.rent_cents, l.charges_cents, l.payment_day
    from gestion.leases l
    where l.status in ('active', 'notice')
  ),
  bounds as (
    select
      live.*,
      greatest(
        date_trunc('month', live.start_date)::date,
        (date_trunc('month', as_of) - interval '11 months')::date
      ) as from_month,
      least(
        (date_trunc('month', as_of) + interval '1 month')::date,
        coalesce(date_trunc('month', live.end_date)::date, (date_trunc('month', as_of) + interval '1 month')::date)
      ) as to_month
    from live
  ),
  months as (
    select b.*, m::date as period
    from bounds b
    cross join lateral generate_series(b.from_month, b.to_month, interval '1 month') as m
  )
  insert into gestion.rent_periods (org_id, lease_id, period, due_date, rent_cents, charges_cents, other_cents, vat_cents)
  select org_id, id, period, (period + (payment_day - 1))::date, rent_cents, charges_cents, 0, 0
  from months
  on conflict (lease_id, period) do nothing;

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

comment on function gestion.roll_rent_periods(date) is
  'Ouvre les échéances mensuelles manquantes de chaque bail en cours, jusqu''au mois prochain. Idempotente. Miroir SQL de openLedger.';

-- Le schéma gestion est exposé à PostgREST : la fonction ne doit pas être
-- appelable en RPC par un client. Seul le planificateur l'exécute.
revoke all on function gestion.roll_rent_periods(date) from public;
revoke all on function gestion.roll_rent_periods(date) from anon;
revoke all on function gestion.roll_rent_periods(date) from authenticated;

-- Chaque nuit à 00:10 UTC. `cron.schedule` par nom est idempotent.
select cron.schedule('gestion-roll-rent-periods', '10 0 * * *', $$select gestion.roll_rent_periods()$$);
