-- Identity, Team & RLS hardening (architecture audit 2026-08-14).
-- One identity (auth.users → profiles → memberships), robust invitations,
-- permission-aware RLS, single-conversation guarantee, cleanup of seed junk.

/* ------------------------------------------------------------------------- *
 * 1. PROFILES — every auth user has exactly one profile.
 *    8 users predate the handle_new_user trigger; backfill them, then seed
 *    empty names from their CRM member display name where available.
 * ------------------------------------------------------------------------- */

insert into public.profiles (id, first_name, last_name, phone, preferred_language, account_type)
select
  u.id,
  coalesce(u.raw_user_meta_data->>'first_name', ''),
  coalesce(u.raw_user_meta_data->>'last_name', ''),
  nullif(u.raw_user_meta_data->>'phone', ''),
  coalesce(nullif(u.raw_user_meta_data->>'preferred_language', ''), 'fr'),
  'customer'
from auth.users u
on conflict (id) do nothing;

update public.profiles p
   set first_name = split_part(m.display_name, ' ', 1),
       last_name  = case
         when position(' ' in m.display_name) = 0 then ''
         else btrim(substring(m.display_name from position(' ' in m.display_name) + 1))
       end
  from (
    select distinct on (user_id) user_id, display_name
    from public.crm_members
    where coalesce(btrim(display_name), '') <> ''
    order by user_id, created_at
  ) m
 where m.user_id = p.id
   and coalesce(p.first_name, '') = ''
   and coalesce(p.last_name, '') = '';

/* ------------------------------------------------------------------------- *
 * 2. INVITATIONS — expiry, permission-aware, deduplicated, previewable,
 *    idempotent acceptance with human-readable errors.
 * ------------------------------------------------------------------------- */

alter table public.crm_invites
  add column if not exists expires_at timestamptz not null default (now() + interval '14 days');

create or replace function public.crm_invite_member(p_agency uuid, p_email text, p_role text)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_token uuid;
begin
  if not (public.crm_has_role(p_agency, array['owner', 'admin'])
          or public.crm_has_perm(p_agency, 'team.invite')) then
    raise exception 'You are not allowed to invite members';
  end if;
  if p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Invalid email address';
  end if;
  if p_role not in ('admin', 'agent', 'marketing', 'assistant', 'viewer') then
    raise exception 'Invalid role';
  end if;
  if exists (
    select 1 from public.crm_members m
    join auth.users u on u.id = m.user_id
    where m.agency_id = p_agency and lower(u.email) = lower(trim(p_email))
  ) then
    raise exception 'This person is already a member of the agency';
  end if;

  -- Re-use (and refresh) an existing pending invite instead of stacking rows.
  select token into v_token
  from public.crm_invites
  where agency_id = p_agency
    and lower(email) = lower(trim(p_email))
    and accepted_at is null
  order by created_at desc
  limit 1;

  if v_token is not null then
    update public.crm_invites
       set role = p_role, expires_at = now() + interval '14 days', invited_by = auth.uid()
     where token = v_token;
    return v_token;
  end if;

  insert into public.crm_invites (agency_id, email, role, invited_by)
  values (p_agency, lower(trim(p_email)), p_role, auth.uid())
  returning token into v_token;
  return v_token;
end;
$$;

create or replace function public.crm_accept_invite(p_token uuid, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_invite record;
  v_email  text;
  v_first  text;
  v_last   text;
  v_name   text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to accept an invitation';
  end if;

  select email into v_email from auth.users where id = auth.uid();

  select * into v_invite
  from public.crm_invites
  where token = p_token
  for update;

  if not found then
    raise exception 'This invitation link is not valid';
  end if;

  if v_invite.accepted_at is not null then
    -- Double click / re-opened link: if it's the same person and they're in,
    -- treat it as success instead of scaring them with an error.
    if exists (
      select 1 from public.crm_members
      where user_id = auth.uid() and agency_id = v_invite.agency_id
    ) then
      return v_invite.agency_id;
    end if;
    raise exception 'This invitation has already been used';
  end if;

  if v_invite.expires_at <= now() then
    raise exception 'This invitation has expired — ask your agency for a new link';
  end if;

  if lower(v_invite.email) <> lower(coalesce(v_email, '')) then
    raise exception 'This invitation was sent to % — you are signed in with a different email', v_invite.email;
  end if;

  if exists (
    select 1 from public.crm_members
    where user_id = auth.uid() and agency_id = v_invite.agency_id
  ) then
    update public.crm_invites set accepted_at = now() where id = v_invite.id;
    return v_invite.agency_id;
  end if;

  -- Reuse the shared profile so the member starts with their real name.
  select first_name, last_name into v_first, v_last
  from public.profiles where id = auth.uid();
  v_name := coalesce(
    nullif(trim(p_display_name), ''),
    nullif(btrim(coalesce(v_first, '') || ' ' || coalesce(v_last, '')), ''),
    split_part(coalesce(v_email, 'agent'), '@', 1)
  );

  insert into public.crm_members (user_id, agency_id, role, display_name, email)
  values (auth.uid(), v_invite.agency_id, v_invite.role, v_name, coalesce(v_email, ''));
  update public.crm_invites set accepted_at = now() where id = v_invite.id;

  return v_invite.agency_id;
end;
$$;

-- Safe, token-gated preview so an invitee can see WHAT they are accepting
-- (agency, role, target email) before signing in.
create or replace function public.crm_invite_preview(p_token uuid)
returns table(agency_name text, role text, email text, expired boolean, used boolean)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select a.name, i.role, i.email, (i.expires_at <= now()), (i.accepted_at is not null)
  from public.crm_invites i
  join public.agencies a on a.id = i.agency_id
  where i.token = p_token;
$$;

drop policy if exists crm_invites_select on public.crm_invites;
create policy crm_invites_select on public.crm_invites
  for select to authenticated
  using (crm_has_role(agency_id, array['owner','admin']) or crm_has_perm(agency_id, 'team.invite'));

drop policy if exists crm_invites_delete on public.crm_invites;
create policy crm_invites_delete on public.crm_invites
  for delete to authenticated
  using (crm_has_role(agency_id, array['owner','admin']) or crm_has_perm(agency_id, 'team.invite'));

/* ------------------------------------------------------------------------- *
 * 3. JOIN REQUESTS — serialized decisions, requester notified, spoof-proof
 *    identity (email always taken from auth.users, never client input).
 * ------------------------------------------------------------------------- */

create or replace function public.crm_request_join(
  p_agency uuid, p_name text, p_email text, p_phone text default null, p_message text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_id    uuid;
  v_email text;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if exists (
    select 1 from public.crm_members
    where agency_id = p_agency and user_id = auth.uid()
  ) then
    raise exception 'Already a member of this agency';
  end if;

  -- The stored email is always the authenticated identity, not client input.
  select email into v_email from auth.users where id = auth.uid();

  insert into public.crm_join_requests (agency_id, user_id, name, email, phone, message)
  values (p_agency, auth.uid(), coalesce(nullif(trim(p_name), ''), 'Someone'),
          coalesce(v_email, p_email), p_phone, p_message)
  on conflict (agency_id, user_id) where status = 'pending' do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.crm_join_requests
    where agency_id = p_agency and user_id = auth.uid() and status = 'pending';
    return v_id;
  end if;

  insert into public.crm_notifications (agency_id, kind, title, body, link)
  values (p_agency, 'team',
    coalesce(nullif(trim(p_name), ''), 'Someone') || ' wants to join your agency',
    coalesce(nullif(p_message, ''), coalesce(v_email, '')), '/pro/team');
  return v_id;
end;
$$;

create or replace function public.crm_decide_join(p_request uuid, p_accept boolean, p_role text default 'agent')
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  r record;
  v_agency_name text;
begin
  select * into r from public.crm_join_requests
  where id = p_request and status = 'pending'
  for update;
  if r is null then raise exception 'Request not found or already decided'; end if;
  if not (crm_has_role(r.agency_id, array['owner']) or crm_has_perm(r.agency_id, 'team.invite')) then
    raise exception 'Not allowed to decide join requests';
  end if;

  if p_accept then
    if p_role not in ('admin','agent','marketing','assistant','viewer') then
      raise exception 'Invalid role';
    end if;
    insert into public.crm_members (user_id, agency_id, role, display_name, email, status, phone)
    values (r.user_id, r.agency_id, p_role, r.name, r.email, 'active', r.phone)
    on conflict do nothing;
  end if;

  update public.crm_join_requests
     set status = case when p_accept then 'accepted' else 'declined' end,
         decided_by = auth.uid(), decided_at = now()
   where id = p_request;

  -- The requester always learns the outcome (both directions).
  select name into v_agency_name from public.agencies where id = r.agency_id;
  insert into public.customer_notifications (user_id, kind, title, body, link)
  values (
    r.user_id, 'team',
    case when p_accept
      then 'Your request to join ' || coalesce(v_agency_name, 'the agency') || ' was accepted'
      else 'Your request to join ' || coalesce(v_agency_name, 'the agency') || ' was declined'
    end,
    case when p_accept then 'Open Morada Pro to get started.' else '' end,
    case when p_accept then '/pro' else '/pro/onboarding' end
  );
end;
$$;

/* ------------------------------------------------------------------------- *
 * 4. MEMBERS — removal honours the team.remove permission (RLS level).
 * ------------------------------------------------------------------------- */

drop policy if exists crm_members_delete on public.crm_members;
create policy crm_members_delete on public.crm_members
  for delete to authenticated
  using (
    (crm_has_role(agency_id, array['owner','admin']) or crm_has_perm(agency_id, 'team.remove'))
    and role <> 'owner'
  );

/* ------------------------------------------------------------------------- *
 * 5. CUSTOMER CONVERSATIONS — customers may read/create/update their own
 *    threads but never DELETE a conversation shared with an agency.
 * ------------------------------------------------------------------------- */

drop policy if exists conversations_customer_all on public.customer_conversations;
create policy conversations_customer_select on public.customer_conversations
  for select to authenticated using (user_id = auth.uid());
create policy conversations_customer_insert on public.customer_conversations
  for insert to authenticated with check (user_id = auth.uid());
create policy conversations_customer_update on public.customer_conversations
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

/* ------------------------------------------------------------------------- *
 * 6. ONE CONVERSATION PER ENQUIRY — the trigger now links the signed-in
 *    user (auth.uid() flows through direct inserts), and the upsert adopts a
 *    matching anonymous thread instead of creating a duplicate.
 * ------------------------------------------------------------------------- */

create or replace function public.customer_conversation_upsert(
  p_agency uuid, p_user uuid, p_listing uuid, p_discovery uuid,
  p_name text, p_email text, p_phone text, p_kind text, p_lead uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_id uuid;
begin
  if p_agency is null then
    return null;
  end if;

  select id into v_id
  from public.customer_conversations
  where agency_id = p_agency
    and listing_id        is not distinct from p_listing
    and discovery_post_id is not distinct from p_discovery
    and (
      (p_user is not null and user_id = p_user)
      or (p_user is null and user_id is null and p_email is not null
          and lower(contact_email) = lower(p_email))
    )
  order by created_at
  limit 1;

  -- A known user adopts their earlier anonymous thread (same agency/listing/
  -- email) instead of forking a second conversation.
  if v_id is null and p_user is not null and p_email is not null then
    select id into v_id
    from public.customer_conversations
    where agency_id = p_agency
      and listing_id        is not distinct from p_listing
      and discovery_post_id is not distinct from p_discovery
      and user_id is null
      and lower(contact_email) = lower(p_email)
    order by created_at
    limit 1;
    if v_id is not null then
      update public.customer_conversations set user_id = p_user where id = v_id;
    end if;
  end if;

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

create or replace function public.crm_import_public_lead()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
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

  -- auth.uid() is non-null when a signed-in visitor submits the enquiry with
  -- their own session — the conversation is then keyed to their account and
  -- shows up in their inbox with notifications. Anonymous API submissions
  -- keep the email-keyed thread.
  v_conv := public.customer_conversation_upsert(
    new.agency_id, auth.uid(), new.listing_id, null,
    new.name, new.email, new.phone, 'enquiry', new.id);

  perform public.customer_conversation_post(
    v_conv, new.agency_id, 'customer', null,
    coalesce(nullif(new.message, ''), 'Nouvelle demande de renseignements'),
    'New enquiry from ' || new.name,
    coalesce(nullif(new.message, ''), 'Via the Morada marketplace'));

  return new;
end;
$$;

-- One notification per agency reply: the customer_messages trigger already
-- notifies the customer; drop the RPC's duplicate insert.
create or replace function public.agency_reply_to_customer(p_conversation uuid, p_body text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
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
end;
$$;

/* ------------------------------------------------------------------------- *
 * 7. DATA REPAIR — merge duplicate (anonymous + account) conversation pairs,
 *    then link remaining anonymous threads to accounts matching by email.
 * ------------------------------------------------------------------------- */

do $$
declare dup record;
begin
  for dup in
    select anon.id as anon_id, owned.id as owned_id
    from public.customer_conversations anon
    join public.customer_conversations owned
      on owned.agency_id = anon.agency_id
     and owned.listing_id        is not distinct from anon.listing_id
     and owned.discovery_post_id is not distinct from anon.discovery_post_id
     and owned.user_id is not null
     and anon.user_id is null
     and anon.contact_email is not null
     and lower(coalesce(owned.contact_email, '')) = lower(anon.contact_email)
  loop
    update public.customer_messages
       set conversation_id = dup.owned_id
     where conversation_id = dup.anon_id;
    update public.crm_notifications
       set link = replace(link, dup.anon_id::text, dup.owned_id::text)
     where link like '%' || dup.anon_id::text || '%';
    delete from public.customer_conversations where id = dup.anon_id;
  end loop;
end;
$$;

update public.customer_conversations c
   set user_id = u.id
  from auth.users u
 where c.user_id is null
   and c.contact_email is not null
   and lower(c.contact_email) = lower(u.email)
   and not exists (
     select 1 from public.customer_conversations o
     where o.user_id = u.id
       and o.agency_id = c.agency_id
       and o.listing_id        is not distinct from c.listing_id
       and o.discovery_post_id is not distinct from c.discovery_post_id
   );

/* ------------------------------------------------------------------------- *
 * 8. LISTINGS — module permissions enforced at the RLS level.
 *    owner/admin: everything; properties.edit_all: any listing;
 *    properties.edit_own: assigned-to-me or unassigned; others: nothing.
 * ------------------------------------------------------------------------- */

drop policy if exists crm_listings_update on public.listings;
create policy crm_listings_update on public.listings
  for update to authenticated
  using (
    agency_id in (select crm_member_agencies())
    and (
      crm_has_role(agency_id, array['owner','admin'])
      or crm_has_perm(agency_id, 'properties.edit_all')
      or (crm_has_perm(agency_id, 'properties.edit_own')
          and (assigned_to = auth.uid() or assigned_to is null))
    )
  )
  with check (agency_id in (select crm_member_agencies()));

drop policy if exists crm_listing_images_all on public.listing_images;
create policy crm_listing_images_all on public.listing_images
  for all to authenticated
  using (exists (
    select 1 from public.listings l
    where l.id = listing_images.listing_id
      and l.agency_id in (select crm_member_agencies())
      and (
        crm_has_role(l.agency_id, array['owner','admin'])
        or crm_has_perm(l.agency_id, 'properties.edit_all')
        or (crm_has_perm(l.agency_id, 'properties.edit_own')
            and (l.assigned_to = auth.uid() or l.assigned_to is null))
      )
  ))
  with check (exists (
    select 1 from public.listings l
    where l.id = listing_images.listing_id
      and l.agency_id in (select crm_member_agencies())
      and (
        crm_has_role(l.agency_id, array['owner','admin'])
        or crm_has_perm(l.agency_id, 'properties.edit_all')
        or (crm_has_perm(l.agency_id, 'properties.edit_own')
            and (l.assigned_to = auth.uid() or l.assigned_to is null))
      )
  ));

/* ------------------------------------------------------------------------- *
 * 9. REALTIME — members' own rows broadcast so open tabs learn about role
 *    changes and removals without a reload.
 * ------------------------------------------------------------------------- */

do $$
begin
  alter publication supabase_realtime add table public.crm_members;
exception
  when duplicate_object then null;
  when undefined_object then null;
end;
$$;

/* ------------------------------------------------------------------------- *
 * 10. HYGIENE — search_path pinning + seed junk removal.
 * ------------------------------------------------------------------------- */

alter function public.set_updated_at() set search_path = public, pg_temp;
alter function public.crm_role_defaults(text) set search_path = public, pg_temp;

-- Empty test workspace (no members, no listings).
delete from public.agencies a
 where a.name = 'ZTest2'
   and not exists (select 1 from public.crm_members m where m.agency_id = a.id)
   and not exists (select 1 from public.listings l where l.agency_id = a.id);

-- Published seed post with a broken video URL (test row "ZT").
delete from public.discovery_posts where video_url = 'https://x/v.mp4';
