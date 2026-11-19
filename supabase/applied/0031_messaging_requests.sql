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
-- Tout est additif. Rien dans public ; gestion.can non touchée.
--
-- Réversible :
--   drop function if exists gestion.my_unread_messages();
--   drop function if exists gestion.mark_conversation_read(uuid, timestamptz);
--   drop table if exists gestion.message_reads;

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
