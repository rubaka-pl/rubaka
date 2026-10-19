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
