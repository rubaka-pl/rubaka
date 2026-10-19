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
