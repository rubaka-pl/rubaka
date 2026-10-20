-- RUBAKA — franchises also count works you do not have yet: relations of the
-- titles in a franchise that point at sequels / prequels / adaptations / side
-- stories outside the library ("character" and "other" links are ignored).

-- Works related to a franchise's titles that are not in the library.
create or replace function public.franchise_missing(p_franchise uuid)
returns table (
  provider text, external_id text, title text, category public.media_category,
  poster_url text, relation_type public.relation_type, via_title text
)
language sql stable security invoker
set search_path = public
as $$
  select distinct on (r.related_provider, r.related_external_id)
    r.related_provider, r.related_external_id, r.related_title, r.related_category,
    r.related_poster_url, r.relation_type, m.title
  from public.media m
  join public.media_relations r on r.media_id = m.id
  where m.franchise_id = p_franchise
    and r.related_media_id is null
    and r.related_provider is not null and r.related_external_id is not null
    and r.relation_type not in ('character', 'other')
    and not exists (select 1 from public.media_external_ids x
                    where x.provider = r.related_provider and x.external_id = r.related_external_id)
  order by r.related_provider, r.related_external_id,
    array_position(array['sequel', 'prequel', 'parent', 'adaptation', 'source', 'side_story', 'spin_off', 'alternative', 'summary']::public.relation_type[], r.relation_type)
$$;

drop function if exists public.franchise_list();
create function public.franchise_list()
returns table (
  id uuid, name text, members integer, completed integer, in_progress integer, missing integer,
  categories text[], posters jsonb, avg_rating numeric, first_year smallint, updated_at timestamptz
)
language sql stable security invoker
set search_path = public
as $$
  select f.id, f.name,
    count(m.id)::integer,
    count(*) filter (where e.status = 'completed')::integer,
    count(*) filter (where e.status = 'in_progress')::integer,
    (select count(*) from public.franchise_missing(f.id))::integer,
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

grant execute on function public.franchise_missing(uuid) to authenticated;
grant execute on function public.franchise_list() to authenticated;
revoke execute on function public.franchise_missing(uuid) from anon;
revoke execute on function public.franchise_list() from anon;

-- An external group (TMDB collection, IGDB franchise) is worth showing even
-- with one title in the library: the other parts appear as "not in library".
create or replace function public.assign_franchise_group(p_source text, p_name text, p_media_ids uuid[])
returns uuid
language plpgsql security invoker
set search_path = public
as $$
begin
  if p_source is null or p_source !~ '^[a-z_]+:[0-9]+$' then raise exception 'Invalid franchise source'; end if;
  if coalesce(cardinality(p_media_ids), 0) < 1 then return null; end if;
  return app_private.join_franchise(p_media_ids, p_name, p_source);
end $$;

-- Titles that are alone in the library but have an unseen sequel / prequel /
-- side story of the same kind also become a franchise (so what is left shows up).
create or replace function public.detect_single_franchises()
returns integer
language plpgsql security invoker
set search_path = public
as $$
declare n integer := 0; c record;
begin
  for c in
    select m.id, m.title from public.media m
    where m.franchise_id is null and not ('franchise_id' = any (m.locked_fields))
      and exists (
        select 1 from public.media_relations r
        where r.media_id = m.id and r.related_media_id is null
          and r.relation_type in ('sequel', 'prequel', 'parent', 'side_story', 'spin_off')
          and r.related_category = m.category
          and not exists (select 1 from public.media_external_ids x where x.provider = r.related_provider and x.external_id = r.related_external_id))
  loop
    perform app_private.join_franchise(array[c.id], c.title, null);
    n := n + 1;
  end loop;
  return n;
end $$;
grant execute on function public.detect_single_franchises() to authenticated;
revoke execute on function public.detect_single_franchises() from anon;
