-- 0014 · Un lot ne porte qu'un dossier en préparation et qu'un bail en cours
-- Appliqué le 2026-09-19 (migration `gestion_one_lease_per_lot`).
--
-- Le cycle de vie d'un lot est : libre, dossier en préparation (brouillon),
-- location active, départ, ancien locataire dans l'historique, libre à
-- nouveau. Deux règles le tiennent, et elles doivent tenir dans la base
-- elle-même, pas seulement dans l'application :
--
--   1. au plus UN bail en cours (active ou notice) par lot ;
--   2. au plus UN brouillon par lot, et aucun brouillon sur un lot déjà loué.
--
-- Un déclencheur les vérifie à l'insertion et à chaque changement de statut
-- ou de lot, sous un verrou consultatif par lot pour que deux écritures
-- simultanées ne passent pas toutes les deux. Il ne touche pas aux lignes
-- existantes : un lot qui porte déjà deux brouillons (état antérieur à cette
-- règle) continue de fonctionner, et le brouillon en trop se retire depuis
-- la fiche du bien. Un bail qui se clôture (status = ended) n'est jamais
-- bloqué, une suppression non plus.
--
-- Les erreurs portent le code 23505 (unique_violation) et un message stable
-- que l'application traduit : « gestion: lot already let » et
-- « gestion: one draft dossier per lot ».
--
-- Additif et réversible :
--   drop trigger if exists leases_one_per_lot on gestion.leases;
--   drop function if exists gestion.enforce_one_lease_per_lot();

create or replace function gestion.enforce_one_lease_per_lot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Un verrou par lot, tenu jusqu'à la fin de la transaction.
  perform pg_advisory_xact_lock(hashtext('gestion.leases:' || new.unit_id::text));

  if new.status = 'draft' then
    if exists (
      select 1 from gestion.leases l
      where l.unit_id = new.unit_id and l.id <> new.id and l.status = 'draft'
    ) then
      raise exception 'gestion: one draft dossier per lot'
        using errcode = '23505', constraint = 'leases_one_draft_per_lot';
    end if;
    if exists (
      select 1 from gestion.leases l
      where l.unit_id = new.unit_id and l.id <> new.id and l.status in ('active', 'notice')
    ) then
      raise exception 'gestion: lot already let'
        using errcode = '23505', constraint = 'leases_one_live_per_lot';
    end if;
  elsif new.status in ('active', 'notice') then
    if exists (
      select 1 from gestion.leases l
      where l.unit_id = new.unit_id and l.id <> new.id and l.status in ('active', 'notice')
    ) then
      raise exception 'gestion: lot already let'
        using errcode = '23505', constraint = 'leases_one_live_per_lot';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function gestion.enforce_one_lease_per_lot() from public;

drop trigger if exists leases_one_per_lot on gestion.leases;
create trigger leases_one_per_lot
  before insert or update of status, unit_id on gestion.leases
  for each row execute function gestion.enforce_one_lease_per_lot();
