-- ===========================================================================
-- 0030 · intégrité : ce que la base garantit elle-même
--
-- Prérequis : 0001 à 0029 (0022 pour gestion.audit_row).
--
-- Suite de l'audit du 19 novembre 2026. Jusqu'ici plusieurs règles ne
-- tenaient que par l'application ; elles tiennent maintenant dans la base,
-- pour le web comme pour l'app mobile.
--
--   1. gestion.today() : le jour civil luxembourgeois. La vue du statut des
--      échéances s'en sert, pour que « en retard » bascule à minuit à
--      Luxembourg et non à minuit UTC.
--   2. L'isolement des espaces, repris ici tel qu'il est en production depuis
--      le 11 octobre 2026 (supabase/shared, sections 1, 2 et 7) : la base de
--      test de la CI porte ainsi les mêmes règles que la base hébergée. Sur
--      celle-ci ces instructions ne changent rien.
--   3. Une ligne fille appartient à l'espace de sa ligne mère : un garde
--      générique posé sur chaque clé étrangère entre deux tables de gestion
--      qui portent org_id, et un garde pour les références sans clé
--      (conversations, pièces, courriers recommandés).
--   4. contacts.user_id n'est écrit que par l'acceptation d'une invitation.
--   5. Ce qu'un locataire écrit : l'heure, l'état et le rattachement sont
--      ceux de la base, pas ceux de l'appelant.
--   6. conversations.last_message_at suit chaque message, de qui qu'il vienne.
--   7. Archiver un bien archive ses lots ; le restaurer les restaure ; un bien
--      dont un lot est loué ne s'archive pas.
--   8. Ce qui est scellé ne se réécrit pas : pièces scellées, états des lieux
--      scellés, contenu d'un courrier parti.
--   9. Le journal couvre aussi les échéances, les imputations, les parties au
--      bail, les fiches et les lignes d'état des lieux.
--  10. Le bucket : le dossier des pièces suit le droit sur les pièces.
--
-- Rien de `public` n'est touché. Aucune ligne existante n'est modifiée, sauf
-- conversations.last_message_at (recalé sur le dernier message réel).
-- Vérifié avant écriture sur la base hébergée : aucune des 81 liaisons ne
-- porte de ligne dont l'espace diffère de celui de sa ligne mère.
--
-- Repli :
--   select gestion.drop_org_guards();  drop function gestion.drop_org_guards();
--   drop trigger guard_scope_org on gestion.conversations (documents, registered_letters) ;
--   drop trigger guard_contact_user on gestion.contacts ;
--   drop trigger messages_from_tenant on gestion.messages ; drop trigger tickets_from_tenant on gestion.tickets ;
--   drop trigger messages_touch_conversation on gestion.messages ;
--   drop trigger properties_archive_lots on gestion.properties ;
--   drop trigger guard_sealed on gestion.documents (edl_sessions, edl_items, edl_media, registered_letters) ;
--   la vue rent_period_status et les policies du bucket reviennent à leur
--   texte de 0021 et 0011.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Le jour civil.
-- ---------------------------------------------------------------------------
create or replace function gestion.today()
returns date
language sql stable
set search_path = ''
as $$
  select (now() at time zone 'Europe/Luxembourg')::date
$$;
revoke all on function gestion.today() from public, anon;
grant execute on function gestion.today() to authenticated, service_role;

create or replace view gestion.rent_period_status
with (security_invoker = true) as
select rp.id,
       rp.org_id,
       rp.lease_id,
       rp.period,
       rp.due_date,
       rp.total_cents,
       coalesce(sum(pa.amount_cents) filter (where pa.reversed_at is null), 0::bigint)::integer as allocated_cents,
       case
         when rp.written_off then 'written_off'::text
         when coalesce(sum(pa.amount_cents) filter (where pa.reversed_at is null), 0::bigint) >= rp.total_cents then 'paid'::text
         when coalesce(sum(pa.amount_cents) filter (where pa.reversed_at is null), 0::bigint) > 0 then
           case when rp.due_date < gestion.today() then 'partial_late'::text else 'partial'::text end
         when rp.due_date < gestion.today() then 'late'::text
         when rp.period > gestion.today() then 'upcoming'::text
         else 'pending'::text
       end as status
  from gestion.rent_periods rp
  left join gestion.payment_allocations pa on pa.rent_period_id = rp.id
 group by rp.id;

-- ---------------------------------------------------------------------------
-- 2. L'isolement des espaces, tel qu'en production (supabase/shared,
--    20261011120000, sections 1, 2 et 7).
-- ---------------------------------------------------------------------------
create or replace function gestion.portal_tenant_lease(p_lease uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
      from gestion.leases l
      join gestion.lease_parties lp on lp.lease_id = l.id and lp.org_id = l.org_id
      join gestion.contacts c on c.id = lp.contact_id and c.org_id = l.org_id
     where l.id = p_lease
       and lp.role in ('tenant', 'colocataire')
       and c.user_id = auth.uid()
  );
$$;

create or replace function gestion.portal_owner_property(p_property uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
      from gestion.properties p
      join gestion.property_ownership po on po.property_id = p.id and po.org_id = p.org_id
      join gestion.contacts c on c.id = po.contact_id and c.org_id = p.org_id
     where p.id = p_property
       and c.user_id = auth.uid()
       and (po.to_date is null or po.to_date >= current_date)
    union all
    select 1
      from gestion.properties p
      join gestion.property_ownership po on po.property_id = p.id and po.org_id = p.org_id
      join gestion.vehicle_members vm on vm.vehicle_id = po.vehicle_id
      join gestion.contacts c on c.id = vm.contact_id and c.org_id = p.org_id
     where p.id = p_property
       and c.user_id = auth.uid()
       and (po.to_date is null or po.to_date >= current_date)
       and (vm.to_date is null or vm.to_date >= current_date)
  );
$$;

create or replace function gestion.lease_org(p_lease uuid)
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select org_id from gestion.leases where id = p_lease;
$$;
revoke all on function gestion.lease_org(uuid) from public, anon;
grant execute on function gestion.lease_org(uuid) to authenticated;

alter policy tickets_portal_insert on gestion.tickets
  with check (lease_id is not null and source = 'tenant'
              and org_id = gestion.lease_org(lease_id)
              and gestion.portal_tenant_live_lease(lease_id));

alter policy conversations_portal_insert on gestion.conversations
  with check (scope_type = 'lease' and scope_id is not null
              and org_id = gestion.lease_org(scope_id)
              and gestion.portal_tenant_lease(scope_id));

alter policy messages_portal_insert on gestion.messages
  with check (sender_kind = 'tenant' and sender_user_id = auth.uid()
              and (ticket_id is null or gestion.portal_tenant_ticket(ticket_id))
              and exists (
                select 1 from gestion.conversations cv
                 where cv.id = messages.conversation_id
                   and cv.org_id = messages.org_id
                   and ((cv.scope_type = 'lease' and cv.scope_id is not null and gestion.portal_tenant_lease(cv.scope_id))
                     or (cv.scope_type = 'ticket' and cv.scope_id is not null and gestion.portal_tenant_ticket(cv.scope_id)))));

-- La photo d'une demande : la ligne vit dans l'espace de la demande, et son
-- fichier dans le dossier du bail de cette demande (nouveau par rapport au
-- 11 octobre : le chemin).
alter policy documents_portal_insert on gestion.documents
  with check (related_type = 'ticket' and related_id is not null and class = 'photo' and uploaded_by = auth.uid()
              and exists (
                select 1 from gestion.tickets t
                 where t.id = documents.related_id
                   and t.org_id = documents.org_id
                   and t.lease_id is not null
                   and gestion.portal_tenant_live_lease(t.lease_id)
                   and documents.storage_path like documents.org_id::text || '/tickets/' || t.lease_id::text || '/%'));

alter policy gestion_media_portal_insert on storage.objects
  with check (bucket_id = 'gestion-media'
              and (storage.foldername(name))[2] = 'tickets'
              and gestion.media_org(name) = gestion.lease_org(gestion.media_segment(name, 3))
              and gestion.portal_tenant_live_lease(gestion.media_segment(name, 3)));

create or replace function gestion.guard_link_org()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'lease_parties' then
    if not exists (select 1 from gestion.leases where id = new.lease_id and org_id = new.org_id)
       or not exists (select 1 from gestion.contacts where id = new.contact_id and org_id = new.org_id) then
      raise exception 'lease party outside the organisation' using errcode = '42501';
    end if;
  elsif tg_table_name = 'property_ownership' then
    if not exists (select 1 from gestion.properties where id = new.property_id and org_id = new.org_id)
       or (new.contact_id is not null and not exists (select 1 from gestion.contacts where id = new.contact_id and org_id = new.org_id))
       or (new.vehicle_id is not null and not exists (select 1 from gestion.ownership_vehicles where id = new.vehicle_id and org_id = new.org_id)) then
      raise exception 'ownership outside the organisation' using errcode = '42501';
    end if;
  elsif tg_table_name = 'vehicle_members' then
    if not exists (select 1 from gestion.ownership_vehicles v join gestion.contacts c on c.org_id = v.org_id
                    where v.id = new.vehicle_id and c.id = new.contact_id) then
      raise exception 'vehicle member outside the organisation' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;
revoke all on function gestion.guard_link_org() from public, anon, authenticated;

drop trigger if exists guard_link_org on gestion.lease_parties;
create trigger guard_link_org before insert or update on gestion.lease_parties
  for each row execute function gestion.guard_link_org();
drop trigger if exists guard_link_org on gestion.property_ownership;
create trigger guard_link_org before insert or update on gestion.property_ownership
  for each row execute function gestion.guard_link_org();
drop trigger if exists guard_link_org on gestion.vehicle_members;
create trigger guard_link_org before insert or update on gestion.vehicle_members
  for each row execute function gestion.guard_link_org();

-- ---------------------------------------------------------------------------
-- 3. Une ligne fille appartient à l'espace de sa ligne mère.
-- ---------------------------------------------------------------------------
-- Le garde : la ligne mère désignée par la colonne doit porter le même org_id.
-- Appelé avec le nom de la table mère et celui de la colonne.
create or replace function gestion.guard_parent_org()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_parent text := tg_argv[0];
  v_col text := tg_argv[1];
  v_id uuid;
  v_ok boolean;
begin
  v_id := (to_jsonb(new) ->> v_col)::uuid;
  if v_id is null then
    return new;
  end if;
  execute format('select exists (select 1 from gestion.%I p where p.id = $1 and p.org_id = $2)', v_parent)
     into v_ok using v_id, new.org_id;
  if not v_ok then
    raise exception 'gestion: % belongs to another workspace', v_col using errcode = '42501';
  end if;
  return new;
end
$$;
revoke all on function gestion.guard_parent_org() from public, anon, authenticated;

-- Pose (ou repose) le garde sur chaque clé étrangère simple entre deux tables
-- de gestion qui portent org_id. À rappeler après toute migration qui crée
-- une telle clé. Renvoie le nombre de gardes posés.
create or replace function gestion.install_org_guards()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  r record;
  v_name text;
  n integer := 0;
begin
  for r in
    select c.relname as child, a.attname as col, p.relname as parent
      from pg_catalog.pg_constraint con
      join pg_catalog.pg_class c on c.oid = con.conrelid
      join pg_catalog.pg_namespace cn on cn.oid = c.relnamespace
      join pg_catalog.pg_class p on p.oid = con.confrelid
      join pg_catalog.pg_namespace pn on pn.oid = p.relnamespace
      join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum = con.conkey[1]
      join pg_catalog.pg_attribute pa on pa.attrelid = p.oid and pa.attnum = con.confkey[1]
     where con.contype = 'f'
       and cn.nspname = 'gestion' and pn.nspname = 'gestion'
       and pg_catalog.array_length(con.conkey, 1) = 1
       and pa.attname = 'id'
       and exists (select 1 from pg_catalog.pg_attribute x where x.attrelid = c.oid and x.attname = 'org_id' and not x.attisdropped)
       and exists (select 1 from pg_catalog.pg_attribute x where x.attrelid = p.oid and x.attname = 'org_id' and not x.attisdropped)
     order by c.relname, a.attname
  loop
    v_name := 'guard_org_' || r.col;
    execute format('drop trigger if exists %I on gestion.%I', v_name, r.child);
    execute format(
      'create trigger %I before insert or update of %I, org_id on gestion.%I for each row execute function gestion.guard_parent_org(%L, %L)',
      v_name, r.col, r.child, r.parent, r.col);
    n := n + 1;
  end loop;
  return n;
end
$$;
revoke all on function gestion.install_org_guards() from public, anon, authenticated;

create or replace function gestion.drop_org_guards()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select c.relname as child, t.tgname
      from pg_catalog.pg_trigger t
      join pg_catalog.pg_class c on c.oid = t.tgrelid
      join pg_catalog.pg_namespace cn on cn.oid = c.relnamespace
      join pg_catalog.pg_proc f on f.oid = t.tgfoid
     where cn.nspname = 'gestion' and f.proname = 'guard_parent_org' and not t.tgisinternal
  loop
    execute format('drop trigger %I on gestion.%I', r.tgname, r.child);
    n := n + 1;
  end loop;
  return n;
end
$$;
revoke all on function gestion.drop_org_guards() from public, anon, authenticated;

select gestion.install_org_guards();

-- Les références sans clé étrangère : la conversation d'un bail ou d'une
-- demande, la pièce rattachée à un objet, le courrier recommandé. Et le
-- fichier d'une pièce, qui vit dans le dossier de son espace.
create or replace function gestion.guard_scope_org()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_type text;
  v_id uuid;
  v_org uuid;
begin
  if tg_table_name = 'conversations' then
    v_type := new.scope_type;
    v_id := new.scope_id;
  elsif tg_table_name = 'documents' then
    if gestion.media_org(new.storage_path) is distinct from new.org_id then
      raise exception 'gestion: the file of a document lives in its own workspace' using errcode = '42501';
    end if;
    v_type := new.related_type;
    v_id := new.related_id;
  else
    v_type := new.related_type;
    v_id := new.related_id;
  end if;
  if v_id is null or v_type is null then
    return new;
  end if;
  if v_type = 'lease' then
    select org_id into v_org from gestion.leases where id = v_id;
  elsif v_type = 'ticket' then
    select org_id into v_org from gestion.tickets where id = v_id;
  elsif v_type = 'property' then
    select org_id into v_org from gestion.properties where id = v_id;
  elsif v_type = 'unit' then
    select org_id into v_org from gestion.units where id = v_id;
  elsif v_type = 'contact' then
    select org_id into v_org from gestion.contacts where id = v_id;
  elsif v_type = 'rent_period' then
    select org_id into v_org from gestion.rent_periods where id = v_id;
  elsif v_type = 'bill' then
    select org_id into v_org from gestion.bills where id = v_id;
  elsif v_type = 'deposit' then
    select org_id into v_org from gestion.deposits where id = v_id;
  elsif v_type = 'mandate' then
    select org_id into v_org from gestion.mandates where id = v_id;
  else
    return new;
  end if;
  -- Une ligne mère absente ne lie rien ; une ligne mère d'un autre espace est refusée.
  if v_org is not null and v_org <> new.org_id then
    raise exception 'gestion: % belongs to another workspace', v_type using errcode = '42501';
  end if;
  return new;
end
$$;
revoke all on function gestion.guard_scope_org() from public, anon, authenticated;

drop trigger if exists guard_scope_org on gestion.conversations;
create trigger guard_scope_org before insert or update of scope_type, scope_id, org_id on gestion.conversations
  for each row execute function gestion.guard_scope_org();
drop trigger if exists guard_scope_org on gestion.documents;
create trigger guard_scope_org before insert or update of related_type, related_id, storage_path, org_id on gestion.documents
  for each row execute function gestion.guard_scope_org();
drop trigger if exists guard_scope_org on gestion.registered_letters;
create trigger guard_scope_org before insert or update of related_type, related_id, org_id on gestion.registered_letters
  for each row execute function gestion.guard_scope_org();

-- ---------------------------------------------------------------------------
-- 4. Le lien fiche / compte ne s'écrit qu'en acceptant une invitation.
--    Un gestionnaire peut le retirer (user_id à null), jamais le poser.
--    Droits de l'appelant : current_user est le rôle de l'API pour une
--    écriture directe, et le propriétaire de la fonction dans portal_accept.
-- ---------------------------------------------------------------------------
create or replace function gestion.guard_contact_user()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') and new.user_id is not null
     and (tg_op = 'INSERT' or new.user_id is distinct from old.user_id) then
    raise exception 'gestion: a contact is linked to an account by its invitation only' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke all on function gestion.guard_contact_user() from public, anon;

drop trigger if exists guard_contact_user on gestion.contacts;
create trigger guard_contact_user before insert or update of user_id on gestion.contacts
  for each row execute function gestion.guard_contact_user();

-- ---------------------------------------------------------------------------
-- 5. Ce qu'un locataire écrit.
-- ---------------------------------------------------------------------------
alter table gestion.messages drop constraint if exists messages_body_length;
alter table gestion.messages add constraint messages_body_length check (char_length(body) <= 4000);

create or replace function gestion.message_from_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.sender_kind = 'tenant' then
    new.sent_at := now();
    new.read_at := null;
    new.translated := null;
  end if;
  return new;
end
$$;
revoke all on function gestion.message_from_tenant() from public, anon;

drop trigger if exists messages_from_tenant on gestion.messages;
create trigger messages_from_tenant before insert on gestion.messages
  for each row execute function gestion.message_from_tenant();

-- Une demande déposée par un locataire : nouvelle, datée d'ici, sur le lot et
-- le bien de son bail.
create or replace function gestion.ticket_from_tenant()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_unit uuid;
  v_property uuid;
begin
  if new.source = 'tenant' and new.lease_id is not null then
    select l.unit_id, u.property_id into v_unit, v_property
      from gestion.leases l join gestion.units u on u.id = l.unit_id
     where l.id = new.lease_id;
    new.unit_id := v_unit;
    new.property_id := v_property;
    new.status := 'new';
    new.created_at := now();
    new.updated_at := now();
    new.closed_at := null;
    new.pending_tenant_since := null;
    new.satisfaction := null;
    new.sla_due_at := null;
    new.created_by := auth.uid();
  end if;
  return new;
end
$$;
revoke all on function gestion.ticket_from_tenant() from public, anon, authenticated;

drop trigger if exists tickets_from_tenant on gestion.tickets;
create trigger tickets_from_tenant before insert on gestion.tickets
  for each row execute function gestion.ticket_from_tenant();

-- ---------------------------------------------------------------------------
-- 6. L'horloge d'une conversation suit ses messages.
-- ---------------------------------------------------------------------------
create or replace function gestion.touch_conversation()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  update gestion.conversations c
     set last_message_at = new.sent_at
   where c.id = new.conversation_id
     and (c.last_message_at is null or c.last_message_at < new.sent_at);
  return null;
end
$$;
revoke all on function gestion.touch_conversation() from public, anon, authenticated;

drop trigger if exists messages_touch_conversation on gestion.messages;
create trigger messages_touch_conversation after insert on gestion.messages
  for each row execute function gestion.touch_conversation();

update gestion.conversations c
   set last_message_at = m.last_sent
  from (select conversation_id, max(sent_at) as last_sent from gestion.messages group by conversation_id) m
 where m.conversation_id = c.id
   and c.last_message_at is distinct from m.last_sent;

-- ---------------------------------------------------------------------------
-- 7. Archiver un bien.
-- ---------------------------------------------------------------------------
create or replace function gestion.archive_property_lots()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.archived_at is not null and old.archived_at is null then
    if exists (select 1
                 from gestion.leases l
                 join gestion.units u on u.id = l.unit_id
                where u.property_id = new.id and l.status in ('active', 'notice')) then
      raise exception 'gestion: a property with a tenancy in force cannot be archived' using errcode = '23514';
    end if;
    update gestion.units set archived_at = new.archived_at where property_id = new.id and archived_at is null;
  elsif new.archived_at is null and old.archived_at is not null then
    -- Les lots archivés avec le bien reviennent avec lui ; ceux archivés à part restent archivés.
    update gestion.units set archived_at = null where property_id = new.id and archived_at = old.archived_at;
  end if;
  return null;
end
$$;
revoke all on function gestion.archive_property_lots() from public, anon, authenticated;

drop trigger if exists properties_archive_lots on gestion.properties;
create trigger properties_archive_lots after update of archived_at on gestion.properties
  for each row execute function gestion.archive_property_lots();

-- ---------------------------------------------------------------------------
-- 8. Ce qui est scellé ne se réécrit pas (par l'API ; la maintenance garde la main).
-- ---------------------------------------------------------------------------
create or replace function gestion.guard_sealed()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_status text;
  v_old jsonb;
  v_new jsonb;
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    -- Maintenance (postgres, tâches planifiées, rôle de service) : pas de garde.
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_table_name = 'documents' then
    if old.sealed and (new.sealed is distinct from old.sealed
                       or new.storage_path is distinct from old.storage_path
                       or new.sha256 is distinct from old.sha256
                       or new.size_bytes is distinct from old.size_bytes
                       or new.mime is distinct from old.mime
                       or new.class is distinct from old.class
                       or new.org_id is distinct from old.org_id) then
      raise exception 'gestion: a sealed document cannot be rewritten' using errcode = '42501';
    end if;
    return new;
  end if;

  if tg_table_name = 'edl_sessions' then
    if tg_op = 'DELETE' then
      if old.status = 'sealed' then
        raise exception 'gestion: a sealed inventory cannot be removed' using errcode = '42501';
      end if;
      return old;
    end if;
    if old.status = 'sealed' and (new.hash_manifest_sha256 is distinct from old.hash_manifest_sha256
                                  or new.kind is distinct from old.kind
                                  or new.lease_id is distinct from old.lease_id
                                  or new.org_id is distinct from old.org_id
                                  or new.status not in ('sealed', 'contested')) then
      raise exception 'gestion: a sealed inventory cannot be rewritten' using errcode = '42501';
    end if;
    return new;
  end if;

  if tg_table_name = 'edl_items' then
    select s.status into v_status from gestion.edl_sessions s
     where s.id = case when tg_op = 'DELETE' then old.session_id else new.session_id end;
    if v_status = 'sealed' then
      raise exception 'gestion: a sealed inventory cannot be rewritten' using errcode = '42501';
    end if;
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_table_name = 'edl_media' then
    select s.status into v_status
      from gestion.edl_items i join gestion.edl_sessions s on s.id = i.session_id
     where i.id = case when tg_op = 'DELETE' then old.item_id else new.item_id end;
    if v_status = 'sealed' then
      raise exception 'gestion: a sealed inventory cannot be rewritten' using errcode = '42501';
    end if;
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_table_name = 'registered_letters' then
    -- Une fois parti, ce que le courrier dit et à qui ne change plus. Les
    -- dates de l'accusé de réception restent à saisir et à corriger : le
    -- journal en garde la trace.
    if old.status <> 'draft' then
      v_old := to_jsonb(old);
      v_new := to_jsonb(new);
      if (v_new -> 'content') is distinct from (v_old -> 'content')
         or new.content_sha256 is distinct from old.content_sha256
         or new.template_key is distinct from old.template_key
         or new.related_type is distinct from old.related_type
         or new.related_id is distinct from old.related_id
         or new.recipient_contact_id is distinct from old.recipient_contact_id
         or new.org_id is distinct from old.org_id then
        raise exception 'gestion: a dispatched letter cannot be rewritten' using errcode = '42501';
      end if;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;
revoke all on function gestion.guard_sealed() from public, anon, authenticated;

drop trigger if exists guard_sealed on gestion.documents;
create trigger guard_sealed before update on gestion.documents
  for each row execute function gestion.guard_sealed();
drop trigger if exists guard_sealed on gestion.edl_sessions;
create trigger guard_sealed before update or delete on gestion.edl_sessions
  for each row execute function gestion.guard_sealed();
drop trigger if exists guard_sealed on gestion.edl_items;
create trigger guard_sealed before insert or update or delete on gestion.edl_items
  for each row execute function gestion.guard_sealed();
drop trigger if exists guard_sealed on gestion.edl_media;
create trigger guard_sealed before insert or update or delete on gestion.edl_media
  for each row execute function gestion.guard_sealed();
drop trigger if exists guard_sealed on gestion.registered_letters;
create trigger guard_sealed before update on gestion.registered_letters
  for each row execute function gestion.guard_sealed();

-- ---------------------------------------------------------------------------
-- 9. Le journal couvre aussi ces cinq tables.
-- ---------------------------------------------------------------------------
drop trigger if exists audit_rent_periods on gestion.rent_periods;
create trigger audit_rent_periods after insert or update or delete on gestion.rent_periods
  for each row execute function gestion.audit_row();
drop trigger if exists audit_payment_allocations on gestion.payment_allocations;
create trigger audit_payment_allocations after insert or update or delete on gestion.payment_allocations
  for each row execute function gestion.audit_row();
drop trigger if exists audit_lease_parties on gestion.lease_parties;
create trigger audit_lease_parties after insert or update or delete on gestion.lease_parties
  for each row execute function gestion.audit_row();
drop trigger if exists audit_contacts on gestion.contacts;
create trigger audit_contacts after insert or update or delete on gestion.contacts
  for each row execute function gestion.audit_row();
drop trigger if exists audit_edl_items on gestion.edl_items;
create trigger audit_edl_items after insert or update or delete on gestion.edl_items
  for each row execute function gestion.audit_row();

-- ---------------------------------------------------------------------------
-- 10. Le bucket gestion-media : le dossier `documents` suit le droit sur les
--     pièces (un comptable peut déposer une facture sans gérer les biens),
--     et le fichier d'une pièce scellée ne s'écrase pas.
-- ---------------------------------------------------------------------------
create or replace function gestion.media_sealed(path text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from gestion.documents d where d.storage_path = path and d.sealed)
      or exists (select 1
                   from gestion.edl_media m
                   join gestion.edl_items i on i.id = m.item_id
                   join gestion.edl_sessions s on s.id = i.session_id
                  where m.storage_path = path and s.status = 'sealed')
$$;
revoke all on function gestion.media_sealed(text) from public, anon;
grant execute on function gestion.media_sealed(text) to authenticated;

drop policy if exists gestion_media_select on storage.objects;
create policy gestion_media_select on storage.objects
  for select to authenticated
  using (bucket_id = 'gestion-media'
         and (gestion.can(gestion.media_org(name), 'gestion.properties.view')
              or ((storage.foldername(name))[2] = 'documents' and gestion.can(gestion.media_org(name), 'gestion.documents.view'))));

drop policy if exists gestion_media_insert on storage.objects;
create policy gestion_media_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'gestion-media'
              and (gestion.can(gestion.media_org(name), 'gestion.properties.edit')
                   or ((storage.foldername(name))[2] = 'documents' and gestion.can(gestion.media_org(name), 'gestion.documents.edit'))));

drop policy if exists gestion_media_update on storage.objects;
create policy gestion_media_update on storage.objects
  for update to authenticated
  using (bucket_id = 'gestion-media'
         and not gestion.media_sealed(name)
         and (gestion.can(gestion.media_org(name), 'gestion.properties.edit')
              or ((storage.foldername(name))[2] = 'documents' and gestion.can(gestion.media_org(name), 'gestion.documents.edit'))))
  with check (bucket_id = 'gestion-media'
              and (gestion.can(gestion.media_org(name), 'gestion.properties.edit')
                   or ((storage.foldername(name))[2] = 'documents' and gestion.can(gestion.media_org(name), 'gestion.documents.edit'))));

drop policy if exists gestion_media_delete on storage.objects;
create policy gestion_media_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'gestion-media'
         and (gestion.can(gestion.media_org(name), 'gestion.properties.edit')
              or ((storage.foldername(name))[2] = 'documents' and gestion.can(gestion.media_org(name), 'gestion.documents.edit'))));
