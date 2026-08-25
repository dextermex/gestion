# Ne pas appliquer ces fichiers

Ces quatre migrations ont été écrites pour une base Morada Gestion autonome,
avant que la décision soit prise de brancher l'application sur le Supabase
commun de Morada. **Les appliquer sur la production casserait Morada.**

## Pourquoi elles sont dangereuses

1. `20260823100000_foundation.sql` contient

   ```sql
   create or replace function public.g_can(p_org uuid, p_perm text)
   ```

   avec exactement la même signature que la fonction déjà déployée en
   production. Un `create or replace` ne produit aucune erreur : il remplace
   silencieusement la fonction. La version de production lit `crm_members` et
   sert les policies RLS des vingt tables `g_*` de l'ancien Morada Gestion ;
   celle d'ici lit `org_members`, une table qui n'existe pas en production.
   Toutes ces policies tomberaient d'un coup.

2. Treize tables portent des noms déjà pris en production
   (`g_properties`, `g_units`, `g_leases`, `g_lease_parties`, `g_rent_periods`,
   `g_payments`, `g_payment_allocations`, `g_documents`, `g_activity`,
   `g_bank_accounts`, `g_bank_imports`, `g_bank_transactions`, `g_work_orders`).
   Comme les `create table` sont en `if not exists`, rien ne serait créé et
   rien n'échouerait : l'application lirait des colonnes absentes. Panne
   silencieuse.

3. `orgs` et `org_members` dupliqueraient l'identité déjà portée par
   `agencies` et `crm_members`.

## Ce qui les remplace

Le schéma retenu vit dans `supabase/proposed/`, dans un schéma Postgres dédié
`gestion`, sans préfixe `g_`, sans `orgs` ni `org_members`, et sans jamais
toucher à `public.g_can`. Ces fichiers-ci sont conservés uniquement comme
référence de modélisation métier.
