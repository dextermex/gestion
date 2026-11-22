-- 0033 · API : des limites de débit comptées en base, et les demandes de
-- suppression de compte que l'équipe peut lister
-- Proposé, non appliqué en production (voir APPLIQUE.md). Rejoué
-- automatiquement sur la base jetable des tests de bout en bout.
--
-- Tout est additif et rejouable : aucune table, policy ni fonction existante
-- n'est modifiée.
--
-- 1. gestion.rate_counters + gestion.rate_take(...) : l'application n'a pas de
--    mémoire partagée entre ses instances, donc les routes qui envoient un
--    e-mail, appellent un service payant ou ouvrent une session chez un
--    prestataire comptent leurs appels ici, sous le jeton de l'appelant, par
--    personne et par espace. Un compteur ne peut que monter : appeler la
--    fonction directement ne rend aucune allocation, et l'on ne compte sur un
--    espace que si l'on en est membre actif.
--
-- 2. gestion.account_requests : une demande de suppression de compte est une
--    ligne datée par la base, que la personne lit et retire, et que l'équipe
--    liste depuis le tableau de bord. Rien n'est effacé par cette table.
--
-- L'application fonctionne sans ce fichier : sans rate_take les routes ne
-- limitent pas (et le journalisent), sans account_requests la demande reste
-- notée sur le compte comme avant.
--
-- Réversible :
--   drop function gestion.rate_take(text, uuid, integer, integer, integer);
--   drop table gestion.rate_counters;
--   drop table gestion.account_requests;

-- ---------------------------------------------------------------------------
-- 1. Limites de débit
-- ---------------------------------------------------------------------------
create table if not exists gestion.rate_counters (
  -- 'u:<compte>' ou 'o:<espace>'
  subject        text        not null check (subject ~ '^[uo]:[0-9a-f-]{36}$'),
  action         text        not null check (action ~ '^[a-z][a-z0-9_.]{0,63}$'),
  window_seconds integer     not null check (window_seconds between 10 and 86400),
  window_start   timestamptz not null,
  hits           integer     not null default 0 check (hits >= 0),
  primary key (subject, action, window_seconds, window_start)
);

alter table gestion.rate_counters enable row level security;

-- Les droits par défaut du schéma donnent lecture et écriture à
-- `authenticated` : ici seule la fonction écrit.
revoke all on gestion.rate_counters from public, anon, authenticated;
grant select on gestion.rate_counters to authenticated;

-- Chacun lit ses propres compteurs, rien d'autre ; aucune policy d'écriture.
drop policy if exists rate_counters_own_select on gestion.rate_counters;
create policy rate_counters_own_select on gestion.rate_counters
  for select to authenticated
  using (subject = 'u:' || (select auth.uid())::text);

-- Compte un appel et dit s'il reste dans les limites. `p_org` nul : seul le
-- compteur de la personne est tenu (routes du locataire). Une limite nulle
-- n'est pas vérifiée. Vrai : l'appel peut avoir lieu.
create or replace function gestion.rate_take(
  p_action         text,
  p_org            uuid,
  p_window_seconds integer,
  p_user_max       integer,
  p_org_max        integer
)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user   uuid := auth.uid();
  v_window integer := least(greatest(coalesce(p_window_seconds, 3600), 10), 86400);
  v_start  timestamptz;
  v_hits   integer;
  v_ok     boolean := true;
begin
  if v_user is null then
    raise exception 'gestion: not signed in' using errcode = '42501';
  end if;
  if p_action is null or p_action !~ '^[a-z][a-z0-9_.]{0,63}$' then
    raise exception 'gestion: invalid action' using errcode = '22023';
  end if;
  -- On ne compte sur un espace que si l'on en est membre actif : personne ne
  -- consomme l'allocation d'un espace qui n'est pas le sien.
  if p_org is not null and not exists (
    select 1
      from public.crm_members m
     where m.agency_id = p_org
       and m.user_id = v_user
       and m.status = 'active'
  ) then
    raise exception 'gestion: not a member of this workspace' using errcode = '42501';
  end if;

  v_start := to_timestamp(floor(extract(epoch from now()) / v_window) * v_window);

  insert into gestion.rate_counters as c (subject, action, window_seconds, window_start, hits)
  values ('u:' || v_user::text, p_action, v_window, v_start, 1)
  on conflict (subject, action, window_seconds, window_start)
  do update set hits = c.hits + 1
  returning c.hits into v_hits;
  if p_user_max is not null and v_hits > greatest(p_user_max, 0) then
    v_ok := false;
  end if;

  if p_org is not null then
    insert into gestion.rate_counters as c (subject, action, window_seconds, window_start, hits)
    values ('o:' || p_org::text, p_action, v_window, v_start, 1)
    on conflict (subject, action, window_seconds, window_start)
    do update set hits = c.hits + 1
    returning c.hits into v_hits;
    if p_org_max is not null and v_hits > greatest(p_org_max, 0) then
      v_ok := false;
    end if;
  end if;

  -- Ménage : les fenêtres closes depuis plus de deux jours, pour ces deux sujets.
  delete from gestion.rate_counters r
   where r.subject in ('u:' || v_user::text, 'o:' || coalesce(p_org::text, ''))
     and r.window_start < now() - interval '2 days';

  return v_ok;
end
$$;

comment on function gestion.rate_take(text, uuid, integer, integer, integer) is
  'Compte un appel (par personne, et par espace si l''appelant en est membre actif) et dit s''il reste dans les limites. Un compteur ne peut que monter.';

revoke all on function gestion.rate_take(text, uuid, integer, integer, integer) from public, anon;
grant execute on function gestion.rate_take(text, uuid, integer, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Demandes de suppression de compte
-- ---------------------------------------------------------------------------
create table if not exists gestion.account_requests (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null default auth.uid(),
  kind         text        not null default 'deletion' check (kind in ('deletion')),
  -- L'adresse du compte au moment de la demande, pour que l'équipe réponde.
  email        text        check (email is null or char_length(email) <= 320),
  requested_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  -- Renseigné par l'équipe (tableau de bord), jamais par l'application.
  handled_at   timestamptz,
  note         text
);

-- Une seule demande ouverte par compte.
create unique index if not exists account_requests_open_idx
  on gestion.account_requests (user_id, kind)
  where withdrawn_at is null and handled_at is null;
create index if not exists account_requests_at_idx
  on gestion.account_requests (requested_at desc);

alter table gestion.account_requests enable row level security;

-- La date et le compte viennent de la base, pas de l'appelant : seules la
-- nature et l'adresse s'écrivent à la création, seul le retrait se modifie.
revoke all on gestion.account_requests from public, anon, authenticated;
grant select on gestion.account_requests to authenticated;
grant insert (kind, email) on gestion.account_requests to authenticated;
grant update (withdrawn_at) on gestion.account_requests to authenticated;

drop policy if exists account_requests_own_select on gestion.account_requests;
create policy account_requests_own_select on gestion.account_requests
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists account_requests_own_insert on gestion.account_requests;
create policy account_requests_own_insert on gestion.account_requests
  for insert to authenticated
  with check (user_id = (select auth.uid()) and withdrawn_at is null and handled_at is null);

-- Retirer sa propre demande tant que l'équipe ne l'a pas traitée.
drop policy if exists account_requests_own_withdraw on gestion.account_requests;
create policy account_requests_own_withdraw on gestion.account_requests
  for update to authenticated
  using (user_id = (select auth.uid()) and handled_at is null)
  with check (user_id = (select auth.uid()) and handled_at is null);

comment on table gestion.account_requests is
  'Demandes de suppression de compte (RGPD art. 17), datées par la base. L''équipe les liste et renseigne handled_at ; rien n''est effacé par cette table.';
