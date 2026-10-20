-- RUBAKA — allow animated GIFs in the asset bucket (sidebar mascot upload).
-- Covers are still converted to WebP in the browser; only the mascot keeps its GIF.
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then return; end if;
  update storage.buckets
  set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif']
  where id = 'media-assets';
end $$;
