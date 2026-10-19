-- RUBAKA — storage for manually uploaded covers/backdrops.
-- Provider images stay as remote URLs; only custom uploads live here.
-- The bucket is public-read (cover art is not sensitive, and signed URLs for
-- every poster in a grid would cost a request each), but only the owner can
-- upload, replace or delete files. Paths are random UUIDs.
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    raise notice 'storage schema not present; skipping bucket setup';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('media-assets', 'media-assets', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
  on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

  execute $p$create policy "rubaka owner insert" on storage.objects for insert to authenticated
    with check (bucket_id = 'media-assets' and (select app_private.is_owner()))$p$;
  execute $p$create policy "rubaka owner update" on storage.objects for update to authenticated
    using (bucket_id = 'media-assets' and (select app_private.is_owner()))$p$;
  execute $p$create policy "rubaka owner delete" on storage.objects for delete to authenticated
    using (bucket_id = 'media-assets' and (select app_private.is_owner()))$p$;
  execute $p$create policy "rubaka owner select" on storage.objects for select to authenticated
    using (bucket_id = 'media-assets' and (select app_private.is_owner()))$p$;
end $$;
