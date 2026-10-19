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
