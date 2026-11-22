-- ===========================================================================
-- 0035 · Registres et portail : les derniers points base de l'audit du
-- 19 novembre 2026 qu'aucune autre migration ne portait.
--
-- Prérequis : 0001 à 0034 (gestion.charge_periods et charge_lines de 0005,
-- gestion.activity de 0002, gestion.workspace_settings de 0022,
-- gestion.my_managers de 0015/0022).
--
-- 1. Un décompte émis ne se réécrit plus par l'API. Une fois émis (et
--    jusqu'au règlement), ses montants, son bail, son année, son régime et
--    ses dates restent ceux qui ont été envoyés ; il ne se supprime pas et
--    ne redevient pas brouillon. Seul son statut avance (contesté, réglé).
--    Ses lignes ne s'ajoutent, ne changent ni ne se retirent plus.
--    L'application n'écrit jamais autre chose sur un décompte émis.
-- 2. L'ancienne fonction d'invitation (gestion.portal_invite(uuid, text),
--    0006) n'est plus exécutable par un client : les invitations passent par
--    portal_invite_lease, que l'application web et l'iPhone appellent.
-- 3. Une ligne du journal d'activité reste dans l'espace qui l'a écrite.
-- 4. Ce que le locataire lit de son bailleur (gestion.my_managers) : le
--    contact que l'espace déclare (l'agence, puis l'identité du bailleur dans
--    les réglages), jamais l'adresse de connexion ni le téléphone du compte
--    propriétaire.
--
-- Les gardes ne s'appliquent qu'aux rôles des clients (authenticated, anon) :
-- la maintenance (postgres, tâches planifiées, rôle de service) n'est pas
-- concernée, comme gestion.guard_sealed (0030).
--
-- Réversible :
--   drop trigger guard_issued_charges on gestion.charge_periods;
--   drop trigger guard_issued_charges on gestion.charge_lines;
--   drop function gestion.guard_issued_charges();
--   drop trigger activity_org_fixed on gestion.activity;
--   drop function gestion.guard_org_fixed();
--   grant execute on function gestion.portal_invite(uuid, text) to authenticated;
--   recréer gestion.my_managers() telle qu'en 0015.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. UN DÉCOMPTE ÉMIS
-- ---------------------------------------------------------------------------
create or replace function gestion.guard_issued_charges()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_table_name = 'charge_periods' then
    if old.status in ('issued', 'disputed', 'settled') then
      if tg_op = 'DELETE' then
        raise exception 'gestion: an issued charge statement cannot be deleted' using errcode = '42501';
      end if;
      if new.status in ('open', 'draft')
         or new.org_id is distinct from old.org_id
         or new.lease_id is distinct from old.lease_id
         or new.year is distinct from old.year
         or new.regime is distinct from old.regime
         or new.advances_billed_cents is distinct from old.advances_billed_cents
         or new.actual_cents is distinct from old.actual_cents
         or new.issued_on is distinct from old.issued_on
         or new.due_on is distinct from old.due_on then
        raise exception 'gestion: an issued charge statement cannot be rewritten' using errcode = '42501';
      end if;
    end if;
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  -- charge_lines : la ligne d'un décompte émis, avant comme après l'écriture.
  if tg_op in ('UPDATE', 'DELETE') then
    select cp.status into v_status from gestion.charge_periods cp where cp.id = old.charge_period_id;
    if v_status in ('issued', 'disputed', 'settled') then
      raise exception 'gestion: the lines of an issued charge statement cannot be changed' using errcode = '42501';
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    select cp.status into v_status from gestion.charge_periods cp where cp.id = new.charge_period_id;
    if v_status in ('issued', 'disputed', 'settled') then
      raise exception 'gestion: the lines of an issued charge statement cannot be changed' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;
revoke all on function gestion.guard_issued_charges() from public, anon, authenticated;

drop trigger if exists guard_issued_charges on gestion.charge_periods;
create trigger guard_issued_charges before update or delete on gestion.charge_periods
  for each row execute function gestion.guard_issued_charges();
drop trigger if exists guard_issued_charges on gestion.charge_lines;
create trigger guard_issued_charges before insert or update or delete on gestion.charge_lines
  for each row execute function gestion.guard_issued_charges();

-- ---------------------------------------------------------------------------
-- 2. L'ANCIENNE FONCTION D'INVITATION
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('gestion.portal_invite(uuid, text)') is not null then
    execute 'revoke all on function gestion.portal_invite(uuid, text) from public, anon, authenticated';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. UNE LIGNE D'ACTIVITÉ RESTE DANS SON ESPACE
-- ---------------------------------------------------------------------------
create or replace function gestion.guard_org_fixed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.org_id is distinct from old.org_id then
    raise exception 'gestion: a row stays in its workspace' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke all on function gestion.guard_org_fixed() from public, anon, authenticated;

drop trigger if exists activity_org_fixed on gestion.activity;
create trigger activity_org_fixed before update of org_id on gestion.activity
  for each row execute function gestion.guard_org_fixed();

-- ---------------------------------------------------------------------------
-- 4. LE CONTACT DU BAILLEUR QUE LE LOCATAIRE LIT
-- ---------------------------------------------------------------------------
create or replace function gestion.my_managers()
returns table (org_id uuid, name text, email text, phone text)
language sql stable security definer
set search_path = ''
as $$
  select distinct on (a.id) a.id, a.name,
         coalesce(nullif(trim(a.email), ''), nullif(trim(ws.email), '')),
         coalesce(nullif(trim(a.phone), ''), nullif(trim(ws.phone), ''))
    from gestion.leases l
    join public.agencies a on a.id = l.org_id
    left join gestion.workspace_settings ws on ws.org_id = a.id
   where gestion.portal_tenant_lease(l.id)
   order by a.id;
$$;
revoke all on function gestion.my_managers() from public, anon;
grant execute on function gestion.my_managers() to authenticated;
