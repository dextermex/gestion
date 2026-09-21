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

## 0014 · 2026-09-19 · un dossier et un bail par lot

Le cycle de vie d'un lot (libre, brouillon, location active, départ,
historique, libre) reposait sur l'application seule : deux brouillons sur le
même lot existaient déjà en production. `0014_one_lease_per_lot.sql`
(migration `gestion_one_lease_per_lot`) ajoute la fonction
`gestion.enforce_one_lease_per_lot()` (security definer, search_path vide) et
le déclencheur `leases_one_per_lot` sur `gestion.leases`, avant insertion et
avant tout changement de `status` ou de `unit_id`, sous un verrou consultatif
par lot : au plus un brouillon par lot, au plus un bail en cours par lot,
aucun brouillon sur un lot loué. Les refus portent le code 23505 et un
message stable que l'application traduit.

Les lignes existantes ne sont pas touchées : les deux brouillons du lot
« Maison » restent modifiables et se retirent depuis la fiche du bien.
Vérifié après application dans une transaction annulée : second bail actif
refusé, brouillon sur lot loué refusé, troisième brouillon refusé, mise à
jour d'un brouillon existant acceptée. `public.g_can` toujours sur
`60d98f80cccaa74f02b4afb1ebd6b859`, 3 baux, aucun objet de `public` touché.
Réversible : drop du déclencheur puis de la fonction.

## 0015 · 2026-09-19 · le portail locataire

`0015_tenant_portal.sql` (migrations `gestion_tenant_portal` puis
`gestion_invite_preview_public`) complète 0006 pour que l'espace locataire
lise le vrai dossier et que l'invitation soit réelle. Tout est additif :
colonnes `lease_id`, `revoked_at`, `sent_at`, `delivery` sur
`gestion.portal_invites` ; prédicats `portal_tenant_live_lease`,
`portal_tenant_property`, `portal_tenant_ticket`, `media_segment` ; policies
de lecture `*_portal` sur `deposits`, `edl_sessions`, `insurance_policies`,
`payment_allocations`, `documents`, `conversations`, `messages` et d'écriture
sur `tickets` (bail en cours, `source = tenant`), `documents` (photo d'une
demande), `conversations`, `messages` (au nom du compte) ; policies de
stockage sur `gestion-media` (photo du bien en lecture, dossier
`<org>/tickets/<bail>/` en lecture et dépôt) ; `my_home()` recréée avec les
colonnes de « Mon bail », `my_lease_parties()`, `my_managers()` ;
`portal_invite_lease`, `portal_invite_delivered`, `portal_revoke`,
`portal_invite_preview`, `portal_accept` (verrou de ligne, idempotente pour
le même compte, adresse du compte vérifiée). Le rôle `anon` ne reçoit aucun
droit sur le schéma `gestion` : `public.gestion_invite_preview` relaie la
prévisualisation, comme `public.gestion_onboard` relaie l'ouverture d'un
espace.

Vérifié après application : `public.g_can` toujours sur
`60d98f80cccaa74f02b4afb1ebd6b859`, prévisualisation anonyme d'un jeton
inconnu = `{state: unknown}`, policies et fonctions présentes, aucune ligne
existante modifiée. Réversible : voir l'en-tête du fichier.

## 0016 · 2026-09-21 · la photo d'un lot

`0016_unit_photo.sql` (migration `gestion_unit_photo`) ajoute la colonne
nullable `gestion.units.photo_url` (chemin dans `gestion-media`, dossier du
bien, mêmes policies de stockage) et recrée `gestion.my_home()` à signature
identique pour préférer la photo du lot à celle du bien. Additif ; aucune
ligne modifiée. Vérifié après application : colonne présente, fonction
recréée, `public.g_can` toujours sur `60d98f80cccaa74f02b4afb1ebd6b859`.
Réversible : drop de la colonne, puis `my_home()` telle qu'en 0015.

## 0017 · 2026-09-21 · l'invitation d'un bail, et « est-il locataire ? »

`0017_portal_invite_scope.sql` (migration `gestion_portal_invite_scope`)
corrige deux points relevés en relecture du portail. `portal_invite_lease`
est recréée à signature identique : un nouvel envoi ne révoque plus que
l'invitation ouverte du même bail (ou une ancienne ligne sans bail), plus
celles des autres baux de la même personne. `gestion.is_tenant()` est
ajoutée (security definer, `authenticated` seulement) : vrai si le compte
courant est partie tenant ou colocataire d'au moins un bail, le prédicat de
`my_home()` sans en assembler les lignes ; la mise en page de l'espace de
gestion la demande à chaque requête à la place de `my_home()`. Additif ;
aucune ligne modifiée, aucune invitation ouverte au moment de l'application.
Vérifié après application : clause de révocation présente, `is_tenant()`
exécutable par `authenticated` seulement et d'accord avec `my_home()` pour
les quatre comptes en base (deux locataires : vrai, 1 logement ; deux
gestionnaires : faux, 0), `public.g_can` toujours sur
`60d98f80cccaa74f02b4afb1ebd6b859`. Réversible : `portal_invite_lease`
telle qu'en 0015, drop de `is_tenant()`.

## 0018 · 2026-09-21 · droits d'exécution explicites sur les fonctions

`0018_function_grants.sql` (migration `gestion_function_grants`) vient de la
première exécution de l'audit de sécurité de la base
(`e2e/db/rls-audit.sql`) sur le schéma complet rejoué localement : huit
fonctions du schéma gestion créées sans clause de droits gardaient le droit
d'exécution par défaut de PUBLIC (`can`, `member_orgs`, `role_extra_defaults`,
`portal_tenant_lease`, `portal_owner_property`, `portal_owner_lease`,
`media_org`, `media_segment`). Le rôle anon n'a pas d'USAGE sur le schéma,
rien n'était donc accessible ; la garantie ne reposait que sur ce seul verrou.
Même geste qu'en 0015 : révocation de PUBLIC et d'anon, droit explicite à
`authenticated` pour les sept fonctions que les policies (tables et stockage)
évaluent au nom de l'utilisateur connecté ; `role_extra_defaults`, appelée
seulement depuis `can()` (security definer), reste au propriétaire. Aucune
signature, aucun corps, aucune ligne modifiés. Vérifié après application :
aucune fonction de gestion exécutable par anon, vingt exécutables par
`authenticated` ; en se faisant passer pour un compte gestionnaire, 7 biens,
6 baux, 11 lignes de `rent_period_status`, 2 objets `gestion-media` visibles
et `can(org, 'properties.read')` vrai ; pour un compte locataire, 1 logement
dans `my_home()`, `is_tenant()` vrai, 1 objet `gestion-media` visible ;
`public.g_can` toujours sur `60d98f80cccaa74f02b4afb1ebd6b859`. Réversible :
`grant execute on function ... to public` pour chacune.
