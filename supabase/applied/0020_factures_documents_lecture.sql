-- 0020 · Factures, pièces téléversées, et lecture bornée
-- Proposé, non appliqué en production (voir APPLIQUE.md). Appliqué
-- automatiquement à la base jetable des tests de bout en bout.
--
-- Trois choses, toutes additives :
--
-- 1. Le bucket privé gestion-media accepte les pièces d'un cabinet en plus
--    des photos : PDF et tableurs, jusqu'à 25 Mo. Les policies existantes
--    (0011, 0015) ne changent pas : le premier segment du chemin reste
--    l'espace, et gestion.can() décide. Les pièces d'un cabinet vivent sous
--    <org>/documents/<uuid>.<ext> ; la policy portail (0015) ne lit que les
--    dossiers tickets/<bail> et <bien>, donc un locataire ne les voit pas.
--
-- 2. gestion.bills : une facture ou une recette saisie au bureau, avec sa
--    pièce (gestion.documents) et ce que le pack fiscal en fera (catégorie
--    = rubrique du modèle 190). Montant TTC en centimes entiers, TVA en
--    centimes, taux luxembourgeois (17 / 14 / 8 / 3 / exonéré). Même motif
--    RLS que la famille finance : gestion.can(org_id, 'gestion.finance.*').
--
-- 3. Deux vues de lecture, security_invoker (même motif que 0009), pour que
--    les écrans ne lisent plus les tables d'historique en entier :
--    conversation_heads (dernier message et non-lus par conversation) et
--    edl_session_counts (postes et photos par état des lieux).
--
-- Réversible :
--   drop view gestion.edl_session_counts; drop view gestion.conversation_heads;
--   drop table gestion.bills;
--   update storage.buckets set file_size_limit = 10485760,
--     allowed_mime_types = array['image/jpeg','image/png','image/webp','image/avif']
--     where id = 'gestion-media';

-- 1. Le bucket : les pièces d'un cabinet.
update storage.buckets
   set file_size_limit = 26214400,
       allowed_mime_types = array[
         'image/jpeg', 'image/png', 'image/webp', 'image/avif',
         'application/pdf', 'text/csv',
         'application/vnd.ms-excel',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
       ]
 where id = 'gestion-media';

-- 2. Les factures.
create table gestion.bills (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  direction text not null default 'expense' check (direction in ('expense', 'income')),
  supplier_contact_id uuid references gestion.contacts(id) on delete set null,
  property_id uuid references gestion.properties(id) on delete set null,
  unit_id uuid references gestion.units(id) on delete set null,
  -- La rubrique fiscale (modèle 190) que la dépense alimentera.
  category text not null check (category in
    ('maintenance_repairs', 'permanent_charges', 'insurance', 'management_fees',
     'impot_foncier', 'debt_interest', 'other_frais')),
  subject text not null,
  doc_no text not null default '',
  doc_date date,
  due_on date,
  paid_on date,
  cashflow boolean not null default true,
  vat_rate_pct numeric(5,2) not null default 17 check (vat_rate_pct in (0, 3, 8, 14, 17)),
  amount_cents integer not null check (amount_cents > 0),
  vat_cents integer not null default 0 check (vat_cents >= 0),
  document_id uuid references gestion.documents(id) on delete set null,
  created_by uuid,
  created_at timestamptz not null default now()
);
comment on column gestion.bills.amount_cents is 'Montant TTC, centimes entiers.';
comment on column gestion.bills.category is 'Rubrique du modèle 190 : maintenance_repairs, permanent_charges, insurance, management_fees, impot_foncier, debt_interest, other_frais.';
create index bills_org_date_idx on gestion.bills (org_id, doc_date desc, created_at desc);
create index bills_property_idx on gestion.bills (property_id);
create index bills_unit_idx on gestion.bills (unit_id);
create index bills_document_idx on gestion.bills (document_id);
alter table gestion.bills enable row level security;
create policy bills_select on gestion.bills
  for select to authenticated using (gestion.can(org_id, 'gestion.finance.view'));
create policy bills_insert on gestion.bills
  for insert to authenticated with check (gestion.can(org_id, 'gestion.finance.edit'));
create policy bills_update on gestion.bills
  for update to authenticated using (gestion.can(org_id, 'gestion.finance.edit'))
  with check (gestion.can(org_id, 'gestion.finance.edit'));
create policy bills_delete on gestion.bills
  for delete to authenticated using (gestion.can(org_id, 'gestion.finance.edit'));
grant select, insert, update, delete on gestion.bills to authenticated;

-- 3. Les vues de lecture. security_invoker : les policies des tables
--    sous-jacentes décident ligne par ligne, comme pour rent_period_status.
create view gestion.conversation_heads with (security_invoker = true) as
select c.id as conversation_id,
       c.org_id,
       (select count(*) from gestion.messages m
         where m.conversation_id = c.id and m.read_at is null and m.sender_kind <> 'manager') as unread,
       lm.id as last_message_id,
       lm.sender_kind as last_sender_kind,
       lm.sender_contact_id as last_sender_contact_id,
       lm.sender_user_id as last_sender_user_id,
       lm.body as last_body,
       lm.sent_at as last_sent_at,
       lm.read_at as last_read_at,
       lm.ticket_id as last_ticket_id
  from gestion.conversations c
  left join lateral (
    select m.* from gestion.messages m where m.conversation_id = c.id order by m.sent_at desc limit 1
  ) lm on true;
grant select on gestion.conversation_heads to authenticated;

create view gestion.edl_session_counts with (security_invoker = true) as
select s.id as session_id,
       s.org_id,
       (select count(*) from gestion.edl_items i where i.session_id = s.id) as items,
       (select count(*) from gestion.edl_media m join gestion.edl_items i on i.id = m.item_id where i.session_id = s.id) as photos
  from gestion.edl_sessions s;
grant select on gestion.edl_session_counts to authenticated;
