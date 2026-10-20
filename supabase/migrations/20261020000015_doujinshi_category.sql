-- RUBAKA — Doujinshi (18+) as its own category, and nhentai favourites as an
-- import source. Run on its own: a new enum value can only be used after commit
-- (the next migration uses it).
alter type public.media_category add value if not exists 'doujinshi' after 'manga';

alter table public.import_jobs drop constraint if exists import_jobs_source_check;
alter table public.import_jobs add constraint import_jobs_source_check
  check (source in ('imdb_csv', 'mal_xml', 'backloggd_json', 'vndb_api', 'nhentai_json', 'rubaka_backup', 'other'));

alter table public.media_external_ids drop constraint if exists media_external_ids_provider_check;
alter table public.media_external_ids add constraint media_external_ids_provider_check check (provider in (
  'mal_anime', 'mal_manga', 'anilist', 'kitsu', 'imdb', 'tmdb_movie', 'tmdb_tv', 'tvmaze',
  'vndb', 'igdb', 'rawg', 'backloggd', 'openlibrary', 'mangadex', 'nhentai', 'other'));
