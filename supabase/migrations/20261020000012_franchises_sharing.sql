-- RUBAKA — franchises (groups of titles across every category) and a public,
-- read-only share link.

-- ---------------------------------------------------------------------------
-- Franchises
-- ---------------------------------------------------------------------------
create table public.franchises (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  -- External grouping key ('tmdb_collection:10', 'igdb_franchise:3'); NULL for
  -- groups found through relations or made by hand.
  source text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A title belongs to at most one franchise. Removing it by hand locks the
-- field ('franchise_id' in locked_fields) so detection never re-adds it.
alter table public.media add column franchise_id uuid references public.franchises (id) on delete set null;
create index media_franchise_idx on public.media (franchise_id) where franchise_id is not null;

create trigger franchises_touch before update on public.franchises
  for each row execute function app_private.touch_updated_at();

alter table public.franchises enable row level security;
create policy owner_all on public.franchises for all to authenticated
  using ((select app_private.is_owner())) with check ((select app_private.is_owner()));
revoke all on public.franchises from anon;
grant select, insert, update, delete on public.franchises to authenticated;

/** Picks (or creates) the franchise for a set of titles and adds the free ones to it. */
create or replace function app_private.join_franchise(p_ids uuid[], p_name text, p_source text)
returns uuid
language plpgsql security invoker
set search_path = public
as $$
declare v_fid uuid;
begin
  if p_source is not null then
    select id into v_fid from public.franchises where source = p_source;
  end if;
  if v_fid is null then
    -- Reuse the franchise most of these titles are already in.
    select m.franchise_id into v_fid from public.media m
    where m.id = any (p_ids) and m.franchise_id is not null
    group by m.franchise_id order by count(*) desc, m.franchise_id limit 1;
  end if;
  if v_fid is null then
    insert into public.franchises (name, source) values (left(btrim(p_name), 200), p_source) returning id into v_fid;
  elsif p_source is not null then
    update public.franchises set source = p_source where id = v_fid and source is null
      and not exists (select 1 from public.franchises where source = p_source);
  end if;
  update public.media set franchise_id = v_fid
  where id = any (p_ids) and franchise_id is null and not ('franchise_id' = any (locked_fields));
  return v_fid;
end $$;

-- Groups titles connected by relations (sequel, prequel, adaptation, source,
-- side story, spin-off, ...) — across categories, e.g. an anime, its manga and
-- its light novel. Relations to titles outside the library are followed via
-- their external ids when that title is in the library. Never moves a title
-- that is already in a franchise or was removed from one by hand.
create or replace function public.detect_franchises()
returns jsonb
language plpgsql security invoker
set search_path = public
as $$
declare
  v_changed integer;
  v_groups integer := 0;
  v_before integer;
  v_after integer;
  c record;
begin
  select count(*) into v_before from public.media where franchise_id is not null;

  drop table if exists pg_temp._fr_edge;
  drop table if exists pg_temp._fr_label;
  create temp table _fr_edge as
    select distinct r.media_id as a, coalesce(r.related_media_id, x.media_id) as b
    from public.media_relations r
    left join public.media_external_ids x
      on r.related_media_id is null and x.provider = r.related_provider and x.external_id = r.related_external_id
    where r.relation_type not in ('character', 'other')
      and coalesce(r.related_media_id, x.media_id) is not null
      and coalesce(r.related_media_id, x.media_id) <> r.media_id;

  create temp table _fr_label as
    select id, id as lab from (select a as id from _fr_edge union select b from _fr_edge) s;

  -- Connected components: every node takes the smallest label among its neighbours.
  loop
    with nb as (
      select e.a as id, l.lab from _fr_edge e join _fr_label l on l.id = e.b
      union all
      select e.b, l.lab from _fr_edge e join _fr_label l on l.id = e.a
    ), best as (select id, min(lab::text)::uuid as lab from nb group by id)
    update _fr_label l set lab = b.lab from best b where b.id = l.id and b.lab::text < l.lab::text;
    get diagnostics v_changed = row_count;
    exit when v_changed = 0;
  end loop;

  for c in
    select l.lab, array_agg(l.id) as ids from _fr_label l group by l.lab having count(*) > 1
  loop
    -- Named after the earliest title (usually the original work).
    perform app_private.join_franchise(c.ids, (
      select m.title from public.media m where m.id = any (c.ids)
      order by coalesce(m.release_date, make_date(m.release_year, 1, 1)) asc nulls last, char_length(m.title), m.title
      limit 1), null);
    v_groups := v_groups + 1;
  end loop;

  drop table _fr_edge;
  drop table _fr_label;
  -- Franchises whose titles were all deleted.
  delete from public.franchises f where not exists (select 1 from public.media m where m.franchise_id = f.id);
  select count(*) into v_after from public.media where franchise_id is not null;
  return jsonb_build_object('groups', v_groups, 'added', v_after - v_before);
end $$;

-- Groups from an external key (TMDB collection, IGDB franchise). Needs two or
-- more titles from the library.
create or replace function public.assign_franchise_group(p_source text, p_name text, p_media_ids uuid[])
returns uuid
language plpgsql security invoker
set search_path = public
as $$
begin
  if p_source is null or p_source !~ '^[a-z_]+:[0-9]+$' then raise exception 'Invalid franchise source'; end if;
  if coalesce(cardinality(p_media_ids), 0) < 2 then return null; end if;
  return app_private.join_franchise(p_media_ids, p_name, p_source);
end $$;

-- Overview for the Franchises page.
create or replace function public.franchise_list()
returns table (
  id uuid, name text, members integer, completed integer, in_progress integer,
  categories text[], posters jsonb, avg_rating numeric, first_year smallint, updated_at timestamptz
)
language sql stable security invoker
set search_path = public
as $$
  select f.id, f.name,
    count(m.id)::integer,
    count(*) filter (where e.status = 'completed')::integer,
    count(*) filter (where e.status = 'in_progress')::integer,
    array_agg(distinct m.category::text),
    coalesce((select jsonb_agg(p) from (
      select jsonb_build_object('poster_url', m2.poster_url, 'custom_poster_path', m2.custom_poster_path, 'title', m2.title) as p
      from public.media m2 where m2.franchise_id = f.id and (m2.poster_url is not null or m2.custom_poster_path is not null)
      order by coalesce(m2.release_date, make_date(m2.release_year, 1, 1)) asc nulls last limit 4) s), '[]'::jsonb),
    round(avg(e.rating) / 2.0, 1),
    min(m.release_year),
    f.updated_at
  from public.franchises f
  join public.media m on m.franchise_id = f.id
  left join public.library_entries e on e.media_id = m.id
  group by f.id
  order by f.name
$$;

-- ---------------------------------------------------------------------------
-- Public share link (read-only)
-- ---------------------------------------------------------------------------
create table public.share_links (
  token text primary key default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
    check (token ~ '^[A-Za-z0-9_-]{32,64}$'),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  show_ratings boolean not null default true,
  -- NULL = every category.
  categories public.media_category[],
  created_at timestamptz not null default now()
);
alter table public.share_links enable row level security;
create policy owner_rows on public.share_links for all to authenticated
  using (user_id = (select auth.uid()) and (select app_private.is_owner()))
  with check (user_id = (select auth.uid()) and (select app_private.is_owner()));
revoke all on public.share_links from anon;
grant select, insert, update, delete on public.share_links to authenticated;

-- What a visitor with the link may see: titles, posters, status, progress,
-- dates, favourites and (optionally) ratings. Never notes, reviews, history
-- or anything else. Runs with the definer's rights; the token is the only key.
create or replace function app_private.public_items(p_link public.share_links, p_rows jsonb)
returns jsonb
language sql immutable
as $$
  select coalesce(jsonb_agg(
    (r - 'relevance' - 'total_count' - 'wishlisted_at' - 'wishlist_priority' - 'genres' - 'active_session_id'
       - 'last_activity_at' - 'added_at')
    - case when p_link.show_ratings then 'x' else 'rating' end), '[]'::jsonb)
  from jsonb_array_elements(p_rows) r
$$;

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
    where e.user_id = v_link.user_id and (v_link.categories is null or m.category = any (v_link.categories))
    group by m.category) s;

  select jsonb_agg(to_jsonb(q)) into v_fav from public.library_query(p_favorite => true, p_sort => 'rating_desc', p_limit => 60) q
    where v_link.categories is null or q.category = any (v_link.categories);
  select jsonb_agg(to_jsonb(q)) into v_recent from public.library_query(p_statuses => array['completed']::public.library_status[], p_sort => 'completed_desc', p_limit => 40) q
    where v_link.categories is null or q.category = any (v_link.categories);

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
  if v_link.categories is not null and not (p_category = any (v_link.categories)) then return null; end if;
  if p_sort not in ('rating_desc', 'title_asc', 'release_desc', 'release_asc', 'completed_desc', 'added_desc') then p_sort := 'title_asc'; end if;
  if not v_link.show_ratings and p_sort = 'rating_desc' then p_sort := 'title_asc'; end if;

  select jsonb_agg(to_jsonb(q)), max(q.total_count) into v_rows, v_total
  from public.library_query(
    p_category => p_category,
    p_statuses => case when p_status is null then null else array[p_status] end,
    p_search => p_search, p_sort => p_sort, p_limit => least(greatest(p_limit, 1), 120), p_offset => greatest(p_offset, 0)) q;

  return jsonb_build_object('total', coalesce(v_total, 0), 'items', app_private.public_items(v_link, coalesce(v_rows, '[]'::jsonb)));
end $$;

revoke execute on function public.public_profile(text) from public;
revoke execute on function public.public_library(text, public.media_category, public.library_status, text, text, integer, integer) from public;
grant execute on function public.public_profile(text) to anon, authenticated;
grant execute on function public.public_library(text, public.media_category, public.library_status, text, text, integer, integer) to anon, authenticated;
revoke execute on function app_private.public_items(public.share_links, jsonb) from public, anon, authenticated;
grant execute on function public.detect_franchises() to authenticated;
grant execute on function public.assign_franchise_group(text, text, uuid[]) to authenticated;
grant execute on function public.franchise_list() to authenticated;
revoke execute on function public.detect_franchises() from anon;
revoke execute on function public.assign_franchise_group(text, text, uuid[]) from anon;
revoke execute on function public.franchise_list() from anon;
revoke execute on function app_private.join_franchise(uuid[], text, text) from anon;
grant execute on function app_private.join_franchise(uuid[], text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Backups: franchises are restored (before media, which points at them);
-- wiping the library removes them too.
-- ---------------------------------------------------------------------------
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
  if p_table not in ('franchises', 'media', 'media_titles', 'media_external_ids', 'media_seasons', 'media_relations',
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
    and not (p_table = 'library_entries' and c.column_name = 'session_repeat_count');

  execute format('insert into public.%I (%s) select %s from jsonb_populate_recordset(null::public.%I, $1) on conflict do nothing',
                 p_table, v_cols, v_select, p_table)
  using p_rows;
  get diagnostics n = row_count;
  return n;
end $$;

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
  delete from public.franchises;
  delete from public.genres;
  delete from public.metadata_cache;
end $$;
