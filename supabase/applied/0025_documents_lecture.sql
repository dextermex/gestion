-- 0025 · Lecture des pièces : ce que le lecteur a relevé
-- Proposée, NON appliquée en production (voir APPLIQUE.md). Rejouée
-- automatiquement sur la base jetable des tests de bout en bout.
--
-- Tout est additif : six colonnes facultatives sur gestion.documents, où
-- l'application rangera ce que la lecture d'une pièce a relevé et que la
-- personne a confirmé à l'ajout : la date que la pièce porte, son montant
-- principal en centimes, une phrase de résumé, les parties nommées, sa
-- propre référence, et l'instant de la lecture. Aucune policy ne change :
-- les colonnes suivent celles de la ligne. Aucune valeur n'est écrite par
-- cette migration ; le code qui remplit ces colonnes attend son application.
--
-- Réversible :
--   alter table gestion.documents
--     drop column if exists document_date,
--     drop column if exists amount_cents,
--     drop column if exists summary,
--     drop column if exists parties,
--     drop column if exists reference,
--     drop column if exists recognised_at;

alter table gestion.documents
  add column if not exists document_date date,
  add column if not exists amount_cents bigint check (amount_cents is null or amount_cents >= 0),
  add column if not exists summary text check (summary is null or char_length(summary) <= 240),
  add column if not exists parties text[] check (parties is null or cardinality(parties) <= 4),
  add column if not exists reference text check (reference is null or char_length(reference) <= 60),
  add column if not exists recognised_at timestamptz;

comment on column gestion.documents.document_date is 'La date que la pièce porte (émission, signature ou arrêté), relevée à la lecture et confirmée.';
comment on column gestion.documents.amount_cents is 'Le montant principal de la pièce, en centimes, relevé à la lecture et confirmé.';
comment on column gestion.documents.summary is 'Une phrase disant ce que la pièce est et ce qu''elle règle.';
comment on column gestion.documents.parties is 'Jusqu''à quatre noms de personnes ou de sociétés que la pièce nomme.';
comment on column gestion.documents.reference is 'Le numéro ou la référence propre de la pièce (facture, police, dossier).';
comment on column gestion.documents.recognised_at is 'L''instant de la lecture dont ces colonnes viennent ; nul pour une pièce renseignée à la main.';
