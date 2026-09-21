-- 0018 · Droits d'exécution explicites sur les fonctions du schéma gestion
--
-- Huit fonctions créées sans clause de droits gardaient le droit d'exécution
-- que Postgres accorde par défaut à PUBLIC : `can`, `member_orgs`,
-- `role_extra_defaults` (0001), `portal_tenant_lease`, `portal_owner_property`,
-- `portal_owner_lease` (0006), `media_org` (0011) et `media_segment` (0015).
-- Le rôle anon n'a pas d'USAGE sur le schéma gestion, il ne pouvait donc pas
-- les appeler ; l'audit de sécurité de la base (e2e/db/rls-audit.sql) exige
-- néanmoins qu'aucune fonction de gestion ne lui soit exécutable, pour que la
-- garantie ne repose pas sur un seul verrou.
--
-- Même geste qu'en 0015 : révocation de PUBLIC et d'anon, puis droit explicite
-- à authenticated pour les fonctions que les policies (tables et stockage)
-- évaluent au nom de l'utilisateur connecté. `role_extra_defaults` n'est
-- appelée que depuis `can()` (security definer, propriétaire postgres) :
-- le propriétaire suffit. Aucune signature, aucun corps, aucune ligne modifiés.
-- Réversible : `grant execute on function ... to public` pour chacune.

revoke all on function gestion.can(uuid, text)               from public, anon;
revoke all on function gestion.member_orgs()                 from public, anon;
revoke all on function gestion.role_extra_defaults(text)     from public, anon;
revoke all on function gestion.portal_tenant_lease(uuid)     from public, anon;
revoke all on function gestion.portal_owner_property(uuid)   from public, anon;
revoke all on function gestion.portal_owner_lease(uuid)      from public, anon;
revoke all on function gestion.media_org(text)               from public, anon;
revoke all on function gestion.media_segment(text, integer)  from public, anon;

grant execute on function gestion.can(uuid, text)              to authenticated;
grant execute on function gestion.member_orgs()                to authenticated;
grant execute on function gestion.portal_tenant_lease(uuid)    to authenticated;
grant execute on function gestion.portal_owner_property(uuid)  to authenticated;
grant execute on function gestion.portal_owner_lease(uuid)     to authenticated;
grant execute on function gestion.media_org(text)              to authenticated;
grant execute on function gestion.media_segment(text, integer) to authenticated;
