-- 0032 · Location et argent : fin de bail datée, paiements en une transaction,
--        annulation tracée, crédit du locataire, début du suivi des loyers
--
-- ADDITIF. Ne crée et ne modifie que des objets du schéma `gestion`. Aucune
-- ligne existante n'est réécrite. Prérequis : 0001 à 0031 (dont
-- `gestion.today()`, le jour de Luxembourg, posé par 0030).
--
--  1. payments : colonnes d'annulation (qui, quand, pourquoi) et clé de
--     requête ; un seul paiement vivant par opération bancaire ; une seule
--     écriture par clé de requête.
--  2. leases.ledger_from : le mois à partir duquel Morada suit les loyers ;
--     rent_periods.adjusted_at, adjusted_by, adjust_reason : le montant d'un
--     mois fixé à la main, avec sa raison.
--  3. vue lease_credit : l'argent reçu au-delà de ce qui était dû, par bail.
--  4. apply_lease_credit : répartit l'argent non affecté d'un bail sur ses
--     échéances ouvertes, la plus ancienne d'abord.
--  5. record_payment : un paiement et ses affectations en une transaction,
--     l'opération bancaire réclamée d'abord, sous un verrou par bail.
--  6. cancel_payment : annule un paiement et ses affectations, avec trace.
--  7. settle_lease_end, close_lease : un départ à venir met le bail en
--     préavis jusqu'à sa date ; le jour venu, le bail se clôt.
--  8. end_due_leases : chaque nuit, clôt les baux dont la date est arrivée.
--  9. roll_rent_periods : respecte le début du suivi, ouvre les mois au loyer
--     saisi d'avance quand il y en a un (et le met en vigueur le jour venu),
--     puis affecte les crédits.
-- 10. issue_charge_period : un décompte émis porte toujours son solde au
--     grand livre, dans la même transaction.
-- 11. my_lease_credit : le locataire lit son crédit, et rien d'autre des
--     paiements.
-- 12. portal_tenant_live_lease : une partie sortie du bail n'y écrit plus.
-- 13. lease_keeps_tenant : un bail en cours n'est jamais laissé sans
--     locataire présent.
-- 14. arrears_actions_period_stage_key : une étape de relance par échéance.
-- 15. properties.request_key : un bien créé une fois par requête.
-- 16. lease_parties_present_key : une place par personne et par titre.
--
-- Les fonctions appelées par l'application sont SECURITY INVOKER : elles
-- écrivent sous le jeton de l'appelant, les politiques RLS décident, et
-- chacune vérifie en plus `gestion.can()` sur l'espace de la ligne. Les deux
-- fonctions de nuit sont SECURITY DEFINER, `search_path` vide, et ne sont
-- exécutables par aucun rôle client : seul le planificateur les appelle.
--
-- Réversible :
--   drop index if exists gestion.lease_parties_present_key;
--   drop index if exists gestion.properties_request_key;
--   alter table gestion.properties drop column request_key;
--   drop index if exists gestion.arrears_actions_period_stage_key;
--   drop trigger lease_keeps_tenant on gestion.lease_parties;
--   drop trigger lease_starts_with_tenant on gestion.leases;
--   drop function gestion.guard_live_lease_tenant();
--   recréer gestion.portal_tenant_live_lease telle qu'en 0015 ;
--   drop function gestion.my_lease_credit();
--   select cron.unschedule('gestion-end-due-leases');
--   drop function gestion.end_due_leases();
--   drop function gestion.close_lease(uuid, date);
--   drop function gestion.settle_lease_end(uuid);
--   drop function gestion.issue_charge_period(uuid, date, date, text);
--   drop function gestion.cancel_payment(uuid, text);
--   drop function gestion.record_payment(uuid, integer, date, uuid, text, text, boolean, uuid[], jsonb, text, integer);
--   drop function gestion.apply_lease_credit(uuid, boolean);
--   drop view gestion.lease_credit;
--   drop index gestion.payments_bank_transaction_live_key, gestion.payments_request_key;
--   alter table gestion.payments drop column cancelled_at, drop column cancelled_by, drop column cancel_reason, drop column request_key;
--   alter table gestion.leases drop column ledger_from;
--   alter table gestion.rent_periods drop column adjusted_at, drop column adjusted_by, drop column adjust_reason;
--   puis réappliquer le corps de roll_rent_periods de 0013.

-- ---------------------------------------------------------------------------
-- 1. Paiements : annulation tracée, idempotence
-- ---------------------------------------------------------------------------
alter table gestion.payments add column if not exists cancelled_at timestamptz;
alter table gestion.payments add column if not exists cancelled_by uuid;
alter table gestion.payments add column if not exists cancel_reason text;
alter table gestion.payments add column if not exists request_key text;

comment on column gestion.payments.cancelled_at is
  'Paiement annulé : ses affectations sont contre-passées (reversed_at) et il ne compte plus. Jamais supprimé.';
comment on column gestion.payments.request_key is
  'Clé de la requête qui a créé le paiement : la même requête rejouée ne crée rien.';

-- Une opération bancaire ne devient qu'un paiement. Un paiement annulé
-- libère l'opération, qui peut être rapprochée de nouveau.
create unique index if not exists payments_bank_transaction_live_key
  on gestion.payments (bank_transaction_id)
  where bank_transaction_id is not null and cancelled_at is null;

create unique index if not exists payments_request_key
  on gestion.payments (org_id, request_key)
  where request_key is not null;

-- ---------------------------------------------------------------------------
-- 2. Le début du suivi des loyers
-- ---------------------------------------------------------------------------
alter table gestion.leases add column if not exists ledger_from date;

comment on column gestion.leases.ledger_from is
  'Premier mois dont Morada suit le loyer (premier jour du mois). Nul : le premier mois déjà ouvert, sinon le début du bail.';

-- Le montant d'un mois fixé à la main (le premier ou le dernier mois au
-- prorata, un mois remis) : qui, quand, pourquoi.
alter table gestion.rent_periods add column if not exists adjusted_at timestamptz;
alter table gestion.rent_periods add column if not exists adjusted_by uuid;
alter table gestion.rent_periods add column if not exists adjust_reason text;

comment on column gestion.rent_periods.adjust_reason is
  'Pourquoi le montant du mois a été fixé à la main (prorata du premier ou du dernier mois, remise). Avec adjusted_at et adjusted_by.';

-- ---------------------------------------------------------------------------
-- 3. Le crédit d'un bail : reçu, pas encore affecté
-- ---------------------------------------------------------------------------
create or replace view gestion.lease_credit with (security_invoker = true) as
select
  p.org_id,
  p.lease_id,
  sum(p.amount_cents - coalesce(a.allocated_cents, 0))::integer as credit_cents
from gestion.payments p
left join lateral (
  select sum(pa.amount_cents) as allocated_cents
  from gestion.payment_allocations pa
  where pa.payment_id = p.id and pa.reversed_at is null
) a on true
where p.lease_id is not null and p.cancelled_at is null
group by p.org_id, p.lease_id
having sum(p.amount_cents - coalesce(a.allocated_cents, 0)) > 0;

comment on view gestion.lease_credit is
  'Par bail, ce qui a été reçu et n''est affecté à aucune échéance : le crédit du locataire. Lecture seule, sous la RLS de l''appelant.';

revoke all on gestion.lease_credit from public, anon;
revoke insert, update, delete on gestion.lease_credit from authenticated;
grant select on gestion.lease_credit to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Répartir l'argent non affecté d'un bail
-- ---------------------------------------------------------------------------
create or replace function gestion.apply_lease_credit(p_lease uuid, p_auto boolean default true)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  pay record;
  per record;
  v_left integer;
  v_take integer;
  v_total integer := 0;
begin
  -- Un seul écrivain par bail, jusqu'à la fin de la transaction.
  perform pg_advisory_xact_lock(hashtext('gestion.ledger:' || p_lease::text));

  for pay in
    select p.id, p.org_id,
           p.amount_cents - coalesce((
             select sum(a.amount_cents) from gestion.payment_allocations a
             where a.payment_id = p.id and a.reversed_at is null
           ), 0) as left_cents
    from gestion.payments p
    where p.lease_id = p_lease and p.cancelled_at is null
    order by p.received_on, p.created_at, p.id
  loop
    v_left := pay.left_cents;
    continue when v_left <= 0;
    for per in
      select rp.id,
             rp.total_cents - coalesce((
               select sum(a.amount_cents) from gestion.payment_allocations a
               where a.rent_period_id = rp.id and a.reversed_at is null
             ), 0) as open_cents
      from gestion.rent_periods rp
      where rp.lease_id = p_lease and not rp.written_off
      order by rp.due_date, rp.period, rp.id
    loop
      exit when v_left <= 0;
      continue when per.open_cents <= 0;
      v_take := least(v_left, per.open_cents);
      insert into gestion.payment_allocations (org_id, payment_id, rent_period_id, amount_cents, auto, allocated_by)
      values (pay.org_id, pay.id, per.id, v_take, p_auto, auth.uid());
      v_left := v_left - v_take;
      v_total := v_total + v_take;
    end loop;
  end loop;
  return v_total;
end;
$$;

comment on function gestion.apply_lease_credit(uuid, boolean) is
  'Affecte l''argent reçu et non affecté d''un bail à ses échéances ouvertes, la plus ancienne d''abord. Idempotente. Sous la RLS de l''appelant.';

-- ---------------------------------------------------------------------------
-- 5. Un paiement et ses affectations, en une transaction
-- ---------------------------------------------------------------------------
create or replace function gestion.record_payment(
  p_lease uuid,
  p_amount_cents integer,
  p_received_on date,
  p_bank_transaction uuid default null,
  p_method text default 'transfer',
  p_note text default null,
  p_auto boolean default false,
  p_periods uuid[] default null,
  p_match jsonb default null,
  p_request_key text default null,
  p_twin_days integer default 0
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid;
  v_payment uuid;
  v_amount integer;
  v_claimed uuid;
  v_linked boolean := false;
  v_left integer;
  v_take integer;
  v_allocated integer;
  per record;
begin
  if p_amount_cents is null or p_amount_cents <= 0 or p_received_on is null then
    raise exception 'gestion: invalid payment' using errcode = '22023';
  end if;

  select l.org_id into v_org from gestion.leases l where l.id = p_lease;
  if v_org is null or not gestion.can(v_org, 'gestion.finance.edit') then
    raise exception 'gestion: lease not found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtext('gestion.ledger:' || p_lease::text));

  -- La même requête rejouée (double clic, réponse perdue) ne crée rien.
  if p_request_key is not null then
    select p.id, p.amount_cents into v_payment, v_amount
    from gestion.payments p
    where p.org_id = v_org and p.request_key = p_request_key;
    if found then
      select coalesce(sum(a.amount_cents), 0)::integer into v_allocated
      from gestion.payment_allocations a
      where a.payment_id = v_payment and a.reversed_at is null;
      return jsonb_build_object('payment_id', v_payment, 'allocated', v_allocated,
        'credit', greatest(v_amount - v_allocated, 0), 'linked', false, 'replayed', true);
    end if;
  end if;

  if p_bank_transaction is not null then
    -- L'opération est réclamée d'abord : une seule requête la fait passer de
    -- « à traiter » à « rapprochée », l'autre n'y trouve plus rien.
    update gestion.bank_transactions t
       set match_status = case when p_auto then 'auto' else 'manual' end,
           match_tier = coalesce(p_match ->> 'tier', case when p_auto then null else 'manual' end),
           match_confidence = (p_match ->> 'confidence')::numeric,
           match_explain = p_match ->> 'explain'
     where t.id = p_bank_transaction
       and t.org_id = v_org
       and t.match_status in ('unmatched', 'review')
       and t.amount_cents = p_amount_cents
    returning t.id into v_claimed;
    if v_claimed is null then
      raise exception 'gestion: operation already matched' using errcode = 'P0001';
    end if;

    -- Le même argent déjà saisi à la main sur ce bail : l'opération est
    -- rattachée à ce paiement, rien n'est compté deux fois.
    if coalesce(p_twin_days, 0) > 0 then
      select p.id into v_payment
      from gestion.payments p
      where p.org_id = v_org
        and p.lease_id = p_lease
        and p.bank_transaction_id is null
        and p.cancelled_at is null
        and p.amount_cents = p_amount_cents
        and p.received_on between p_received_on - p_twin_days and p_received_on + p_twin_days
      order by abs(p.received_on - p_received_on), p.created_at, p.id
      limit 1
      for update;
      if found then
        update gestion.payments set bank_transaction_id = p_bank_transaction where id = v_payment;
        v_linked := true;
      end if;
    end if;
  end if;

  if not v_linked then
    insert into gestion.payments (org_id, lease_id, bank_transaction_id, received_on, amount_cents, method, note, request_key)
    values (v_org, p_lease, p_bank_transaction, p_received_on, p_amount_cents, coalesce(p_method, 'transfer'), nullif(p_note, ''), p_request_key)
    returning id into v_payment;

    -- Les échéances que le rapprochement a désignées passent d'abord.
    if p_periods is not null then
      v_left := p_amount_cents;
      for per in
        select rp.id,
               rp.total_cents - coalesce((
                 select sum(a.amount_cents) from gestion.payment_allocations a
                 where a.rent_period_id = rp.id and a.reversed_at is null
               ), 0) as open_cents
        from gestion.rent_periods rp
        where rp.id = any (p_periods) and rp.org_id = v_org and rp.lease_id = p_lease and not rp.written_off
        order by rp.due_date, rp.period, rp.id
      loop
        exit when v_left <= 0;
        continue when per.open_cents <= 0;
        v_take := least(v_left, per.open_cents);
        insert into gestion.payment_allocations (org_id, payment_id, rent_period_id, amount_cents, auto, allocated_by)
        values (v_org, v_payment, per.id, v_take, p_auto, auth.uid());
        v_left := v_left - v_take;
      end loop;
    end if;
  end if;

  -- Le reste, et tout crédit antérieur du bail, vont aux échéances ouvertes.
  perform gestion.apply_lease_credit(p_lease, p_auto);

  select coalesce(sum(a.amount_cents), 0)::integer into v_allocated
  from gestion.payment_allocations a
  where a.payment_id = v_payment and a.reversed_at is null;

  return jsonb_build_object('payment_id', v_payment, 'allocated', v_allocated,
    'credit', greatest(p_amount_cents - v_allocated, 0), 'linked', v_linked, 'replayed', false);
end;
$$;

comment on function gestion.record_payment(uuid, integer, date, uuid, text, text, boolean, uuid[], jsonb, text, integer) is
  'Enregistre un paiement sur un bail et l''affecte, en une transaction : opération bancaire réclamée d''abord, verrou par bail, affectation de la plus ancienne échéance à la plus récente, le surplus gardé en crédit.';

-- ---------------------------------------------------------------------------
-- 6. Annuler un paiement
-- ---------------------------------------------------------------------------
create or replace function gestion.cancel_payment(p_payment uuid, p_reason text default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid;
  v_lease uuid;
  v_tx uuid;
  v_cancelled timestamptz;
  v_receipt boolean := false;
begin
  select p.org_id, p.lease_id into v_org, v_lease from gestion.payments p where p.id = p_payment;
  if v_org is null or not gestion.can(v_org, 'gestion.finance.edit') then
    raise exception 'gestion: payment not found' using errcode = 'P0002';
  end if;
  -- Le verrou du bail d'abord, la ligne ensuite : le même ordre que record_payment.
  if v_lease is not null then
    perform pg_advisory_xact_lock(hashtext('gestion.ledger:' || v_lease::text));
  end if;
  select p.bank_transaction_id, p.cancelled_at into v_tx, v_cancelled
  from gestion.payments p where p.id = p_payment for update;
  if v_cancelled is not null then
    return jsonb_build_object('ok', true, 'already', true, 'lease_id', v_lease, 'bank_transaction_id', v_tx);
  end if;

  -- Une quittance déjà produite atteste le paiement : il ne s'annule plus ici.
  if to_regclass('gestion.generated_documents') is not null then
    execute
      'select exists (
         select 1
         from gestion.payment_allocations a
         join gestion.generated_documents gd on gd.source_id = a.rent_period_id and gd.kind = ''rent_receipt''
         where a.payment_id = $1 and a.reversed_at is null)'
      into v_receipt using p_payment;
    if v_receipt then
      raise exception 'gestion: receipt issued' using errcode = 'P0001';
    end if;
  end if;

  update gestion.payment_allocations
     set reversed_at = now(), reversed_by = auth.uid()
   where payment_id = p_payment and reversed_at is null;

  update gestion.payments
     set cancelled_at = now(), cancelled_by = auth.uid(),
         cancel_reason = nullif(left(coalesce(p_reason, ''), 500), '')
   where id = p_payment;

  -- L'opération bancaire redevient à traiter.
  if v_tx is not null then
    update gestion.bank_transactions
       set match_status = 'review', match_tier = null, match_confidence = null, match_explain = 'payment_cancelled'
     where id = v_tx and org_id = v_org and match_status in ('auto', 'manual');
  end if;

  -- Ce que les échéances libérées peuvent recevoir d'un crédit existant.
  if v_lease is not null then
    perform gestion.apply_lease_credit(v_lease, true);
  end if;

  return jsonb_build_object('ok', true, 'already', false, 'lease_id', v_lease, 'bank_transaction_id', v_tx);
end;
$$;

comment on function gestion.cancel_payment(uuid, text) is
  'Annule un paiement : affectations contre-passées, auteur et date gardés, opération bancaire remise à traiter. Refusé quand une quittance couvre une de ses échéances.';

-- ---------------------------------------------------------------------------
-- 7. La fin d'un bail suit sa date
-- ---------------------------------------------------------------------------
create or replace function gestion.settle_lease_end(p_lease uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
  v_end date;
  v_after date;
  v_dropped integer := 0;
  v_n integer;
begin
  select l.status, l.end_date into v_status, v_end
  from gestion.leases l where l.id = p_lease for update;
  if not found then
    raise exception 'gestion: lease not found' using errcode = 'P0002';
  end if;
  if v_end is null or v_status = 'draft' then
    return jsonb_build_object('status', v_status, 'dropped', 0);
  end if;

  -- Les mois après le départ ne seront jamais dus. Sans rien reçu, l'échéance
  -- disparaît ; si elle porte un solde de décompte, seul le loyer en sort ;
  -- si elle a une histoire (une affectation annulée), elle est passée en perte.
  v_after := (date_trunc('month', v_end) + interval '1 month')::date;

  update gestion.rent_periods rp
     set rent_cents = 0, charges_cents = 0, vat_cents = 0
   where rp.lease_id = p_lease and rp.period >= v_after and rp.other_cents <> 0
     and (rp.rent_cents <> 0 or rp.charges_cents <> 0 or rp.vat_cents <> 0)
     and not exists (select 1 from gestion.payment_allocations a where a.rent_period_id = rp.id and a.reversed_at is null);

  delete from gestion.rent_periods rp
   where rp.lease_id = p_lease and rp.period >= v_after and rp.other_cents = 0
     and not exists (select 1 from gestion.payment_allocations a where a.rent_period_id = rp.id);
  get diagnostics v_dropped = row_count;

  update gestion.rent_periods rp
     set written_off = true
   where rp.lease_id = p_lease and rp.period >= v_after and rp.other_cents = 0 and not rp.written_off
     and not exists (select 1 from gestion.payment_allocations a where a.rent_period_id = rp.id and a.reversed_at is null);
  get diagnostics v_n = row_count;
  v_dropped := v_dropped + v_n;

  -- Le jour venu, le bail se clôt : les personnes sont sorties à cette date.
  if v_status in ('active', 'notice') and v_end <= gestion.today() then
    update gestion.leases
       set status = 'ended', details = coalesce(details, '{}'::jsonb) - 'departure', updated_at = now()
     where id = p_lease;
    update gestion.lease_parties set moved_out_on = v_end where lease_id = p_lease and moved_out_on is null;
    v_status := 'ended';
  end if;

  return jsonb_build_object('status', v_status, 'dropped', v_dropped);
end;
$$;

comment on function gestion.settle_lease_end(uuid) is
  'Aligne un bail sur sa date de fin : retire les échéances postérieures que rien n''a payées et, la date arrivée, clôt le bail. Idempotente. Sous la RLS de l''appelant.';

create or replace function gestion.close_lease(p_lease uuid, p_end_date date)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid;
  v_status text;
  v_start date;
  v_unit uuid;
  v_out jsonb;
begin
  select l.org_id, l.status, l.start_date, l.unit_id into v_org, v_status, v_start, v_unit
  from gestion.leases l where l.id = p_lease for update;
  if v_org is null or not gestion.can(v_org, 'gestion.leases.edit') then
    raise exception 'gestion: lease not found' using errcode = 'P0002';
  end if;
  if v_status = 'ended' then
    raise exception 'gestion: lease already ended' using errcode = 'P0001';
  end if;
  if v_status = 'draft' then
    raise exception 'gestion: lease not live' using errcode = 'P0001';
  end if;
  if p_end_date is null or p_end_date <= v_start then
    raise exception 'gestion: end before start' using errcode = '22023';
  end if;

  -- Une date à venir est un préavis : le bail reste en cours jusqu'à ce jour,
  -- le lot reste occupé, le loyer reste dû. Aujourd'hui ou avant : il se clôt.
  update gestion.leases
     set status = case when p_end_date > gestion.today() then 'notice' else status end,
         end_date = p_end_date,
         updated_at = now()
   where id = p_lease;

  v_out := gestion.settle_lease_end(p_lease);
  return v_out || jsonb_build_object('end_date', p_end_date, 'unit_id', v_unit);
end;
$$;

comment on function gestion.close_lease(uuid, date) is
  'Enregistre le départ d''un locataire : préavis jusqu''à la date quand elle est à venir, clôture sinon. Une transaction.';

-- ---------------------------------------------------------------------------
-- 8. Chaque nuit : les baux dont la date de fin est arrivée se clôturent
-- ---------------------------------------------------------------------------
create or replace function gestion.end_due_leases()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_count integer := 0;
begin
  for r in
    select l.id
    from gestion.leases l
    where l.status in ('active', 'notice')
      and l.end_date is not null
      and l.end_date <= gestion.today()
  loop
    perform gestion.settle_lease_end(r.id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

comment on function gestion.end_due_leases() is
  'Clôt chaque bail en cours dont la date de fin est arrivée. Appelée par le planificateur seulement.';

-- ---------------------------------------------------------------------------
-- 9. Le grand livre se prolonge depuis le début du suivi, puis reçoit les crédits
-- ---------------------------------------------------------------------------
create or replace function gestion.roll_rent_periods(as_of date default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted integer;
  v_day date := coalesce(as_of, gestion.today());
  r record;
begin
  -- Un loyer saisi d'avance (details.rentChange) devient le loyer en vigueur
  -- le premier jour de son mois ; l'ancien reste comme loyer précédent.
  update gestion.leases l
     set previous_rent_cents = case
           when (l.details -> 'rentChange' ->> 'rentCents')::integer <> l.rent_cents then l.rent_cents
           else l.previous_rent_cents
         end,
         rent_cents = (l.details -> 'rentChange' ->> 'rentCents')::integer,
         charges_cents = (l.details -> 'rentChange' ->> 'chargesCents')::integer,
         details = l.details - 'rentChange',
         updated_at = now()
   where l.status in ('active', 'notice')
     and l.details ? 'rentChange'
     and case
           when (l.details -> 'rentChange' ->> 'from') ~ '^\d{4}-\d{2}-01$'
            and (l.details -> 'rentChange' ->> 'rentCents') ~ '^[1-9]\d{0,8}$'
            and (l.details -> 'rentChange' ->> 'chargesCents') ~ '^\d{1,9}$'
           then (l.details -> 'rentChange' ->> 'from')::date <= date_trunc('month', v_day)::date
           else false
         end;

  with live as (
    select l.id, l.org_id, l.start_date, l.end_date, l.rent_cents, l.charges_cents, l.payment_day,
           -- Le loyer saisi d'avance, pour les mois à partir du sien.
           case when (l.details -> 'rentChange' ->> 'from') ~ '^\d{4}-\d{2}-01$'
                 and (l.details -> 'rentChange' ->> 'rentCents') ~ '^[1-9]\d{0,8}$'
                 and (l.details -> 'rentChange' ->> 'chargesCents') ~ '^\d{1,9}$'
                then (l.details -> 'rentChange' ->> 'from')::date end as change_from,
           (l.details -> 'rentChange' ->> 'rentCents') as change_rent,
           (l.details -> 'rentChange' ->> 'chargesCents') as change_charges,
           -- Le suivi commence au mois choisi ; à défaut, au premier mois déjà
           -- ouvert : une date de début corrigée n'ouvre jamais de loyers passés.
           coalesce(l.ledger_from, (select min(rp.period) from gestion.rent_periods rp where rp.lease_id = l.id)) as tracked_from
    from gestion.leases l
    where l.status in ('active', 'notice')
  ),
  bounds as (
    select
      live.*,
      greatest(
        date_trunc('month', live.start_date)::date,
        (date_trunc('month', v_day) - interval '11 months')::date,
        date_trunc('month', coalesce(live.tracked_from, live.start_date))::date
      ) as from_month,
      least(
        (date_trunc('month', v_day) + interval '1 month')::date,
        coalesce(date_trunc('month', live.end_date)::date, (date_trunc('month', v_day) + interval '1 month')::date)
      ) as to_month
    from live
  ),
  months as (
    select b.*, m::date as period
    from bounds b
    cross join lateral generate_series(b.from_month, b.to_month, interval '1 month') as m
  )
  insert into gestion.rent_periods (org_id, lease_id, period, due_date, rent_cents, charges_cents, other_cents, vat_cents)
  select org_id, id, period, greatest((period + (payment_day - 1))::date, start_date),
         case when change_from is not null and period >= change_from then change_rent::integer else rent_cents end,
         case when change_from is not null and period >= change_from then change_charges::integer else charges_cents end,
         0, 0
  from months
  on conflict (lease_id, period) do nothing;

  get diagnostics inserted = row_count;

  -- Un crédit attend l'échéance suivante : elle vient peut-être de s'ouvrir.
  for r in select c.lease_id from gestion.lease_credit c loop
    perform gestion.apply_lease_credit(r.lease_id, true);
  end loop;

  return inserted;
end;
$$;

comment on function gestion.roll_rent_periods(date) is
  'Ouvre les échéances mensuelles manquantes de chaque bail en cours, du début du suivi au mois prochain, puis affecte les crédits en attente. Idempotente. Miroir SQL de openLedger.';

-- ---------------------------------------------------------------------------
-- 10. Un décompte émis porte son solde au grand livre
-- ---------------------------------------------------------------------------
create or replace function gestion.issue_charge_period(p_period uuid, p_issued_on date, p_due_on date, p_label text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid;
  v_lease uuid;
  v_status text;
  v_balance integer;
  v_month date := date_trunc('month', gestion.today())::date;
  v_target uuid;
  v_carried date;
  v_other integer;
  v_other_label text;
  v_live boolean;
  l record;
begin
  select cp.org_id, cp.lease_id, cp.status, cp.balance_cents into v_org, v_lease, v_status, v_balance
  from gestion.charge_periods cp where cp.id = p_period for update;
  if v_org is null or not gestion.can(v_org, 'gestion.finance.edit') then
    raise exception 'gestion: charge period not found' using errcode = 'P0002';
  end if;
  if v_status <> 'draft' then
    raise exception 'gestion: not a draft' using errcode = 'P0001';
  end if;
  if p_issued_on is null or p_due_on is null or p_due_on < p_issued_on then
    raise exception 'gestion: invalid dates' using errcode = '22023';
  end if;

  update gestion.charge_periods set status = 'issued', issued_on = p_issued_on, due_on = p_due_on where id = p_period;

  if v_balance > 0 then
    perform pg_advisory_xact_lock(hashtext('gestion.ledger:' || v_lease::text));
    -- La première échéance, de ce mois en avant, que personne n'a commencé à
    -- payer et qui ne tombe pas avant l'échéance du décompte : le solde n'est
    -- jamais dû plus tôt que ce que le décompte annonce au locataire.
    select rp.id, rp.period, rp.other_cents, rp.other_label into v_target, v_carried, v_other, v_other_label
    from gestion.rent_periods rp
    where rp.lease_id = v_lease and rp.period >= v_month and not rp.written_off
      and rp.due_date >= p_due_on
      and not exists (select 1 from gestion.payment_allocations a where a.rent_period_id = rp.id and a.reversed_at is null)
    order by rp.period
    limit 1
    for update;

    if v_target is not null then
      update gestion.rent_periods
         set other_cents = v_other + v_balance,
             other_label = case
               when v_other_label is null or v_other_label = '' or v_other_label = p_label then p_label
               else v_other_label || ' · ' || p_label
             end
       where id = v_target;
    else
      -- Aucune échéance libre à temps (tout est payé d'avance, le mois est
      -- déjà échu, ou le bail est clos) : le solde ouvre sa propre échéance,
      -- au premier mois sans ligne qui ne tombe pas avant celle du décompte.
      select le.status, le.end_date, le.start_date, le.rent_cents, le.charges_cents, le.payment_day into l
      from gestion.leases le where le.id = v_lease;
      v_live := l.status in ('active', 'notice');
      v_carried := v_month;
      loop
        exit when not exists (select 1 from gestion.rent_periods rp where rp.lease_id = v_lease and rp.period = v_carried)
          and (not v_live or greatest((v_carried + (l.payment_day - 1))::date, l.start_date) >= p_due_on);
        v_carried := (v_carried + interval '1 month')::date;
      end loop;
      if v_live and (l.end_date is null or v_carried <= date_trunc('month', l.end_date)::date) then
        -- Un mois que le bail devra de toute façon : son loyer, plus le solde.
        insert into gestion.rent_periods (org_id, lease_id, period, due_date, rent_cents, charges_cents, other_cents, other_label, vat_cents)
        values (v_org, v_lease, v_carried, greatest((v_carried + (l.payment_day - 1))::date, l.start_date), l.rent_cents, l.charges_cents, v_balance, p_label, 0);
      else
        insert into gestion.rent_periods (org_id, lease_id, period, due_date, rent_cents, charges_cents, other_cents, other_label, vat_cents)
        values (v_org, v_lease, v_carried, p_due_on, 0, 0, v_balance, p_label, 0);
      end if;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'balance_cents', v_balance, 'carried_to', v_carried);
end;
$$;

comment on function gestion.issue_charge_period(uuid, date, date, text) is
  'Émet un décompte en brouillon et porte son solde dû au grand livre, dans la même transaction : sur la première échéance libre, sinon sur une échéance propre.';

-- ---------------------------------------------------------------------------
-- 11. Ce que le locataire lit de son crédit
-- ---------------------------------------------------------------------------
-- Le locataire ne lit pas la table des paiements : la fonction lui rend, pour
-- chaque bail dont il est partie, l'argent reçu qu'aucune échéance ne porte
-- encore, et rien d'autre.
create or replace function gestion.my_lease_credit()
returns table (lease_id uuid, credit_cents integer)
language sql
stable
security definer
set search_path = ''
as $$
  select p.lease_id, sum(p.amount_cents - coalesce(a.allocated_cents, 0))::integer as credit_cents
    from gestion.payments p
    left join lateral (
      select sum(pa.amount_cents) as allocated_cents
        from gestion.payment_allocations pa
       where pa.payment_id = p.id and pa.reversed_at is null
    ) a on true
   where p.lease_id is not null
     and p.cancelled_at is null
     and gestion.portal_tenant_lease(p.lease_id)
   group by p.lease_id
  having sum(p.amount_cents - coalesce(a.allocated_cents, 0)) > 0
$$;

comment on function gestion.my_lease_credit() is
  'Par bail dont l''appelant est locataire : l''argent reçu non encore affecté (son crédit). Rien d''autre des paiements.';

-- ---------------------------------------------------------------------------
-- 12. Écrire depuis l'espace locataire : partie au bail, pas encore sortie
-- ---------------------------------------------------------------------------
-- Un colocataire sorti du bail (moved_out_on passé) garde la lecture de son
-- histoire ; il n'ouvre plus de demande et ne dépose plus de pièce.
create or replace function gestion.portal_tenant_live_lease(p_lease uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from gestion.leases l
      join gestion.lease_parties lp on lp.lease_id = l.id and lp.org_id = l.org_id
      join gestion.contacts c on c.id = lp.contact_id and c.org_id = l.org_id
     where l.id = p_lease
       and l.status in ('active', 'notice')
       and lp.role in ('tenant', 'colocataire')
       and (lp.moved_out_on is null or lp.moved_out_on > gestion.today())
       and c.user_id = auth.uid()
  )
$$;

-- ---------------------------------------------------------------------------
-- 13. Un bail en cours garde un locataire
-- ---------------------------------------------------------------------------
-- Ni la sortie datée, ni le retrait, ni le changement de rôle d'une partie ne
-- laissent un bail en cours (actif ou en préavis) sans locataire présent ; un
-- dossier ne passe en cours qu'avec un locataire. Le départ de tous passe par
-- la clôture du bail, qui change d'abord le statut.
create or replace function gestion.guard_live_lease_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_lease uuid;
begin
  foreach v_lease in array (
    case
      when tg_table_name = 'leases' then array[new.id]
      when tg_op = 'DELETE' then array[old.lease_id]
      else array[old.lease_id, new.lease_id]
    end
  ) loop
    if exists (select 1 from gestion.leases l where l.id = v_lease and l.status in ('active', 'notice'))
       and not exists (
         select 1 from gestion.lease_parties lp
          where lp.lease_id = v_lease and lp.role in ('tenant', 'colocataire') and lp.moved_out_on is null
       ) then
      raise exception 'gestion: a tenancy in force keeps a tenant' using errcode = '23514';
    end if;
  end loop;
  return null;
end;
$$;

comment on function gestion.guard_live_lease_tenant() is
  'Refuse qu''un bail en cours reste sans locataire présent : sortie, retrait ou changement de rôle de la dernière partie, ou activation d''un dossier sans locataire.';

drop trigger if exists lease_keeps_tenant on gestion.lease_parties;
create trigger lease_keeps_tenant
  after delete or update of moved_out_on, role, lease_id on gestion.lease_parties
  for each row execute function gestion.guard_live_lease_tenant();

drop trigger if exists lease_starts_with_tenant on gestion.leases;
create trigger lease_starts_with_tenant
  after update of status on gestion.leases
  for each row
  when (old.status = 'draft' and new.status in ('active', 'notice'))
  execute function gestion.guard_live_lease_tenant();

-- ---------------------------------------------------------------------------
-- 14. Une étape de relance par échéance
-- ---------------------------------------------------------------------------
-- Deux clics ne font qu'une étape. Si la base porte déjà des doublons
-- (écrits avant cette règle), l'index n'est pas posé et une notice le dit :
-- les doublons se trient d'abord, la migration se rejoue ensuite.
do $$
begin
  if exists (
    select 1 from gestion.arrears_actions
     where rent_period_id is not null
     group by rent_period_id, stage
    having count(*) > 1
  ) then
    raise notice 'arrears_actions: duplicate steps exist, index arrears_actions_period_stage_key not created';
  else
    create unique index if not exists arrears_actions_period_stage_key
      on gestion.arrears_actions (rent_period_id, stage)
      where rent_period_id is not null;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 15. Un bien créé une fois par requête
-- ---------------------------------------------------------------------------
-- La clé que l'assistant envoie avec sa création : la même requête rejouée
-- (réponse perdue, second clic) retrouve le bien qu'elle a créé.
alter table gestion.properties add column if not exists request_key text;

comment on column gestion.properties.request_key is
  'Clé de la requête qui a créé le bien : la même requête rejouée ne crée rien.';

create unique index if not exists properties_request_key
  on gestion.properties (org_id, request_key)
  where request_key is not null;

-- ---------------------------------------------------------------------------
-- 16. Une personne n'a qu'une place à la fois sur un bail
-- ---------------------------------------------------------------------------
-- Deux enregistrements croisés d'un dossier ne mettent pas deux fois la même
-- personne au même titre. Une partie sortie (moved_out_on) peut revenir.
-- Posé seulement là où aucun doublon n'existe déjà (une notice le dit).
do $$
begin
  if exists (
    select 1 from gestion.lease_parties
     where moved_out_on is null
     group by lease_id, contact_id, role
    having count(*) > 1
  ) then
    raise notice 'lease_parties: duplicate places exist, index lease_parties_present_key not created';
  else
    create unique index if not exists lease_parties_present_key
      on gestion.lease_parties (lease_id, contact_id, role)
      where moved_out_on is null;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Droits d'exécution, explicites (même geste que 0018)
-- ---------------------------------------------------------------------------
revoke all on function gestion.apply_lease_credit(uuid, boolean) from public, anon;
revoke all on function gestion.record_payment(uuid, integer, date, uuid, text, text, boolean, uuid[], jsonb, text, integer) from public, anon;
revoke all on function gestion.cancel_payment(uuid, text) from public, anon;
revoke all on function gestion.settle_lease_end(uuid) from public, anon;
revoke all on function gestion.close_lease(uuid, date) from public, anon;
revoke all on function gestion.issue_charge_period(uuid, date, date, text) from public, anon;
revoke all on function gestion.my_lease_credit() from public, anon;
revoke all on function gestion.guard_live_lease_tenant() from public, anon, authenticated;
revoke all on function gestion.portal_tenant_live_lease(uuid) from public, anon;

grant execute on function gestion.apply_lease_credit(uuid, boolean) to authenticated;
grant execute on function gestion.record_payment(uuid, integer, date, uuid, text, text, boolean, uuid[], jsonb, text, integer) to authenticated;
grant execute on function gestion.cancel_payment(uuid, text) to authenticated;
grant execute on function gestion.settle_lease_end(uuid) to authenticated;
grant execute on function gestion.close_lease(uuid, date) to authenticated;
grant execute on function gestion.issue_charge_period(uuid, date, date, text) to authenticated;
grant execute on function gestion.my_lease_credit() to authenticated;
grant execute on function gestion.portal_tenant_live_lease(uuid) to authenticated;

-- Les fonctions de nuit ne sont pas des RPC : seul le planificateur les exécute.
revoke all on function gestion.end_due_leases() from public, anon, authenticated;
revoke all on function gestion.roll_rent_periods(date) from public, anon, authenticated;

-- Chaque nuit à 00:05 UTC, avant l'ouverture des échéances (00:10, 0012).
-- `cron.schedule` par nom est idempotent.
select cron.schedule('gestion-end-due-leases', '5 0 * * *', $$select gestion.end_due_leases()$$);
