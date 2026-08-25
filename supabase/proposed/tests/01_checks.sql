-- ===========================================================================
-- TESTS — à exécuter sur une base jetable, après la fixture et 0001 à 0006.
--
-- Six scénarios, ceux du brief :
--   1. structure : RLS active et au moins une policy sur chaque table
--   2. non-régression : public.g_can et les tables g_* intactes
--   3. isolation : le gestionnaire A ne voit rien du patrimoine B
--   4. URL trafiquée : lire par identifiant un bien d'autrui renvoie zéro ligne
--   5. multi-rôle : un même compte locataire chez Pierre et bailleur chez lui
--   6. anonyme : aucune lecture sans session
--
-- Chaque test lève une exception s'il échoue ; un run silencieux vaut succès.
-- ===========================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- 1. STRUCTURE
-- ---------------------------------------------------------------------------
do $$
declare n int; bad text;
begin
  select count(*) into n from pg_tables where schemaname = 'gestion';
  if n < 60 then raise exception 'Attendu au moins 60 tables dans gestion, trouvé %', n; end if;

  select string_agg(tablename, ', ') into bad
    from pg_tables where schemaname = 'gestion' and not rowsecurity;
  if bad is not null then raise exception 'Tables sans RLS : %', bad; end if;

  select string_agg(t.tablename, ', ') into bad
    from pg_tables t
   where t.schemaname = 'gestion'
     and not exists (select 1 from pg_policies p
                      where p.schemaname = 'gestion' and p.tablename = t.tablename);
  if bad is not null then raise exception 'Tables sans policy : %', bad; end if;

  if exists (select 1 from information_schema.role_table_grants
              where table_schema = 'gestion' and grantee = 'anon') then
    raise exception 'anon a reçu des droits sur gestion';
  end if;

  raise notice '1. structure : % tables, RLS et policies partout, anon exclu', n;
end $$;

-- ---------------------------------------------------------------------------
-- 2. NON-REGRESSION SUR public
-- ---------------------------------------------------------------------------
do $$
declare src text;
begin
  src := pg_get_functiondef('public.g_can(uuid, text)'::regprocedure);
  if src not like '%crm_member_agencies%' then
    raise exception 'public.g_can ne lit plus crm_members : elle a été écrasée';
  end if;
  if src like '%org_members%' then
    raise exception 'public.g_can lit org_members : elle a été écrasée';
  end if;
  if to_regclass('public.orgs') is not null or to_regclass('public.org_members') is not null then
    raise exception 'orgs / org_members ont été créées dans public';
  end if;
  if to_regclass('public.g_properties') is null or to_regclass('public.g_leases') is null then
    raise exception 'les tables g_* de l''ancien /gestion ont disparu';
  end if;
  raise notice '2. non-régression : public.g_can intacte, aucune table orgs, g_* intactes';
end $$;

-- ---------------------------------------------------------------------------
-- JEU D'ESSAI
-- ---------------------------------------------------------------------------
do $$
declare
  u_a uuid; u_b uuid; u_jean uuid; u_sophie uuid;
  o_a uuid; o_b uuid; o_pierre uuid; o_jean uuid;
  p_a uuid; p_b uuid; p_p uuid; p_j uuid;
  un_p uuid; un_j uuid;
  l_p uuid; l_j uuid;
  c_jean_chez_pierre uuid; c_jean_chez_lui uuid; c_sophie uuid;
begin
  insert into auth.users (email) values ('a@cabinet-a.lu')  returning id into u_a;
  insert into auth.users (email) values ('b@cabinet-b.lu')  returning id into u_b;
  insert into auth.users (email) values ('jean@example.lu') returning id into u_jean;
  insert into auth.users (email) values ('sophie@example.lu') returning id into u_sophie;

  insert into public.agencies (slug, name, kind, is_public) values
    ('cabinet-a', 'Cabinet A', 'manager', false) returning id into o_a;
  insert into public.agencies (slug, name, kind, is_public) values
    ('cabinet-b', 'Cabinet B', 'manager', false) returning id into o_b;
  insert into public.agencies (slug, name, kind, is_public) values
    ('pierre', 'Patrimoine Pierre', 'owner', false) returning id into o_pierre;
  insert into public.agencies (slug, name, kind, is_public) values
    ('jean', 'Patrimoine Jean', 'owner', false) returning id into o_jean;

  insert into public.crm_members (user_id, agency_id, role) values
    (u_a, o_a, 'owner'), (u_b, o_b, 'owner'), (u_jean, o_jean, 'owner');

  insert into gestion.properties (org_id, name, commune) values (o_a, 'Résidence A', 'Luxembourg') returning id into p_a;
  insert into gestion.properties (org_id, name, commune) values (o_b, 'Résidence B', 'Esch')       returning id into p_b;
  insert into gestion.properties (org_id, name, commune) values (o_pierre, 'Maison Pierre', 'Esch') returning id into p_p;
  insert into gestion.properties (org_id, name, commune) values (o_jean, 'Studio Jean', 'Luxembourg') returning id into p_j;

  insert into gestion.units (org_id, property_id, label) values (o_pierre, p_p, 'Appartement 1') returning id into un_p;
  insert into gestion.units (org_id, property_id, label) values (o_jean,   p_j, 'Studio')        returning id into un_j;

  -- Jean est locataire chez Pierre, et bailleur de Sophie chez lui.
  insert into gestion.contacts (org_id, first_name, last_name, user_id)
    values (o_pierre, 'Jean', 'Weber', u_jean) returning id into c_jean_chez_pierre;
  insert into gestion.contacts (org_id, first_name, last_name, user_id)
    values (o_jean, 'Jean', 'Weber', u_jean) returning id into c_jean_chez_lui;
  insert into gestion.contacts (org_id, first_name, last_name)
    values (o_jean, 'Sophie', 'Muller') returning id into c_sophie;

  insert into gestion.leases (org_id, unit_id, status, start_date, rent_cents)
    values (o_pierre, un_p, 'active', date '2025-01-01', 120000) returning id into l_p;
  insert into gestion.leases (org_id, unit_id, status, start_date, rent_cents)
    values (o_jean, un_j, 'active', date '2025-03-01', 90000) returning id into l_j;

  insert into gestion.lease_parties (org_id, lease_id, contact_id, role)
    values (o_pierre, l_p, c_jean_chez_pierre, 'tenant');
  insert into gestion.lease_parties (org_id, lease_id, contact_id, role)
    values (o_jean, l_j, c_sophie, 'tenant');

  -- Jean détient son studio en direct.
  insert into gestion.property_ownership (org_id, property_id, contact_id, share_pct, from_date)
    values (o_jean, p_j, c_jean_chez_lui, 100, date '2020-01-01');

  raise notice 'jeu d''essai : 4 comptes, 4 organisations, 4 biens, 2 baux';
end $$;

-- ---------------------------------------------------------------------------
-- 3 & 4. ISOLATION DES PATRIMOINES, Y COMPRIS PAR IDENTIFIANT DEVINE
-- ---------------------------------------------------------------------------
do $$
declare
  u_a uuid; u_b uuid; p_b uuid; n int;
begin
  select id into u_a from auth.users where email = 'a@cabinet-a.lu';
  select id into u_b from auth.users where email = 'b@cabinet-b.lu';
  select id into p_b from gestion.properties where name = 'Résidence B';

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u_a)::text, true);

  select count(*) into n from gestion.properties;
  if n <> 1 then raise exception '3. le gestionnaire A voit % biens au lieu de 1', n; end if;

  -- L'attaque du brief : on connaît l'identifiant du bien d'un autre.
  select count(*) into n from gestion.properties where id = p_b;
  if n <> 0 then raise exception '4. le gestionnaire A a lu le bien de B par son identifiant'; end if;

  select count(*) into n from gestion.leases;
  if n <> 0 then raise exception '3. le gestionnaire A voit des baux qui ne sont pas les siens'; end if;

  reset role;
  raise notice '3 & 4. isolation : A ne voit que son bien, et rien par identifiant';
end $$;

-- ---------------------------------------------------------------------------
-- 5. MULTI-ROLE — un seul compte, locataire ici, bailleur là
-- ---------------------------------------------------------------------------
do $$
declare u_jean uuid; n int; noms text;
begin
  select id into u_jean from auth.users where email = 'jean@example.lu';

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u_jean)::text, true);

  -- Deux baux : celui qu'il loue chez Pierre, celui qu'il loue à Sophie.
  select count(*) into n from gestion.leases;
  if n <> 2 then raise exception '5. Jean voit % baux au lieu de 2', n; end if;

  -- Côté bailleur : son studio, et rien d'autre.
  select string_agg(name, ', ' order by name) into noms from gestion.properties;
  if noms is distinct from 'Maison Pierre, Studio Jean' then
    raise exception '5. Jean voit les biens « % » au lieu de « Maison Pierre, Studio Jean »', noms;
  end if;

  -- Aucune fuite vers les cabinets A et B.
  select count(*) into n from gestion.properties where name in ('Résidence A', 'Résidence B');
  if n <> 0 then raise exception '5. Jean voit le patrimoine des cabinets A ou B'; end if;

  -- Locataire chez Pierre : il lit l'immeuble, jamais les chiffres du bailleur.
  select count(*) into n from gestion.property_acquisitions;
  if n <> 0 then raise exception '5. Jean lit les acquisitions d''un autre patrimoine'; end if;
  select count(*) into n from gestion.owner_ledger_entries;
  if n <> 0 then raise exception '5. Jean lit le compte propriétaire de Pierre'; end if;

  reset role;
  raise notice '5. multi-rôle : Jean voit ses 2 baux et ses 2 biens, sans second compte';
end $$;

-- ---------------------------------------------------------------------------
-- 6. ANONYME
-- ---------------------------------------------------------------------------
do $$
declare ok boolean := false;
begin
  set local role anon;
  begin
    perform 1 from gestion.properties;
  exception when insufficient_privilege then
    ok := true;
  end;
  reset role;
  if not ok then raise exception '6. un visiteur non connecté a pu interroger gestion.properties'; end if;
  raise notice '6. anonyme : accès refusé au niveau du schéma';
end $$;

do $$ begin raise notice 'TOUS LES TESTS PASSENT'; end $$;
