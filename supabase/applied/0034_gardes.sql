-- ===========================================================================
-- 0034 · les gardes d'espace suivent les nouvelles liaisons
--
-- Prérequis : 0030 (gestion.install_org_guards), 0031 à 0033.
--
-- 0031 à 0033 créent des tables qui portent org_id et pointent vers d'autres
-- tables de gestion (les marques de lecture d'une conversation, par exemple).
-- Le garde de 0030 se pose par clé étrangère : il est reposé ici, une fois
-- ces clés créées. À refaire après toute migration qui en ajoute.
--
-- Et une fonction du moteur de notifications (supabase/shared) reçoit le
-- search_path vide que l'audit de la plateforme demande. Elle n'existe que
-- sur la base hébergée : l'instruction est conditionnelle.
--
-- Repli : aucun objet créé ; select gestion.drop_org_guards() retire les gardes.
-- ===========================================================================

select gestion.install_org_guards();

do $$
begin
  if to_regprocedure('gestion.notify_url()') is not null then
    execute 'alter function gestion.notify_url() set search_path = ''''';
  end if;
end $$;
