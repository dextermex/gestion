-- ===========================================================================
-- MORADA GESTION — 0006 PORTAIL LOCATAIRE & PROPRIETAIRE
--
-- ADDITIF. Relie une fiche contact à un compte Morada, pour qu'une seule et
-- même personne puisse être locataire ici et propriétaire là, sans jamais
-- créer un second compte.
--
-- Le modèle est volontairement l'inverse d'un `account_type` : ce sont les
-- RELATIONS (bail, quote-part de propriété) qui donnent les capacités, jamais
-- un champ posé sur l'utilisateur. Jean loue chez Pierre et loue son propre
-- appartement à Sophie : deux fiches contact, deux organisations, un compte.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. LE LIEN FICHE <-> COMPTE
--
-- Nullable : l'immense majorité des contacts n'auront jamais de compte, et
-- une fiche ne devient reliée que par acceptation explicite d'une invitation.
-- ---------------------------------------------------------------------------
alter table gestion.contacts
  add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists contacts_user_idx
  on gestion.contacts(user_id) where user_id is not null;

-- Une même personne ne peut être reliée qu'une fois par organisation.
create unique index if not exists contacts_user_org_uidx
  on gestion.contacts(org_id, user_id) where user_id is not null;

comment on column gestion.contacts.user_id is
  'Compte Morada relié à cette fiche, après acceptation d''une invitation. Jamais renseigné à la main.';

-- ---------------------------------------------------------------------------
-- 2. INVITATIONS
--
-- Le jeton est opaque, à usage unique et daté. Il ne transporte aucune
-- identité : accepter exige d'être déjà connecté à Morada.
-- ---------------------------------------------------------------------------
create table if not exists gestion.portal_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  contact_id uuid not null references gestion.contacts(id) on delete cascade,
  role text not null check (role in ('tenant', 'owner')),
  token text not null unique default encode(gen_random_bytes(32), 'hex'),
  email text not null default '',
  expires_at timestamptz not null default now() + interval '14 days',
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null
);
create index if not exists portal_invites_contact_idx on gestion.portal_invites(contact_id);

alter table gestion.portal_invites enable row level security;

-- Le jeton ne se lit jamais par API : seule la RPC d'acceptation y touche.
create policy portal_invites_select on gestion.portal_invites for select to authenticated
  using (gestion.can(org_id, 'gestion.tenants.view'));

-- ---------------------------------------------------------------------------
-- 3. PREDICATS DU PORTAIL
--
-- Deux façons d'être légitime sur un bail : y être partie (locataire) ou
-- posséder le bien loué (propriétaire, en direct ou via une société).
-- ---------------------------------------------------------------------------
create or replace function gestion.portal_tenant_lease(p_lease uuid)
returns boolean language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
      from gestion.lease_parties lp
      join gestion.contacts c on c.id = lp.contact_id
     where lp.lease_id = p_lease
       and lp.role in ('tenant', 'colocataire')
       and c.user_id = auth.uid()
  );
$$;

create or replace function gestion.portal_owner_property(p_property uuid)
returns boolean language sql stable security definer
set search_path = ''
as $$
  select exists (
    -- Détention directe
    select 1
      from gestion.property_ownership po
      join gestion.contacts c on c.id = po.contact_id
     where po.property_id = p_property
       and c.user_id = auth.uid()
       and (po.to_date is null or po.to_date >= current_date)
    union all
    -- Détention via une société de patrimoine
    select 1
      from gestion.property_ownership po
      join gestion.vehicle_members vm on vm.vehicle_id = po.vehicle_id
      join gestion.contacts c on c.id = vm.contact_id
     where po.property_id = p_property
       and c.user_id = auth.uid()
       and (po.to_date is null or po.to_date >= current_date)
       and (vm.to_date is null or vm.to_date >= current_date)
  );
$$;

create or replace function gestion.portal_tenant_property(p_property uuid)
returns boolean language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
      from gestion.units u
      join gestion.leases l on l.unit_id = u.id
     where u.property_id = p_property
       and gestion.portal_tenant_lease(l.id)
  );
$$;

create or replace function gestion.portal_owner_lease(p_lease uuid)
returns boolean language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
      from gestion.leases l
      join gestion.units u on u.id = l.unit_id
     where l.id = p_lease
       and gestion.portal_owner_property(u.property_id)
  );
$$;

comment on function gestion.portal_tenant_lease(uuid) is
  'Vrai si l''utilisateur courant est partie au bail. Aucun rôle global n''est consulté.';
comment on function gestion.portal_owner_property(uuid) is
  'Vrai si l''utilisateur courant détient le bien, en direct ou via une société dont il est membre.';
comment on function gestion.portal_tenant_property(uuid) is
  'Vrai si l''utilisateur courant est locataire d''une unité de ce bien.';

-- ---------------------------------------------------------------------------
-- 4. LECTURE SEULE POUR LE PORTAIL
--
-- Policies ADDITIONNELLES : sous Postgres, plusieurs policies permissives se
-- cumulent en OU. Un gestionnaire garde donc exactement les droits que lui
-- donne gestion.can(), et un locataire gagne la lecture de son seul bail.
-- ---------------------------------------------------------------------------
create policy leases_portal on gestion.leases for select to authenticated
  using (gestion.portal_tenant_lease(id) or gestion.portal_owner_lease(id));

create policy units_portal on gestion.units for select to authenticated
  using (
    gestion.portal_owner_property(property_id)
    or exists (select 1 from gestion.leases l
                where l.unit_id = units.id and gestion.portal_tenant_lease(l.id))
  );

-- Le locataire lit la fiche de l'immeuble qu'il habite : nom, adresse, classe
-- énergétique, syndic. Les tables d'argent du propriétaire (acquisitions,
-- investissements, amortissements, écritures) n'ont, elles, aucune policy
-- portail : elles restent fermées au locataire.
create policy properties_portal on gestion.properties for select to authenticated
  using (gestion.portal_owner_property(id) or gestion.portal_tenant_property(id));

create policy rent_periods_portal on gestion.rent_periods for select to authenticated
  using (gestion.portal_tenant_lease(lease_id) or gestion.portal_owner_lease(lease_id));

create policy lease_parties_portal on gestion.lease_parties for select to authenticated
  using (gestion.portal_tenant_lease(lease_id) or gestion.portal_owner_lease(lease_id));

-- Un locataire ouvre et suit ses propres demandes, techniques comme
-- administratives, et rien d'autre.
create policy tickets_portal_select on gestion.tickets for select to authenticated
  using (lease_id is not null and gestion.portal_tenant_lease(lease_id));
create policy tickets_portal_insert on gestion.tickets for insert to authenticated
  with check (lease_id is not null and gestion.portal_tenant_lease(lease_id));

-- ---------------------------------------------------------------------------
-- 5. INVITER / ACCEPTER
-- ---------------------------------------------------------------------------
create or replace function gestion.portal_invite(p_contact uuid, p_role text)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_org   uuid;
  v_user  uuid;
  v_email text;
  v_token text;
begin
  if p_role not in ('tenant', 'owner') then
    raise exception 'Type d''invitation invalide.';
  end if;

  select c.org_id, c.user_id, coalesce(c.email, '')
    into v_org, v_user, v_email
    from gestion.contacts c
   where c.id = p_contact;

  if not found then
    raise exception 'Fiche introuvable.';
  end if;
  if not gestion.can(v_org, 'gestion.tenants.edit') then
    raise exception 'Action non autorisée.';
  end if;
  if v_user is not null then
    raise exception 'Cette fiche est déjà reliée à un compte Morada.';
  end if;

  delete from gestion.portal_invites
   where contact_id = p_contact and accepted_at is null;

  insert into gestion.portal_invites (org_id, contact_id, role, email)
  values (v_org, p_contact, p_role, v_email)
  returning token into v_token;

  return v_token;
end;
$$;

create or replace function gestion.portal_accept(p_token text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  inv    gestion.portal_invites;
  v_user uuid;
begin
  if auth.uid() is null then
    raise exception 'Connectez-vous pour accepter cette invitation.';
  end if;

  select * into inv from gestion.portal_invites where token = p_token for update;
  if not found then
    raise exception 'Invitation introuvable ou révoquée.';
  end if;
  if inv.accepted_at is not null then
    if inv.accepted_by = auth.uid() then
      return jsonb_build_object('org_id', inv.org_id, 'role', inv.role, 'already', true);
    end if;
    raise exception 'Cette invitation a déjà été utilisée par un autre compte.';
  end if;
  if inv.expires_at < now() then
    raise exception 'Cette invitation a expiré. Demandez-en une nouvelle à votre gestionnaire.';
  end if;

  select user_id into v_user from gestion.contacts where id = inv.contact_id;
  if v_user is not null and v_user <> auth.uid() then
    raise exception 'Cette fiche est déjà reliée à un autre compte.';
  end if;

  update gestion.contacts set user_id = auth.uid() where id = inv.contact_id;
  update gestion.portal_invites
     set accepted_at = now(), accepted_by = auth.uid()
   where id = inv.id;

  return jsonb_build_object('org_id', inv.org_id, 'role', inv.role, 'already', false);
end;
$$;

revoke all on function gestion.portal_invite(uuid, text) from public, anon;
revoke all on function gestion.portal_accept(text)       from public, anon;
grant execute on function gestion.portal_invite(uuid, text) to authenticated;
grant execute on function gestion.portal_accept(text)       to authenticated;
