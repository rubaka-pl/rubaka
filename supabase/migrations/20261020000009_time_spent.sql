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
