-- Public bucket for listing photos downloaded server-side from an imported
-- source (we never hotlink the origin). Path: <agency_id>/<listing_id>/<n>.<ext>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('listing-images', 'listing-images', true, 10485760,
        array['image/jpeg','image/png','image/webp','image/avif'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists listing_images_read on storage.objects;
create policy listing_images_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'listing-images');

drop policy if exists listing_images_write on storage.objects;
create policy listing_images_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'listing-images'
    and (nullif(split_part(name, '/', 1), ''))::uuid in (select public.crm_member_agencies())
  );

drop policy if exists listing_images_update on storage.objects;
create policy listing_images_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'listing-images'
    and (nullif(split_part(name, '/', 1), ''))::uuid in (select public.crm_member_agencies())
  );

drop policy if exists listing_images_delete on storage.objects;
create policy listing_images_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'listing-images'
    and (nullif(split_part(name, '/', 1), ''))::uuid in (select public.crm_member_agencies())
  );
