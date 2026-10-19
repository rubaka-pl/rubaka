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
