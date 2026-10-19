-- RUBAKA — allow VNDB (API) as an import source. Idempotent.
alter table public.import_jobs drop constraint if exists import_jobs_source_check;
alter table public.import_jobs add constraint import_jobs_source_check
  check (source in ('imdb_csv', 'mal_xml', 'backloggd_json', 'vndb_api', 'rubaka_backup', 'other'));
