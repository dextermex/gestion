# Appliqué en production le 29 août 2026

Sur approbation explicite d'Alexandre (« I approve the supabase », « ship the
bank »), les fichiers 0001 à 0007 ont été appliqués au projet
lgmoocvumiuqjcqnrlej via l'outil de migration Supabase, dans l'ordre.

Empreinte de non-régression exécutée juste avant et juste après : chaque
ligne de `public` identique (comptes, listings, agences, membres, corps de
g_can = 60d98f80cccaa74f02b4afb1ebd6b859, 20 tables g_*, 69 policies,
structure et RLS inchangées). Nouveau : schéma gestion présent, 62 tables,
toutes sous RLS.

Exposition API : `alter role authenticator set pgrst.db_schemas = 'public,
graphql_public, gestion'` + reload PostgREST. Réversible par
`alter role authenticator reset pgrst.db_schemas`. L'équivalent cliquable vit
dans Supabase, Settings puis API, « Exposed schemas ».

Le repli complet reste 0099_rollback.sql (drop du seul schéma gestion).
