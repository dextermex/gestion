-- 0022 · Trace papier : réglages du bailleur, modèles validés, documents
-- générés, journal d'audit
-- Proposé, non appliqué en production (voir APPLIQUE.md). Rejoué
-- automatiquement sur la base jetable des tests de bout en bout.
--
-- Tout est additif :
--
-- 1. gestion.workspace_settings : l'identité du bailleur (raison sociale ou
--    nom, adresse, signataire) et le compte que les locataires paient (IBAN,
--    BIC, titulaire tel qu'enregistré à la banque). Une ligne par espace.
--
-- 2. gestion.template_validations : le modèle d'un document (genre, langue,
--    version) que l'espace a explicitement validé. Aucun document ne se
--    génère à partir d'un modèle que l'espace n'a pas validé dans cette
--    version ; une nouvelle version du modèle redemande la validation.
--
-- 3. gestion.generated_documents : pour chaque pièce produite par
--    l'application, le genre, la langue, la version du modèle, la source
--    (quelle échéance, quel courrier, quel bail) et l'empreinte des données
--    d'entrée. La pièce elle-même est une ligne de gestion.documents,
--    scellée, avec l'empreinte SHA-256 du PDF.
--
-- 4. registered_letters.content : le contenu structuré du courrier tel
--    qu'envoyé (déjà haché dans content_sha256), pour le régénérer à
--    l'identique.
--
-- 5. gestion.my_payment_instructions() : ce qu'un locataire lit du compte à
--    payer, et rien d'autre des réglages (même motif que my_managers).
--
-- 6. gestion.audit_row() et ses déclencheurs : chaque écriture sur les tables
--    à effet juridique laisse une ligne dans gestion.audit_log (table de 0002,
--    jusqu'ici jamais alimentée), acteur = auth.uid().
--
-- 7. La policy portail du bucket (0015) lit aussi l'objet d'une pièce du bail :
--    <org>/documents/<uuid>.<ext> s'ouvre pour le locataire quand la ligne de
--    gestion.documents correspondante lui est lisible (documents_portal_select,
--    c'est-à-dire les pièces rattachées à son bail). La sous-requête tourne
--    sous les policies de l'appelant : rien ne s'ouvre qui ne se lise déjà.
--
-- Réversible :
--   drop trigger ... (voir la liste en bas) ; drop function gestion.audit_row();
--   drop function gestion.my_payment_instructions();
--   alter table gestion.registered_letters drop column content;
--   drop table gestion.generated_documents; drop table gestion.template_validations;
--   drop table gestion.workspace_settings;
--   drop index gestion.documents_storage_path_idx ;
--   puis recréer gestion_media_portal_select telle qu'en 0015 (deux branches :
--   tickets, et le reste par le bien).

-- 1. L'identité du bailleur et le compte à payer.
create table gestion.workspace_settings (
  org_id uuid primary key references public.agencies(id) on delete cascade,
  legal_name text not null default '',
  signatory_name text not null default '',
  address_street text not null default '',
  address_number text not null default '',
  postal_code text not null default '',
  city text not null default '',
  country text not null default 'LU',
  email text not null default '',
  phone text not null default '',
  iban text not null default '',
  bic text not null default '',
  holder_name text not null default '',
  document_lang text not null default 'fr' check (document_lang in ('fr', 'en', 'de', 'lu')),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table gestion.workspace_settings enable row level security;
create policy workspace_settings_select on gestion.workspace_settings
  for select to authenticated using (gestion.can(org_id, 'gestion.documents.view'));
create policy workspace_settings_insert on gestion.workspace_settings
  for insert to authenticated with check (gestion.can(org_id, 'gestion.settings.edit'));
create policy workspace_settings_update on gestion.workspace_settings
  for update to authenticated using (gestion.can(org_id, 'gestion.settings.edit'))
  with check (gestion.can(org_id, 'gestion.settings.edit'));
grant select, insert, update on gestion.workspace_settings to authenticated;

-- 2. Les modèles validés.
create table gestion.template_validations (
  org_id uuid not null references public.agencies(id) on delete cascade,
  kind text not null,
  lang text not null check (lang in ('fr', 'en', 'de', 'lu')),
  version text not null,
  validated_by uuid,
  validated_at timestamptz not null default now(),
  primary key (org_id, kind, lang)
);
alter table gestion.template_validations enable row level security;
create policy template_validations_select on gestion.template_validations
  for select to authenticated using (gestion.can(org_id, 'gestion.documents.view'));
create policy template_validations_insert on gestion.template_validations
  for insert to authenticated with check (gestion.can(org_id, 'gestion.settings.edit'));
create policy template_validations_update on gestion.template_validations
  for update to authenticated using (gestion.can(org_id, 'gestion.settings.edit'))
  with check (gestion.can(org_id, 'gestion.settings.edit'));
create policy template_validations_delete on gestion.template_validations
  for delete to authenticated using (gestion.can(org_id, 'gestion.settings.edit'));
grant select, insert, update, delete on gestion.template_validations to authenticated;

-- 3. Les documents générés.
create table gestion.generated_documents (
  document_id uuid primary key references gestion.documents(id) on delete cascade,
  org_id uuid not null references public.agencies(id) on delete cascade,
  kind text not null,
  lang text not null,
  template_version text not null,
  source_type text not null,
  source_id uuid not null,
  payload_sha256 text not null,
  generated_by uuid,
  generated_at timestamptz not null default now()
);
create index generated_documents_source_idx on gestion.generated_documents (org_id, kind, source_id, generated_at desc);
alter table gestion.generated_documents enable row level security;
create policy generated_documents_select on gestion.generated_documents
  for select to authenticated using (gestion.can(org_id, 'gestion.documents.view'));
create policy generated_documents_insert on gestion.generated_documents
  for insert to authenticated with check (gestion.can(org_id, 'gestion.documents.edit'));
create policy generated_documents_delete on gestion.generated_documents
  for delete to authenticated using (gestion.can(org_id, 'gestion.documents.edit'));
grant select, insert, delete on gestion.generated_documents to authenticated;

-- 4. Le contenu du courrier, tel qu'envoyé.
alter table gestion.registered_letters add column content jsonb;

-- 5. Ce qu'un locataire lit du compte à payer.
create function gestion.my_payment_instructions()
returns table (org_id uuid, legal_name text, iban text, bic text, holder_name text)
language sql stable security definer
set search_path = ''
as $$
  select w.org_id, w.legal_name, w.iban, w.bic, w.holder_name
    from gestion.workspace_settings w
   where exists (
           select 1
             from gestion.lease_parties lp
             join gestion.contacts c on c.id = lp.contact_id
            where lp.org_id = w.org_id
              and c.user_id = auth.uid()
         )
$$;
revoke all on function gestion.my_payment_instructions() from public;
grant execute on function gestion.my_payment_instructions() to authenticated;

-- 6. Le journal.
create function gestion.audit_row()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_before jsonb;
  v_after jsonb;
begin
  if tg_op = 'DELETE' then
    v_row := to_jsonb(old);
    v_before := v_row;
    v_after := null;
  elsif tg_op = 'UPDATE' then
    v_row := to_jsonb(new);
    v_before := to_jsonb(old);
    v_after := v_row;
  else
    v_row := to_jsonb(new);
    v_before := null;
    v_after := v_row;
  end if;
  insert into gestion.audit_log (org_id, actor, verb, object_type, object_id, before, after)
  values ((v_row ->> 'org_id')::uuid, auth.uid(), lower(tg_op), tg_table_name, (v_row ->> 'id')::uuid, v_before, v_after);
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;
revoke all on function gestion.audit_row() from public;

create trigger audit_workspace_settings after insert or update or delete on gestion.workspace_settings for each row execute function gestion.audit_row();
create trigger audit_template_validations after insert or update or delete on gestion.template_validations for each row execute function gestion.audit_row();
create trigger audit_documents after insert or update or delete on gestion.documents for each row execute function gestion.audit_row();
create trigger audit_registered_letters after insert or update or delete on gestion.registered_letters for each row execute function gestion.audit_row();
create trigger audit_arrears_actions after insert or update or delete on gestion.arrears_actions for each row execute function gestion.audit_row();
create trigger audit_deposits after insert or update or delete on gestion.deposits for each row execute function gestion.audit_row();
create trigger audit_deposit_deductions after insert or update or delete on gestion.deposit_deductions for each row execute function gestion.audit_row();
create trigger audit_charge_periods after insert or update or delete on gestion.charge_periods for each row execute function gestion.audit_row();
create trigger audit_leases after insert or update or delete on gestion.leases for each row execute function gestion.audit_row();
create trigger audit_edl_sessions after insert or update or delete on gestion.edl_sessions for each row execute function gestion.audit_row();
create trigger audit_edl_media after insert or update or delete on gestion.edl_media for each row execute function gestion.audit_row();
create trigger audit_bills after insert or update or delete on gestion.bills for each row execute function gestion.audit_row();
create trigger audit_payments after insert or update or delete on gestion.payments for each row execute function gestion.audit_row();

-- 7. Le locataire ouvre les pièces de son bail.
create index if not exists documents_storage_path_idx on gestion.documents (storage_path);
drop policy if exists gestion_media_portal_select on storage.objects;
create policy gestion_media_portal_select on storage.objects for select to authenticated
  using (
    bucket_id = 'gestion-media'
    and (
      ((storage.foldername(name))[2] = 'tickets' and gestion.portal_tenant_lease(gestion.media_segment(name, 3)))
      or ((storage.foldername(name))[2] = 'documents' and exists (select 1 from gestion.documents d where d.storage_path = name))
      or ((storage.foldername(name))[2] not in ('tickets', 'documents') and gestion.portal_tenant_property(gestion.media_segment(name, 2)))
    )
  );
