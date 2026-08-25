# Checklist de non-régression, avant migration

Rien n'est appliqué tant que cette liste n'est pas cochée. Elle se joue en
trois temps : l'empreinte avant, la migration, l'empreinte après.

## Avant

- [ ] **Relecture faite** de `0001_gestion_spine.sql` et `0006_gestion_portail.sql`.
- [ ] **Sauvegarde Supabase du jour vérifiée** dans le tableau de bord du
      projet, avec sa date et son heure notées. On ne s'en servira pas, le
      rollback suffit, mais on ne migre pas sans filet.
- [ ] **`empreinte.sql` exécutée et sa sortie mise de côté.** C'est elle, prise
      à cet instant, qui sert de référence pour l'après. `empreinte-avant.txt`
      n'est qu'un exemple daté : les comptes et les profils montent à chaque
      inscription, et c'est normal.
- [ ] **Aucune autre session Claude ne travaille sur le projet.** Deux
      sessions ont déjà poussé en parallèle sur ce dépôt une fois.

## Les huit points que vous avez demandés

Chacun se vérifie avant, puis se revérifie après, à l'identique.

| # | Ce qui doit rester inchangé | Comment on le prouve |
| --- | --- | --- |
| 1 | **Morada** | `morada.lu` s'ouvre, une recherche renvoie des annonces, une fiche d'annonce s'affiche. Et `listings` = 850 dans l'empreinte. |
| 2 | **Morada Pro** | `morada.lu/pro` s'ouvre avec un compte membre, la liste des annonces de l'agence s'affiche, le CRM répond. |
| 3 | **Connexion** | Déconnexion complète, puis connexion e-mail plus mot de passe sur `morada.lu`. La session doit s'établir du premier coup. |
| 4 | **Mot de passe oublié** | Demander un lien, le recevoir, le suivre, changer le mot de passe, se reconnecter avec le nouveau. C'est le test le plus important de la phase session : c'est lui qui a fait écarter `@supabase/ssr`. |
| 5 | **Utilisateurs existants** | `auth.users` = 12 et `profiles` = 12 dans l'empreinte. Et personne n'est déconnecté : un onglet resté ouvert doit continuer de fonctionner. |
| 6 | **Annonces** | `listings` = 850. Aucune migration ne touche cette table, mais on le vérifie quand même. |
| 7 | **CRM** | `crm_members` = 10, dont 10 actifs. Les cinq fonctions `crm_*` ont la même empreinte de corps qu'avant. |
| 8 | **Ancien `/gestion`** | 20 tables, 69 policies, 0 ligne. `morada.lu/gestion` s'ouvre et se comporte comme avant. |
| 9 | **`public.g_can`** | Empreinte du corps `60d98f80cccaa74f02b4afb1ebd6b859`. **Si elle change, on arrête tout et on joue le rollback.** |

## Après la migration

- [ ] **`empreinte.sql` rejouée.** Une seule ligne a le droit d'avoir changé :
      « schéma gestion », de `absent` à `présent`. Toute autre différence
      déclenche `0099_rollback.sql`.
- [ ] **Les neuf points ci-dessus revérifiés**, dans le même ordre.
- [ ] **Alertes Supabase relevées** et comparées aux 118 d'aujourd'hui, dont
      aucune de niveau erreur. Le schéma `gestion` ne doit pas en ajouter.
- [ ] **`gestion` ajouté aux « Exposed schemas »** seulement une fois tout le
      reste vert. Tant que ce réglage n'est pas fait, le schéma existe mais
      n'est joignable par personne : c'est un bon état intermédiaire.

## Si quelque chose cloche

```sql
-- Annule intégralement 0001 à 0006. Ne touche à rien d'autre.
\i ../0099_rollback.sql
```

Puis retirer `gestion` des « Exposed schemas », et rejouer `empreinte.sql`
pour confirmer le retour à `empreinte-avant.txt`.

Le rollback est prouvé sans effet de bord : `tests/02_rollback.sql` compare
l'empreinte de `public` dans les deux sens et exige zéro différence.
