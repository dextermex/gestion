-- 0019 · Une conversation par bail ; les demandes y prennent place
--
-- Jusqu'ici une demande de locataire ouvrait sa propre conversation
-- (scope_type = 'ticket'). Messages devient une conversation continue par
-- bail (scope_type = 'lease', scope_id = le bail), et une demande y est un
-- message qui porte le ticket : `messages.ticket_id`. Le titre, le statut,
-- la description et les photos restent sur le ticket ; le message n'est que
-- sa place dans le fil et son état lu / non lu. Rien n'est copié.
--
-- Additif : une colonne, deux index, quatre policies du portail réécrites
-- pour admettre le fil du bail (lecture pour tout bail du locataire, écriture
-- en son nom, ancrage d'un ticket seulement s'il est le sien ; les fils de
-- ticket restent lisibles pour ne rien perdre). Les fils de demande
-- existants sont fondus dans celui du bail (messages déplacés, fil vide
-- supprimé) et chaque demande de locataire sans ancre en reçoit une à la
-- date de sa création, marquée lue. En production au moment de
-- l'application : aucune conversation, aucun message, deux demandes.
-- Réversible : drop de la colonne et des index, policies telles qu'en 0015.

alter table gestion.messages
  add column if not exists ticket_id uuid references gestion.tickets(id) on delete set null;
create index if not exists messages_ticket_idx on gestion.messages(ticket_id) where ticket_id is not null;

-- Un seul fil par bail. S'il y en avait plusieurs, ils sont fondus dans le
-- plus ancien avant que l'index ne l'exige.
do $$
declare dup record; keep uuid;
begin
  for dup in
    select scope_id from gestion.conversations where scope_type = 'lease' group by scope_id having count(*) > 1
  loop
    select id into keep from gestion.conversations
     where scope_type = 'lease' and scope_id = dup.scope_id order by created_at, id limit 1;
    update gestion.messages set conversation_id = keep
     where conversation_id in (select id from gestion.conversations where scope_type = 'lease' and scope_id = dup.scope_id and id <> keep);
    delete from gestion.conversations where scope_type = 'lease' and scope_id = dup.scope_id and id <> keep;
  end loop;
end $$;
create unique index if not exists conversations_lease_one on gestion.conversations(scope_id) where scope_type = 'lease';

-- Les fils de demande rejoignent le fil du bail ; chaque demande de
-- locataire reçoit son ancre, à sa date, lue (elle était déjà à l'écran).
do $$
declare r record; canonical uuid; label text;
begin
  for r in
    select t.id as ticket_id, t.org_id, t.lease_id, t.title, t.created_at, t.created_by,
           (select c.id from gestion.conversations c where c.scope_type = 'ticket' and c.scope_id = t.id order by c.created_at limit 1) as thread_id
      from gestion.tickets t
     where t.lease_id is not null
       and (t.source = 'tenant' or exists (select 1 from gestion.conversations c where c.scope_type = 'ticket' and c.scope_id = t.id))
     order by t.created_at
  loop
    select c.id into canonical from gestion.conversations c where c.scope_type = 'lease' and c.scope_id = r.lease_id;
    if canonical is null then
      select coalesce(u.label, '') || case when p.name is not null then ' · ' || p.name else '' end into label
        from gestion.leases l
        join gestion.units u on u.id = l.unit_id
        join gestion.properties p on p.id = u.property_id
       where l.id = r.lease_id;
      insert into gestion.conversations (org_id, scope_type, scope_id, subject, created_at)
      values (r.org_id, 'lease', r.lease_id, coalesce(nullif(label, ''), 'Conversation'), r.created_at)
      returning id into canonical;
    end if;
    if r.thread_id is not null then
      update gestion.messages set conversation_id = canonical where conversation_id = r.thread_id;
      delete from gestion.conversations where id = r.thread_id;
    end if;
    if not exists (select 1 from gestion.messages m where m.ticket_id = r.ticket_id) then
      insert into gestion.messages (org_id, conversation_id, sender_kind, sender_user_id, body, sent_at, read_at, ticket_id)
      values (r.org_id, canonical, 'tenant', r.created_by, r.title, r.created_at, now(), r.ticket_id);
    end if;
    update gestion.conversations
       set last_message_at = (select max(m.sent_at) from gestion.messages m where m.conversation_id = canonical)
     where id = canonical;
  end loop;
end $$;

-- Le portail : le fil du bail se lit pour tout bail du locataire (l'historique
-- reste le sien après son départ), s'ouvre en son nom, et n'accueille que ses
-- messages ; un ticket ne s'y ancre que s'il est le sien.
drop policy if exists conversations_portal_select on gestion.conversations;
create policy conversations_portal_select on gestion.conversations for select to authenticated
  using (
    (scope_type = 'lease' and scope_id is not null and gestion.portal_tenant_lease(scope_id))
    or (scope_type = 'ticket' and scope_id is not null and gestion.portal_tenant_ticket(scope_id))
  );
drop policy if exists conversations_portal_insert on gestion.conversations;
create policy conversations_portal_insert on gestion.conversations for insert to authenticated
  with check (scope_type = 'lease' and scope_id is not null and gestion.portal_tenant_lease(scope_id));

drop policy if exists messages_portal_select on gestion.messages;
create policy messages_portal_select on gestion.messages for select to authenticated
  using (exists (
    select 1 from gestion.conversations cv
     where cv.id = conversation_id
       and (
         (cv.scope_type = 'lease' and cv.scope_id is not null and gestion.portal_tenant_lease(cv.scope_id))
         or (cv.scope_type = 'ticket' and cv.scope_id is not null and gestion.portal_tenant_ticket(cv.scope_id))
       )
  ));
drop policy if exists messages_portal_insert on gestion.messages;
create policy messages_portal_insert on gestion.messages for insert to authenticated
  with check (
    sender_kind = 'tenant' and sender_user_id = auth.uid()
    and (ticket_id is null or gestion.portal_tenant_ticket(ticket_id))
    and exists (
      select 1 from gestion.conversations cv
       where cv.id = conversation_id
         and (
           (cv.scope_type = 'lease' and cv.scope_id is not null and gestion.portal_tenant_lease(cv.scope_id))
           or (cv.scope_type = 'ticket' and cv.scope_id is not null and gestion.portal_tenant_ticket(cv.scope_id))
         )
    )
  );
