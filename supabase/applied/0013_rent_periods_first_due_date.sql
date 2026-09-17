-- 0013 · La première échéance n'est jamais due avant le début du bail
--
-- Un bail signé le 17 avec un loyer dû le 5 devait son premier mois le 5,
-- douze jours avant d'exister : l'échéance naissait « en retard ». La règle
-- devient greatest(jour d'échéance du mois, date de début), appliquée par
-- openLedger (src/lib/gestion/lease.ts) et, à l'identique, par la fonction
-- nocturne. Les échéances existantes ne sont pas réécrites (on conflict do
-- nothing) : ce texte remplace seulement le corps de la fonction.
--
-- Additif et réversible : réappliquer le corps de 0012.

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
  select org_id, id, period, greatest((period + (payment_day - 1))::date, start_date), rent_cents, charges_cents, 0, 0
  from months
  on conflict (lease_id, period) do nothing;

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;
