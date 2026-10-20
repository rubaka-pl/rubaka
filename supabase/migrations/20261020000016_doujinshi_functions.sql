-- RUBAKA — Doujinshi category rules (after 20261020000015 is committed).
--   * formats: doujinshi / one shot / other; read once = "completed";
--   * repeats are rereads; reading time ≈ 0.5 min per page (details.pages);
--   * a public share link never shows Doujinshi unless it was ticked explicitly.

create or replace function app_private.valid_format(p_category public.media_category, p_format text)
returns boolean
language sql immutable
set search_path = ''
as $$
  select p_format is null or p_format = any (case p_category
    when 'anime' then array['tv', 'tv_short', 'movie', 'ova', 'ona', 'special', 'music', 'other']
    when 'manga' then array['manga', 'manhwa', 'manhua', 'webtoon', 'one_shot', 'doujinshi', 'other']
    when 'doujinshi' then array['doujinshi', 'one_shot', 'artist_cg', 'other']
    when 'novel' then array['light_novel', 'web_novel', 'novel', 'short_story', 'other']
    when 'visual_novel' then array['visual_novel', 'kinetic_novel', 'other']
    when 'movie' then array['movie', 'tv_movie', 'short', 'video', 'special', 'other']
    when 'tv_series' then array['series', 'mini_series', 'special', 'other']
    when 'animated_series' then array['series', 'mini_series', 'special', 'other']
    when 'game' then array['game', 'dlc', 'expansion', 'remake', 'remaster', 'other']
  end)
$$;

create or replace function app_private.validate_session()
returns trigger language plpgsql set search_path = '' as $$
declare v_cat public.media_category;
begin
  select m.category into v_cat from public.library_entries e join public.media m on m.id = e.media_id
  where e.id = new.entry_id;
  if new.session_type <> (case
      when v_cat in ('manga', 'novel', 'doujinshi') then 'reread'
      when v_cat in ('visual_novel', 'game') then 'replay'
      else 'rewatch' end)::public.session_type then
    raise exception 'Session type % does not match category %', new.session_type, v_cat
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

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
    when m.category = 'doujinshi' and (m.details ->> 'pages') is not null then
      nullif(round(((case when e.status = 'completed' then 1 else 0 end) + e.repeat_count) * (m.details ->> 'pages')::integer * 0.5)::integer, 0)
    when m.category = 'novel' and e.volumes_read > 0 then
      (e.volumes_read + e.repeat_count * coalesce(m.total_volumes, e.volumes_read)) * 210
    when m.category = 'novel' then
      nullif((e.chapters_read + e.repeat_count * coalesce(m.total_chapters, e.chapters_read)) * 15, 0)
  end
$$;

-- Which categories a link shows: the ticked ones, or everything except Doujinshi.
create or replace function app_private.link_shows(p_link public.share_links, p_category public.media_category)
returns boolean language sql immutable set search_path = '' as $$
  select case when p_link.categories is null then p_category <> 'doujinshi' else p_category = any (p_link.categories) end
$$;
revoke execute on function app_private.link_shows(public.share_links, public.media_category) from public, anon, authenticated;

create or replace function public.public_profile(p_token text)
returns jsonb
language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_link public.share_links;
  v_cats jsonb;
  v_fav jsonb;
  v_recent jsonb;
begin
  select * into v_link from public.share_links where token = p_token;
  if not found then return null; end if;

  select coalesce(jsonb_agg(x order by x->>'category'), '[]'::jsonb) into v_cats from (
    select jsonb_build_object(
      'category', m.category,
      'total', count(*),
      'completed', count(*) filter (where e.status = 'completed'),
      'in_progress', count(*) filter (where e.status = 'in_progress'),
      'planning', count(*) filter (where e.status = 'planning'),
      'on_hold', count(*) filter (where e.status = 'on_hold'),
      'dropped', count(*) filter (where e.status = 'dropped'),
      'avg_rating', case when v_link.show_ratings then round(avg(e.rating) / 2.0, 2) end
    ) as x
    from public.library_entries e join public.media m on m.id = e.media_id
    where e.user_id = v_link.user_id and app_private.link_shows(v_link, m.category)
    group by m.category) s;

  select jsonb_agg(to_jsonb(q)) into v_fav from public.library_query(p_favorite => true, p_sort => 'rating_desc', p_limit => 60) q
    where app_private.link_shows(v_link, q.category);
  select jsonb_agg(to_jsonb(q)) into v_recent from public.library_query(p_statuses => array['completed']::public.library_status[], p_sort => 'completed_desc', p_limit => 40) q
    where app_private.link_shows(v_link, q.category);

  return jsonb_build_object(
    'show_ratings', v_link.show_ratings,
    'categories', v_cats,
    'favorites', app_private.public_items(v_link, coalesce(v_fav, '[]'::jsonb)),
    'recent', app_private.public_items(v_link, coalesce(v_recent, '[]'::jsonb)));
end $$;

create or replace function public.public_library(
  p_token text,
  p_category public.media_category,
  p_status public.library_status default null,
  p_sort text default 'rating_desc',
  p_search text default null,
  p_limit integer default 60,
  p_offset integer default 0
)
returns jsonb
language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_link public.share_links;
  v_rows jsonb;
  v_total bigint;
begin
  select * into v_link from public.share_links where token = p_token;
  if not found then return null; end if;
  if not app_private.link_shows(v_link, p_category) then return null; end if;
  if p_sort not in ('rating_desc', 'title_asc', 'release_desc', 'release_asc', 'completed_desc', 'added_desc') then p_sort := 'title_asc'; end if;
  if not v_link.show_ratings and p_sort = 'rating_desc' then p_sort := 'title_asc'; end if;

  select jsonb_agg(to_jsonb(q)), max(q.total_count) into v_rows, v_total
  from public.library_query(
    p_category => p_category,
    p_statuses => case when p_status is null then null else array[p_status] end,
    p_search => p_search, p_sort => p_sort, p_limit => least(greatest(p_limit, 1), 120), p_offset => greatest(p_offset, 0)) q;

  return jsonb_build_object('total', coalesce(v_total, 0), 'items', app_private.public_items(v_link, coalesce(v_rows, '[]'::jsonb)));
end $$;

-- Doujinshi have no metadata provider (data comes with the nhentai import): never queue them.
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
    and m.category <> 'doujinshi'
    and m.enrichment_state in ('pending', 'failed', 'unresolved')
    and not m.is_custom
  on conflict (media_id, provider) do update set
    status = 'pending', attempts = 0, next_attempt_at = now()
    where p_retry_failed and metadata_enrichment_jobs.status in ('failed', 'unresolved');
  get diagnostics n = row_count;
  return n;
end $$;
