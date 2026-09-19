-- 0015 · Le portail locataire : invitations réelles, lecture du bail, demandes
-- Appliqué le 2026-09-19 (migration `gestion_tenant_portal`).
--
-- 0006 avait posé le lien fiche <-> compte (`contacts.user_id`), la table
-- des invitations, les prédicats `portal_*` et la vue restreinte
-- `my_home()`. Il manquait ce qu'un locataire lit vraiment dans son espace
-- (garantie, états des lieux, assurance, documents, allocations qui font le
-- statut d'une échéance, fil d'une demande), l'invitation rattachée à un
-- bail précis avec ses états (envoyée, acceptée, expirée, révoquée), et une
-- prévisualisation publique du lien pour la page « Votre logement vous
-- attend sur Morada ».
--
-- Tout est ADDITIF : aucune table renommée ni supprimée, des policies
-- permissives supplémentaires (elles se cumulent en OU avec celles des
-- gestionnaires), une fonction recréée avec plus de colonnes (`my_home`), une
-- policy d'insertion remplacée par une plus stricte (`tickets_portal_insert`
-- exige un bail en cours). Rien de `public` n'est touché.
--
-- Réversible : drop des policies `*_portal*` ci-dessous, des fonctions
-- `portal_invite_lease`, `portal_revoke`, `portal_invite_delivered`,
-- `portal_invite_preview`, `my_lease_parties`, `my_managers`,
-- `portal_tenant_live_lease`, `portal_tenant_property`,
-- `portal_tenant_ticket`, `media_segment`, et des colonnes ajoutées à
-- `portal_invites`.

-- ---------------------------------------------------------------------------
-- 1. L'INVITATION NOMME SON BAIL ET CONNAIT SES ETATS
-- ---------------------------------------------------------------------------
alter table gestion.portal_invites
  add column if not exists lease_id uuid references gestion.leases(id) on delete cascade,
  add column if not exists revoked_at timestamptz,
  add column if not exists sent_at timestamptz,
  add column if not exists delivery text check (delivery in ('email', 'link'));

create index if not exists portal_invites_lease_idx
  on gestion.portal_invites(lease_id) where lease_id is not null;

comment on column gestion.portal_invites.lease_id is
  'Le bail que l''invitation ouvre. Une invitation par personne et par bail ; la précédente encore ouverte est révoquée.';
comment on column gestion.portal_invites.revoked_at is
  'Révoquée par le gestionnaire ou remplacée par un nouvel envoi : le lien ne vaut plus rien.';

-- ---------------------------------------------------------------------------
-- 2. PREDICATS SUPPLEMENTAIRES
-- ---------------------------------------------------------------------------
-- Partie à un bail EN COURS : ce qu'il faut pour écrire (une demande, une
-- pièce), pas seulement lire.
create or replace function gestion.portal_tenant_live_lease(p_lease uuid)
returns boolean language sql stable security definer
set search_path = ''
as $$
  select gestion.portal_tenant_lease(p_lease)
     and exists (select 1 from gestion.leases l where l.id = p_lease and l.status in ('active', 'notice'));
$$;

-- Locataire (présent ou passé) d'un lot du bien : ce qui ouvre la photo.
create or replace function gestion.portal_tenant_property(p_property uuid)
returns boolean language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
      from gestion.leases l
      join gestion.units u on u.id = l.unit_id
     where u.property_id = p_property
       and gestion.portal_tenant_lease(l.id)
  );
$$;

-- Une demande est au locataire si elle est posée sur l'un de ses baux.
create or replace function gestion.portal_tenant_ticket(p_ticket uuid)
returns boolean language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from gestion.tickets t
     where t.id = p_ticket and t.lease_id is not null and gestion.portal_tenant_lease(t.lease_id)
  );
$$;

-- Le n-ième segment d'un chemin de stockage, s'il est un uuid.
create or replace function gestion.media_segment(path text, n int)
returns uuid language sql immutable
set search_path = ''
as $$
  select case
    when (storage.foldername(path))[n] ~
         '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then ((storage.foldername(path))[n])::uuid
    else null
  end
$$;

revoke all on function gestion.portal_tenant_live_lease(uuid) from public;
revoke all on function gestion.portal_tenant_property(uuid) from public;
revoke all on function gestion.portal_tenant_ticket(uuid) from public;
grant execute on function gestion.portal_tenant_live_lease(uuid) to authenticated;
grant execute on function gestion.portal_tenant_property(uuid) to authenticated;
grant execute on function gestion.portal_tenant_ticket(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. CE QU'UN LOCATAIRE LIT DE SON BAIL, ET RIEN D'AUTRE
-- ---------------------------------------------------------------------------
drop policy if exists deposits_portal on gestion.deposits;
create policy deposits_portal on gestion.deposits for select to authenticated
  using (gestion.portal_tenant_lease(lease_id));

drop policy if exists edl_sessions_portal on gestion.edl_sessions;
create policy edl_sessions_portal on gestion.edl_sessions for select to authenticated
  using (gestion.portal_tenant_lease(lease_id));

drop policy if exists insurance_policies_portal on gestion.insurance_policies;
create policy insurance_policies_portal on gestion.insurance_policies for select to authenticated
  using (lease_id is not null and gestion.portal_tenant_lease(lease_id));

-- Les allocations font le statut d'une échéance (la vue rent_period_status
-- s'exécute avec les droits de l'appelant). Montant et échéance seulement :
-- le paiement, la transaction bancaire et le compte restent invisibles.
drop policy if exists payment_allocations_portal on gestion.payment_allocations;
create policy payment_allocations_portal on gestion.payment_allocations for select to authenticated
  using (exists (
    select 1 from gestion.rent_periods rp
     where rp.id = rent_period_id and gestion.portal_tenant_lease(rp.lease_id)
  ));

-- Les pièces du bail et de ses demandes ; jamais celles du bien ou du cabinet.
drop policy if exists documents_portal_select on gestion.documents;
create policy documents_portal_select on gestion.documents for select to authenticated
  using (
    (related_type = 'lease' and related_id is not null and gestion.portal_tenant_lease(related_id))
    or (related_type = 'ticket' and related_id is not null and gestion.portal_tenant_ticket(related_id))
  );
drop policy if exists documents_portal_insert on gestion.documents;
create policy documents_portal_insert on gestion.documents for insert to authenticated
  with check (
    related_type = 'ticket' and related_id is not null
    and class = 'photo'
    and uploaded_by = auth.uid()
    and exists (
      select 1 from gestion.tickets t
       where t.id = related_id and t.lease_id is not null and gestion.portal_tenant_live_lease(t.lease_id)
    )
  );

-- Une demande se pose sur un bail en cours, et se dit venir du locataire.
drop policy if exists tickets_portal_insert on gestion.tickets;
create policy tickets_portal_insert on gestion.tickets for insert to authenticated
  with check (lease_id is not null and source = 'tenant' and gestion.portal_tenant_live_lease(lease_id));

-- Le fil d'une demande : lu par le locataire, alimenté par lui en son nom.
drop policy if exists conversations_portal_select on gestion.conversations;
create policy conversations_portal_select on gestion.conversations for select to authenticated
  using (scope_type = 'ticket' and scope_id is not null and gestion.portal_tenant_ticket(scope_id));
drop policy if exists conversations_portal_insert on gestion.conversations;
create policy conversations_portal_insert on gestion.conversations for insert to authenticated
  with check (scope_type = 'ticket' and scope_id is not null and gestion.portal_tenant_ticket(scope_id));

drop policy if exists messages_portal_select on gestion.messages;
create policy messages_portal_select on gestion.messages for select to authenticated
  using (exists (
    select 1 from gestion.conversations cv
     where cv.id = conversation_id and cv.scope_type = 'ticket' and cv.scope_id is not null
       and gestion.portal_tenant_ticket(cv.scope_id)
  ));
drop policy if exists messages_portal_insert on gestion.messages;
create policy messages_portal_insert on gestion.messages for insert to authenticated
  with check (
    sender_kind = 'tenant' and sender_user_id = auth.uid()
    and exists (
      select 1 from gestion.conversations cv
       where cv.id = conversation_id and cv.scope_type = 'ticket' and cv.scope_id is not null
         and gestion.portal_tenant_ticket(cv.scope_id)
    )
  );

-- La photo du bien (chemin <org>/<bien>/<uuid>) se lit ; les pièces d'une
-- demande (chemin <org>/tickets/<bail>/<uuid>) se lisent et se déposent.
drop policy if exists gestion_media_portal_select on storage.objects;
create policy gestion_media_portal_select on storage.objects for select to authenticated
  using (
    bucket_id = 'gestion-media'
    and (
      ((storage.foldername(name))[2] = 'tickets' and gestion.portal_tenant_lease(gestion.media_segment(name, 3)))
      or ((storage.foldername(name))[2] <> 'tickets' and gestion.portal_tenant_property(gestion.media_segment(name, 2)))
    )
  );
drop policy if exists gestion_media_portal_insert on storage.objects;
create policy gestion_media_portal_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'gestion-media'
    and (storage.foldername(name))[2] = 'tickets'
    and gestion.portal_tenant_live_lease(gestion.media_segment(name, 3))
  );

-- ---------------------------------------------------------------------------
-- 4. « MON LOGEMENT » AVEC CE QU'IL FAUT POUR « MON BAIL »
-- ---------------------------------------------------------------------------
drop function if exists gestion.my_home();
create function gestion.my_home()
returns table (
  lease_id                  uuid,
  org_id                    uuid,
  unit_id                   uuid,
  property_id               uuid,
  lease_status              text,
  lease_type                text,
  start_date                date,
  end_date                  date,
  rent_cents                integer,
  charges_cents             integer,
  charges_regime            text,
  payment_day               int,
  rf_reference              text,
  furnished                 boolean,
  colocation                boolean,
  last_adjustment_on        date,
  previous_rent_cents       integer,
  unit_label                text,
  unit_floor                text,
  unit_area_sqm             numeric,
  unit_rooms                numeric,
  unit_bedrooms             int,
  property_name             text,
  property_address          jsonb,
  property_commune          text,
  energy_class              text,
  cpe_issued_on             date,
  syndic_name               text,
  smoke_detectors_confirmed boolean,
  photo_url                 text
)
language sql stable security definer
set search_path = ''
as $$
  select l.id, l.org_id, u.id, p.id, l.status, l.lease_type, l.start_date, l.end_date,
         l.rent_cents, l.charges_cents, l.charges_regime, l.payment_day,
         l.rf_reference, l.furnished, l.colocation, l.last_adjustment_on, l.previous_rent_cents,
         u.label, u.floor, u.area_sqm, u.rooms, u.bedrooms,
         p.name, p.address, p.commune, p.energy_class, p.cpe_issued_on,
         p.syndic_name, p.smoke_detectors_confirmed, p.photo_url
    from gestion.leases l
    join gestion.units u on u.id = l.unit_id
    join gestion.properties p on p.id = u.property_id
   where gestion.portal_tenant_lease(l.id)
   order by l.start_date desc;
$$;
comment on function gestion.my_home() is
  'Le logement du locataire, colonnes restreintes. Seule porte d''entrée du portail locataire vers properties, units et leases.';
revoke all on function gestion.my_home() from public, anon;
grant execute on function gestion.my_home() to authenticated;

-- Qui signe avec moi : noms et dates seulement, jamais les coordonnées.
create or replace function gestion.my_lease_parties()
returns table (lease_id uuid, contact_id uuid, display_name text, role text, moved_in_on date, moved_out_on date, is_me boolean)
language sql stable security definer
set search_path = ''
as $$
  select lp.lease_id, c.id, c.display_name, lp.role, lp.moved_in_on, lp.moved_out_on, (c.user_id = auth.uid())
    from gestion.lease_parties lp
    join gestion.contacts c on c.id = lp.contact_id
   where gestion.portal_tenant_lease(lp.lease_id);
$$;
revoke all on function gestion.my_lease_parties() from public, anon;
grant execute on function gestion.my_lease_parties() to authenticated;

-- À qui écrire : le cabinet ou le propriétaire qui gère mon bail.
create or replace function gestion.my_managers()
returns table (org_id uuid, name text, email text, phone text)
language sql stable security definer
set search_path = ''
as $$
  select distinct on (a.id) a.id, a.name,
         coalesce(nullif(a.email, ''), m.email),
         coalesce(nullif(a.phone, ''), m.phone)
    from gestion.leases l
    join public.agencies a on a.id = l.org_id
    left join public.crm_members m
      on m.agency_id = a.id and m.status = 'active' and m.role = 'owner'
   where gestion.portal_tenant_lease(l.id)
   order by a.id, m.created_at;
$$;
revoke all on function gestion.my_managers() from public, anon;
grant execute on function gestion.my_managers() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. INVITER, RENVOYER, REVOQUER, PREVISUALISER, ACCEPTER
-- ---------------------------------------------------------------------------
-- Une invitation par personne et par bail. La précédente encore ouverte est
-- révoquée, jamais effacée : l'historique dit ce qui a été envoyé.
create or replace function gestion.portal_invite_lease(p_lease uuid, p_contact uuid)
returns table (invite_id uuid, token text, email text, expires_at timestamptz)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_status text;
  v_user uuid;
  v_email text;
  v_id uuid;
  v_token text;
  v_expires timestamptz;
begin
  select l.org_id, l.status into v_org, v_status from gestion.leases l where l.id = p_lease;
  if not found then
    raise exception 'gestion: lease not found';
  end if;
  if not gestion.can(v_org, 'gestion.tenants.edit') then
    raise exception 'gestion: not allowed';
  end if;
  if v_status not in ('active', 'notice') then
    raise exception 'gestion: lease not live';
  end if;
  if not exists (
    select 1 from gestion.lease_parties lp
     where lp.lease_id = p_lease and lp.contact_id = p_contact and lp.role in ('tenant', 'colocataire')
  ) then
    raise exception 'gestion: not a party';
  end if;

  select c.user_id, coalesce(c.email, '') into v_user, v_email from gestion.contacts c where c.id = p_contact;
  if v_user is not null then
    raise exception 'gestion: already linked';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'gestion: no email';
  end if;

  update gestion.portal_invites
     set revoked_at = now()
   where contact_id = p_contact and accepted_at is null and revoked_at is null;

  insert into gestion.portal_invites (org_id, contact_id, lease_id, role, email, sent_at, delivery)
  values (v_org, p_contact, p_lease, 'tenant', lower(v_email), now(), 'link')
  returning portal_invites.id, portal_invites.token, portal_invites.email, portal_invites.expires_at
    into v_id, v_token, v_email, v_expires;

  return query select v_id, v_token, v_email, v_expires;
end;
$$;

create or replace function gestion.portal_invite_delivered(p_invite uuid, p_delivery text)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if p_delivery not in ('email', 'link') then
    raise exception 'gestion: bad delivery';
  end if;
  select org_id into v_org from gestion.portal_invites where id = p_invite;
  if not found or not gestion.can(v_org, 'gestion.tenants.edit') then
    raise exception 'gestion: not allowed';
  end if;
  update gestion.portal_invites set delivery = p_delivery, sent_at = now() where id = p_invite;
  return true;
end;
$$;

create or replace function gestion.portal_revoke(p_invite uuid)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select org_id into v_org from gestion.portal_invites where id = p_invite;
  if not found or not gestion.can(v_org, 'gestion.tenants.edit') then
    raise exception 'gestion: not allowed';
  end if;
  update gestion.portal_invites
     set revoked_at = now()
   where id = p_invite and accepted_at is null and revoked_at is null;
  return found;
end;
$$;

-- Ce que voit celui qui tient le lien, avant de se connecter : de quoi
-- reconnaître son logement, jamais un identifiant ni une coordonnée d'autrui.
create or replace function gestion.portal_invite_preview(p_token text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  inv gestion.portal_invites;
  v_state text;
  v_first text;
  v_property text;
  v_address jsonb;
  v_unit text;
  v_org text;
  v_status text;
begin
  if p_token is null or length(p_token) < 32 then
    return jsonb_build_object('state', 'unknown');
  end if;
  select * into inv from gestion.portal_invites where token = p_token;
  if not found then
    return jsonb_build_object('state', 'unknown');
  end if;

  v_state := case
    when inv.accepted_at is not null then 'accepted'
    when inv.revoked_at is not null then 'revoked'
    when inv.expires_at < now() then 'expired'
    else 'pending'
  end;

  select coalesce(c.first_name, split_part(c.display_name, ' ', 1)) into v_first
    from gestion.contacts c where c.id = inv.contact_id;
  select p.name, p.address, u.label, l.status
    into v_property, v_address, v_unit, v_status
    from gestion.leases l
    join gestion.units u on u.id = l.unit_id
    join gestion.properties p on p.id = u.property_id
   where l.id = inv.lease_id;
  select a.name into v_org from public.agencies a where a.id = inv.org_id;

  return jsonb_build_object(
    'state', v_state,
    'mine', (auth.uid() is not null and inv.accepted_by = auth.uid()),
    'first_name', v_first,
    'email', inv.email,
    'org_name', v_org,
    'property_name', v_property,
    'address', jsonb_build_object(
      'street', v_address ->> 'street', 'number', v_address ->> 'number',
      'postal_code', v_address ->> 'postal_code', 'city', v_address ->> 'city'),
    'unit_label', v_unit,
    'lease_status', v_status,
    'expires_at', inv.expires_at
  );
end;
$$;

-- Accepter : à usage unique, idempotent pour le même compte, transactionnel
-- (le verrou sur la ligne sérialise deux clics), et l'adresse du compte doit
-- être celle à laquelle l'invitation a été envoyée.
create or replace function gestion.portal_accept(p_token text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  inv gestion.portal_invites;
  v_user uuid;
  v_email text;
  v_linked uuid;
begin
  if auth.uid() is null then
    raise exception 'gestion: sign in first';
  end if;

  select * into inv from gestion.portal_invites where token = p_token for update;
  if not found then
    raise exception 'gestion: invitation unknown';
  end if;
  if inv.accepted_at is not null then
    if inv.accepted_by = auth.uid() then
      return jsonb_build_object('org_id', inv.org_id, 'role', inv.role, 'lease_id', inv.lease_id, 'already', true);
    end if;
    raise exception 'gestion: invitation used';
  end if;
  if inv.revoked_at is not null then
    raise exception 'gestion: invitation revoked';
  end if;
  if inv.expires_at < now() then
    raise exception 'gestion: invitation expired';
  end if;

  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  if inv.email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and lower(inv.email) <> v_email then
    raise exception 'gestion: wrong account';
  end if;

  select user_id into v_user from gestion.contacts where id = inv.contact_id;
  if v_user is not null and v_user <> auth.uid() then
    raise exception 'gestion: contact linked elsewhere';
  end if;
  -- Un compte n'est relié qu'à une fiche par espace (contacts_user_org_uidx).
  select c.id into v_linked
    from gestion.contacts c
   where c.org_id = inv.org_id and c.user_id = auth.uid() and c.id <> inv.contact_id;
  if v_linked is not null then
    raise exception 'gestion: account linked to another contact';
  end if;

  if v_user is null then
    update gestion.contacts set user_id = auth.uid() where id = inv.contact_id;
  end if;
  update gestion.portal_invites
     set accepted_at = now(), accepted_by = auth.uid()
   where id = inv.id;

  return jsonb_build_object('org_id', inv.org_id, 'role', inv.role, 'lease_id', inv.lease_id, 'already', false);
end;
$$;

revoke all on function gestion.portal_invite_lease(uuid, uuid) from public, anon;
revoke all on function gestion.portal_invite_delivered(uuid, text) from public, anon;
revoke all on function gestion.portal_revoke(uuid) from public, anon;
revoke all on function gestion.portal_invite_preview(text) from public;
revoke all on function gestion.portal_accept(text) from public, anon;
grant execute on function gestion.portal_invite_lease(uuid, uuid) to authenticated;
grant execute on function gestion.portal_invite_delivered(uuid, text) to authenticated;
grant execute on function gestion.portal_revoke(uuid) to authenticated;
grant execute on function gestion.portal_invite_preview(text) to anon, authenticated;
grant execute on function gestion.portal_accept(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. LA PREVISUALISATION, JOIGNABLE SANS SESSION
--
-- Le rôle anon n'a aucun droit sur le schéma gestion et n'en reçoit pas :
-- une seule fonction de public, comme public.gestion_onboard, relaie vers
-- gestion.portal_invite_preview. Elle ne rend que ce que rend celle-ci.
-- (Appliquée comme migration `gestion_invite_preview_public`.)
-- ---------------------------------------------------------------------------
create or replace function public.gestion_invite_preview(p_token text)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select gestion.portal_invite_preview(p_token);
$$;
revoke all on function public.gestion_invite_preview(text) from public;
grant execute on function public.gestion_invite_preview(text) to anon, authenticated;
revoke execute on function gestion.portal_invite_preview(text) from anon;
