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

## 0009 · 2026-08-29 · security_invoker sur la vue de statut

En branchant les écritures réelles, l'audit a montré que
`gestion.rent_period_status` s'exécutait avec les droits de son
propriétaire : tout utilisateur authentifié pouvait lire les échéances de
tous les espaces via l'API. `0009_rent_period_status_security_invoker.sql`
(migration `gestion_rent_period_status_security_invoker`) force la vue à
s'exécuter avec les droits de l'appelant (RLS des tables sous-jacentes) et
retire les droits d'écriture sans objet. Vérifié après application :
`reloptions = {security_invoker=true}`. Aucun objet de `public` touché.

## 0010 · 2026-08-29 · gestion.insurance_policies

La section Gestion locative > Assurances demandée pour la structure de
référence exige un vrai registre : `0010_insurance_policies.sql`
(migration `gestion_insurance_policies`) crée la table, ses index et ses
quatre politiques RLS sur le motif gestion.can existant. Additive, aucune
table existante touchée ; réversible par un drop de la seule table.

## 0011 · 2026-09-15 · chambres des lots et bucket média

La refonte de Patrimoine a besoin de deux choses que la base n'avait pas.
`gestion.units.bedrooms` (int, nullable) porte le nombre de chambres, que
`rooms` ne distinguait pas des pièces. Et le bucket privé `gestion-media`
stocke enfin les photos de biens : `gestion.properties.photo_url` existait
depuis 0003 sans aucun stockage derrière.

Le bucket est le septième du projet ; les six de Morada
(discovery-videos, discovery-thumbnails, documents, customer-documents,
listing-images, discovery-audio) ne sont pas touchés. Les quatre policies
ajoutées sur `storage.objects` sont PERMISSIVE et filtrées sur
`bucket_id = 'gestion-media'` : elles n'élargissent ni ne restreignent
l'accès aux autres buckets. Les quatorze policies existantes sont
inchangées (empreinte `bea6afc57e674006c12d00b38dc3f0cd`), et
`public.g_can` reste sur `60d98f80cccaa74f02b4afb1ebd6b859`.

Le chemin d'un objet est `<org_id>/<property_id>/<uuid>.<ext>` : la RLS lit
l'espace sur le premier segment via `gestion.media_org(text)`, qui renvoie
NULL si ce segment n'est pas un uuid. Bricoler une URL ne donne donc jamais
accès au bucket d'un autre cabinet. Vérifié après application : 7 buckets,
18 policies sur storage.objects, colonne `bedrooms` présente.
