# Schéma `gestion` — proposition, non appliquée

Ces fichiers ne sont **pas** dans `supabase/migrations/` et ne peuvent donc pas
partir par accident avec un `supabase db push`. Ils attendent une relecture.

## Ce qu'ils font

| Fichier | Contenu |
| --- | --- |
| `0001_gestion_spine.sql` | Crée le schéma `gestion`, ses droits, et `gestion.can()` qui délègue à `crm_members` |
| `0002_gestion_foundation.sql` | Contacts, champs personnalisés, activité, journal d'audit |
| `0003_gestion_portefeuille_baux.sql` | Sociétés de patrimoine, biens, unités, compteurs, baux, quittancement |
| `0004_gestion_argent_operations.sql` | Banque, paiements, mandats, charges, maintenance, messagerie |
| `0005_gestion_conformite_fiscal.sql` | Paramètres légaux, EDL, garanties, LBC/FT, fiscal |
| `0006_gestion_portail.sql` | Lien fiche/compte, invitations, accès locataire et propriétaire |
| `0099_rollback.sql` | `drop schema gestion cascade` : annule tout |

62 tables, toutes dans `gestion`, toutes avec RLS et au moins une policy.

## Ce qu'ils ne font pas

Aucun objet de `public` n'est créé, modifié ou supprimé. En particulier :

- `public.g_can` n'est pas touchée, donc les vingt tables `g_*` de l'ancien
  `/gestion` continuent de fonctionner ;
- `public.crm_role_defaults`, `crm_has_perm`, `crm_has_role` et
  `crm_member_agencies` ne sont pas touchées ;
- ni `agencies`, ni `crm_members`, ni `profiles`, ni `listings` ;
- `orgs` et `org_members` ne sont pas créées : l'identité reste celle de
  l'écosystème.

Les migrations d'origine, dangereuses, sont conservées comme référence de
modélisation dans `../_unsafe_do_not_apply/`.

## Vérifier avant d'appliquer

```bash
cd supabase/proposed && ./tests/run.sh
```

Il faut un PostgreSQL local jetable (15 ou plus). Le script recrée la surface
de production nécessaire (rôles Supabase, schéma `auth`, `agencies`,
`crm_members`, les quatre fonctions du CRM et `public.g_can` dans sa version
de production), applique les six fichiers, joue les tests puis le rollback.

Vérifié sur PostgreSQL 16.13. La production tourne en 17.6 ; rien dans ces
fichiers ne dépend d'une version.

## Tests couverts

1. **Structure** : 62 tables, RLS active partout, au moins une policy partout, `anon` sans aucun droit.
2. **Non-régression** : `public.g_can` inchangée au caractère près, aucune table `orgs`, tables `g_*` intactes.
3. **Isolation** : le gestionnaire du cabinet A ne voit que le patrimoine A.
4. **URL trafiquée** : lire un bien d'autrui par son identifiant renvoie zéro ligne.
5. **Multi-rôle** : Jean, locataire chez Pierre et bailleur de Sophie, voit ses deux baux avec un seul compte, et rien des cabinets A et B. Ses lectures s'arrêtent aux fiches des biens : les acquisitions et le compte propriétaire de Pierre lui restent fermés.
6. **Anonyme** : sans session, l'accès est refusé au niveau du schéma.
7. **Rollback** : après `0099`, `public` est strictement identique, empreinte comparée dans les deux sens.

## Réglage Supabase nécessaire

Un seul, réversible en un clic : ajouter `gestion` aux « Exposed schemas »
dans Settings > API. Sans lui, PostgREST ne sert pas le schéma et
l'application ne voit rien. Aucun autre réglage du projet ne change.
