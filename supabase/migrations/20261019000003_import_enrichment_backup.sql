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
