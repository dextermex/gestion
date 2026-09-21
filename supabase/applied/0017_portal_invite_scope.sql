-- 0017 · L'invitation d'un bail ne révoque que la sienne, et « est-il locataire ? » en une question
-- Appliqué le 2026-09-21 (migration `gestion_portal_invite_scope`).
--
-- Deux corrections trouvées en relecture du portail locataire (0015).
--
-- 1. `portal_invite_lease` révoquait toute invitation encore ouverte de la
--    personne, quel que soit le bail. Une personne qui prend un second lot
--    (un parking, un studio) recevait un lien pour le second et perdait, sans
--    que personne ne le sache, celui du premier. La révocation ne porte plus
--    que sur les invitations du même bail (et sur les anciennes lignes sans
--    bail, antérieures à 0015). Le reste de la fonction est inchangé.
--
-- 2. La mise en page de l'espace de gestion demandait `my_home()` à chaque
--    requête pour savoir si le compte est locataire quelque part : le bail,
--    le lot et le bien étaient assemblés pour être comptés. `is_tenant()`
--    répond oui ou non avec le seul prédicat derrière `my_home()`
--    (`portal_tenant_lease`, 0006) : partie d'un bail, rôle tenant ou
--    colocataire, compte relié à la fiche.
--
-- ADDITIF : aucune table touchée, une fonction recréée à signature identique,
-- une fonction ajoutée. `anon` ne reçoit rien.
-- Réversible : `portal_invite_lease` telle qu'en 0015, drop de `is_tenant()`.

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

  -- Un nouvel envoi remplace l'invitation ouverte DE CE BAIL ; celle d'un
  -- autre bail de la même personne reste valable.
  update gestion.portal_invites
     set revoked_at = now()
   where contact_id = p_contact
     and (lease_id = p_lease or lease_id is null)
     and accepted_at is null and revoked_at is null;

  insert into gestion.portal_invites (org_id, contact_id, lease_id, role, email, sent_at, delivery)
  values (v_org, p_contact, p_lease, 'tenant', lower(v_email), now(), 'link')
  returning portal_invites.id, portal_invites.token, portal_invites.email, portal_invites.expires_at
    into v_id, v_token, v_email, v_expires;

  return query select v_id, v_token, v_email, v_expires;
end;
$$;
comment on function gestion.portal_invite_lease(uuid, uuid) is
  'Émet l''invitation d''une partie d''un bail en cours (gestion.tenants.edit). Révoque l''invitation ouverte du même bail, pas celles des autres baux de la personne. Le jeton n''est rendu qu''ici.';
revoke all on function gestion.portal_invite_lease(uuid, uuid) from public, anon;
grant execute on function gestion.portal_invite_lease(uuid, uuid) to authenticated;

create or replace function gestion.is_tenant()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
      from gestion.lease_parties lp
      join gestion.contacts c on c.id = lp.contact_id
     where lp.role in ('tenant', 'colocataire')
       and c.user_id = auth.uid()
  );
$$;
comment on function gestion.is_tenant() is
  'Vrai si le compte courant est partie (tenant ou colocataire) d''au moins un bail : le prédicat de my_home(), sans en assembler les lignes.';
revoke all on function gestion.is_tenant() from public, anon;
grant execute on function gestion.is_tenant() to authenticated;
