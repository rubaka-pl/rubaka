-- RUBAKA — full database setup (generated from supabase/migrations; do not edit by hand)
-- Paste into Supabase Dashboard -> SQL Editor -> Run. Run once on a new project.

-- ===== 20261019000001_core_schema.sql =====
-- RUBAKA — core schema
-- Media metadata (media, media_*) is kept separate from personal library data
-- (library_entries, tracking_sessions, ...). Every table is protected by RLS and
-- only the configured owner (app_private.owner) can read or write anything.

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

create schema if not exists app_private;

-- ---------------------------------------------------------------------------
-- Owner configuration
-- ---------------------------------------------------------------------------
-- Exactly one row. Set it once after creating your auth user:
--   insert into app_private.owner (user_id) values ('<your auth.users id>');
create table app_private.owner (
  singleton boolean primary key default true check (singleton),
  user_id uuid not null unique
);

create or replace function app_private.is_owner()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from app_private.owner o where o.user_id = (select auth.uid())
  );
$$;

-- Normalization used for search_text and for search queries: lower-case,
-- strip accents (Kyōjin -> kyojin), turn punctuation/symbols into spaces and
-- collapse whitespace. Japanese/Cyrillic characters are preserved.
create or replace function app_private.normalize_text(p text)
returns text
language sql stable
set search_path = ''
as $$
  select btrim(regexp_replace(
    lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p, ''))),
    '[[:punct:][:space:]・･〜～「」『』（）【】、。！？：；]+', ' ', 'g'))
$$;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.media_category as enum (
  'anime', 'manga', 'novel', 'visual_novel', 'movie', 'tv_series', 'animated_series', 'game'
);
create type public.library_status as enum ('planning', 'in_progress', 'completed', 'on_hold', 'dropped');
create type public.session_type as enum ('rewatch', 'reread', 'replay');
create type public.session_status as enum ('active', 'completed', 'abandoned');
create type public.enrichment_state as enum ('pending', 'matched', 'unresolved', 'failed', 'skipped');
create type public.relation_type as enum (
  'adaptation', 'source', 'sequel', 'prequel', 'side_story', 'spin_off',
  'alternative', 'parent', 'summary', 'character', 'other'
);

-- Allowed formats per category. Kept as a function so the CHECK constraint and
-- the frontend list (src/lib/categories.ts) can be compared in tests.
create or replace function app_private.valid_format(p_category public.media_category, p_format text)
returns boolean
language sql immutable
set search_path = ''
as $$
  select p_format is null or p_format = any (case p_category
    when 'anime' then array['tv', 'tv_short', 'movie', 'ova', 'ona', 'special', 'music', 'other']
    when 'manga' then array['manga', 'manhwa', 'manhua', 'webtoon', 'one_shot', 'doujinshi', 'other']
    when 'novel' then array['light_novel', 'web_novel', 'novel', 'short_story', 'other']
    when 'visual_novel' then array['visual_novel', 'kinetic_novel', 'other']
    when 'movie' then array['movie', 'tv_movie', 'short', 'video', 'special', 'other']
    when 'tv_series' then array['series', 'mini_series', 'special', 'other']
    when 'animated_series' then array['series', 'mini_series', 'special', 'other']
    when 'game' then array['game', 'dlc', 'expansion', 'remake', 'remaster', 'other']
  end)
$$;

-- ---------------------------------------------------------------------------
-- Media metadata
-- ---------------------------------------------------------------------------
create table public.media (
  id uuid primary key default gen_random_uuid(),
  category public.media_category not null,
  title text not null check (length(btrim(title)) > 0),
  sort_title text generated always as (lower(title)) stored,
  original_title text,
  synopsis text,
  format text,
  release_date date,
  release_year smallint check (release_year between 1800 and 2200),
  end_date date,
  release_status text check (release_status in ('upcoming', 'releasing', 'finished', 'cancelled', 'hiatus')),
  country text check (country ~ '^[A-Z]{2}$'),
  poster_url text,
  backdrop_url text,
  custom_poster_path text,
  custom_backdrop_path text,
  -- NULL means "unknown". Zero is never a valid total.
  total_episodes integer check (total_episodes > 0),
  total_chapters integer check (total_chapters > 0),
  total_volumes integer check (total_volumes > 0),
  total_seasons integer check (total_seasons > 0),
  total_routes integer check (total_routes > 0),
  episode_duration smallint check (episode_duration > 0), -- informational only
  runtime smallint check (runtime > 0),                   -- informational only
  -- Category-specific metadata (studios, authors, developers, platforms, cast,
  -- directors, publisher, themes, tags, age_rating, ...). Validated by zod on
  -- the client; constrained to an object here.
  details jsonb not null default '{}' check (jsonb_typeof(details) = 'object'),
  -- Fields edited by hand. Metadata enrichment never overwrites these.
  locked_fields text[] not null default '{}',
  is_custom boolean not null default false,
  enrichment_state public.enrichment_state not null default 'pending',
  enriched_at timestamptz,
  search_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint media_format_valid check (app_private.valid_format(category, format)),
  constraint media_dates_valid check (end_date is null or release_date is null or end_date >= release_date)
);
create index media_category_idx on public.media (category);
create index media_search_trgm_idx on public.media using gin (search_text extensions.gin_trgm_ops);

create table public.media_titles (
  id uuid primary key default gen_random_uuid(),
  media_id uuid not null references public.media (id) on delete cascade,
  title text not null check (length(btrim(title)) > 0),
  kind text not null default 'synonym'
    check (kind in ('english', 'romaji', 'japanese', 'native', 'russian', 'synonym', 'other')),
  unique (media_id, kind, title)
);
create index media_titles_media_idx on public.media_titles (media_id);

-- Provider ids are namespaced where a provider reuses numbers across types
-- (mal_anime vs mal_manga, tmdb_movie vs tmdb_tv). (provider, external_id) is
-- globally unique: this is the primary duplicate-prevention key for imports.
create table public.media_external_ids (
  provider text not null check (provider in (
    'mal_anime', 'mal_manga', 'anilist', 'kitsu', 'imdb', 'tmdb_movie', 'tmdb_tv', 'tvmaze',
    'vndb', 'igdb', 'rawg', 'backloggd', 'openlibrary', 'mangadex', 'other')),
  external_id text not null check (length(btrim(external_id)) > 0),
  media_id uuid not null references public.media (id) on delete cascade,
  url text,
  primary key (provider, external_id)
);
create index media_external_ids_media_idx on public.media_external_ids (media_id);

create table public.genres (
  id integer generated always as identity primary key,
  name text not null unique check (length(btrim(name)) > 0)
);

create table public.media_genres (
  media_id uuid not null references public.media (id) on delete cascade,
  genre_id integer not null references public.genres (id) on delete cascade,
  primary key (media_id, genre_id)
);
create index media_genres_genre_idx on public.media_genres (genre_id);

create table public.media_seasons (
  media_id uuid not null references public.media (id) on delete cascade,
  season_number smallint not null check (season_number >= 0),
  title text,
  episode_count integer check (episode_count > 0),
  air_date date,
  primary key (media_id, season_number)
);

-- Relations may point at a title in the library (related_media_id) or at an
-- external work that is not tracked (provider + external id + title).
create table public.media_relations (
  id uuid primary key default gen_random_uuid(),
  media_id uuid not null references public.media (id) on delete cascade,
  relation_type public.relation_type not null,
  related_media_id uuid references public.media (id) on delete set null,
  related_title text,
  related_category public.media_category,
  related_provider text,
  related_external_id text,
  related_poster_url text,
  check (related_media_id is not null or related_title is not null),
  check (related_media_id is distinct from media_id)
);
create unique index media_relations_ext_uq on public.media_relations (media_id, relation_type, related_provider, related_external_id)
  where related_external_id is not null;
create unique index media_relations_local_uq on public.media_relations (media_id, relation_type, related_media_id)
  where related_media_id is not null;

-- ---------------------------------------------------------------------------
-- Personal library
-- ---------------------------------------------------------------------------
create table public.library_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  media_id uuid not null references public.media (id) on delete cascade,
  status public.library_status not null default 'planning',
  -- Half-stars: 0..10 => 0..5 stars. NULL = unrated, 0 = explicit zero stars.
  rating smallint check (rating between 0 and 10),
  episodes_watched integer not null default 0 check (episodes_watched >= 0),
  chapters_read integer not null default 0 check (chapters_read >= 0),
  volumes_read integer not null default 0 check (volumes_read >= 0),
  current_season smallint check (current_season >= 0),
  current_episode integer check (current_episode >= 0),
  routes_completed integer not null default 0 check (routes_completed >= 0),
  endings_completed integer not null default 0 check (endings_completed >= 0),
  start_date date,
  completion_date date,
  -- Repeats known only as an aggregate (e.g. "times rewatched: 2" from an
  -- import, no dates). We keep the number instead of inventing sessions.
  imported_repeat_count integer not null default 0 check (imported_repeat_count >= 0),
  -- Maintained by trigger: number of completed tracking_sessions.
  session_repeat_count integer not null default 0 check (session_repeat_count >= 0),
  repeat_count integer generated always as (imported_repeat_count + session_repeat_count) stored,
  is_favorite boolean not null default false,
  -- Wishlist membership is independent from status.
  wishlisted_at timestamptz,
  wishlist_priority smallint check (wishlist_priority between 1 and 3),
  notes text,
  review text,
  -- User-facing "date added" (may be historical when imported).
  added_at timestamptz not null default now(),
  completed_at timestamptz,
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, media_id),
  constraint entry_dates_valid check (completion_date is null or start_date is null or completion_date >= start_date),
  constraint entry_priority_needs_wishlist check (wishlist_priority is null or wishlisted_at is not null)
);
create index library_entries_user_status_idx on public.library_entries (user_id, status);
create index library_entries_media_idx on public.library_entries (media_id);
create index library_entries_added_idx on public.library_entries (user_id, added_at desc);
create index library_entries_activity_idx on public.library_entries (user_id, last_activity_at desc);
create index library_entries_wishlist_idx on public.library_entries (user_id, wishlisted_at desc) where wishlisted_at is not null;

create table public.entry_season_progress (
  entry_id uuid not null references public.library_entries (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  season_number smallint not null check (season_number >= 0),
  episodes_watched integer not null default 0 check (episodes_watched >= 0),
  primary key (entry_id, season_number)
);

create table public.tracking_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  entry_id uuid not null references public.library_entries (id) on delete cascade,
  session_type public.session_type not null,
  status public.session_status not null default 'active',
  start_date date,
  end_date date,
  progress integer check (progress >= 0),           -- episodes / chapters / routes
  progress_secondary integer check (progress_secondary >= 0), -- volumes
  season_number smallint check (season_number >= 0), -- rewatching a single season
  rating smallint check (rating between 0 and 10),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);
create index tracking_sessions_entry_idx on public.tracking_sessions (entry_id, created_at);
-- At most one active repeat session per entry.
create unique index tracking_sessions_one_active_uq on public.tracking_sessions (entry_id) where status = 'active';

create table public.vn_routes (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.library_entries (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  kind text not null default 'route' check (kind in ('route', 'ending')),
  completed boolean not null default false,
  completed_on date,
  sort_order integer not null default 0,
  source text not null default 'manual' check (source in ('manual', 'vndb')),
  created_at timestamptz not null default now()
);
create index vn_routes_entry_idx on public.vn_routes (entry_id, sort_order);

create table public.activity_log (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  entry_id uuid references public.library_entries (id) on delete set null,
  media_id uuid references public.media (id) on delete set null,
  category public.media_category,
  action text not null check (action in (
    'added', 'status_changed', 'completed', 'rating_changed', 'progress',
    'repeat_started', 'repeat_completed', 'repeat_abandoned',
    'wishlist_added', 'wishlist_removed', 'favorited', 'imported', 'restored')),
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index activity_log_user_time_idx on public.activity_log (user_id, created_at desc);
create index activity_log_entry_time_idx on public.activity_log (entry_id, created_at desc);

create table public.user_settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  settings jsonb not null default '{}' check (jsonb_typeof(settings) = 'object'),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Imports and enrichment
-- ---------------------------------------------------------------------------
create table public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source text not null check (source in ('imdb_csv', 'mal_xml', 'backloggd_json', 'rubaka_backup', 'other')),
  file_name text,
  status text not null default 'running' check (status in ('running', 'completed', 'partial', 'failed', 'cancelled')),
  options jsonb not null default '{}',
  summary jsonb not null default '{}',
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

-- One row per source record per job, including skipped/failed ones, so
-- nothing is silently dropped and an interrupted job can be resumed.
create table public.import_records (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.import_jobs (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source_key text not null,
  row_number integer,
  outcome text not null check (outcome in ('created', 'updated', 'unchanged', 'skipped', 'failed', 'invalid')),
  entry_id uuid references public.library_entries (id) on delete set null,
  media_id uuid references public.media (id) on delete set null,
  message text,
  raw jsonb,
  created_at timestamptz not null default now(),
  unique (job_id, source_key)
);

create table public.metadata_enrichment_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  media_id uuid not null references public.media (id) on delete cascade,
  provider text not null,
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'unresolved', 'failed', 'review')),
  attempts smallint not null default 0,
  last_error text,
  next_attempt_at timestamptz not null default now(),
  -- Candidate matches awaiting manual review, or the applied result.
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (media_id, provider)
);
create index metadata_jobs_queue_idx on public.metadata_enrichment_jobs (status, next_attempt_at);

-- Cached provider responses (keyed by provider + request) to save API calls.
create table public.metadata_cache (
  provider text not null,
  cache_key text not null,
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  primary key (provider, cache_key)
);

-- ---------------------------------------------------------------------------
-- Triggers: timestamps, search text, validation, derived counters
-- ---------------------------------------------------------------------------
create or replace function app_private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger media_touch before update on public.media
  for each row execute function app_private.touch_updated_at();
create trigger sessions_touch before update on public.tracking_sessions
  for each row execute function app_private.touch_updated_at();
create trigger settings_touch before update on public.user_settings
  for each row execute function app_private.touch_updated_at();
create trigger enrichment_touch before update on public.metadata_enrichment_jobs
  for each row execute function app_private.touch_updated_at();

-- search_text = normalized title + original title + every alternative title.
create or replace function app_private.compute_search_text(p_media_id uuid)
returns text language sql stable set search_path = '' as $$
  select app_private.normalize_text(concat_ws(' ', m.title, m.original_title,
    (select string_agg(t.title, ' ') from public.media_titles t where t.media_id = m.id)))
  from public.media m where m.id = p_media_id
$$;

create or replace function app_private.media_search_text()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.search_text := app_private.normalize_text(concat_ws(' ', new.title, new.original_title,
    (select string_agg(t.title, ' ') from public.media_titles t where t.media_id = new.id)));
  return new;
end $$;

create trigger media_search_text before insert or update of title, original_title on public.media
  for each row execute function app_private.media_search_text();

create or replace function app_private.media_titles_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_id uuid := coalesce(new.media_id, old.media_id);
begin
  update public.media set search_text = app_private.compute_search_text(v_id) where id = v_id;
  return null;
end $$;

create trigger media_titles_search after insert or update or delete on public.media_titles
  for each row execute function app_private.media_titles_changed();

-- Progress may not exceed a *known* total. Unknown totals (NULL) never limit.
create or replace function app_private.validate_entry()
returns trigger language plpgsql set search_path = '' as $$
declare m record;
begin
  select total_episodes, total_chapters, total_volumes, total_routes into m
  from public.media where id = new.media_id;
  if m.total_episodes is not null and new.episodes_watched > m.total_episodes then
    raise exception 'Episodes watched (%) exceed the total (%)', new.episodes_watched, m.total_episodes
      using errcode = 'check_violation';
  end if;
  if m.total_chapters is not null and new.chapters_read > m.total_chapters then
    raise exception 'Chapters read (%) exceed the total (%)', new.chapters_read, m.total_chapters
      using errcode = 'check_violation';
  end if;
  if m.total_volumes is not null and new.volumes_read > m.total_volumes then
    raise exception 'Volumes read (%) exceed the total (%)', new.volumes_read, m.total_volumes
      using errcode = 'check_violation';
  end if;
  if m.total_routes is not null and new.routes_completed > m.total_routes then
    raise exception 'Routes completed (%) exceed the total (%)', new.routes_completed, m.total_routes
      using errcode = 'check_violation';
  end if;

  if tg_op = 'UPDATE' then
    new.updated_at := now();
    if new.status = 'completed' and old.status is distinct from 'completed' and new.completed_at is null then
      new.completed_at := now();
    end if;
    if (new.status, new.rating, new.episodes_watched, new.chapters_read, new.volumes_read,
        new.routes_completed, new.endings_completed, new.is_favorite, new.wishlisted_at,
        new.session_repeat_count, new.notes, new.review)
       is distinct from
       (old.status, old.rating, old.episodes_watched, old.chapters_read, old.volumes_read,
        old.routes_completed, old.endings_completed, old.is_favorite, old.wishlisted_at,
        old.session_repeat_count, old.notes, old.review) then
      new.last_activity_at := now();
    end if;
  end if;
  if new.wishlisted_at is null then
    new.wishlist_priority := null;
  end if;
  return new;
end $$;

create trigger library_entries_validate before insert or update on public.library_entries
  for each row execute function app_private.validate_entry();

-- Session type must match the category (rewatch/reread/replay).
create or replace function app_private.validate_session()
returns trigger language plpgsql set search_path = '' as $$
declare v_cat public.media_category;
begin
  select m.category into v_cat from public.library_entries e join public.media m on m.id = e.media_id
  where e.id = new.entry_id;
  if new.session_type <> (case
      when v_cat in ('manga', 'novel') then 'reread'
      when v_cat in ('visual_novel', 'game') then 'replay'
      else 'rewatch' end)::public.session_type then
    raise exception 'Session type % does not match category %', new.session_type, v_cat
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger tracking_sessions_validate before insert or update on public.tracking_sessions
  for each row execute function app_private.validate_session();

-- Only completed sessions count as repeats; active or abandoned ones do not.
create or replace function app_private.sessions_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_entry uuid := coalesce(new.entry_id, old.entry_id);
begin
  update public.library_entries e
  set session_repeat_count = (
    select count(*) from public.tracking_sessions s where s.entry_id = v_entry and s.status = 'completed')
  where e.id = v_entry;
  return null;
end $$;

create trigger tracking_sessions_count after insert or update or delete on public.tracking_sessions
  for each row execute function app_private.sessions_changed();

-- Season rows drive the overall TV progress fields when they exist.
create or replace function app_private.season_progress_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_entry uuid := coalesce(new.entry_id, old.entry_id);
  v_last record;
begin
  select season_number, episodes_watched into v_last from public.entry_season_progress
  where entry_id = v_entry and episodes_watched > 0
  order by season_number desc limit 1;

  update public.library_entries e set
    episodes_watched = coalesce((select sum(p.episodes_watched) from public.entry_season_progress p where p.entry_id = v_entry), 0),
    current_season = v_last.season_number,
    current_episode = v_last.episodes_watched
  where e.id = v_entry;
  return null;
end $$;

create trigger season_progress_sync after insert or update or delete on public.entry_season_progress
  for each row execute function app_private.season_progress_changed();

create or replace function app_private.vn_routes_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_entry uuid := coalesce(new.entry_id, old.entry_id);
begin
  update public.library_entries e set
    routes_completed = (select count(*) from public.vn_routes r where r.entry_id = v_entry and r.kind = 'route' and r.completed),
    endings_completed = (select count(*) from public.vn_routes r where r.entry_id = v_entry and r.kind = 'ending' and r.completed)
  where e.id = v_entry;
  return null;
end $$;

create trigger vn_routes_sync after insert or update or delete on public.vn_routes
  for each row execute function app_private.vn_routes_changed();

-- ---------------------------------------------------------------------------
-- Activity log
-- ---------------------------------------------------------------------------
-- Logged from triggers so every write path (UI, bulk edit) is covered.
-- Imports/restores set rubaka.suppress_activity = 'on' and log one summary.
-- To keep the feed useful, consecutive progress updates on the same entry
-- within 2 hours (and rating changes within 15 minutes) are merged into the
-- previous event instead of creating a new one.
create or replace function app_private.log_activity(
  p_entry public.library_entries, p_action text, p_details jsonb, p_merge_window interval default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_last public.activity_log;
  v_cat public.media_category;
begin
  if p_merge_window is not null then
    select * into v_last from public.activity_log
    where entry_id = p_entry.id order by created_at desc, id desc limit 1;
    if found and v_last.action = p_action and v_last.created_at > now() - p_merge_window then
      update public.activity_log
      set details = v_last.details || jsonb_build_object('to', p_details -> 'to'), created_at = now()
      where id = v_last.id;
      return;
    end if;
  end if;
  select category into v_cat from public.media where id = p_entry.media_id;
  insert into public.activity_log (user_id, entry_id, media_id, category, action, details)
  values (p_entry.user_id, p_entry.id, p_entry.media_id, v_cat, p_action, coalesce(p_details, '{}'));
end $$;

create or replace function app_private.entry_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_old_progress jsonb;
  v_new_progress jsonb;
begin
  if coalesce(current_setting('rubaka.suppress_activity', true), '') = 'on' then
    return null;
  end if;

  if tg_op = 'INSERT' then
    perform app_private.log_activity(new, 'added',
      jsonb_build_object('status', new.status, 'wishlist', new.wishlisted_at is not null));
    return null;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'completed' then
      perform app_private.log_activity(new, 'completed', jsonb_build_object('from', old.status, 'to', new.status));
    else
      perform app_private.log_activity(new, 'status_changed', jsonb_build_object('from', old.status, 'to', new.status));
    end if;
  end if;

  if new.rating is distinct from old.rating then
    perform app_private.log_activity(new, 'rating_changed',
      jsonb_build_object('from', old.rating, 'to', new.rating), interval '15 minutes');
  end if;

  v_old_progress := jsonb_strip_nulls(jsonb_build_object(
    'episodes', nullif(old.episodes_watched, 0), 'chapters', nullif(old.chapters_read, 0),
    'volumes', nullif(old.volumes_read, 0), 'routes', nullif(old.routes_completed, 0)));
  v_new_progress := jsonb_strip_nulls(jsonb_build_object(
    'episodes', nullif(new.episodes_watched, 0), 'chapters', nullif(new.chapters_read, 0),
    'volumes', nullif(new.volumes_read, 0), 'routes', nullif(new.routes_completed, 0)));
  if v_new_progress is distinct from v_old_progress and new.status is not distinct from old.status then
    perform app_private.log_activity(new, 'progress',
      jsonb_build_object('from', v_old_progress, 'to', v_new_progress), interval '2 hours');
  end if;

  if new.wishlisted_at is not null and old.wishlisted_at is null then
    perform app_private.log_activity(new, 'wishlist_added', '{}');
  elsif new.wishlisted_at is null and old.wishlisted_at is not null then
    perform app_private.log_activity(new, 'wishlist_removed', '{}');
  end if;

  if new.is_favorite and not old.is_favorite then
    perform app_private.log_activity(new, 'favorited', '{}');
  end if;
  return null;
end $$;

create trigger library_entries_activity after insert or update on public.library_entries
  for each row execute function app_private.entry_activity();

create or replace function app_private.session_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_entry public.library_entries;
begin
  if coalesce(current_setting('rubaka.suppress_activity', true), '') = 'on' then
    return null;
  end if;
  select * into v_entry from public.library_entries where id = new.entry_id;
  if tg_op = 'INSERT' then
    perform app_private.log_activity(v_entry,
      case new.status when 'active' then 'repeat_started' when 'completed' then 'repeat_completed' else 'repeat_abandoned' end,
      jsonb_build_object('session_id', new.id, 'type', new.session_type));
  elsif new.status is distinct from old.status then
    perform app_private.log_activity(v_entry,
      case new.status when 'active' then 'repeat_started' when 'completed' then 'repeat_completed' else 'repeat_abandoned' end,
      jsonb_build_object('session_id', new.id, 'type', new.session_type));
  end if;
  return null;
end $$;

create trigger tracking_sessions_activity after insert or update on public.tracking_sessions
  for each row execute function app_private.session_activity();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.media enable row level security;
alter table public.media_titles enable row level security;
alter table public.media_external_ids enable row level security;
alter table public.genres enable row level security;
alter table public.media_genres enable row level security;
alter table public.media_seasons enable row level security;
alter table public.media_relations enable row level security;
alter table public.metadata_cache enable row level security;
alter table public.library_entries enable row level security;
alter table public.entry_season_progress enable row level security;
alter table public.tracking_sessions enable row level security;
alter table public.vn_routes enable row level security;
alter table public.activity_log enable row level security;
alter table public.user_settings enable row level security;
alter table public.import_jobs enable row level security;
alter table public.import_records enable row level security;
alter table public.metadata_enrichment_jobs enable row level security;

-- Metadata tables: owner only (the whole app is private).
do $$
declare t text;
begin
  foreach t in array array['media', 'media_titles', 'media_external_ids', 'genres', 'media_genres',
                           'media_seasons', 'media_relations', 'metadata_cache'] loop
    execute format(
      'create policy owner_all on public.%I for all to authenticated using ((select app_private.is_owner())) with check ((select app_private.is_owner()))', t);
  end loop;
  -- Personal tables: owner AND the row belongs to the signed-in user.
  foreach t in array array['library_entries', 'entry_season_progress', 'tracking_sessions', 'vn_routes',
                           'activity_log', 'user_settings', 'import_jobs', 'import_records',
                           'metadata_enrichment_jobs'] loop
    execute format(
      'create policy owner_rows on public.%I for all to authenticated using (user_id = (select auth.uid()) and (select app_private.is_owner())) with check (user_id = (select auth.uid()) and (select app_private.is_owner()))', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Privileges: nothing for anon; table access for authenticated (RLS applies).
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant usage on schema app_private to authenticated;
grant usage on schema extensions to authenticated;
revoke all on all tables in schema app_private from anon, authenticated;
grant execute on function app_private.is_owner() to authenticated;
grant execute on function app_private.normalize_text(text) to authenticated;
grant execute on function app_private.valid_format(public.media_category, text) to authenticated;
revoke execute on all functions in schema app_private from anon;


-- ===== 20261019000002_query_functions.sql =====
-- RUBAKA — read-side functions
-- All functions are SECURITY INVOKER: RLS applies exactly as for direct table
-- access, so these are conveniences, not privilege escalations.

-- Primary progress value/total for an entry, by category:
--   anime/tv/animated -> episodes, manga/novel -> chapters, visual novel -> routes.
create or replace function app_private.primary_progress(
  p_category public.media_category, e public.library_entries)
returns integer language sql immutable set search_path = '' as $$
  select case
    when p_category in ('anime', 'tv_series', 'animated_series') then e.episodes_watched
    when p_category in ('manga', 'novel') then e.chapters_read
    when p_category = 'visual_novel' then e.routes_completed
  end
$$;

create or replace function app_private.primary_total(p_category public.media_category, m public.media)
returns integer language sql immutable set search_path = '' as $$
  select case
    when p_category in ('anime', 'tv_series', 'animated_series') then m.total_episodes
    when p_category in ('manga', 'novel') then m.total_chapters
    when p_category = 'visual_novel' then m.total_routes
  end
$$;

-- ---------------------------------------------------------------------------
-- library_query: filtering, sorting and pagination over the WHOLE matching
-- dataset (not just a loaded page). Every sort ends with entry id as a
-- deterministic tie-breaker so offset pagination is stable. NULLs always sort
-- last regardless of direction. "random" is stable per p_seed so paging a
-- shuffled list does not repeat items.
-- ---------------------------------------------------------------------------
create or replace function public.library_query(
  p_category public.media_category default null,
  p_statuses public.library_status[] default null,
  p_wishlist boolean default null,
  p_favorite boolean default null,
  p_search text default null,
  p_genres text[] default null,
  p_formats text[] default null,
  p_countries text[] default null,
  p_release_statuses text[] default null,
  p_year_min integer default null,
  p_year_max integer default null,
  p_rating_min integer default null,
  p_rating_max integer default null,
  p_rated boolean default null,
  p_min_repeats integer default null,
  p_progress_min integer default null,
  p_active_repeat boolean default null,
  p_entry_ids uuid[] default null,
  p_sort text default 'added_desc',
  p_seed text default '',
  p_limit integer default 48,
  p_offset integer default 0
)
returns table (
  entry_id uuid,
  media_id uuid,
  category public.media_category,
  title text,
  original_title text,
  format text,
  release_year smallint,
  release_date date,
  release_status text,
  country text,
  poster_url text,
  custom_poster_path text,
  total_episodes integer,
  total_chapters integer,
  total_volumes integer,
  total_seasons integer,
  total_routes integer,
  status public.library_status,
  rating smallint,
  episodes_watched integer,
  chapters_read integer,
  volumes_read integer,
  current_season smallint,
  current_episode integer,
  routes_completed integer,
  endings_completed integer,
  start_date date,
  completion_date date,
  repeat_count integer,
  is_favorite boolean,
  wishlisted_at timestamptz,
  wishlist_priority smallint,
  added_at timestamptz,
  last_activity_at timestamptz,
  active_session_id uuid,
  active_session_progress integer,
  genres text[],
  relevance real,
  total_count bigint
)
language sql stable security invoker
set search_path = public, extensions
as $$
  with params as (
    select nullif(app_private.normalize_text(p_search), '') as term
  ),
  base as (
    select
      e, m,
      app_private.primary_progress(m.category, e) as prog,
      app_private.primary_total(m.category, m) as prog_total,
      s.id as active_session_id,
      s.progress as active_session_progress,
      case when params.term is null then 0::real
           when m.search_text like params.term || '%' then 2::real
           when m.search_text like '%' || params.term || '%' then 1::real
           else extensions.word_similarity(params.term, m.search_text) end as relevance
    from public.library_entries e
    join public.media m on m.id = e.media_id
    cross join params
    left join public.tracking_sessions s on s.entry_id = e.id and s.status = 'active'
    where (p_category is null or m.category = p_category)
      and (p_statuses is null or e.status = any (p_statuses))
      and (p_wishlist is null or (e.wishlisted_at is not null) = p_wishlist)
      and (p_favorite is null or e.is_favorite = p_favorite)
      and (p_formats is null or m.format = any (p_formats))
      and (p_countries is null or m.country = any (p_countries))
      and (p_release_statuses is null or m.release_status = any (p_release_statuses))
      and (p_year_min is null or m.release_year >= p_year_min)
      and (p_year_max is null or m.release_year <= p_year_max)
      and (p_rating_min is null or e.rating >= p_rating_min)
      and (p_rating_max is null or e.rating <= p_rating_max)
      and (p_rated is null or (e.rating is not null) = p_rated)
      and (p_min_repeats is null or e.repeat_count >= p_min_repeats)
      and (p_progress_min is null or app_private.primary_progress(m.category, e) >= p_progress_min)
      and (p_active_repeat is null or (s.id is not null) = p_active_repeat)
      and (p_entry_ids is null or e.id = any (p_entry_ids))
      -- Genres combine with AND: the title must have every selected genre.
      and (p_genres is null or cardinality(p_genres) = 0 or (
        select count(distinct g.name) from public.media_genres mg join public.genres g on g.id = mg.genre_id
        where mg.media_id = m.id and g.name = any (p_genres)) = cardinality(p_genres))
      and (params.term is null
           or m.search_text like '%' || params.term || '%'
           or extensions.word_similarity(params.term, m.search_text) >= 0.45)
  )
  select
    (b.e).id, (b.m).id, (b.m).category, (b.m).title, (b.m).original_title, (b.m).format,
    (b.m).release_year, (b.m).release_date, (b.m).release_status, (b.m).country,
    (b.m).poster_url, (b.m).custom_poster_path,
    (b.m).total_episodes, (b.m).total_chapters, (b.m).total_volumes, (b.m).total_seasons, (b.m).total_routes,
    (b.e).status, (b.e).rating, (b.e).episodes_watched, (b.e).chapters_read, (b.e).volumes_read,
    (b.e).current_season, (b.e).current_episode, (b.e).routes_completed, (b.e).endings_completed,
    (b.e).start_date, (b.e).completion_date, (b.e).repeat_count, (b.e).is_favorite,
    (b.e).wishlisted_at, (b.e).wishlist_priority, (b.e).added_at, (b.e).last_activity_at,
    b.active_session_id, b.active_session_progress,
    array(select g.name from public.media_genres mg join public.genres g on g.id = mg.genre_id
          where mg.media_id = (b.m).id order by g.name),
    b.relevance,
    count(*) over ()
  from base b
  order by
    case when p_sort = 'relevance' then b.relevance end desc nulls last,
    case when p_sort = 'added_desc' then (b.e).added_at end desc nulls last,
    case when p_sort = 'added_asc' then (b.e).added_at end asc nulls last,
    case when p_sort = 'title_asc' then (b.m).sort_title end asc nulls last,
    case when p_sort = 'title_desc' then (b.m).sort_title end desc nulls last,
    case when p_sort = 'release_desc' then coalesce((b.m).release_date, make_date((b.m).release_year, 1, 1)) end desc nulls last,
    case when p_sort = 'release_asc' then coalesce((b.m).release_date, make_date((b.m).release_year, 1, 1)) end asc nulls last,
    case when p_sort = 'rating_desc' then (b.e).rating end desc nulls last,
    case when p_sort = 'rating_asc' then (b.e).rating end asc nulls last,
    case when p_sort = 'started_desc' then (b.e).start_date end desc nulls last,
    case when p_sort = 'started_asc' then (b.e).start_date end asc nulls last,
    case when p_sort = 'completed_desc' then coalesce((b.e).completion_date, (b.e).completed_at::date) end desc nulls last,
    case when p_sort = 'completed_asc' then coalesce((b.e).completion_date, (b.e).completed_at::date) end asc nulls last,
    case when p_sort = 'activity_desc' then (b.e).last_activity_at end desc nulls last,
    case when p_sort = 'progress_desc' then b.prog::numeric / nullif(b.prog_total, 0) end desc nulls last,
    case when p_sort = 'progress_desc' then b.prog end desc nulls last,
    case when p_sort = 'repeats_desc' then (b.e).repeat_count end desc nulls last,
    case when p_sort = 'priority_desc' then (b.e).wishlist_priority end desc nulls last,
    case when p_sort = 'priority_desc' then (b.e).wishlisted_at end desc nulls last,
    case when p_sort = 'random' then md5((b.e).id::text || p_seed) end asc,
    (b.m).sort_title asc,
    (b.e).id asc
  limit least(greatest(p_limit, 1), 500)
  offset greatest(p_offset, 0)
$$;

-- Facet values for filter dropdowns (genres/years/formats present in a category).
create or replace function public.library_facets(p_category public.media_category default null)
returns jsonb
language sql stable security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'genres', coalesce((
      select jsonb_agg(x order by x->>'name') from (
        select jsonb_build_object('name', g.name, 'count', count(*)) as x
        from public.library_entries e
        join public.media m on m.id = e.media_id
        join public.media_genres mg on mg.media_id = m.id
        join public.genres g on g.id = mg.genre_id
        where p_category is null or m.category = p_category
        group by g.name) s), '[]'::jsonb),
    'formats', coalesce((
      select jsonb_agg(distinct m.format) from public.library_entries e join public.media m on m.id = e.media_id
      where (p_category is null or m.category = p_category) and m.format is not null), '[]'::jsonb),
    'countries', coalesce((
      select jsonb_agg(distinct m.country) from public.library_entries e join public.media m on m.id = e.media_id
      where (p_category is null or m.category = p_category) and m.country is not null), '[]'::jsonb),
    'year_min', (select min(m.release_year) from public.library_entries e join public.media m on m.id = e.media_id
                 where p_category is null or m.category = p_category),
    'year_max', (select max(m.release_year) from public.library_entries e join public.media m on m.id = e.media_id
                 where p_category is null or m.category = p_category),
    'status_counts', coalesce((
      select jsonb_object_agg(status, n) from (
        select e.status, count(*) as n from public.library_entries e join public.media m on m.id = e.media_id
        where p_category is null or m.category = p_category group by e.status) s), '{}'::jsonb),
    'wishlist_count', (select count(*) from public.library_entries e join public.media m on m.id = e.media_id
                       where (p_category is null or m.category = p_category) and e.wishlisted_at is not null),
    'total', (select count(*) from public.library_entries e join public.media m on m.id = e.media_id
              where p_category is null or m.category = p_category)
  )
$$;

-- Per-category counters for the dashboard cards and sidebar.
create or replace function public.dashboard_summary()
returns jsonb
language sql stable security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'category', c.category,
    'total', coalesce(s.total, 0),
    'active', coalesce(s.active, 0),
    'completed', coalesce(s.completed, 0),
    'wishlist', coalesce(s.wishlist, 0)) order by c.ord), '[]'::jsonb)
  from (select category, row_number() over () as ord
        from unnest(enum_range(null::public.media_category)) as category) c
  left join (
    select m.category,
      count(*) as total,
      count(*) filter (where e.status = 'in_progress'
        or exists (select 1 from public.tracking_sessions t where t.entry_id = e.id and t.status = 'active')) as active,
      count(*) filter (where e.status = 'completed') as completed,
      count(*) filter (where e.wishlisted_at is not null) as wishlist
    from public.library_entries e join public.media m on m.id = e.media_id
    group by m.category
  ) s on s.category = c.category
$$;

-- ---------------------------------------------------------------------------
-- Statistics. Only real data is used: completion dates that are unknown are
-- reported as "unknown", never guessed.
-- ---------------------------------------------------------------------------
create or replace function public.library_stats(
  p_category public.media_category default null,
  p_year integer default null,
  p_tz text default 'UTC'
)
returns jsonb
language plpgsql stable security invoker
set search_path = public
as $$
declare
  v_year integer := coalesce(p_year, extract(year from now() at time zone p_tz)::integer);
  v jsonb;
begin
  with ent as (
    select e.*, m.category, m.title, m.poster_url, m.custom_poster_path, m.release_year,
           coalesce(e.completion_date, (e.completed_at at time zone p_tz)::date) as done_on
    from public.library_entries e join public.media m on m.id = e.media_id
    where p_category is null or m.category = p_category
  )
  select jsonb_build_object(
    'overview', (select jsonb_build_object(
        'total', count(*),
        'completed', count(*) filter (where status = 'completed'),
        'in_progress', count(*) filter (where status = 'in_progress'),
        'planning', count(*) filter (where status = 'planning'),
        'on_hold', count(*) filter (where status = 'on_hold'),
        'dropped', count(*) filter (where status = 'dropped'),
        'wishlist', count(*) filter (where wishlisted_at is not null),
        'favorites', count(*) filter (where is_favorite),
        'rated', count(*) filter (where rating is not null),
        'average_rating', round(avg(rating) / 2.0, 2),
        'repeats_completed', coalesce(sum(repeat_count), 0),
        'repeats_undated', coalesce(sum(imported_repeat_count), 0),
        'completed_without_date', count(*) filter (where status = 'completed' and done_on is null))
      from ent),
    'by_category', coalesce((select jsonb_agg(jsonb_build_object(
        'category', category, 'total', n, 'completed', c, 'in_progress', ip, 'average_rating', ar) order by category)
      from (select category, count(*) n, count(*) filter (where status = 'completed') c,
                   count(*) filter (where status = 'in_progress') ip, round(avg(rating) / 2.0, 2) ar
            from ent group by category) s), '[]'::jsonb),
    'rating_distribution', (select jsonb_agg(jsonb_build_object('rating', r, 'count',
        (select count(*) from ent where rating = r)) order by r) from generate_series(0, 10) r),
    'status_distribution', coalesce((select jsonb_object_agg(status, n)
      from (select status, count(*) n from ent group by status) s), '{}'::jsonb),
    'completed_by_year', coalesce((select jsonb_agg(jsonb_build_object('year', y, 'count', n) order by y)
      from (select extract(year from done_on)::int y, count(*) n from ent
            where status = 'completed' and done_on is not null group by 1) s), '[]'::jsonb),
    'added_by_year', coalesce((select jsonb_agg(jsonb_build_object('year', y, 'count', n) order by y)
      from (select extract(year from added_at at time zone p_tz)::int y, count(*) n from ent group by 1) s), '[]'::jsonb),
    'top_genres', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'count', n, 'average_rating', ar) order by n desc, name)
      from (select g.name, count(*) n, round(avg(ent.rating) / 2.0, 2) ar from ent
            join public.media_genres mg on mg.media_id = ent.media_id
            join public.genres g on g.id = mg.genre_id
            group by g.name order by count(*) desc, g.name limit 15) s), '[]'::jsonb),
    'highest_rated', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('entry_id', id, 'media_id', media_id, 'title', title, 'category', category,
          'poster_url', poster_url, 'custom_poster_path', custom_poster_path, 'rating', rating, 'year', release_year) x
        from ent where rating is not null order by rating desc, title limit 12) s), '[]'::jsonb),
    'most_revisited', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('entry_id', id, 'media_id', media_id, 'title', title, 'category', category,
          'poster_url', poster_url, 'custom_poster_path', custom_poster_path, 'repeat_count', repeat_count, 'rating', rating) x
        from ent where repeat_count > 0 order by repeat_count desc, title limit 12) s), '[]'::jsonb),
    'year', v_year,
    'year_completed', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('entry_id', id, 'media_id', media_id, 'title', title, 'category', category,
          'poster_url', poster_url, 'custom_poster_path', custom_poster_path, 'rating', rating, 'completed_on', done_on) x
        from ent where status = 'completed' and extract(year from done_on) = v_year
        order by done_on desc, title) s), '[]'::jsonb),
    'available_years', coalesce((select jsonb_agg(y order by y desc) from (
        select distinct extract(year from done_on)::int y from ent where done_on is not null
        union select distinct extract(year from (a.created_at at time zone p_tz))::int from public.activity_log a) s), '[]'::jsonb),
    -- Heatmap: logged activity plus known start/completion dates. Imports and
    -- restores are excluded from the count so they don't create a fake spike.
    'heatmap', coalesce((select jsonb_object_agg(d, n) from (
        select d::text, count(*) n from (
          select (a.created_at at time zone p_tz)::date d from public.activity_log a
          left join public.media m on m.id = a.media_id
          where a.action not in ('imported', 'restored') and (p_category is null or m.category = p_category)
          union all select start_date from ent where start_date is not null
          union all select completion_date from ent where completion_date is not null
          union all select ts.end_date from public.tracking_sessions ts join ent on ent.id = ts.entry_id
            where ts.end_date is not null and ts.status = 'completed'
        ) days where extract(year from d) = v_year group by d) s), '{}'::jsonb)
  ) into v;
  return v;
end $$;

grant execute on function public.library_query to authenticated;
grant execute on function public.library_facets to authenticated;
grant execute on function public.dashboard_summary to authenticated;
grant execute on function public.library_stats to authenticated;
grant execute on function app_private.primary_progress to authenticated;
grant execute on function app_private.primary_total to authenticated;
revoke execute on function public.library_query from anon;
revoke execute on function public.library_facets from anon;
revoke execute on function public.dashboard_summary from anon;
revoke execute on function public.library_stats from anon;

-- Lets the app tell "not configured as owner" apart from "empty library".
create or replace function public.am_i_owner()
returns boolean
language sql stable security invoker
set search_path = ''
as $$ select app_private.is_owner() $$;
revoke execute on function public.am_i_owner from anon, public;
grant execute on function public.am_i_owner to authenticated;


-- ===== 20261019000003_import_enrichment_backup.sql =====
-- RUBAKA — imports, metadata enrichment, backup/restore
-- All functions are SECURITY INVOKER (RLS applies).

-- Fill-only metadata merge: a field is written only when it is currently NULL
-- (or an empty object/array) and is not listed in media.locked_fields. Totals
-- are never lowered below the user's recorded progress. Returns the list of
-- fields that were changed.
create or replace function app_private.merge_media_metadata(p_media_id uuid, p jsonb)
returns text[]
language plpgsql security invoker
set search_path = public
as $$
declare
  m public.media;
  changed text[] := '{}';
  f text;
  v_max_progress integer;
begin
  select * into m from public.media where id = p_media_id for update;
  if not found or p is null then return changed; end if;

  foreach f in array array['original_title', 'synopsis', 'format', 'release_date', 'release_year', 'end_date',
    'release_status', 'country', 'poster_url', 'backdrop_url', 'total_episodes', 'total_chapters',
    'total_volumes', 'total_seasons', 'total_routes', 'episode_duration', 'runtime'] loop
    continue when not (p ? f) or jsonb_typeof(p -> f) = 'null';
    continue when f = any (m.locked_fields);
    continue when (to_jsonb(m) -> f) is not null and jsonb_typeof(to_jsonb(m) -> f) <> 'null';
    -- Respect progress: a provider total smaller than what was already read/watched is ignored.
    if f in ('total_episodes', 'total_chapters', 'total_volumes', 'total_routes') then
      select max(case f when 'total_episodes' then e.episodes_watched when 'total_chapters' then e.chapters_read
                        when 'total_volumes' then e.volumes_read else e.routes_completed end)
      into v_max_progress from public.library_entries e where e.media_id = p_media_id;
      continue when v_max_progress is not null and (p ->> f)::integer < v_max_progress;
    end if;
    changed := changed || f;
  end loop;

  if cardinality(changed) > 0 then
    -- jsonb_populate_record over the current row applies only the chosen keys.
    update public.media t set
      original_title = r.original_title, synopsis = r.synopsis, format = r.format,
      release_date = r.release_date, release_year = r.release_year, end_date = r.end_date,
      release_status = r.release_status, country = r.country, poster_url = r.poster_url,
      backdrop_url = r.backdrop_url, total_episodes = r.total_episodes, total_chapters = r.total_chapters,
      total_volumes = r.total_volumes, total_seasons = r.total_seasons, total_routes = r.total_routes,
      episode_duration = r.episode_duration, runtime = r.runtime
    from jsonb_populate_record(m, (select jsonb_object_agg(k, p -> k) from unnest(changed) k)) r
    where t.id = p_media_id;
  end if;

  -- details: add keys that are missing; never replace existing keys or locked ones.
  if jsonb_typeof(p -> 'details') = 'object' and not ('details' = any (m.locked_fields)) then
    update public.media t set details = (
      select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(p -> 'details') x(k, v)
      where jsonb_typeof(v) <> 'null' and not (m.details ? k)
    ) || m.details
    where t.id = p_media_id and exists (
      select 1 from jsonb_each(p -> 'details') x(k, v) where jsonb_typeof(v) <> 'null' and not (m.details ? k));
    if found then changed := changed || 'details'::text; end if;
  end if;
  return changed;
end $$;

-- Attach alternative titles, genres and external ids (all idempotent).
create or replace function app_private.attach_media_extras(
  p_media_id uuid, p_titles jsonb, p_genres jsonb, p_external_ids jsonb, p_lock_genres boolean default false)
returns void
language plpgsql security invoker
set search_path = public
as $$
begin
  insert into public.media_titles (media_id, title, kind)
  select p_media_id, btrim(t ->> 'title'), coalesce(t ->> 'kind', 'synonym')
  from jsonb_array_elements(coalesce(p_titles, '[]')) t
  where length(btrim(coalesce(t ->> 'title', ''))) > 0
  on conflict do nothing;

  if not p_lock_genres then
    insert into public.genres (name)
    select distinct btrim(g #>> '{}') from jsonb_array_elements(coalesce(p_genres, '[]')) g
    where length(btrim(coalesce(g #>> '{}', ''))) > 0
    on conflict (name) do nothing;
    insert into public.media_genres (media_id, genre_id)
    select p_media_id, gr.id from public.genres gr
    where gr.name in (select btrim(g #>> '{}') from jsonb_array_elements(coalesce(p_genres, '[]')) g)
    on conflict do nothing;
  end if;

  -- An id already attached to a *different* media row is left alone (never
  -- re-pointed); the caller reports that as a conflict.
  insert into public.media_external_ids (provider, external_id, media_id, url)
  select x ->> 'provider', x ->> 'external_id', p_media_id, x ->> 'url'
  from jsonb_array_elements(coalesce(p_external_ids, '[]')) x
  where length(btrim(coalesce(x ->> 'external_id', ''))) > 0
  on conflict (provider, external_id) do nothing;
end $$;

-- ---------------------------------------------------------------------------
-- import_match: classify incoming records before the preview.
--   input:  [{source_key, category, title, year, format, external_ids:[{provider, external_id}]}]
--   output: [{source_key, match: 'external_id'|'none', media_id, entry, candidates:[...]}]
-- Candidates are title(+year) look-alikes in the same category. They are only
-- suggestions for the user; nothing is merged on title alone.
-- ---------------------------------------------------------------------------
create or replace function public.import_match(p_records jsonb)
returns jsonb
language sql stable security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'source_key', r ->> 'source_key',
    'match', case when idm.media_id is not null then 'external_id' else 'none' end,
    'media_id', idm.media_id,
    'entry', (select to_jsonb(e) - 'user_id' from public.library_entries e where e.media_id = idm.media_id),
    'media', (select jsonb_build_object('title', m.title, 'release_year', m.release_year, 'format', m.format,
                'category', m.category, 'locked_fields', m.locked_fields)
              from public.media m where m.id = idm.media_id),
    'candidates', case when idm.media_id is null then coalesce((
      select jsonb_agg(jsonb_build_object('media_id', m.id, 'entry_id', e.id, 'title', m.title,
               'release_year', m.release_year, 'format', m.format,
               'external_ids', (select coalesce(jsonb_agg(x.provider || ':' || x.external_id), '[]') from public.media_external_ids x where x.media_id = m.id)))
      from public.media m
      left join public.library_entries e on e.media_id = m.id
      where m.category = (r ->> 'category')::public.media_category
        and (app_private.normalize_text(m.title) = app_private.normalize_text(r ->> 'title')
             or app_private.normalize_text(m.original_title) = app_private.normalize_text(r ->> 'title')
             or exists (select 1 from public.media_titles t where t.media_id = m.id
                        and app_private.normalize_text(t.title) = app_private.normalize_text(r ->> 'title')))
        and (m.release_year is null or (r ->> 'year') is null
             or abs(m.release_year - (r ->> 'year')::integer) <= 1)
    ), '[]'::jsonb) else '[]'::jsonb end
  ) order by ord), '[]'::jsonb)
  from jsonb_array_elements(p_records) with ordinality as rec(r, ord)
  left join lateral (
    select x.media_id from jsonb_array_elements(coalesce(r -> 'external_ids', '[]')) xi
    join public.media_external_ids x on x.provider = xi ->> 'provider' and x.external_id = xi ->> 'external_id'
    limit 1
  ) idm on true
$$;

-- ---------------------------------------------------------------------------
-- import_apply: write one batch of normalized records.
-- Each record:
--   { source_key, row_number, raw, decision: 'create'|'merge'|'skip'|'invalid',
--     target_media_id?, message?, media:{...}, titles:[], genres:[], external_ids:[],
--     entry:{status, rating, episodes_watched, ...}, apply_fields:[...], sessions:[...] }
-- Rules:
--   * Re-running the same job skips source keys already recorded (resumable).
--   * Re-running the same file in a NEW job finds titles by external id and
--     creates no duplicates (idempotent).
--   * Existing personal values are changed only for fields listed in
--     apply_fields (chosen by the user in conflict resolution). Empty personal
--     fields (NULL rating/dates/notes, zero progress) are filled when
--     decision = 'merge' because that cannot lose information.
--   * Each record runs in its own subtransaction: a failing record is
--     reported as 'failed' with the error, the rest of the batch continues.
-- ---------------------------------------------------------------------------
create or replace function public.import_apply(p_job_id uuid, p_records jsonb)
returns jsonb
language plpgsql security invoker
set search_path = public
as $$
declare
  r jsonb;
  v_out jsonb := '[]';
  v_media_id uuid;
  v_entry public.library_entries;
  v_new public.library_entries;
  v_outcome text;
  v_msg text;
  v_entry_json jsonb;
  v_apply text[];
  v_patch jsonb;
  f text;
  s jsonb;
begin
  perform set_config('rubaka.suppress_activity', 'on', true);

  for r in select * from jsonb_array_elements(p_records) loop
    v_media_id := null; v_outcome := null; v_msg := r ->> 'message';
    if exists (select 1 from public.import_records ir where ir.job_id = p_job_id and ir.source_key = r ->> 'source_key') then
      v_out := v_out || jsonb_build_object('source_key', r ->> 'source_key', 'outcome', 'already_processed');
      continue;
    end if;

    if r ->> 'decision' in ('skip', 'invalid') then
      insert into public.import_records (job_id, source_key, row_number, outcome, message, raw)
      values (p_job_id, r ->> 'source_key', (r ->> 'row_number')::integer,
              case when r ->> 'decision' = 'invalid' then 'invalid' else 'skipped' end, v_msg, r -> 'raw');
      v_out := v_out || jsonb_build_object('source_key', r ->> 'source_key', 'outcome', r ->> 'decision');
      continue;
    end if;

    begin
      -- 1. Resolve the media row: explicit target > external id > new.
      v_media_id := nullif(r ->> 'target_media_id', '')::uuid;
      if v_media_id is null then
        select x.media_id into v_media_id
        from jsonb_array_elements(coalesce(r -> 'external_ids', '[]')) xi
        join public.media_external_ids x on x.provider = xi ->> 'provider' and x.external_id = xi ->> 'external_id'
        limit 1;
      end if;

      if v_media_id is null then
        insert into public.media (category, title, original_title, synopsis, format, release_date, release_year,
          end_date, release_status, country, poster_url, backdrop_url, total_episodes, total_chapters,
          total_volumes, total_seasons, total_routes, episode_duration, runtime, details, enrichment_state)
        select (r #>> '{media,category}')::public.media_category, r #>> '{media,title}', mm.original_title,
          mm.synopsis, mm.format, mm.release_date, mm.release_year, mm.end_date, mm.release_status, mm.country,
          mm.poster_url, mm.backdrop_url, mm.total_episodes, mm.total_chapters, mm.total_volumes,
          mm.total_seasons, mm.total_routes, mm.episode_duration, mm.runtime,
          coalesce(r #> '{media,details}', '{}'), 'pending'
        from jsonb_populate_record(null::public.media, (r -> 'media') - 'id' - 'category' - 'details') mm
        returning id into v_media_id;
      else
        perform app_private.merge_media_metadata(v_media_id, r -> 'media');
      end if;
      perform app_private.attach_media_extras(v_media_id, r -> 'titles', r -> 'genres', r -> 'external_ids');

      -- 2. Personal entry.
      select * into v_entry from public.library_entries where media_id = v_media_id;
      if not found then
        insert into public.library_entries (media_id, status, rating, episodes_watched, chapters_read,
          volumes_read, routes_completed, current_season, current_episode, start_date, completion_date,
          imported_repeat_count, is_favorite, wishlisted_at, wishlist_priority, notes, review, added_at, completed_at)
        select v_media_id, coalesce(ne.status, 'planning'), ne.rating, coalesce(ne.episodes_watched, 0),
          coalesce(ne.chapters_read, 0), coalesce(ne.volumes_read, 0), coalesce(ne.routes_completed, 0),
          ne.current_season, ne.current_episode, ne.start_date, ne.completion_date,
          coalesce(ne.imported_repeat_count, 0), coalesce(ne.is_favorite, false), ne.wishlisted_at,
          ne.wishlist_priority, ne.notes, ne.review, coalesce(ne.added_at, now()), null
        from jsonb_populate_record(null::public.library_entries, coalesce(r -> 'entry', '{}')) ne
        returning * into v_new;
        v_outcome := 'created';
      else
        -- Build the patch: user-approved overwrites + safe fills of empty fields.
        v_entry_json := to_jsonb(v_entry);
        v_apply := array(select jsonb_array_elements_text(coalesce(r -> 'apply_fields', '[]')));
        v_patch := '{}';
        for f in select jsonb_object_keys(coalesce(r -> 'entry', '{}')) loop
          continue when f not in ('status', 'rating', 'episodes_watched', 'chapters_read', 'volumes_read',
            'routes_completed', 'current_season', 'current_episode', 'start_date', 'completion_date',
            'imported_repeat_count', 'is_favorite', 'wishlisted_at', 'wishlist_priority', 'notes', 'review', 'added_at');
          continue when (r -> 'entry' -> f) = (v_entry_json -> f);
          if f = any (v_apply) then
            v_patch := v_patch || jsonb_build_object(f, r -> 'entry' -> f);
          elsif r ->> 'decision' = 'merge' and jsonb_typeof(r -> 'entry' -> f) <> 'null' and (
                jsonb_typeof(v_entry_json -> f) = 'null'
                or (f in ('episodes_watched', 'chapters_read', 'volumes_read', 'routes_completed', 'imported_repeat_count')
                    and (v_entry_json ->> f)::integer = 0)) then
            v_patch := v_patch || jsonb_build_object(f, r -> 'entry' -> f);
          end if;
        end loop;

        if v_patch = '{}' then
          v_outcome := 'unchanged';
          v_new := v_entry;
        else
          update public.library_entries t set
            status = x.status, rating = x.rating, episodes_watched = x.episodes_watched,
            chapters_read = x.chapters_read, volumes_read = x.volumes_read, routes_completed = x.routes_completed,
            current_season = x.current_season, current_episode = x.current_episode,
            start_date = x.start_date, completion_date = x.completion_date,
            imported_repeat_count = x.imported_repeat_count, is_favorite = x.is_favorite,
            wishlisted_at = x.wishlisted_at, wishlist_priority = x.wishlist_priority,
            notes = x.notes, review = x.review, added_at = x.added_at
          from jsonb_populate_record(v_entry, v_patch) x
          where t.id = v_entry.id
          returning t.* into v_new;
          v_outcome := 'updated';
          v_msg := coalesce(v_msg || ' ', '') || 'Changed: ' || (select string_agg(k, ', ') from jsonb_object_keys(v_patch) k);
        end if;
      end if;

      -- 3. Dated sessions provided by the source (e.g. Backloggd replays).
      --    Deduplicated by (type, start, end) so re-imports do not repeat them.
      for s in select * from jsonb_array_elements(coalesce(r -> 'sessions', '[]')) loop
        if not exists (
          select 1 from public.tracking_sessions ts where ts.entry_id = v_new.id
            and ts.session_type = (s ->> 'session_type')::public.session_type
            and ts.start_date is not distinct from (s ->> 'start_date')::date
            and ts.end_date is not distinct from (s ->> 'end_date')::date) then
          insert into public.tracking_sessions (entry_id, session_type, status, start_date, end_date, rating, notes)
          values (v_new.id, (s ->> 'session_type')::public.session_type,
                  coalesce(s ->> 'status', 'completed')::public.session_status,
                  (s ->> 'start_date')::date, (s ->> 'end_date')::date, (s ->> 'rating')::smallint, s ->> 'notes');
          if v_outcome = 'unchanged' then v_outcome := 'updated'; end if;
        end if;
      end loop;

      insert into public.import_records (job_id, source_key, row_number, outcome, entry_id, media_id, message, raw)
      values (p_job_id, r ->> 'source_key', (r ->> 'row_number')::integer, v_outcome, v_new.id, v_media_id, v_msg, r -> 'raw');
      v_out := v_out || jsonb_build_object('source_key', r ->> 'source_key', 'outcome', v_outcome,
                                           'entry_id', v_new.id, 'media_id', v_media_id);
    exception when others then
      -- The subtransaction for this record is rolled back; record the failure.
      insert into public.import_records (job_id, source_key, row_number, outcome, message, raw)
      values (p_job_id, r ->> 'source_key', (r ->> 'row_number')::integer, 'failed', sqlerrm, r -> 'raw')
      on conflict (job_id, source_key) do nothing;
      v_out := v_out || jsonb_build_object('source_key', r ->> 'source_key', 'outcome', 'failed', 'message', sqlerrm);
    end;
  end loop;
  return v_out;
end $$;

-- Close a job: compute the summary from import_records and log ONE activity
-- event (instead of thousands of "added" events).
create or replace function public.import_finish(p_job_id uuid, p_status text default null)
returns jsonb
language plpgsql security invoker
set search_path = public
as $$
declare v_summary jsonb; v_job public.import_jobs;
begin
  select coalesce(jsonb_object_agg(outcome, n), '{}') into v_summary
  from (select outcome, count(*) n from public.import_records where job_id = p_job_id group by outcome) s;
  update public.import_jobs set
    summary = summary || jsonb_build_object('outcomes', v_summary),
    status = coalesce(p_status, case when v_summary ? 'failed' then 'partial' else 'completed' end),
    finished_at = now()
  where id = p_job_id returning * into v_job;
  insert into public.activity_log (action, details)
  values ('imported', jsonb_build_object('job_id', p_job_id, 'source', v_job.source, 'file', v_job.file_name, 'outcomes', v_summary));
  return v_summary;
end $$;

-- ---------------------------------------------------------------------------
-- Enrichment
-- ---------------------------------------------------------------------------
-- Apply a provider result to one media row. Fill-only (see merge_media_metadata).
-- p: {media:{...}, titles:[], genres:[], external_ids:[], seasons:[], relations:[]}
create or replace function public.apply_enrichment(p_media_id uuid, p jsonb, p_provider text)
returns jsonb
language plpgsql security invoker
set search_path = public
as $$
declare
  v_changed text[];
  v_locked text[];
  v_had_genres boolean;
begin
  select locked_fields into v_locked from public.media where id = p_media_id;
  if not found then raise exception 'Media % not found', p_media_id; end if;
  v_changed := app_private.merge_media_metadata(p_media_id, p -> 'media');
  select exists (select 1 from public.media_genres where media_id = p_media_id) into v_had_genres;
  perform app_private.attach_media_extras(p_media_id, p -> 'titles',
    case when v_had_genres then '[]'::jsonb else p -> 'genres' end, p -> 'external_ids',
    'genres' = any (v_locked));

  insert into public.media_seasons (media_id, season_number, title, episode_count, air_date)
  select p_media_id, (x ->> 'season_number')::smallint, x ->> 'title',
         nullif((x ->> 'episode_count')::integer, 0), (x ->> 'air_date')::date
  from jsonb_array_elements(coalesce(p -> 'seasons', '[]')) x
  where (x ->> 'season_number') is not null
  on conflict (media_id, season_number) do update set
    title = coalesce(media_seasons.title, excluded.title),
    episode_count = coalesce(media_seasons.episode_count, excluded.episode_count),
    air_date = coalesce(media_seasons.air_date, excluded.air_date);

  -- Relations: link to a local media row when we already have the related work.
  insert into public.media_relations (media_id, relation_type, related_media_id, related_title,
    related_category, related_provider, related_external_id, related_poster_url)
  select p_media_id, (x ->> 'relation_type')::public.relation_type,
    (select le.media_id from public.media_external_ids le
      where le.provider = x ->> 'provider' and le.external_id = x ->> 'external_id' and le.media_id <> p_media_id),
    x ->> 'title', (x ->> 'category')::public.media_category, x ->> 'provider', x ->> 'external_id', x ->> 'poster_url'
  from jsonb_array_elements(coalesce(p -> 'relations', '[]')) x
  where x ->> 'external_id' is not null
  on conflict do nothing;

  update public.media set enrichment_state = 'matched', enriched_at = now() where id = p_media_id;
  update public.metadata_enrichment_jobs set status = 'done', last_error = null, result = jsonb_build_object('changed', v_changed)
  where media_id = p_media_id and provider = p_provider;
  return jsonb_build_object('changed', v_changed);
end $$;

-- Queue enrichment for media missing core metadata. Returns rows queued.
create or replace function public.enqueue_enrichment(p_category public.media_category default null, p_retry_failed boolean default false)
returns integer
language plpgsql security invoker
set search_path = public
as $$
declare n integer;
begin
  insert into public.metadata_enrichment_jobs (media_id, provider)
  select m.id, case
      when m.category in ('anime', 'manga') then 'anilist'
      when m.category = 'novel' and exists (select 1 from public.media_external_ids x where x.media_id = m.id and x.provider in ('mal_manga', 'anilist')) then 'anilist'
      when m.category = 'novel' then 'openlibrary'
      when m.category = 'visual_novel' then 'vndb'
      when m.category in ('movie', 'tv_series', 'animated_series') then 'tmdb'
      when m.category = 'game' then 'igdb'
    end
  from public.media m
  where (p_category is null or m.category = p_category)
    and m.enrichment_state in ('pending', 'failed', 'unresolved')
    and not m.is_custom
  on conflict (media_id, provider) do update set
    status = 'pending', attempts = 0, next_attempt_at = now()
    where p_retry_failed and metadata_enrichment_jobs.status in ('failed', 'unresolved');
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Backup restore
-- ---------------------------------------------------------------------------
-- Delete all library data (keeps settings). Requires the literal confirmation
-- string so it cannot be triggered by accident from the client.
create or replace function public.wipe_library(p_confirm text)
returns void
language plpgsql security invoker
set search_path = public
as $$
begin
  if p_confirm is distinct from 'DELETE MY LIBRARY' then
    raise exception 'Confirmation text does not match';
  end if;
  perform set_config('rubaka.suppress_activity', 'on', true);
  delete from public.activity_log;
  delete from public.metadata_enrichment_jobs;
  delete from public.import_jobs;
  delete from public.media;   -- cascades to entries, sessions, titles, ids, ...
  delete from public.genres;
  delete from public.metadata_cache;
end $$;

-- Restore rows for one table from a RUBAKA backup. Table names are
-- whitelisted; columns come from the live schema, so a backup made with fewer
-- columns still restores. user_id is always replaced by the current user.
-- Existing ids are left untouched (on conflict do nothing).
create or replace function public.restore_rows(p_table text, p_rows jsonb)
returns integer
language plpgsql security invoker
set search_path = public
as $$
declare
  v_cols text;
  v_select text;
  n integer;
begin
  if p_table not in ('media', 'media_titles', 'media_external_ids', 'media_seasons', 'media_relations',
                     'library_entries', 'entry_season_progress', 'tracking_sessions', 'vn_routes',
                     'activity_log', 'user_settings') then
    raise exception 'Table % cannot be restored', p_table;
  end if;
  perform set_config('rubaka.suppress_activity', 'on', true);

  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position),
         string_agg(case when c.column_name = 'user_id' then '(select auth.uid())' else quote_ident(c.column_name) end,
                    ', ' order by c.ordinal_position)
  into v_cols, v_select
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = p_table
    and c.is_generated = 'NEVER' and c.is_identity = 'NO'
    -- Derived counters are recomputed by triggers.
    and not (p_table = 'library_entries' and c.column_name = 'session_repeat_count');

  execute format('insert into public.%I (%s) select %s from jsonb_populate_recordset(null::public.%I, $1) on conflict do nothing',
                 p_table, v_cols, v_select, p_table)
  using p_rows;
  get diagnostics n = row_count;
  return n;
end $$;

-- Genres are restored by name (ids differ between databases).
create or replace function public.restore_media_genres(p_rows jsonb)
returns integer
language plpgsql security invoker
set search_path = public
as $$
declare n integer;
begin
  insert into public.genres (name)
  select distinct x ->> 'genre' from jsonb_array_elements(p_rows) x where x ->> 'genre' is not null
  on conflict (name) do nothing;
  insert into public.media_genres (media_id, genre_id)
  select (x ->> 'media_id')::uuid, g.id from jsonb_array_elements(p_rows) x
  join public.genres g on g.name = x ->> 'genre'
  where exists (select 1 from public.media m where m.id = (x ->> 'media_id')::uuid)
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.restore_finish(p_summary jsonb)
returns void
language sql security invoker
set search_path = public
as $$
  insert into public.activity_log (action, details) values ('restored', coalesce(p_summary, '{}'));
$$;

grant execute on function app_private.merge_media_metadata to authenticated;
grant execute on function app_private.attach_media_extras to authenticated;
do $$
declare f text;
begin
  foreach f in array array['import_match', 'import_apply', 'import_finish', 'apply_enrichment', 'enqueue_enrichment',
                           'wipe_library', 'restore_rows', 'restore_media_genres', 'restore_finish'] loop
    execute format('revoke execute on function public.%I from anon, public', f);
    execute format('grant execute on function public.%I to authenticated', f);
  end loop;
end $$;
revoke execute on function public.library_query from public;
revoke execute on function public.library_facets from public;
revoke execute on function public.dashboard_summary from public;
revoke execute on function public.library_stats from public;


-- ===== 20261019000004_storage.sql =====
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


-- ===== 20261019000005_create_media_entry.sql =====
-- RUBAKA — atomic creation of a title + library entry (Add Media / custom entries).
-- If any supplied external id already exists, the existing title is reused and
-- nothing is duplicated (an entry is created for it only if missing).
create or replace function public.create_media_entry(
  p_media jsonb,
  p_entry jsonb default '{}',
  p_titles jsonb default '[]',
  p_genres jsonb default '[]',
  p_external_ids jsonb default '[]',
  p_seasons jsonb default '[]',
  p_relations jsonb default '[]',
  p_is_custom boolean default false,
  p_enriched boolean default false
)
returns jsonb
language plpgsql security invoker
set search_path = public
as $$
declare
  v_media_id uuid;
  v_entry_id uuid;
  v_existing boolean := false;
begin
  select x.media_id into v_media_id
  from jsonb_array_elements(coalesce(p_external_ids, '[]')) xi
  join public.media_external_ids x on x.provider = xi ->> 'provider' and x.external_id = xi ->> 'external_id'
  limit 1;

  if v_media_id is not null then
    v_existing := true;
  else
    insert into public.media (category, title, original_title, synopsis, format, release_date, release_year,
      end_date, release_status, country, poster_url, backdrop_url, custom_poster_path, custom_backdrop_path,
      total_episodes, total_chapters, total_volumes, total_seasons, total_routes, episode_duration, runtime,
      details, is_custom, enrichment_state, enriched_at, locked_fields)
    select (p_media ->> 'category')::public.media_category, btrim(p_media ->> 'title'), nullif(btrim(mm.original_title), ''),
      nullif(btrim(mm.synopsis), ''), mm.format, mm.release_date, coalesce(mm.release_year, extract(year from mm.release_date)::smallint),
      mm.end_date, mm.release_status, mm.country, mm.poster_url, mm.backdrop_url, mm.custom_poster_path, mm.custom_backdrop_path,
      mm.total_episodes, mm.total_chapters, mm.total_volumes, mm.total_seasons, mm.total_routes, mm.episode_duration, mm.runtime,
      coalesce(p_media -> 'details', '{}'), p_is_custom,
      case when p_enriched then 'matched' when p_is_custom then 'skipped' else 'pending' end::public.enrichment_state,
      case when p_enriched then now() end,
      -- Everything typed by hand in a custom entry is protected from enrichment.
      case when p_is_custom then array(select k from jsonb_object_keys(p_media) k where k not in ('category', 'details')) else '{}' end
    from jsonb_populate_record(null::public.media, p_media - 'category' - 'details' - 'title') mm
    returning id into v_media_id;

    perform app_private.attach_media_extras(v_media_id, p_titles, p_genres, p_external_ids);

    insert into public.media_seasons (media_id, season_number, title, episode_count, air_date)
    select v_media_id, (x ->> 'season_number')::smallint, x ->> 'title', nullif((x ->> 'episode_count')::integer, 0), (x ->> 'air_date')::date
    from jsonb_array_elements(coalesce(p_seasons, '[]')) x where x ->> 'season_number' is not null
    on conflict do nothing;

    insert into public.media_relations (media_id, relation_type, related_media_id, related_title, related_category,
      related_provider, related_external_id, related_poster_url)
    select v_media_id, (x ->> 'relation_type')::public.relation_type,
      (select le.media_id from public.media_external_ids le where le.provider = x ->> 'provider' and le.external_id = x ->> 'external_id' and le.media_id <> v_media_id),
      x ->> 'title', (x ->> 'category')::public.media_category, x ->> 'provider', x ->> 'external_id', x ->> 'poster_url'
    from jsonb_array_elements(coalesce(p_relations, '[]')) x where x ->> 'external_id' is not null
    on conflict do nothing;
  end if;

  select id into v_entry_id from public.library_entries where media_id = v_media_id;
  if v_entry_id is null then
    insert into public.library_entries (media_id, status, rating, episodes_watched, chapters_read, volumes_read,
      routes_completed, start_date, completion_date, is_favorite, wishlisted_at, wishlist_priority, notes)
    select v_media_id, coalesce(ne.status, 'planning'), ne.rating, coalesce(ne.episodes_watched, 0), coalesce(ne.chapters_read, 0),
      coalesce(ne.volumes_read, 0), coalesce(ne.routes_completed, 0), ne.start_date, ne.completion_date,
      coalesce(ne.is_favorite, false), ne.wishlisted_at, ne.wishlist_priority, ne.notes
    from jsonb_populate_record(null::public.library_entries, coalesce(p_entry, '{}')) ne
    returning id into v_entry_id;
  end if;

  return jsonb_build_object('media_id', v_media_id, 'entry_id', v_entry_id, 'existing', v_existing);
end $$;

revoke execute on function public.create_media_entry from anon, public;
grant execute on function public.create_media_entry to authenticated;

-- Apply many enrichment results in one round trip. Each item is processed in
-- its own subtransaction so one bad payload does not abort the batch.
-- items: [{media_id, provider, payload}]
create or replace function public.apply_enrichment_batch(p_items jsonb)
returns jsonb
language plpgsql security invoker
set search_path = public
as $$
declare
  it jsonb;
  v_out jsonb := '[]';
  v_res jsonb;
begin
  for it in select * from jsonb_array_elements(p_items) loop
    begin
      v_res := public.apply_enrichment((it ->> 'media_id')::uuid, it -> 'payload', it ->> 'provider');
      v_out := v_out || jsonb_build_object('media_id', it ->> 'media_id', 'ok', true, 'changed', v_res -> 'changed');
    exception when others then
      update public.metadata_enrichment_jobs set status = 'failed', attempts = attempts + 1, last_error = sqlerrm,
        next_attempt_at = now() + make_interval(mins => power(2, least(attempts + 1, 6))::int)
      where media_id = (it ->> 'media_id')::uuid and provider = it ->> 'provider';
      v_out := v_out || jsonb_build_object('media_id', it ->> 'media_id', 'ok', false, 'error', sqlerrm);
    end;
  end loop;
  return v_out;
end $$;
revoke execute on function public.apply_enrichment_batch from anon, public;
grant execute on function public.apply_enrichment_batch to authenticated;


-- ===== 20261020000006_bulk_update.sql =====
-- RUBAKA — bulk updates with an explicit "historical" mode.
-- Marking many titles as completed that were finished long ago must not
-- invent history: in historical mode completed_at stays NULL (date unknown)
-- and no activity events are logged.

create or replace function app_private.validate_entry()
returns trigger language plpgsql set search_path = '' as $$
declare m record;
begin
  select total_episodes, total_chapters, total_volumes, total_routes into m
  from public.media where id = new.media_id;
  if m.total_episodes is not null and new.episodes_watched > m.total_episodes then
    raise exception 'Episodes watched (%) exceed the total (%)', new.episodes_watched, m.total_episodes
      using errcode = 'check_violation';
  end if;
  if m.total_chapters is not null and new.chapters_read > m.total_chapters then
    raise exception 'Chapters read (%) exceed the total (%)', new.chapters_read, m.total_chapters
      using errcode = 'check_violation';
  end if;
  if m.total_volumes is not null and new.volumes_read > m.total_volumes then
    raise exception 'Volumes read (%) exceed the total (%)', new.volumes_read, m.total_volumes
      using errcode = 'check_violation';
  end if;
  if m.total_routes is not null and new.routes_completed > m.total_routes then
    raise exception 'Routes completed (%) exceed the total (%)', new.routes_completed, m.total_routes
      using errcode = 'check_violation';
  end if;

  if tg_op = 'UPDATE' then
    new.updated_at := now();
    -- completed_at records *when* a title was completed in the app. Historical
    -- bulk updates leave it unknown instead of stamping today's date.
    if new.status = 'completed' and old.status is distinct from 'completed' and new.completed_at is null
       and coalesce(current_setting('rubaka.historical', true), '') <> 'on' then
      new.completed_at := now();
    end if;
    if (new.status, new.rating, new.episodes_watched, new.chapters_read, new.volumes_read,
        new.routes_completed, new.endings_completed, new.is_favorite, new.wishlisted_at,
        new.session_repeat_count, new.notes, new.review)
       is distinct from
       (old.status, old.rating, old.episodes_watched, old.chapters_read, old.volumes_read,
        old.routes_completed, old.endings_completed, old.is_favorite, old.wishlisted_at,
        old.session_repeat_count, old.notes, old.review)
       and coalesce(current_setting('rubaka.historical', true), '') <> 'on' then
      new.last_activity_at := now();
    end if;
  end if;
  if new.wishlisted_at is null then
    new.wishlist_priority := null;
  end if;
  return new;
end $$;

-- Update many entries in one statement (all or nothing).
--   p_patch: any of {status, wishlisted_at, is_favorite}
--   p_fill_progress: raise progress to the known total (never above, never down;
--     unknown totals are left alone)
--   p_historical: no activity events, no completed_at / last_activity stamp
create or replace function public.bulk_update_entries(
  p_entry_ids uuid[], p_patch jsonb, p_fill_progress boolean default false, p_historical boolean default false)
returns integer
language plpgsql security invoker
set search_path = public
as $$
declare n integer;
begin
  if p_historical then
    perform set_config('rubaka.suppress_activity', 'on', true);
    perform set_config('rubaka.historical', 'on', true);
  end if;
  update public.library_entries e set
    status = coalesce((p_patch ->> 'status')::public.library_status, e.status),
    wishlisted_at = case when p_patch ? 'wishlisted_at' then (p_patch ->> 'wishlisted_at')::timestamptz else e.wishlisted_at end,
    is_favorite = case when p_patch ? 'is_favorite' then (p_patch ->> 'is_favorite')::boolean else e.is_favorite end,
    episodes_watched = case when p_fill_progress and m.total_episodes > e.episodes_watched then m.total_episodes else e.episodes_watched end,
    chapters_read = case when p_fill_progress and m.total_chapters > e.chapters_read then m.total_chapters else e.chapters_read end,
    volumes_read = case when p_fill_progress and m.total_volumes > e.volumes_read then m.total_volumes else e.volumes_read end,
    routes_completed = case when p_fill_progress and m.total_routes > e.routes_completed then m.total_routes else e.routes_completed end
  from public.media m
  where m.id = e.media_id and e.id = any (p_entry_ids);
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.bulk_update_entries from anon, public;
grant execute on function public.bulk_update_entries to authenticated;


-- ===== 20261020000007_vndb_import_source.sql =====
-- RUBAKA — allow VNDB (API) as an import source. Idempotent.
alter table public.import_jobs drop constraint if exists import_jobs_source_check;
alter table public.import_jobs add constraint import_jobs_source_check
  check (source in ('imdb_csv', 'mal_xml', 'backloggd_json', 'vndb_api', 'rubaka_backup', 'other'));


-- ===== 20261020000008_completed_means_all_episodes.sql =====
-- RUBAKA — for episodic media (anime, TV series, animated series), "Completed"
-- means every episode was watched. Whenever the total is known:
--   * an entry set to (or kept at) Completed has episodes_watched = total;
--   * when the total becomes known later (metadata enrichment), completed
--     entries are brought up to it;
--   * existing completed entries are fixed once (backfill below).
-- These automatic corrections are "historical": no activity events and no
-- last_activity_at bump. Manga/novels are not affected (a completed manga can
-- legitimately have unread chapters in imported data).

create or replace function app_private.validate_entry()
returns trigger language plpgsql set search_path = '' as $$
declare m record;
begin
  select category, total_episodes, total_chapters, total_volumes, total_routes into m
  from public.media where id = new.media_id;

  if new.status = 'completed' and m.total_episodes is not null and new.episodes_watched < m.total_episodes
     and m.category in ('anime', 'tv_series', 'animated_series') then
    new.episodes_watched := m.total_episodes;
  end if;

  if m.total_episodes is not null and new.episodes_watched > m.total_episodes then
    raise exception 'Episodes watched (%) exceed the total (%)', new.episodes_watched, m.total_episodes
      using errcode = 'check_violation';
  end if;
  if m.total_chapters is not null and new.chapters_read > m.total_chapters then
    raise exception 'Chapters read (%) exceed the total (%)', new.chapters_read, m.total_chapters
      using errcode = 'check_violation';
  end if;
  if m.total_volumes is not null and new.volumes_read > m.total_volumes then
    raise exception 'Volumes read (%) exceed the total (%)', new.volumes_read, m.total_volumes
      using errcode = 'check_violation';
  end if;
  if m.total_routes is not null and new.routes_completed > m.total_routes then
    raise exception 'Routes completed (%) exceed the total (%)', new.routes_completed, m.total_routes
      using errcode = 'check_violation';
  end if;

  if tg_op = 'UPDATE' then
    new.updated_at := now();
    if new.status = 'completed' and old.status is distinct from 'completed' and new.completed_at is null
       and coalesce(current_setting('rubaka.historical', true), '') <> 'on' then
      new.completed_at := now();
    end if;
    if (new.status, new.rating, new.episodes_watched, new.chapters_read, new.volumes_read,
        new.routes_completed, new.endings_completed, new.is_favorite, new.wishlisted_at,
        new.session_repeat_count, new.notes, new.review)
       is distinct from
       (old.status, old.rating, old.episodes_watched, old.chapters_read, old.volumes_read,
        old.routes_completed, old.endings_completed, old.is_favorite, old.wishlisted_at,
        old.session_repeat_count, old.notes, old.review)
       and coalesce(current_setting('rubaka.historical', true), '') <> 'on' then
      new.last_activity_at := now();
    end if;
  end if;
  if new.wishlisted_at is null then
    new.wishlist_priority := null;
  end if;
  return new;
end $$;

-- When a total episode count appears or grows, completed entries follow it.
create or replace function app_private.media_total_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_suppress text := coalesce(current_setting('rubaka.suppress_activity', true), '');
  v_historical text := coalesce(current_setting('rubaka.historical', true), '');
begin
  if new.total_episodes is not null and new.total_episodes is distinct from old.total_episodes
     and new.category in ('anime', 'tv_series', 'animated_series') then
    perform set_config('rubaka.suppress_activity', 'on', true);
    perform set_config('rubaka.historical', 'on', true);
    update public.library_entries
    set episodes_watched = new.total_episodes
    where media_id = new.id and status = 'completed' and episodes_watched < new.total_episodes;
    -- Restore the caller's settings for the rest of the transaction.
    perform set_config('rubaka.suppress_activity', v_suppress, true);
    perform set_config('rubaka.historical', v_historical, true);
  end if;
  return null;
end $$;

drop trigger if exists media_total_sync on public.media;
create trigger media_total_sync after update of total_episodes on public.media
  for each row execute function app_private.media_total_changed();

-- One-time backfill of entries that are already completed.
do $$
begin
  perform set_config('rubaka.suppress_activity', 'on', true);
  perform set_config('rubaka.historical', 'on', true);
  update public.library_entries e
  set episodes_watched = m.total_episodes
  from public.media m
  where m.id = e.media_id and e.status = 'completed' and m.total_episodes is not null
    and e.episodes_watched < m.total_episodes and m.category in ('anime', 'tv_series', 'animated_series');
end $$;


-- ===== 20261020000009_time_spent.sql =====
-- RUBAKA — time spent (owner request; replaces the original "no time tracking" rule).
-- Estimated like MyAnimeList / Shikimori:
--   episodic (anime, TV, animated):
--     (episodes_watched + repeat_count × total_episodes) × episode_duration
--   movies: (1 if watched + repeat_count) × runtime
--   games:  (1 if completed + repeat_count) × time to beat (IGDB "normally", minutes)
--   visual novels: (1 if completed + repeat_count) × VNDB length (vote average or class midpoint)
-- A manual value (library_entries.time_spent_minutes) always wins, e.g. your
-- real hours played. Manga and novels have no estimate (manual only).

alter table public.library_entries
  add column if not exists time_spent_minutes integer check (time_spent_minutes >= 0);

create or replace function app_private.estimated_minutes(m public.media, e public.library_entries)
returns integer language sql immutable set search_path = '' as $$
  select case
    when m.category in ('anime', 'tv_series', 'animated_series') and m.episode_duration is not null then
      (e.episodes_watched + e.repeat_count * coalesce(m.total_episodes, e.episodes_watched)) * m.episode_duration
    when m.category = 'movie' and m.runtime is not null then
      ((case when e.status = 'completed' then 1 else 0 end) + e.repeat_count) * m.runtime
    when m.category = 'game' and (m.details ->> 'time_to_beat_minutes') is not null then
      ((case when e.status = 'completed' then 1 else 0 end) + e.repeat_count) * (m.details ->> 'time_to_beat_minutes')::integer
    -- VNDB length: average of player votes, or the middle of its length class.
    when m.category = 'visual_novel' and (m.details ->> 'length_minutes') is not null then
      ((case when e.status = 'completed' then 1 else 0 end) + e.repeat_count) * (m.details ->> 'length_minutes')::integer
  end
$$;

-- Per-category totals for the Statistics page.
--   minutes: manual values + estimates
--   counted: entries that contributed; missing: entries with progress but no duration known
create or replace function public.time_stats()
returns jsonb
language sql stable security invoker
set search_path = public
as $$
  with t as (
    select m.category,
           coalesce(e.time_spent_minutes, app_private.estimated_minutes(m, e)) as minutes,
           e.time_spent_minutes is not null as manual,
           (e.episodes_watched > 0 or e.status = 'completed') as has_progress
    from public.library_entries e join public.media m on m.id = e.media_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'category', category, 'minutes', minutes, 'counted', counted, 'manual', manual, 'missing', missing) order by category), '[]'::jsonb)
  from (
    select category,
           coalesce(sum(minutes), 0)::bigint as minutes,
           count(*) filter (where minutes is not null and minutes > 0) as counted,
           count(*) filter (where manual) as manual,
           count(*) filter (where minutes is null and has_progress) as missing
    from t group by category
  ) s
$$;

grant execute on function app_private.estimated_minutes to authenticated;
revoke execute on function public.time_stats from anon, public;
grant execute on function public.time_stats to authenticated;

-- import_apply: same as before, plus time_spent_minutes (e.g. Backloggd hours played).
create or replace function public.import_apply(p_job_id uuid, p_records jsonb)
returns jsonb
language plpgsql security invoker
set search_path = public
as $$
declare
  r jsonb;
  v_out jsonb := '[]';
  v_media_id uuid;
  v_entry public.library_entries;
  v_new public.library_entries;
  v_outcome text;
  v_msg text;
  v_entry_json jsonb;
  v_apply text[];
  v_patch jsonb;
  f text;
  s jsonb;
begin
  perform set_config('rubaka.suppress_activity', 'on', true);

  for r in select * from jsonb_array_elements(p_records) loop
    v_media_id := null; v_outcome := null; v_msg := r ->> 'message';
    if exists (select 1 from public.import_records ir where ir.job_id = p_job_id and ir.source_key = r ->> 'source_key') then
      v_out := v_out || jsonb_build_object('source_key', r ->> 'source_key', 'outcome', 'already_processed');
      continue;
    end if;

    if r ->> 'decision' in ('skip', 'invalid') then
      insert into public.import_records (job_id, source_key, row_number, outcome, message, raw)
      values (p_job_id, r ->> 'source_key', (r ->> 'row_number')::integer,
              case when r ->> 'decision' = 'invalid' then 'invalid' else 'skipped' end, v_msg, r -> 'raw');
      v_out := v_out || jsonb_build_object('source_key', r ->> 'source_key', 'outcome', r ->> 'decision');
      continue;
    end if;

    begin
      -- 1. Resolve the media row: explicit target > external id > new.
      v_media_id := nullif(r ->> 'target_media_id', '')::uuid;
      if v_media_id is null then
        select x.media_id into v_media_id
        from jsonb_array_elements(coalesce(r -> 'external_ids', '[]')) xi
        join public.media_external_ids x on x.provider = xi ->> 'provider' and x.external_id = xi ->> 'external_id'
        limit 1;
      end if;

      if v_media_id is null then
        insert into public.media (category, title, original_title, synopsis, format, release_date, release_year,
          end_date, release_status, country, poster_url, backdrop_url, total_episodes, total_chapters,
          total_volumes, total_seasons, total_routes, episode_duration, runtime, details, enrichment_state)
        select (r #>> '{media,category}')::public.media_category, r #>> '{media,title}', mm.original_title,
          mm.synopsis, mm.format, mm.release_date, mm.release_year, mm.end_date, mm.release_status, mm.country,
          mm.poster_url, mm.backdrop_url, mm.total_episodes, mm.total_chapters, mm.total_volumes,
          mm.total_seasons, mm.total_routes, mm.episode_duration, mm.runtime,
          coalesce(r #> '{media,details}', '{}'), 'pending'
        from jsonb_populate_record(null::public.media, (r -> 'media') - 'id' - 'category' - 'details') mm
        returning id into v_media_id;
      else
        perform app_private.merge_media_metadata(v_media_id, r -> 'media');
      end if;
      perform app_private.attach_media_extras(v_media_id, r -> 'titles', r -> 'genres', r -> 'external_ids');

      -- 2. Personal entry.
      select * into v_entry from public.library_entries where media_id = v_media_id;
      if not found then
        insert into public.library_entries (media_id, status, rating, episodes_watched, chapters_read,
          volumes_read, routes_completed, current_season, current_episode, start_date, completion_date,
          imported_repeat_count, is_favorite, wishlisted_at, wishlist_priority, notes, review, added_at, completed_at, time_spent_minutes)
        select v_media_id, coalesce(ne.status, 'planning'), ne.rating, coalesce(ne.episodes_watched, 0),
          coalesce(ne.chapters_read, 0), coalesce(ne.volumes_read, 0), coalesce(ne.routes_completed, 0),
          ne.current_season, ne.current_episode, ne.start_date, ne.completion_date,
          coalesce(ne.imported_repeat_count, 0), coalesce(ne.is_favorite, false), ne.wishlisted_at,
          ne.wishlist_priority, ne.notes, ne.review, coalesce(ne.added_at, now()), null, ne.time_spent_minutes
        from jsonb_populate_record(null::public.library_entries, coalesce(r -> 'entry', '{}')) ne
        returning * into v_new;
        v_outcome := 'created';
      else
        -- Build the patch: user-approved overwrites + safe fills of empty fields.
        v_entry_json := to_jsonb(v_entry);
        v_apply := array(select jsonb_array_elements_text(coalesce(r -> 'apply_fields', '[]')));
        v_patch := '{}';
        for f in select jsonb_object_keys(coalesce(r -> 'entry', '{}')) loop
          continue when f not in ('status', 'rating', 'episodes_watched', 'chapters_read', 'volumes_read',
            'routes_completed', 'current_season', 'current_episode', 'start_date', 'completion_date',
            'imported_repeat_count', 'is_favorite', 'wishlisted_at', 'wishlist_priority', 'notes', 'review', 'added_at', 'time_spent_minutes');
          continue when (r -> 'entry' -> f) = (v_entry_json -> f);
          if f = any (v_apply) then
            v_patch := v_patch || jsonb_build_object(f, r -> 'entry' -> f);
          elsif r ->> 'decision' = 'merge' and jsonb_typeof(r -> 'entry' -> f) <> 'null' and (
                jsonb_typeof(v_entry_json -> f) = 'null'
                or (f in ('episodes_watched', 'chapters_read', 'volumes_read', 'routes_completed', 'imported_repeat_count')
                    and (v_entry_json ->> f)::integer = 0)) then
            v_patch := v_patch || jsonb_build_object(f, r -> 'entry' -> f);
          end if;
        end loop;

        if v_patch = '{}' then
          v_outcome := 'unchanged';
          v_new := v_entry;
        else
          update public.library_entries t set
            status = x.status, rating = x.rating, episodes_watched = x.episodes_watched,
            chapters_read = x.chapters_read, volumes_read = x.volumes_read, routes_completed = x.routes_completed,
            current_season = x.current_season, current_episode = x.current_episode,
            start_date = x.start_date, completion_date = x.completion_date,
            imported_repeat_count = x.imported_repeat_count, is_favorite = x.is_favorite,
            wishlisted_at = x.wishlisted_at, wishlist_priority = x.wishlist_priority,
            notes = x.notes, review = x.review, added_at = x.added_at, time_spent_minutes = x.time_spent_minutes
          from jsonb_populate_record(v_entry, v_patch) x
          where t.id = v_entry.id
          returning t.* into v_new;
          v_outcome := 'updated';
          v_msg := coalesce(v_msg || ' ', '') || 'Changed: ' || (select string_agg(k, ', ') from jsonb_object_keys(v_patch) k);
        end if;
      end if;

      -- 3. Dated sessions provided by the source (e.g. Backloggd replays).
      --    Deduplicated by (type, start, end) so re-imports do not repeat them.
      for s in select * from jsonb_array_elements(coalesce(r -> 'sessions', '[]')) loop
        if not exists (
          select 1 from public.tracking_sessions ts where ts.entry_id = v_new.id
            and ts.session_type = (s ->> 'session_type')::public.session_type
            and ts.start_date is not distinct from (s ->> 'start_date')::date
            and ts.end_date is not distinct from (s ->> 'end_date')::date) then
          insert into public.tracking_sessions (entry_id, session_type, status, start_date, end_date, rating, notes)
          values (v_new.id, (s ->> 'session_type')::public.session_type,
                  coalesce(s ->> 'status', 'completed')::public.session_status,
                  (s ->> 'start_date')::date, (s ->> 'end_date')::date, (s ->> 'rating')::smallint, s ->> 'notes');
          if v_outcome = 'unchanged' then v_outcome := 'updated'; end if;
        end if;
      end loop;

      insert into public.import_records (job_id, source_key, row_number, outcome, entry_id, media_id, message, raw)
      values (p_job_id, r ->> 'source_key', (r ->> 'row_number')::integer, v_outcome, v_new.id, v_media_id, v_msg, r -> 'raw');
      v_out := v_out || jsonb_build_object('source_key', r ->> 'source_key', 'outcome', v_outcome,
                                           'entry_id', v_new.id, 'media_id', v_media_id);
    exception when others then
      -- The subtransaction for this record is rolled back; record the failure.
      insert into public.import_records (job_id, source_key, row_number, outcome, message, raw)
      values (p_job_id, r ->> 'source_key', (r ->> 'row_number')::integer, 'failed', sqlerrm, r -> 'raw')
      on conflict (job_id, source_key) do nothing;
      v_out := v_out || jsonb_build_object('source_key', r ->> 'source_key', 'outcome', 'failed', 'message', sqlerrm);
    end;
  end loop;
  return v_out;
end $$;


-- ===== 20261020000010_reading_time.sql =====
-- RUBAKA — rough reading-time estimates (owner request):
--   manga:  chapter ≈ 9.23 min (calibrated: matches the owner's MyAnimeList manga "Days" exactly — 21,583 chapters = 138.4 days)
--   novels: volume ≈ 210 min (≈ 50k words at ~250 wpm); without volumes, chapter ≈ 15 min
-- Repeats add another full read (total if known, otherwise what was read).
-- A manual time_spent_minutes still always wins.
create or replace function app_private.estimated_minutes(m public.media, e public.library_entries)
returns integer language sql immutable set search_path = '' as $$
  select case
    when m.category in ('anime', 'tv_series', 'animated_series') and m.episode_duration is not null then
      (e.episodes_watched + e.repeat_count * coalesce(m.total_episodes, e.episodes_watched)) * m.episode_duration
    when m.category = 'movie' and m.runtime is not null then
      ((case when e.status = 'completed' then 1 else 0 end) + e.repeat_count) * m.runtime
    when m.category = 'game' and (m.details ->> 'time_to_beat_minutes') is not null then
      ((case when e.status = 'completed' then 1 else 0 end) + e.repeat_count) * (m.details ->> 'time_to_beat_minutes')::integer
    when m.category = 'visual_novel' and (m.details ->> 'length_minutes') is not null then
      ((case when e.status = 'completed' then 1 else 0 end) + e.repeat_count) * (m.details ->> 'length_minutes')::integer
    when m.category = 'manga' then
      nullif(round((e.chapters_read + e.repeat_count * coalesce(m.total_chapters, e.chapters_read)) * 9.23)::integer, 0)
    when m.category = 'novel' and e.volumes_read > 0 then
      (e.volumes_read + e.repeat_count * coalesce(m.total_volumes, e.volumes_read)) * 210
    when m.category = 'novel' then
      nullif((e.chapters_read + e.repeat_count * coalesce(m.total_chapters, e.chapters_read)) * 15, 0)
  end
$$;


-- ===== 20261020000011_backup_view.sql =====
-- RUBAKA — flat genre list for server-side backups (media_id, genre name),
-- in the same shape as tables.media_genres in a RUBAKA backup file.
create or replace view public.media_genres_named
with (security_invoker = true) as
  select mg.media_id, g.name as genre
  from public.media_genres mg join public.genres g on g.id = mg.genre_id;

revoke all on public.media_genres_named from anon;
grant select on public.media_genres_named to authenticated;
