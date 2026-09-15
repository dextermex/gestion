-- 0011 · Chambres des lots et bucket média des biens
--
-- Deux ajouts strictement additifs pour la refonte de Patrimoine :
--
-- 1. `gestion.units.bedrooms` : la fiche d'un logement annonce « 3 pièces,
--    2 chambres ». Seul `rooms` (les pièces) existait. Colonne nullable,
--    aucune valeur existante modifiée.
--
-- 2. Le bucket privé `gestion-media` : les photos de biens. La colonne
--    `gestion.properties.photo_url` existait depuis 0003 mais aucun stockage
--    ne la remplissait. Le bucket est nouveau et ne touche à aucun des six
--    buckets de Morada (discovery-videos, discovery-thumbnails, documents,
--    customer-documents, listing-images, discovery-audio) : les policies
--    ajoutées sont PERMISSIVE et filtrées sur `bucket_id = 'gestion-media'`,
--    donc elles n'élargissent ni ne restreignent l'accès aux autres buckets.
--
-- Convention de chemin : `<org_id>/<property_id>/<uuid>.<ext>`. Le premier
-- segment porte l'espace, et c'est lui que la RLS interroge : un utilisateur
-- qui bricole une URL ne peut pas lire le bucket d'un autre cabinet.
--
-- Réversible :
--   alter table gestion.units drop column bedrooms;
--   drop policy gestion_media_select on storage.objects; (idem insert/update/delete)
--   drop function gestion.media_org(text);
--   delete from storage.buckets where id = 'gestion-media';

alter table gestion.units add column if not exists bedrooms int check (bedrooms >= 0);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'gestion-media',
  'gestion-media',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do nothing;

-- L'espace propriétaire d'un objet, lu sur le premier segment du chemin.
-- Renvoie NULL si le segment n'est pas un uuid : gestion.can(NULL, ...) vaut
-- NULL, que la RLS traite comme faux. Aucun cast ne peut donc échouer.
create or replace function gestion.media_org(path text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when (storage.foldername(path))[1] ~
         '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then ((storage.foldername(path))[1])::uuid
    else null
  end
$$;

create policy gestion_media_select on storage.objects
  for select to authenticated
  using (bucket_id = 'gestion-media' and gestion.can(gestion.media_org(name), 'gestion.properties.view'));

create policy gestion_media_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'gestion-media' and gestion.can(gestion.media_org(name), 'gestion.properties.edit'));

create policy gestion_media_update on storage.objects
  for update to authenticated
  using (bucket_id = 'gestion-media' and gestion.can(gestion.media_org(name), 'gestion.properties.edit'))
  with check (bucket_id = 'gestion-media' and gestion.can(gestion.media_org(name), 'gestion.properties.edit'));

create policy gestion_media_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'gestion-media' and gestion.can(gestion.media_org(name), 'gestion.properties.edit'));
