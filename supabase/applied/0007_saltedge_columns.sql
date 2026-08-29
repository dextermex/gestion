-- ===========================================================================
-- MORADA GESTION — 0007 COLONNES SALT EDGE
--
-- ADDITIF. Prérequis : 0004.
-- Trois colonnes que l'import par API ajoute aux comptes : l'identifiant du
-- compte chez le fournisseur (clé de rapprochement des synchronisations), le
-- solde rapporté, et l'horodatage de la dernière synchronisation.
-- ===========================================================================
alter table gestion.bank_accounts
  add column if not exists provider_account_id text,
  add column if not exists balance_cents bigint,
  add column if not exists last_synced_at timestamptz;

create unique index if not exists bank_accounts_provider_key
  on gestion.bank_accounts(org_id, provider, provider_account_id)
  where provider_account_id is not null;
