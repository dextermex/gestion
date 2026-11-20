-- 0031 · Messagerie, demandes et pièces : ce que la base doit porter
-- Proposée, NON appliquée en production (voir APPLIQUE.md). Rejouée
-- automatiquement sur la base jetable des tests de bout en bout, après 0030.
-- Prérequis : 0004 (conversations, messages, tickets), 0005 (documents),
-- 0015 (portal_tenant_lease, portal_tenant_live_lease, portal_tenant_ticket),
-- 0019 (une conversation par bail).
--
-- 1. Lu / non lu du locataire. Jusqu'ici un cookie du navigateur : un autre
--    appareil, un navigateur vidé, et tout redevenait non lu. La marque vit
--    désormais en base, une ligne par conversation et par compte
--    (`gestion.message_reads`). Le locataire ne l'écrit pas directement :
--    `gestion.mark_conversation_read()` vérifie que la conversation est celle
--    d'un de ses baux et borne la marque au dernier message réellement écrit.
--    `gestion.my_unread_messages()` rend, pour ses seules conversations, le
--    nombre de messages non lus et l'heure du dernier : une lecture légère,
--    pour le badge et pour l'interrogation périodique de l'espace.
--
-- 2. Ce qu'un locataire voit et dépose côté demandes.
--    a. Il ne lit plus que les demandes qu'il a lui-même posées
--       (source = 'tenant') : une intervention créée au bureau sur son lot
--       (devis, note interne) n'est plus dans ses « Demandes », ni ses pièces,
--       ni sa date de passage. Partager une intervention du bureau avec le
--       locataire serait une fonction à part (un drapeau sur le ticket).
--    b. Il peut joindre à sa demande, outre des photos, l'attestation
--       d'assurance qu'on lui réclame ou un autre papier (PDF) : classes
--       'photo', 'insurance', 'other'. La pièce doit se trouver dans le
--       dossier de son bail, dans l'espace du bail (même liaison que la
--       migration de sécurité du 11 octobre 2026, plus le chemin).
--
-- 3. Ce qu'un locataire voit des pièces du bail. Jusqu'ici : toute pièce
--    rattachée au bail, dès sa production (une mise en demeure avant son
--    envoi, le journal de preuve d'une signature). Désormais seulement celles
--    que le cabinet partage : `documents.shared_with_tenant`. L'application
--    le pose à vrai pour ce qu'elle produit à l'intention du locataire
--    (contrat, quittance, avis d'échéance, décompte, attestation, état des
--    lieux), à faux pour une relance formelle ou une mise en demeure tant
--    qu'elle n'est pas envoyée, et le gestionnaire le choisit pour une pièce
--    qu'il dépose sur un bail.
--
-- 4. Le bucket (le reste est dans 0030, section 10). Le fichier d'une pièce
--    scellée ne se supprime plus par l'API, comme il ne s'écrasait déjà plus.
--    Un fichier que le locataire vient de déposer et que rien ne référence
--    (la ligne de la pièce a été refusée) peut être retiré par lui, pour ne
--    pas rester dans le dossier du bail sans que personne ne le voie.
--
-- 5. La date de passage (`gestion.my_visits`, 0029) suit la même règle que
--    les demandes : seulement pour une demande que le locataire a posée.
--
-- Additif, sauf des policies et fonctions réécrites (tickets_portal_select,
-- documents_portal_select, documents_portal_insert, gestion_media_delete,
-- portal_tenant_ticket, my_visits). Rien dans public ; gestion.can non
-- touchée. Prérequis en plus : 0029 (my_visits), 0030 (media_sealed,
-- lease_org, media_org).
--
-- ATTENTION (intégration) : `documents_portal_insert`, `gestion_media_delete`
-- et `portal_tenant_ticket` sont redéfinies ici après 0030. Si 0030 leur
-- ajoute une condition, la reporter dans ce fichier.
--
-- Réversible :
--   drop function if exists gestion.my_unread_messages();
--   drop function if exists gestion.mark_conversation_read(uuid, timestamptz);
--   drop table if exists gestion.message_reads;
--   policies tickets_portal_select (0006), documents_portal_* (0015/0030) et
--   gestion_media_delete (0030) telles qu'avant ; drop policy
--   gestion_media_portal_delete on storage.objects ; drop function
--   gestion.media_unregistered(text) ; portal_tenant_ticket (0015) et
--   my_visits (0029) telles qu'avant ;
--   alter table gestion.documents drop column shared_with_tenant;

-- ---------------------------------------------------------------------------
-- 1. LA MARQUE DE LECTURE DU LOCATAIRE
-- ---------------------------------------------------------------------------
create table if not exists gestion.message_reads (
  conversation_id uuid not null references gestion.conversations(id) on delete cascade,
  user_id uuid not null,
  org_id uuid not null references public.agencies(id) on delete cascade,
  read_until timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index if not exists message_reads_user_idx on gestion.message_reads(user_id);

alter table gestion.message_reads enable row level security;

-- Chacun lit ses propres marques, et rien d'autre. Aucune policy d'écriture :
-- la seule porte est la fonction ci-dessous.
drop policy if exists message_reads_own on gestion.message_reads;
create policy message_reads_own on gestion.message_reads for select to authenticated
  using (user_id = auth.uid());
revoke all on gestion.message_reads from anon, authenticated;
grant select on gestion.message_reads to authenticated;

-- « J'ai lu cette conversation jusqu'à tel message. » La conversation doit
-- être celle d'un bail de l'appelant (même prédicat que les policies du
-- portail) ; la marque ne dépasse jamais le dernier message écrit et ne
-- recule jamais. Rend la marque en vigueur, ou NULL s'il n'y a rien à lire.
create or replace function gestion.mark_conversation_read(p_conversation uuid, p_until timestamptz default null)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_org uuid;
  v_last timestamptz;
  v_mark timestamptz;
begin
  if v_user is null then
    raise exception 'gestion: not signed in' using errcode = '42501';
  end if;
  select c.org_id into v_org
    from gestion.conversations c
   where c.id = p_conversation
     and c.scope_type = 'lease'
     and c.scope_id is not null
     and gestion.portal_tenant_lease(c.scope_id);
  if v_org is null then
    raise exception 'gestion: conversation not found' using errcode = '42501';
  end if;
  select max(m.sent_at) into v_last from gestion.messages m where m.conversation_id = p_conversation;
  if v_last is null then
    return null;
  end if;
  v_mark := least(coalesce(p_until, v_last), v_last);
  insert into gestion.message_reads as r (conversation_id, user_id, org_id, read_until)
  values (p_conversation, v_user, v_org, v_mark)
  on conflict (conversation_id, user_id) do update
    set read_until = greatest(r.read_until, excluded.read_until),
        updated_at = now()
  returning r.read_until into v_mark;
  return v_mark;
end
$$;
revoke all on function gestion.mark_conversation_read(uuid, timestamptz) from public, anon;
grant execute on function gestion.mark_conversation_read(uuid, timestamptz) to authenticated;

-- Ce que le locataire connecté n'a pas lu, conversation par conversation :
-- les messages des autres (le gestionnaire, un colocataire) écrits après sa
-- marque de lecture ou après son propre dernier message, le plus récent des
-- deux. Uniquement les conversations de ses baux, quel que soit son rôle par
-- ailleurs.
create or replace function gestion.my_unread_messages()
returns table (conversation_id uuid, lease_id uuid, unread integer, last_sent_at timestamptz, read_until timestamptz)
language sql stable security definer
set search_path = ''
as $$
  select c.id,
         c.scope_id,
         (select count(*)::integer
            from gestion.messages m
           where m.conversation_id = c.id
             and not (m.sender_kind = 'tenant' and m.sender_user_id is not distinct from auth.uid())
             and m.sent_at > greatest(
                   coalesce(r.read_until, '-infinity'::timestamptz),
                   coalesce((select max(o.sent_at) from gestion.messages o
                              where o.conversation_id = c.id and o.sender_kind = 'tenant' and o.sender_user_id = auth.uid()),
                            '-infinity'::timestamptz))),
         (select max(m.sent_at) from gestion.messages m where m.conversation_id = c.id),
         r.read_until
    from gestion.conversations c
    left join gestion.message_reads r on r.conversation_id = c.id and r.user_id = auth.uid()
   where auth.uid() is not null
     and c.scope_type = 'lease'
     and c.scope_id is not null
     and gestion.portal_tenant_lease(c.scope_id);
$$;
revoke all on function gestion.my_unread_messages() from public, anon;
grant execute on function gestion.my_unread_messages() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. LES DEMANDES DU LOCATAIRE, ET CE QU'IL Y JOINT
-- ---------------------------------------------------------------------------

-- Une demande est au locataire si elle est posée sur l'un de ses baux ET
-- qu'elle vient de lui. Les policies qui s'appuient sur ce prédicat (pièces
-- d'une demande, ancrage d'un message) suivent.
create or replace function gestion.portal_tenant_ticket(p_ticket uuid)
returns boolean language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from gestion.tickets t
     where t.id = p_ticket
       and t.lease_id is not null
       and t.source = 'tenant'
       and gestion.portal_tenant_lease(t.lease_id)
  );
$$;
revoke all on function gestion.portal_tenant_ticket(uuid) from public, anon;
grant execute on function gestion.portal_tenant_ticket(uuid) to authenticated;

drop policy if exists tickets_portal_select on gestion.tickets;
create policy tickets_portal_select on gestion.tickets for select to authenticated
  using (lease_id is not null and source = 'tenant' and gestion.portal_tenant_lease(lease_id));

-- Une pièce déposée par le locataire : sur sa propre demande, d'un bail en
-- cours, dans l'espace de ce bail, et dont le fichier est dans le dossier de
-- ce bail. Trois classes : la photo, l'attestation d'assurance, l'autre papier.
drop policy if exists documents_portal_insert on gestion.documents;
create policy documents_portal_insert on gestion.documents for insert to authenticated
  with check (
    related_type = 'ticket' and related_id is not null
    and class in ('photo', 'insurance', 'other')
    and uploaded_by = auth.uid()
    and exists (
      select 1 from gestion.tickets t
       where t.id = documents.related_id
         and t.org_id = documents.org_id
         and t.lease_id is not null
         and t.source = 'tenant'
         and gestion.portal_tenant_live_lease(t.lease_id)
         and left(documents.storage_path, 82) = documents.org_id::text || '/tickets/' || t.lease_id::text || '/'
    )
  );

-- ---------------------------------------------------------------------------
-- 3. CE QUE LE CABINET PARTAGE AVEC LE LOCATAIRE
-- ---------------------------------------------------------------------------
alter table gestion.documents
  add column if not exists shared_with_tenant boolean not null default false;

-- Les pièces déjà produites pour le locataire restent les siennes : tout ce
-- qui est scellé sur un bail, sauf les relances formelles, les mises en
-- demeure et le journal de preuve d'une signature. (En production à
-- l'application : aucune pièce rattachée à un bail.)
do $$
begin
  update gestion.documents d
     set shared_with_tenant = true
   where d.related_type = 'lease' and d.sealed and not d.shared_with_tenant;
  if to_regclass('gestion.generated_documents') is not null then
    execute $q$
      update gestion.documents d
         set shared_with_tenant = false
       where d.shared_with_tenant
         and exists (select 1 from gestion.generated_documents g
                      where g.document_id = d.id and g.kind in ('arrears_formal', 'arrears_mise_en_demeure'))
    $q$;
  end if;
  if to_regclass('gestion.signature_signers') is not null then
    execute $q$
      update gestion.documents d
         set shared_with_tenant = false
       where d.shared_with_tenant
         and exists (select 1 from gestion.signature_signers sg where sg.audit_document_id = d.id)
    $q$;
  end if;
end $$;

-- Les pièces du bail que le cabinet partage, et celles de ses propres
-- demandes ; jamais celles du bien ou du cabinet.
drop policy if exists documents_portal_select on gestion.documents;
create policy documents_portal_select on gestion.documents for select to authenticated
  using (
    (related_type = 'lease' and related_id is not null and shared_with_tenant and gestion.portal_tenant_lease(related_id))
    or (related_type = 'ticket' and related_id is not null and gestion.portal_tenant_ticket(related_id))
  );

-- ---------------------------------------------------------------------------
-- 4. LE BUCKET
-- ---------------------------------------------------------------------------

-- Le texte de 0030, plus : pas le fichier d'une pièce scellée.
drop policy if exists gestion_media_delete on storage.objects;
create policy gestion_media_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'gestion-media'
         and not gestion.media_sealed(name)
         and (gestion.can(gestion.media_org(name), 'gestion.properties.edit')
              or ((storage.foldername(name))[2] = 'documents' and gestion.can(gestion.media_org(name), 'gestion.documents.edit'))));

-- Un fichier que nulle pièce ne nomme, quels que soient les droits de
-- l'appelant sur les lignes (la fonction lit le registre entier).
create or replace function gestion.media_unregistered(path text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select not exists (select 1 from gestion.documents d where d.storage_path = path)
$$;
revoke all on function gestion.media_unregistered(text) from public, anon;
grant execute on function gestion.media_unregistered(text) to authenticated;

-- Le locataire retire un fichier qu'il vient de déposer dans le dossier de
-- son bail en cours, tant qu'aucune pièce ne le nomme : le seul cas est une
-- ligne refusée juste après l'envoi du fichier. Une pièce enregistrée ne se
-- retire pas.
drop policy if exists gestion_media_portal_delete on storage.objects;
create policy gestion_media_portal_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'gestion-media'
         and (storage.foldername(name))[2] = 'tickets'
         and gestion.media_org(name) = gestion.lease_org(gestion.media_segment(name, 3))
         and gestion.portal_tenant_live_lease(gestion.media_segment(name, 3))
         and gestion.media_unregistered(name));

-- ---------------------------------------------------------------------------
-- 5. LA DATE DE PASSAGE : SEULEMENT POUR LES DEMANDES DU LOCATAIRE
-- ---------------------------------------------------------------------------
create or replace function gestion.my_visits()
returns table (ticket_id uuid, status text, scheduled_at timestamptz, artisan_name text)
language sql stable security definer
set search_path = ''
as $$
  select w.ticket_id,
         w.status,
         w.scheduled_at,
         nullif(coalesce(nullif(trim(c.legal_name), ''), nullif(c.display_name, '—')), '')
    from gestion.work_orders w
    join gestion.tickets t on t.id = w.ticket_id
    left join gestion.contacts c on c.id = w.artisan_contact_id
   where t.lease_id is not null
     and t.source = 'tenant'
     and gestion.portal_tenant_lease(t.lease_id)
     and w.scheduled_at is not null
     and w.status <> 'declined';
$$;
revoke all on function gestion.my_visits() from public, anon;
grant execute on function gestion.my_visits() to authenticated;
