-- ===========================================================================
-- MORADA GESTION — PHASE 4 : PORTAIL LOCATAIRE & PROPRIÉTAIRE
--
-- Des locataires et propriétaires (les PERSONNES, pas les membres de
-- l'organisation) accèdent en lecture à leurs propres données via un compte
-- relié par invitation. Principes :
--   • Liaison explicite : g_owners.user_id / g_tenants.user_id, posée
--     uniquement par l'acceptation d'une invitation à jeton (RPC).
--   • RLS ADDITIVE et STRICTEMENT en lecture : aucune policy d'écriture
--     n'est ajoutée pour les utilisateurs portail. La seule écriture
--     possible est la demande d'intervention, via RPC contrôlée.
--   • Un locataire ne voit jamais un autre locataire ; un propriétaire ne
--     voit jamais les biens d'un autre propriétaire (testé en base).
--   • La timeline interne (g_activity) et la GED restent invisibles du
--     portail — elles peuvent contenir des notes internes.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. LIAISON DE COMPTES + INVITATIONS
-- ---------------------------------------------------------------------------
alter table public.g_owners
  add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.g_tenants
  add column if not exists user_id uuid references auth.users(id) on delete set null;
create index if not exists g_owners_user_idx on public.g_owners(user_id) where user_id is not null;
create index if not exists g_tenants_user_idx on public.g_tenants(user_id) where user_id is not null;

create table if not exists public.g_portal_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  entity_type text not null check (entity_type in ('owner','tenant')),
  entity_id uuid not null,
  email text not null default '',
  token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists g_portal_invites_org_idx on public.g_portal_invites(org_id, created_at desc);
create index if not exists g_portal_invites_entity_idx on public.g_portal_invites(entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- 2. HELPERS — relations portail (SECURITY DEFINER pour éviter la récursion
--    RLS et garder les policies lisibles).
-- ---------------------------------------------------------------------------
create or replace function public.g_portal_owner_property(p_prop uuid)
returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1
    from public.g_properties p
    join public.g_owners o on o.id = p.owner_id
    where p.id = p_prop and o.user_id = auth.uid()
  );
$$;

create or replace function public.g_portal_owner_lease(p_lease uuid)
returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1
    from public.g_leases l
    join public.g_units u on u.id = l.unit_id
    join public.g_properties p on p.id = u.property_id
    join public.g_owners o on o.id = p.owner_id
    where l.id = p_lease and o.user_id = auth.uid()
  );
$$;

create or replace function public.g_portal_tenant_lease(p_lease uuid)
returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1
    from public.g_lease_parties lp
    join public.g_tenants t on t.id = lp.tenant_id
    where lp.lease_id = p_lease and t.user_id = auth.uid()
  );
$$;

create or replace function public.g_portal_owner_tenant(p_tenant uuid)
returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1
    from public.g_lease_parties lp
    join public.g_leases l on l.id = lp.lease_id
    join public.g_units u on u.id = l.unit_id
    join public.g_properties p on p.id = u.property_id
    join public.g_owners o on o.id = p.owner_id
    where lp.tenant_id = p_tenant and o.user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- 3. RPC — inviter une personne au portail
-- ---------------------------------------------------------------------------
create or replace function public.g_portal_invite(
  p_org uuid,
  p_type text,
  p_entity uuid
)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_token text;
  v_email text;
  v_linked uuid;
begin
  if p_type not in ('owner','tenant') then
    raise exception 'Type d''invitation invalide.';
  end if;
  if p_type = 'owner' then
    if not public.g_can(p_org, 'gestion.properties.edit') then
      raise exception 'Action non autorisée.';
    end if;
    select user_id, coalesce(email,'') into v_linked, v_email
    from public.g_owners where id = p_entity and org_id = p_org;
  else
    if not public.g_can(p_org, 'gestion.tenants.edit') then
      raise exception 'Action non autorisée.';
    end if;
    select user_id, coalesce(email,'') into v_linked, v_email
    from public.g_tenants where id = p_entity and org_id = p_org;
  end if;
  if not found then
    raise exception 'Fiche introuvable dans cette organisation.';
  end if;
  if v_linked is not null then
    raise exception 'Cette personne a déjà un accès portail relié.';
  end if;

  -- One pending invite per entity: replace any previous one.
  delete from public.g_portal_invites
  where org_id = p_org and entity_type = p_type and entity_id = p_entity and accepted_at is null;

  insert into public.g_portal_invites (org_id, entity_type, entity_id, email, created_by)
  values (p_org, p_type, p_entity, v_email, auth.uid())
  returning token into v_token;

  return v_token;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. RPC — accepter une invitation (relie auth.uid() à la fiche)
-- ---------------------------------------------------------------------------
create or replace function public.g_portal_accept(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  inv record;
  v_linked uuid;
begin
  if auth.uid() is null then
    raise exception 'Connectez-vous pour accepter cette invitation.';
  end if;
  select * into inv from public.g_portal_invites where token = p_token for update;
  if not found then
    raise exception 'Invitation introuvable ou révoquée.';
  end if;
  if inv.accepted_at is not null then
    if inv.accepted_by = auth.uid() then
      return jsonb_build_object('type', inv.entity_type, 'org_id', inv.org_id, 'already', true);
    end if;
    raise exception 'Cette invitation a déjà été utilisée par un autre compte.';
  end if;
  if inv.expires_at < now() then
    raise exception 'Cette invitation a expiré — demandez-en une nouvelle à votre gestionnaire.';
  end if;

  if inv.entity_type = 'owner' then
    select user_id into v_linked from public.g_owners where id = inv.entity_id;
    if not found then raise exception 'La fiche liée à cette invitation n''existe plus.'; end if;
    if v_linked is not null and v_linked <> auth.uid() then
      raise exception 'Cette fiche est déjà reliée à un autre compte.';
    end if;
    update public.g_owners set user_id = auth.uid() where id = inv.entity_id;
  else
    select user_id into v_linked from public.g_tenants where id = inv.entity_id;
    if not found then raise exception 'La fiche liée à cette invitation n''existe plus.'; end if;
    if v_linked is not null and v_linked <> auth.uid() then
      raise exception 'Cette fiche est déjà reliée à un autre compte.';
    end if;
    update public.g_tenants set user_id = auth.uid() where id = inv.entity_id;
  end if;

  update public.g_portal_invites
  set accepted_at = now(), accepted_by = auth.uid()
  where id = inv.id;

  return jsonb_build_object('type', inv.entity_type, 'org_id', inv.org_id, 'already', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. RPC — demande d'intervention par un locataire relié
-- ---------------------------------------------------------------------------
create or replace function public.g_tenant_request(
  p_lease uuid,
  p_title text,
  p_description text default ''
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  l record;
  v_tenant uuid;
  v_wo uuid;
begin
  if auth.uid() is null then
    raise exception 'Connectez-vous pour signaler un problème.';
  end if;
  if coalesce(trim(p_title), '') = '' then
    raise exception 'Décrivez le problème en une ligne.';
  end if;

  select t.id into v_tenant
  from public.g_lease_parties lp
  join public.g_tenants t on t.id = lp.tenant_id
  where lp.lease_id = p_lease and t.user_id = auth.uid()
  limit 1;
  if v_tenant is null then
    raise exception 'Ce bail n''est pas relié à votre compte.';
  end if;

  select id, org_id, unit_id,
         (select property_id from public.g_units u where u.id = g_leases.unit_id) as property_id
  into l
  from public.g_leases where id = p_lease;

  insert into public.g_work_orders
    (org_id, property_id, unit_id, lease_id, tenant_id, title, description,
     priority, status, created_by)
  values
    (l.org_id, l.property_id, l.unit_id, p_lease, v_tenant,
     left(trim(p_title), 200), left(coalesce(p_description,''), 4000),
     'normal', 'new', auth.uid())
  returning id into v_wo;

  return v_wo;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. RLS PORTAIL — policies ADDITIVES, lecture seule.
-- ---------------------------------------------------------------------------
alter table public.g_portal_invites enable row level security;

drop policy if exists g_portal_invites_select on public.g_portal_invites;
create policy g_portal_invites_select on public.g_portal_invites for select to authenticated
  using (
    (entity_type = 'owner' and g_can(org_id, 'gestion.properties.edit'))
    or (entity_type = 'tenant' and g_can(org_id, 'gestion.tenants.edit'))
  );
drop policy if exists g_portal_invites_delete on public.g_portal_invites;
create policy g_portal_invites_delete on public.g_portal_invites for delete to authenticated
  using (
    (entity_type = 'owner' and g_can(org_id, 'gestion.properties.edit'))
    or (entity_type = 'tenant' and g_can(org_id, 'gestion.tenants.edit'))
  );

drop policy if exists g_owners_portal_self on public.g_owners;
create policy g_owners_portal_self on public.g_owners for select to authenticated
  using (user_id = auth.uid());

drop policy if exists g_tenants_portal_self on public.g_tenants;
create policy g_tenants_portal_self on public.g_tenants for select to authenticated
  using (user_id = auth.uid() or public.g_portal_owner_tenant(id));

drop policy if exists g_properties_portal_owner on public.g_properties;
create policy g_properties_portal_owner on public.g_properties for select to authenticated
  using (public.g_portal_owner_property(id));

drop policy if exists g_units_portal_owner on public.g_units;
create policy g_units_portal_owner on public.g_units for select to authenticated
  using (public.g_portal_owner_property(property_id));

drop policy if exists g_leases_portal on public.g_leases;
create policy g_leases_portal on public.g_leases for select to authenticated
  using (public.g_portal_owner_lease(id) or public.g_portal_tenant_lease(id));

drop policy if exists g_lease_parties_portal on public.g_lease_parties;
create policy g_lease_parties_portal on public.g_lease_parties for select to authenticated
  using (public.g_portal_owner_lease(lease_id) or public.g_portal_tenant_lease(lease_id));

drop policy if exists g_rent_periods_portal on public.g_rent_periods;
create policy g_rent_periods_portal on public.g_rent_periods for select to authenticated
  using (public.g_portal_owner_lease(lease_id) or public.g_portal_tenant_lease(lease_id));

drop policy if exists g_payments_portal on public.g_payments;
create policy g_payments_portal on public.g_payments for select to authenticated
  using (
    lease_id is not null
    and (public.g_portal_owner_lease(lease_id) or public.g_portal_tenant_lease(lease_id))
  );

-- Owners see PAID invoices on their own properties (transparency on expenses);
-- tenants never see invoices.
drop policy if exists g_invoices_portal_owner on public.g_invoices;
create policy g_invoices_portal_owner on public.g_invoices for select to authenticated
  using (
    status = 'paid' and property_id is not null
    and public.g_portal_owner_property(property_id)
  );

-- Tenants follow their own requests; owners see work on their properties.
drop policy if exists g_work_orders_portal on public.g_work_orders;
create policy g_work_orders_portal on public.g_work_orders for select to authenticated
  using (
    (tenant_id is not null and exists (
      select 1 from public.g_tenants t where t.id = tenant_id and t.user_id = auth.uid()
    ))
    or (property_id is not null and public.g_portal_owner_property(property_id))
  );

-- ---------------------------------------------------------------------------
-- 7. GRANTS — accept/request sont pour utilisateurs connectés uniquement.
-- ---------------------------------------------------------------------------
revoke execute on function public.g_portal_invite(uuid, text, uuid) from anon, public;
revoke execute on function public.g_portal_accept(text) from anon, public;
revoke execute on function public.g_tenant_request(uuid, text, text) from anon, public;

-- ---------------------------------------------------------------------------
-- 8. VISIBILITÉ LOCATAIRE SUR SON LOGEMENT — un locataire relié voit l'unité
--    et le bien de SES baux (nom, adresse), rien d'autre du patrimoine.
-- ---------------------------------------------------------------------------
create or replace function public.g_portal_tenant_unit(p_unit uuid)
returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1
    from public.g_leases l
    join public.g_lease_parties lp on lp.lease_id = l.id
    join public.g_tenants t on t.id = lp.tenant_id
    where l.unit_id = p_unit and t.user_id = auth.uid()
  );
$$;

create or replace function public.g_portal_tenant_property(p_prop uuid)
returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1
    from public.g_units u
    join public.g_leases l on l.unit_id = u.id
    join public.g_lease_parties lp on lp.lease_id = l.id
    join public.g_tenants t on t.id = lp.tenant_id
    where u.property_id = p_prop and t.user_id = auth.uid()
  );
$$;

drop policy if exists g_units_portal_owner on public.g_units;
create policy g_units_portal_owner on public.g_units for select to authenticated
  using (public.g_portal_owner_property(property_id) or public.g_portal_tenant_unit(id));

drop policy if exists g_properties_portal_owner on public.g_properties;
create policy g_properties_portal_owner on public.g_properties for select to authenticated
  using (public.g_portal_owner_property(id) or public.g_portal_tenant_property(id));
