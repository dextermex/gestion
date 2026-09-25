-- 0021 · Les deux vues de 0020 sont en lecture seule
-- Appliqué le 2026-09-25 (migration `gestion_vues_lecture_seule`), dans la
-- foulée de 0020, après vérification en production.
--
-- Les privilèges par défaut du schéma gestion (`authenticated=arwd` sur
-- toute relation nouvelle) avaient accordé insert, update et delete sur
-- gestion.conversation_heads et gestion.edl_session_counts au moment de leur
-- création. Une vue de lecture n'en a que faire (et edl_session_counts, vue
-- simple, aurait été modifiable) : ils sont retirés, même hygiène que 0009
-- pour rent_period_status. Sans effet sur l'application, qui ne fait que
-- lire ces vues.
--
-- Réversible :
--   grant insert, update, delete on gestion.conversation_heads to authenticated;
--   grant insert, update, delete on gestion.edl_session_counts to authenticated;

revoke insert, update, delete on gestion.conversation_heads from authenticated;
revoke insert, update, delete on gestion.edl_session_counts from authenticated;
