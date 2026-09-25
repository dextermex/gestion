-- 0023 · Envois : le registre des e-mails partis (ou non), les préférences
-- de notification, et ce qu'un locataire peut en déclencher
-- Proposé, non appliqué en production (voir APPLIQUE.md). Rejoué
-- automatiquement sur la base jetable des tests de bout en bout.
--
-- Tout est additif :
--
-- 1. workspace_settings.notify_tenant_messages / notify_manager_messages :
--    l'espace choisit si un message du bureau avertit le locataire par e-mail,
--    et si un message ou une demande du locataire avertit le bureau.
--
-- 2. gestion.deliveries : chaque e-mail que l'application a composé, à qui,
--    pour quelle pièce ou quel message, et ce qu'il en est advenu (parti par
--    Resend, ou enregistré sans partir quand le déploiement n'a pas de clé,
--    refusé, injoignable). Un journal : rien ne s'y modifie ni ne s'y efface.
--
-- 3. gestion.portal_notification_target(bail) : ce qu'un locataire lit pour
--    avertir son bureau (l'adresse et si le bureau le souhaite), et rien
--    d'autre des réglages ; gestion.portal_record_delivery(...) : la ligne du
--    journal qu'un locataire laisse pour cet envoi, sur son propre bail.
--
-- Réversible :
--   drop function gestion.portal_record_delivery(uuid, text, text, text, text, text, text, text, text);
--   drop function gestion.portal_notification_target(uuid);
--   drop table gestion.deliveries;
--   alter table gestion.workspace_settings drop column notify_tenant_messages, drop column notify_manager_messages;

-- 1. Les préférences.
alter table gestion.workspace_settings add column notify_tenant_messages boolean not null default true;
alter table gestion.workspace_settings add column notify_manager_messages boolean not null default true;

-- 2. Le journal des envois.
create table gestion.deliveries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  channel text not null default 'email' check (channel in ('email')),
  kind text not null check (kind in ('document', 'message', 'request')),
  lease_id uuid references gestion.leases(id) on delete set null,
  document_id uuid references gestion.documents(id) on delete set null,
  recipient_kind text not null check (recipient_kind in ('tenant', 'manager')),
  recipient_contact_id uuid references gestion.contacts(id) on delete set null,
  recipient_email text not null,
  lang text not null default 'fr' check (lang in ('fr', 'en', 'de', 'lu')),
  subject text not null,
  body_text text not null,
  status text not null check (status in ('sent', 'not_configured', 'rejected', 'unreachable')),
  provider text,
  provider_message_id text,
  created_by uuid,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index deliveries_org_at_idx on gestion.deliveries (org_id, created_at desc);
alter table gestion.deliveries enable row level security;
create policy deliveries_select on gestion.deliveries
  for select to authenticated using (gestion.can(org_id, 'gestion.documents.view'));
create policy deliveries_insert on gestion.deliveries
  for insert to authenticated with check (gestion.can(org_id, 'gestion.documents.edit'));
grant select, insert on gestion.deliveries to authenticated;
revoke update, delete on gestion.deliveries from authenticated;

-- 3. Ce qu'un locataire déclenche.
create function gestion.portal_notification_target(p_lease uuid)
returns table (org_id uuid, email text, enabled boolean, lang text)
language sql stable security definer
set search_path = ''
as $$
  select l.org_id,
         coalesce(nullif(w.email, ''), nullif(a.email, ''), m.email),
         coalesce(w.notify_manager_messages, true),
         coalesce(w.document_lang, 'fr')
    from gestion.leases l
    join public.agencies a on a.id = l.org_id
    left join gestion.workspace_settings w on w.org_id = l.org_id
    left join lateral (
      select cm.email
        from public.crm_members cm
       where cm.agency_id = a.id and cm.status = 'active' and cm.role = 'owner'
       order by cm.created_at
       limit 1
    ) m on true
   where l.id = p_lease
     and gestion.portal_tenant_lease(l.id)
$$;
revoke all on function gestion.portal_notification_target(uuid) from public;
grant execute on function gestion.portal_notification_target(uuid) to authenticated;

create function gestion.portal_record_delivery(
  p_lease uuid,
  p_kind text,
  p_recipient_email text,
  p_lang text,
  p_subject text,
  p_body text,
  p_status text,
  p_provider text,
  p_provider_message_id text
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_id uuid;
begin
  select l.org_id into v_org from gestion.leases l where l.id = p_lease;
  if not found or not gestion.portal_tenant_lease(p_lease) then
    raise exception 'gestion: not a tenant of this lease';
  end if;
  if p_kind not in ('message', 'request') then
    raise exception 'gestion: invalid kind';
  end if;
  if p_status not in ('sent', 'not_configured', 'rejected', 'unreachable') then
    raise exception 'gestion: invalid status';
  end if;
  insert into gestion.deliveries (org_id, kind, lease_id, recipient_kind, recipient_email, lang, subject, body_text, status, provider, provider_message_id, created_by, sent_at)
  values (v_org, p_kind, p_lease, 'manager', left(p_recipient_email, 320),
          case when p_lang in ('fr', 'en', 'de', 'lu') then p_lang else 'fr' end,
          left(p_subject, 400), left(p_body, 20000), p_status, nullif(p_provider, ''), nullif(p_provider_message_id, ''), auth.uid(),
          case when p_status = 'sent' then now() else null end)
  returning id into v_id;
  return v_id;
end
$$;
revoke all on function gestion.portal_record_delivery(uuid, text, text, text, text, text, text, text, text) from public;
grant execute on function gestion.portal_record_delivery(uuid, text, text, text, text, text, text, text, text) to authenticated;
