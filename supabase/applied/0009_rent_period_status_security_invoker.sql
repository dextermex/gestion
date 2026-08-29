-- 0009 · Correctif de sécurité : la vue de statut respecte la RLS
-- Appliqué le 2026-08-29 (migration `gestion_rent_period_status_security_invoker`).
--
-- La vue gestion.rent_period_status s'exécutait avec les droits de son
-- propriétaire (postgres) : à travers le schéma exposé à PostgREST, tout
-- utilisateur authentifié pouvait lire les échéances et allocations de
-- TOUS les espaces. `security_invoker = true` la fait s'exécuter avec les
-- droits de l'appelant, donc sous les politiques RLS de
-- gestion.rent_periods et gestion.payment_allocations, ligne par ligne.
--
-- Additif et réversible :
--   alter view gestion.rent_period_status set (security_invoker = false);

alter view gestion.rent_period_status set (security_invoker = true);

-- Une vue est en lecture seule par nature; les droits d'écriture accordés
-- par défaut n'avaient pas de sens et sont retirés par hygiène.
revoke insert, update, delete on gestion.rent_period_status from authenticated;
