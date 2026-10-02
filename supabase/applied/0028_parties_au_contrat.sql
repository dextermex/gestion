-- 0028 · Les parties au contrat de bail : une personne ou une société, côté
-- bailleur comme côté locataire
-- Proposée, NON appliquée en production (voir APPLIQUE.md). Rejouée
-- automatiquement sur la base jetable des tests de bout en bout.
-- Prérequis : 0022 (gestion.workspace_settings).
--
-- Tout est additif : des colonnes facultatives, sans réécriture de ligne, sans
-- valeur posée à la place de personne.
--
-- 1. gestion.contacts : pour une personne, sa civilité, sa date et son lieu de
--    naissance ; pour une société, sa forme juridique et qui la représente, en
--    quelle qualité. La nationalité, l'adresse (jsonb), la raison sociale et le
--    numéro RCS existent depuis 0002.
--
-- 2. gestion.workspace_settings : si le bailleur est une personne ou une
--    société ; pour une personne, sa civilité, sa naissance et sa nationalité ;
--    pour une société, sa forme juridique, son numéro RCS et la qualité de son
--    signataire (le nom du signataire existe depuis 0022).
--
-- Aucune policy ne change : les colonnes suivent celles de leur table
-- (contacts : gestion.tenants.view et gestion.tenants.edit ; réglages :
-- gestion.documents.view et gestion.settings.edit). Rien dans public ; g_can
-- non touchée.
--
-- Réversible :
--   alter table gestion.contacts drop column civility, drop column birth_date,
--     drop column birth_place, drop column legal_form,
--     drop column representative_name, drop column representative_role;
--   alter table gestion.workspace_settings drop column lessor_kind,
--     drop column lessor_civility, drop column lessor_birth_date,
--     drop column lessor_birth_place, drop column lessor_nationality,
--     drop column lessor_legal_form, drop column lessor_rcs_number,
--     drop column signatory_role;

-- 1. Les locataires (et tout contact) tels qu'un contrat les nomme.
alter table gestion.contacts
  add column civility text check (civility in ('m', 'f', 'x')),
  add column birth_date date check (birth_date > date '1900-01-01'),
  add column birth_place text check (char_length(birth_place) <= 120),
  add column legal_form text
    check (legal_form in ('sarl', 'sarls', 'sa', 'sci', 'sc', 'senc', 'scs', 'scsp', 'sca', 'scoop', 'asbl', 'fondation', 'other')),
  add column representative_name text check (char_length(representative_name) <= 160),
  add column representative_role text check (char_length(representative_role) <= 80);

comment on column gestion.contacts.civility is
  'Civilité imprimée au contrat : m (Monsieur), f (Madame), x (aucune).';
comment on column gestion.contacts.legal_form is
  'Forme juridique d''une société, imprimée au contrat ; other : aucune forme imprimée.';

-- 2. Le bailleur tel qu'un contrat le nomme.
alter table gestion.workspace_settings
  add column lessor_kind text not null default '' check (lessor_kind in ('', 'natural', 'legal')),
  add column lessor_civility text not null default '' check (lessor_civility in ('', 'm', 'f', 'x')),
  add column lessor_birth_date date check (lessor_birth_date > date '1900-01-01'),
  add column lessor_birth_place text not null default '' check (char_length(lessor_birth_place) <= 120),
  add column lessor_nationality text not null default '' check (char_length(lessor_nationality) <= 80),
  add column lessor_legal_form text not null default ''
    check (lessor_legal_form in ('', 'sarl', 'sarls', 'sa', 'sci', 'sc', 'senc', 'scs', 'scsp', 'sca', 'scoop', 'asbl', 'fondation', 'other')),
  add column lessor_rcs_number text not null default '' check (char_length(lessor_rcs_number) <= 40),
  add column signatory_role text not null default '' check (char_length(signatory_role) <= 80);
