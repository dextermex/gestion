-- 0026 · Un parking comme bien à part entière
-- Proposée, NON appliquée en production (voir APPLIQUE.md). Rejouée
-- automatiquement sur la base jetable des tests de bout en bout.
--
-- Un emplacement, un box ou un garage loué seul est un bien du cabinet
-- comme un autre : l'assistant « Nouveau bien » le propose désormais comme
-- catégorie, avec un lot de genre parking (genre que gestion.units accepte
-- depuis 0003). La contrainte de gestion.properties.type ne connaissait pas
-- cette valeur : elle est recréée avec « parking » en plus, rien d'autre ne
-- change. Aucune ligne existante n'est touchée ; aucune policy ne change.
--
-- Tant qu'elle n'est pas appliquée, l'API répond 503 schema_outdated à la
-- création d'un bien de type parking, jamais une erreur de saisie.
--
-- Réversible (seulement s'il n'existe aucune ligne de type parking) :
--   alter table gestion.properties drop constraint properties_type_check;
--   alter table gestion.properties add constraint properties_type_check
--     check (type in ('apartment_building','house','mixed_use','commercial','apartment','office','other'));

alter table gestion.properties drop constraint if exists properties_type_check;
alter table gestion.properties add constraint properties_type_check
  check (type in ('apartment_building','house','mixed_use','commercial','apartment','office','parking','other'));
