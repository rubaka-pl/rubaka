-- RUBAKA — flat genre list for server-side backups (media_id, genre name),
-- in the same shape as tables.media_genres in a RUBAKA backup file.
create or replace view public.media_genres_named
with (security_invoker = true) as
  select mg.media_id, g.name as genre
  from public.media_genres mg join public.genres g on g.id = mg.genre_id;

revoke all on public.media_genres_named from anon;
grant select on public.media_genres_named to authenticated;
