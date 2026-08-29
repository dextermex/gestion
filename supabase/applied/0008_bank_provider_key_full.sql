-- ===========================================================================
-- MORADA GESTION — 0008 CLE FOURNISSEUR NON PARTIELLE
--
-- ADDITIF. Prérequis : 0007.
-- L'upsert PostgREST vise une contrainte ou un index unique COMPLET; l'index
-- partiel de 0007 ne peut pas être ciblé par ON CONFLICT. Les NULL restant
-- distincts en Postgres, l'index complet autorise toujours plusieurs comptes
-- manuels sans identifiant fournisseur.
-- ===========================================================================
drop index if exists gestion.bank_accounts_provider_key;
create unique index if not exists bank_accounts_provider_key
  on gestion.bank_accounts(org_id, provider, provider_account_id);
