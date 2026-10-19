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
