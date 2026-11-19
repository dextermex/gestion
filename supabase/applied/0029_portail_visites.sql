-- 0029 · Le portail locataire lit la date de passage de l'intervenant
-- Proposée, NON appliquée en production (voir APPLIQUE.md). Rejouée
-- automatiquement sur la base jetable des tests de bout en bout.
-- Prérequis : 0004 (gestion.work_orders), 0015 (gestion.portal_tenant_lease).
--
-- Une demande du locataire devient une intervention quand le gestionnaire y
-- pose un ordre de travail. La date du passage (work_orders.scheduled_at) et
-- le nom de l'intervenant vivent sur cet ordre, que le locataire ne lit pas :
-- aucune policy du portail n'ouvre gestion.work_orders, et il ne faut pas en
-- ouvrir une (l'ordre porte aussi le montant, le lien magique de l'artisan et
-- l'accord du propriétaire).
--
-- `gestion.my_visits()` rend donc, pour les seules demandes posées sur un bail
-- du locataire connecté, quatre colonnes et rien d'autre : la demande, le
-- statut de l'ordre, la date planifiée, le nom de l'intervenant. Jamais le
-- montant, le jeton, les créneaux proposés ni les photos de fin de chantier.
-- Un ordre refusé ou sans date n'est pas rendu.
--
-- Tout est additif : une fonction, aucun changement de table ni de policy.
-- Rien dans public ; g_can non touchée. Tant qu'elle n'est pas appliquée,
-- l'espace locataire n'affiche simplement aucune date de passage.
--
-- Réversible :
--   drop function if exists gestion.my_visits();

create or replace function gestion.my_visits()
returns table (ticket_id uuid, status text, scheduled_at timestamptz, artisan_name text)
language sql stable security definer
set search_path = ''
as $$
  select w.ticket_id,
         w.status,
         w.scheduled_at,
         nullif(coalesce(nullif(trim(c.legal_name), ''), nullif(c.display_name, '—')), '')
    from gestion.work_orders w
    join gestion.tickets t on t.id = w.ticket_id
    left join gestion.contacts c on c.id = w.artisan_contact_id
   where t.lease_id is not null
     and gestion.portal_tenant_lease(t.lease_id)
     and w.scheduled_at is not null
     and w.status <> 'declined';
$$;
revoke all on function gestion.my_visits() from public, anon;
grant execute on function gestion.my_visits() to authenticated;
