-- 0027 · La signature électronique : les envois, leurs signataires, et le
-- registre des prestations à l'usage
-- Proposée, NON appliquée en production (voir APPLIQUE.md). Rejouée
-- automatiquement sur la base jetable des tests de bout en bout.
-- Prérequis : 0022 (gestion.audit_row(), et les documents générés qu'un envoi
-- signe).
--
-- Tout est additif :
--
-- 1. gestion.signature_envelopes : l'envoi en signature d'une pièce du
--    registre (le contrat d'un bail) chez le prestataire (Youtrust, ex-Yousign),
--    son identifiant chez lui, l'environnement (test ou production), l'état tel
--    que relu chez lui, le niveau eIDAS demandé et, une fois signé, la pièce
--    signée scellée au registre. Un seul envoi vivant par bail.
--
-- 2. gestion.signature_signers : chaque signataire d'un envoi, dans l'ordre où
--    il signe (les locataires, puis le bailleur), son rôle, son niveau, son mode
--    d'authentification, son état, l'heure de sa signature et son journal de
--    preuve scellé au registre.
--
-- 3. gestion.usage_charges : les prestations facturées à l'usage (un envoi, un
--    signataire au-delà du quatrième, une signature avancée ou qualifiée), en
--    centimes, avec le coût du prestataire au même moment. Insertion seule :
--    aucune ligne ne se modifie ni ne s'efface depuis l'application.
--
-- Pas de webhook : la base n'ouvre rien sans session (audit RLS) et
-- l'application n'a pas de clé de service. L'état d'un envoi se relit chez le
-- prestataire sous la session de qui ouvre la page.
--
-- Réversible :
--   drop table gestion.usage_charges;
--   drop table gestion.signature_signers;
--   drop table gestion.signature_envelopes;

-- 1. Les envois.
create table gestion.signature_envelopes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  lease_id uuid not null references gestion.leases(id) on delete cascade,
  document_id uuid not null references gestion.documents(id) on delete restrict,
  provider text not null check (provider in ('yousign')),
  provider_env text not null check (provider_env in ('sandbox', 'production')),
  provider_request_id text,
  status text not null default 'draft'
    check (status in ('draft', 'ongoing', 'done', 'declined', 'expired', 'canceled', 'failed')),
  level text not null
    check (level in ('electronic_signature', 'advanced_electronic_signature', 'qualified_electronic_signature')),
  signed_document_id uuid references gestion.documents(id) on delete set null,
  expires_on date,
  sent_at timestamptz,
  completed_at timestamptz,
  last_synced_at timestamptz,
  failure text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (id, org_id),
  unique (provider, provider_request_id)
);
create index signature_envelopes_lease_idx on gestion.signature_envelopes (org_id, lease_id, created_at desc);
-- Un seul envoi vivant par bail : un second « Envoyer » est refusé par la base même.
create unique index signature_envelopes_live_idx on gestion.signature_envelopes (lease_id) where status in ('draft', 'ongoing');
alter table gestion.signature_envelopes enable row level security;
create policy signature_envelopes_select on gestion.signature_envelopes
  for select to authenticated using (gestion.can(org_id, 'gestion.leases.view'));
create policy signature_envelopes_insert on gestion.signature_envelopes
  for insert to authenticated with check (gestion.can(org_id, 'gestion.leases.edit'));
create policy signature_envelopes_update on gestion.signature_envelopes
  for update to authenticated using (gestion.can(org_id, 'gestion.leases.edit'))
  with check (gestion.can(org_id, 'gestion.leases.edit'));
grant select, insert, update on gestion.signature_envelopes to authenticated;

-- 2. Les signataires, rattachés à un envoi du même espace.
create table gestion.signature_signers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  envelope_id uuid not null,
  position int not null check (position between 1 and 20),
  role text not null check (role in ('tenant', 'lessor', 'guarantor')),
  contact_id uuid references gestion.contacts(id) on delete set null,
  first_name text not null check (length(first_name) between 1 and 80),
  last_name text not null check (length(last_name) between 1 and 80),
  email text not null check (length(email) between 3 and 254),
  phone text check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  locale text not null default 'fr' check (locale in ('fr', 'en', 'de')),
  level text not null
    check (level in ('electronic_signature', 'advanced_electronic_signature', 'qualified_electronic_signature')),
  auth_mode text not null check (auth_mode in ('otp_email', 'otp_sms', 'no_otp')),
  provider_signer_id text,
  status text not null default 'pending' check (status in ('pending', 'notified', 'signed', 'declined', 'error')),
  signed_at timestamptz,
  audit_document_id uuid references gestion.documents(id) on delete set null,
  foreign key (envelope_id, org_id) references gestion.signature_envelopes (id, org_id) on delete cascade,
  unique (envelope_id, position)
);
create index signature_signers_envelope_idx on gestion.signature_signers (org_id, envelope_id, position);
alter table gestion.signature_signers enable row level security;
create policy signature_signers_select on gestion.signature_signers
  for select to authenticated using (gestion.can(org_id, 'gestion.leases.view'));
create policy signature_signers_insert on gestion.signature_signers
  for insert to authenticated with check (gestion.can(org_id, 'gestion.leases.edit'));
create policy signature_signers_update on gestion.signature_signers
  for update to authenticated using (gestion.can(org_id, 'gestion.leases.edit'))
  with check (gestion.can(org_id, 'gestion.leases.edit'));
grant select, insert, update on gestion.signature_signers to authenticated;

-- 3. Les prestations à l'usage : insertion seule.
create table gestion.usage_charges (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  kind text not null
    check (kind in ('signature_sending', 'signature_extra_signer', 'signature_advanced', 'signature_qualified')),
  quantity int not null default 1 check (quantity between 1 and 100),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  unit_cost_cents integer not null check (unit_cost_cents >= 0),
  lease_id uuid references gestion.leases(id) on delete set null,
  envelope_id uuid references gestion.signature_envelopes(id) on delete set null,
  provider text not null check (provider in ('yousign')),
  provider_env text not null check (provider_env in ('sandbox', 'production')),
  occurred_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index usage_charges_org_idx on gestion.usage_charges (org_id, occurred_at desc);
alter table gestion.usage_charges enable row level security;
create policy usage_charges_select on gestion.usage_charges
  for select to authenticated using (gestion.can(org_id, 'gestion.finance.view'));
create policy usage_charges_insert on gestion.usage_charges
  for insert to authenticated with check (gestion.can(org_id, 'gestion.leases.edit'));
grant select, insert on gestion.usage_charges to authenticated;

-- 4. Le journal : un envoi et ses signataires ont un effet juridique.
create trigger audit_signature_envelopes after insert or update or delete on gestion.signature_envelopes for each row execute function gestion.audit_row();
create trigger audit_signature_signers after insert or update or delete on gestion.signature_signers for each row execute function gestion.audit_row();
