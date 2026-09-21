-- ===========================================================================
-- Client ↔ agency conversations: every client enquiry becomes a real, visible
-- conversation in Morada Pro.
--
-- Before: a public enquiry created only a `leads` row + a crm_notification.
-- Nothing was written to customer_conversations/customer_messages, so the
-- agency's client inbox stayed empty and the "New enquiry" notification pointed
-- at a page with no conversation. customer_conversations.user_id was also
-- NOT NULL (FK to auth.users), so an anonymous public enquiry could not be
-- represented at all.
--
-- This migration:
--   1. lets customer_conversations hold anonymous enquiries (nullable user_id +
--      contact fields + lead link + kind + read-tracking);
--   2. adds an idempotent find-or-create helper (anti-duplicate);
--   3. wires new leads AND visit requests into a conversation + first message,
--      with the notification pointing at the conversation;
--   4. lets agencies reply through a SECURITY DEFINER RPC that also notifies the
--      client;
--   5. backfills the enquiries that already exist, without duplicates;
--   6. keeps RLS intact (agencies see their conversations, clients see only
--      theirs, internal team threads stay separate).
-- ===========================================================================

/* 1. Extend customer_conversations ---------------------------------------- */
alter table public.customer_conversations
  alter column user_id drop not null;

alter table public.customer_conversations
  add column if not exists contact_name          text,
  add column if not exists contact_email         text,
  add column if not exists contact_phone         text,
  add column if not exists lead_id               uuid references public.leads(id) on delete set null,
  add column if not exists kind                  text not null default 'enquiry',
  add column if not exists last_sender_role      text,
  add column if not exists agency_last_read_at   timestamptz,
  add column if not exists customer_last_read_at timestamptz;

alter table public.customer_conversations drop constraint if exists customer_conversations_kind_chk;
alter table public.customer_conversations add constraint customer_conversations_kind_chk
  check (kind in ('enquiry','visit','discovery','favourite','message'));

create index if not exists customer_conversations_lead_idx  on public.customer_conversations(lead_id);
create index if not exists customer_conversations_email_idx on public.customer_conversations(agency_id, lower(contact_email));

/* 2. Idempotent find-or-create (anti-duplicate) --------------------------- *
 * One conversation per (agency, listing/discovery context, participant). The
 * participant is the auth user when logged in, otherwise the email. Called only
 * from SECURITY DEFINER triggers, so it is not grantable to clients. */
create or replace function public.customer_conversation_upsert(
  p_agency uuid, p_user uuid, p_listing uuid, p_discovery uuid,
  p_name text, p_email text, p_phone text, p_kind text, p_lead uuid
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
begin
  if p_agency is null then
    return null;
  end if;

  select id into v_id
  from public.customer_conversations
  where agency_id = p_agency
    and listing_id       is not distinct from p_listing
    and discovery_post_id is not distinct from p_discovery
    and (
      (p_user is not null and user_id = p_user)
      or (p_user is null and user_id is null and p_email is not null
          and lower(contact_email) = lower(p_email))
    )
  order by created_at
  limit 1;

  if v_id is null then
    insert into public.customer_conversations
      (user_id, agency_id, listing_id, discovery_post_id, subject,
       contact_name, contact_email, contact_phone, kind, lead_id, last_message_at)
    values
      (p_user, p_agency, p_listing, p_discovery,
       coalesce(nullif(p_name, ''), 'Client'),
       p_name, p_email, p_phone, coalesce(p_kind, 'enquiry'), p_lead, now())
    returning id into v_id;
  else
    update public.customer_conversations
       set contact_name  = coalesce(contact_name,  p_name),
           contact_email = coalesce(contact_email, p_email),
           contact_phone = coalesce(contact_phone, p_phone),
           lead_id       = coalesce(lead_id, p_lead)
     where id = v_id;
  end if;

  return v_id;
end;
$$;

/* Post a message into a conversation, bump it, and (optionally) notify the
 * agency. Definer-only helper. */
create or replace function public.customer_conversation_post(
  p_conversation uuid, p_agency uuid, p_sender_role text, p_sender_user uuid,
  p_body text, p_notify_title text, p_notify_body text, p_notify boolean default true
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.customer_messages (conversation_id, sender_role, sender_user, body)
  values (p_conversation, p_sender_role, p_sender_user, coalesce(nullif(p_body, ''), '—'));

  update public.customer_conversations
     set last_message_at  = now(),
         last_sender_role = p_sender_role
   where id = p_conversation;

  if p_notify and p_sender_role = 'customer' and p_agency is not null then
    insert into public.crm_notifications (agency_id, kind, title, body, link)
    values (p_agency, 'lead', p_notify_title, p_notify_body,
            '/pro/messages?c=' || p_conversation);
  end if;
end;
$$;

revoke execute on function public.customer_conversation_upsert(uuid,uuid,uuid,uuid,text,text,text,text,uuid) from public, anon, authenticated;
revoke execute on function public.customer_conversation_post(uuid,uuid,text,uuid,text,text,text,boolean) from public, anon, authenticated;

/* 3a. New public enquiry → crm_lead + conversation + first message -------- */
create or replace function public.crm_import_public_lead()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_lead uuid;
  v_conv uuid;
begin
  if new.agency_id is null then
    return new;
  end if;

  insert into public.crm_leads
    (agency_id, listing_id, source_lead_id, name, email, phone, message, source, stage)
  values
    (new.agency_id, new.listing_id, new.id, new.name, new.email, new.phone,
     coalesce(new.message, ''), 'website_enquiry', 'new')
  returning id into v_lead;

  -- Public enquiries are anonymous (no auth user) → key the conversation by email.
  v_conv := public.customer_conversation_upsert(
    new.agency_id, null, new.listing_id, null,
    new.name, new.email, new.phone, 'enquiry', new.id);

  perform public.customer_conversation_post(
    v_conv, new.agency_id, 'customer', null,
    coalesce(nullif(new.message, ''), 'Nouvelle demande de renseignements'),
    'New enquiry from ' || new.name,
    coalesce(nullif(new.message, ''), 'Via the Morada marketplace'));

  return new;
end;
$$;

/* 3b. New visit request → conversation + first message -------------------- */
create or replace function public.customer_conv_from_visit()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_conv uuid;
  v_name text;
begin
  if new.agency_id is null then
    return new;
  end if;

  select coalesce(nullif(trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')), ''), 'Client')
    into v_name
  from public.profiles where id = new.user_id;

  v_conv := public.customer_conversation_upsert(
    new.agency_id, new.user_id, new.listing_id, new.discovery_post_id,
    coalesce(v_name, 'Client'), null, null, 'visit', null);

  perform public.customer_conversation_post(
    v_conv, new.agency_id, 'customer', new.user_id,
    'Demande de visite'
      || case when new.preferred_at is not null
              then ' · ' || to_char(new.preferred_at, 'DD/MM/YYYY HH24:MI') else '' end
      || case when nullif(new.message, '') is not null then E'\n' || new.message else '' end,
    'Visit request from ' || coalesce(v_name, 'a client'),
    'Nouvelle demande de visite');

  return new;
end;
$$;

drop trigger if exists customer_conv_from_visit_trg on public.visit_requests;
create trigger customer_conv_from_visit_trg
  after insert on public.visit_requests
  for each row execute function public.customer_conv_from_visit();

/* 4. Agency reply RPC (notifies the client, respects RLS) ----------------- */
create or replace function public.agency_reply_to_customer(p_conversation uuid, p_body text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_agency uuid;
  v_user uuid;
begin
  select agency_id, user_id into v_agency, v_user
  from public.customer_conversations where id = p_conversation;

  if v_agency is null or v_agency not in (select public.crm_member_agencies()) then
    raise exception 'not a member of this conversation''s agency';
  end if;
  if coalesce(nullif(trim(p_body), ''), '') = '' then
    raise exception 'empty message';
  end if;

  insert into public.customer_messages (conversation_id, sender_role, sender_user, body)
  values (p_conversation, 'agency', auth.uid(), p_body);

  update public.customer_conversations
     set last_message_at = now(), last_sender_role = 'agency'
   where id = p_conversation;

  -- Notify the client (only if they have an account).
  if v_user is not null then
    insert into public.customer_notifications (user_id, kind, title, body, link)
    values (v_user, 'reply', 'New reply from your agency',
            left(p_body, 140), '/account/messages');
  end if;
end;
$$;

grant execute on function public.agency_reply_to_customer(uuid, text) to authenticated;

/* 5. Unread counts for the agency ----------------------------------------- */
create or replace function public.agency_unread_counts(p_agency uuid)
returns table(conversation_id uuid, unread bigint)
language sql security definer set search_path = public, pg_temp stable as $$
  with allowed as (select 1 where p_agency in (select public.crm_member_agencies()))
  select m.conversation_id, count(*)::bigint
  from public.customer_messages m
  join public.customer_conversations c on c.id = m.conversation_id
  where c.agency_id = p_agency and exists (select 1 from allowed)
    and m.sender_role = 'customer'
    and (c.agency_last_read_at is null or m.created_at > c.agency_last_read_at)
  group by m.conversation_id
$$;

grant execute on function public.agency_unread_counts(uuid) to authenticated;

/* 6. RLS: let agency members mark conversations read ---------------------- */
drop policy if exists conversations_agency_update on public.customer_conversations;
create policy conversations_agency_update on public.customer_conversations
  for update to authenticated
  using (agency_id in (select public.crm_member_agencies()))
  with check (agency_id in (select public.crm_member_agencies()));

/* 7. Backfill existing enquiries (idempotent, no duplicate notifications) -- */
do $$
declare
  r record;
  v_conv uuid;
begin
  for r in
    select * from public.leads
    where agency_id is not null
      and id not in (select lead_id from public.customer_conversations where lead_id is not null)
  loop
    v_conv := public.customer_conversation_upsert(
      r.agency_id, null, r.listing_id, null, r.name, r.email, r.phone, 'enquiry', r.id);

    if not exists (select 1 from public.customer_messages where conversation_id = v_conv) then
      -- p_notify = false: the original "New enquiry" notification already exists.
      perform public.customer_conversation_post(
        v_conv, r.agency_id, 'customer', null,
        coalesce(nullif(r.message, ''), 'Nouvelle demande de renseignements'),
        '', '', false);
    end if;

    -- Re-point the already-existing notification at the conversation.
    update public.crm_notifications n
       set link = '/pro/messages?c=' || v_conv
      from public.crm_leads cl
     where cl.source_lead_id = r.id
       and n.link = '/pro/leads/' || cl.id;
  end loop;
end $$;
