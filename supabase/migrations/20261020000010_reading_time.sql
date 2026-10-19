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
