// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite'
import { addTitle, as, createTestDb, OWNER, STRANGER } from './harness'

let db: PGlite
beforeAll(async () => {
  db = await createTestDb()
})

const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  as(db, OWNER, async (tx) => (await tx.query<T>(sql, params)).rows[0])

describe('row level security', () => {
  test('anon cannot read or write anything', async () => {
    await addTitle(db, { category: 'anime', title: 'RLS Probe' })
    await expect(as(db, 'anon', (tx) => tx.query('select * from library_entries'))).rejects.toThrow(/permission denied/)
    await expect(as(db, 'anon', (tx) => tx.query('select * from media'))).rejects.toThrow(/permission denied/)
    await expect(as(db, 'anon', (tx) => tx.query(`select * from library_query()`))).rejects.toThrow(/permission denied/)
  })

  test('a signed-in user who is not the owner sees and writes nothing', async () => {
    const rows = await as(db, STRANGER, (tx) => tx.query('select * from media'))
    expect(rows.rows).toHaveLength(0)
    const entries = await as(db, STRANGER, (tx) => tx.query('select * from library_query()'))
    expect(entries.rows).toHaveLength(0)
    await expect(
      as(db, STRANGER, (tx) => tx.query(`insert into media (category, title) values ('anime', 'Intruder')`)),
    ).rejects.toThrow(/row-level security/)
    const upd = await as(db, STRANGER, (tx) => tx.query(`update library_entries set rating = 1`))
    expect(upd.affectedRows).toBe(0)
  })

  test('without a configured owner even the real user is locked out', async () => {
    const fresh = await createTestDb({ owner: false })
    await expect(
      as(fresh, OWNER, (tx) => tx.query(`insert into media (category, title) values ('anime', 'X')`)),
    ).rejects.toThrow(/row-level security/)
    await fresh.close()
  })

  test('owner cannot write rows for another user id', async () => {
    const { mediaId } = await addTitle(db, { category: 'movie', title: 'Owner Spoof' })
    await expect(
      as(db, OWNER, (tx) =>
        tx.query(`insert into activity_log (user_id, action) values ($1, 'added')`, [STRANGER]),
      ),
    ).rejects.toThrow(/row-level security/)
    expect(mediaId).toBeTruthy()
  })
})

describe('ratings', () => {
  test('stores half-stars 0..10, distinguishes NULL from 0, rejects out of range', async () => {
    const { entryId } = await addTitle(db, { category: 'anime', title: 'Rating Test' })
    const r0 = await one<{ rating: number | null }>('select rating from library_entries where id = $1', [entryId])
    expect(r0.rating).toBeNull()
    await one('update library_entries set rating = 0 where id = $1', [entryId])
    expect((await one<{ rating: number }>('select rating from library_entries where id = $1', [entryId])).rating).toBe(0)
    await one('update library_entries set rating = 9 where id = $1', [entryId])
    await expect(one('update library_entries set rating = 11 where id = $1', [entryId])).rejects.toThrow(/check/)
    await expect(one('update library_entries set rating = -1 where id = $1', [entryId])).rejects.toThrow(/check/)
    await one('update library_entries set rating = null where id = $1', [entryId])
  })
})

describe('progress and totals', () => {
  test('unknown totals are NULL, never zero, and do not cap progress', async () => {
    await expect(addTitle(db, { category: 'manga', title: 'Zero total', total_chapters: 0 })).rejects.toThrow(/check/)
    const { entryId } = await addTitle(db, { category: 'manga', title: 'One Piece (test)' }, { chapters_read: 1100 })
    const e = await one<{ chapters_read: number }>('select chapters_read from library_entries where id = $1', [entryId])
    expect(e.chapters_read).toBe(1100)
  })

  test('progress may not exceed a known total; chapters and volumes are independent', async () => {
    const { entryId } = await addTitle(db, { category: 'manga', title: 'Known total', total_chapters: 10, total_volumes: 2 })
    await one('update library_entries set chapters_read = 10, volumes_read = 1 where id = $1', [entryId])
    await expect(one('update library_entries set chapters_read = 11 where id = $1', [entryId])).rejects.toThrow(/exceed/)
    await expect(one('update library_entries set volumes_read = 3 where id = $1', [entryId])).rejects.toThrow(/exceed/)
  })

  test('format must be valid for the category', async () => {
    await expect(addTitle(db, { category: 'movie', title: 'Bad', format: 'manhwa' })).rejects.toThrow(/media_format_valid/)
    await addTitle(db, { category: 'manga', title: 'Good', format: 'manhwa', country: 'KR' })
  })

  test('season progress drives TV episode counters', async () => {
    const { entryId } = await addTitle(db, { category: 'tv_series', title: 'Breaking Test', total_episodes: 62 })
    await one(`insert into entry_season_progress (entry_id, season_number, episodes_watched) values ($1, 1, 7), ($1, 2, 3)`, [entryId])
    const e = await one<{ episodes_watched: number; current_season: number; current_episode: number }>(
      'select episodes_watched, current_season, current_episode from library_entries where id = $1', [entryId])
    expect(e).toEqual({ episodes_watched: 10, current_season: 2, current_episode: 3 })
  })

  test('VN route checklist drives route/ending counters', async () => {
    const { entryId } = await addTitle(db, { category: 'visual_novel', title: 'VN Test', total_routes: 3 })
    await one(`insert into vn_routes (entry_id, name, kind, completed) values
      ($1, 'Kurisu', 'route', true), ($1, 'Mayuri', 'route', false), ($1, 'True End', 'ending', true)`, [entryId])
    const e = await one<{ routes_completed: number; endings_completed: number }>(
      'select routes_completed, endings_completed from library_entries where id = $1', [entryId])
    expect(e).toEqual({ routes_completed: 1, endings_completed: 1 })
  })
})

describe('repeat sessions', () => {
  test('rewatch keeps Completed status and only completed sessions count', async () => {
    const { entryId } = await addTitle(db, { category: 'anime', title: 'Steins;Gate (test)', total_episodes: 24 },
      { status: 'completed', episodes_watched: 24, imported_repeat_count: 1 })
    const s = await one<{ id: string }>(
      `insert into tracking_sessions (entry_id, session_type, start_date) values ($1, 'rewatch', '2025-01-01') returning id`, [entryId])
    let e = await one<{ status: string; repeat_count: number }>('select status, repeat_count from library_entries where id = $1', [entryId])
    expect(e).toEqual({ status: 'completed', repeat_count: 1 })

    await expect(one(`insert into tracking_sessions (entry_id, session_type) values ($1, 'rewatch')`, [entryId]))
      .rejects.toThrow(/tracking_sessions_one_active_uq/)
    await expect(one(`insert into tracking_sessions (entry_id, session_type, status) values ($1, 'reread', 'completed')`, [entryId]))
      .rejects.toThrow(/does not match/)

    await one(`update tracking_sessions set status = 'completed', end_date = '2025-01-03', progress = 24 where id = $1`, [s.id])
    e = await one('select status, repeat_count from library_entries where id = $1', [entryId])
    expect(e).toEqual({ status: 'completed', repeat_count: 2 })

    const s2 = await one<{ id: string }>(`insert into tracking_sessions (entry_id, session_type) values ($1, 'rewatch') returning id`, [entryId])
    await one(`update tracking_sessions set status = 'abandoned' where id = $1`, [s2.id])
    e = await one('select status, repeat_count from library_entries where id = $1', [entryId])
    expect(e).toEqual({ status: 'completed', repeat_count: 2 })
  })
})

describe('wishlist', () => {
  test('membership is independent from status and priority needs membership', async () => {
    const { entryId } = await addTitle(db, { category: 'game', title: 'Wish Game' }, { status: 'planning' })
    await one(`update library_entries set wishlisted_at = now(), wishlist_priority = 3 where id = $1`, [entryId])
    await one(`update library_entries set status = 'in_progress' where id = $1`, [entryId])
    let e = await one<{ wishlisted: boolean; wishlist_priority: number | null }>(
      `select wishlisted_at is not null as wishlisted, wishlist_priority from library_entries where id = $1`, [entryId])
    expect(e).toEqual({ wishlisted: true, wishlist_priority: 3 })
    await one(`update library_entries set wishlisted_at = null where id = $1`, [entryId])
    e = await one(`select wishlisted_at is not null as wishlisted, wishlist_priority from library_entries where id = $1`, [entryId])
    expect(e).toEqual({ wishlisted: false, wishlist_priority: null })
  })
})

describe('activity log', () => {
  test('merges consecutive progress updates and rating clicks, logs completion', async () => {
    const { entryId } = await addTitle(db, { category: 'anime', title: 'Activity Test', total_episodes: 12 }, { status: 'in_progress' })
    for (const n of [1, 2, 3]) await one('update library_entries set episodes_watched = $2 where id = $1', [entryId, n])
    for (const r of [6, 7, 8]) await one('update library_entries set rating = $2 where id = $1', [entryId, r])
    await one(`update library_entries set status = 'completed', episodes_watched = 12 where id = $1`, [entryId])
    const rows = await as(db, OWNER, async (tx) =>
      (await tx.query<{ action: string; details: Record<string, unknown> }>(
        'select action, details from activity_log where entry_id = $1 order by id', [entryId])).rows)
    expect(rows.map((r) => r.action)).toEqual(['added', 'progress', 'rating_changed', 'completed'])
    expect(rows[1].details).toEqual({ from: {}, to: { episodes: 3 } })
    expect(rows[2].details).toEqual({ from: null, to: 8 })
  })
})

describe('search and library_query', () => {
  beforeAll(async () => {
    const { mediaId } = await addTitle(db,
      { category: 'anime', title: 'Attack on Titan', original_title: '進撃の巨人', release_year: 2013, format: 'tv', total_episodes: 25 },
      { status: 'completed', rating: 9, episodes_watched: 25 })
    await one(`insert into media_titles (media_id, title, kind) values ($1, 'Shingeki no Kyōjin', 'romaji'), ($1, 'Атака титанов', 'russian')`, [mediaId])
    await one(`insert into genres (name) values ('Action'), ('Drama') on conflict do nothing`)
    await one(`insert into media_genres select $1, id from genres where name in ('Action', 'Drama')`, [mediaId])
    await addTitle(db, { category: 'novel', title: 'Kusuriya no Hitorigoto', original_title: '薬屋のひとりごと', release_year: 2011 }, { status: 'in_progress', chapters_read: 40 })
    await addTitle(db, { category: 'visual_novel', title: 'Steins;Gate VN', original_title: 'シュタインズ・ゲート', release_year: 2009 }, { status: 'planning' })
  })

  const search = async (q: string) =>
    as(db, OWNER, async (tx) => (await tx.query<{ title: string }>(`select title from library_query(p_search => $1, p_sort => 'relevance')`, [q])).rows.map((r) => r.title))

  test('matches alternative, romaji (accent-insensitive), Russian and Japanese titles', async () => {
    expect(await search('shingeki no kyojin')).toContain('Attack on Titan')
    expect(await search('атака')).toContain('Attack on Titan')
    expect(await search('進撃')).toContain('Attack on Titan')
    expect(await search('薬屋')).toContain('Kusuriya no Hitorigoto')
    expect(await search('シュタインズ')).toContain('Steins;Gate VN')
    expect(await search('シュタインズ・ゲート')).toContain('Steins;Gate VN')
    expect(await search('steins gate')).toContain('Steins;Gate VN')
  })

  test('fuzzy matches a typo', async () => {
    expect(await search('atack on titan')).toContain('Attack on Titan')
  })

  test('combines filters and reports total count', async () => {
    const rows = await as(db, OWNER, async (tx) => (await tx.query<{ title: string; total_count: number; genres: string[] }>(
      `select title, total_count, genres from library_query(p_category => 'anime', p_statuses => '{completed}', p_rating_min => 8, p_genres => '{Action}')`)).rows)
    expect(rows.map((r) => r.title)).toEqual(['Attack on Titan'])
    expect(Number(rows[0].total_count)).toBe(1)
    expect(rows[0].genres).toEqual(['Action', 'Drama'])
  })

  test('pagination is stable and sorts nulls last in both directions', async () => {
    for (let i = 0; i < 9; i++) {
      await addTitle(db, { category: 'movie', title: `Paged ${i % 3}`, release_year: i % 2 ? 2000 + i : null }, { rating: i % 4 === 0 ? null : i })
    }
    for (const sort of ['rating_desc', 'rating_asc', 'release_desc', 'release_asc', 'title_asc', 'random']) {
      const all = await as(db, OWNER, async (tx) =>
        (await tx.query<{ entry_id: string; rating: number | null }>(`select entry_id, rating from library_query(p_category => 'movie', p_sort => $1, p_seed => 'abc', p_limit => 500)`, [sort])).rows)
      const pages: string[] = []
      for (let off = 0; off < all.length; off += 4) {
        const page = await as(db, OWNER, async (tx) =>
          (await tx.query<{ entry_id: string }>(`select entry_id from library_query(p_category => 'movie', p_sort => $1, p_seed => 'abc', p_limit => 4, p_offset => $2)`, [sort, off])).rows)
        pages.push(...page.map((p) => p.entry_id))
      }
      expect(pages).toEqual(all.map((a) => a.entry_id))
      if (sort.startsWith('rating')) {
        const firstNull = all.findIndex((a) => a.rating === null)
        expect(all.slice(firstNull).every((a) => a.rating === null)).toBe(true)
      }
    }
  })
})

describe('imports', () => {
  const job = async (source = 'mal_xml') =>
    (await one<{ id: string }>(`insert into import_jobs (source, file_name) values ($1, 'test') returning id`, [source])).id

  const record = (over: Record<string, unknown> = {}) => ({
    source_key: 'mal_anime:9253',
    row_number: 1,
    decision: 'create',
    raw: { series_animedb_id: '9253' },
    media: { category: 'anime', title: 'Steins;Gate', format: 'tv', total_episodes: 24 },
    titles: [],
    genres: [],
    external_ids: [{ provider: 'mal_anime', external_id: '9253', url: 'https://myanimelist.net/anime/9253' }],
    entry: { status: 'completed', rating: 10, episodes_watched: 24, imported_repeat_count: 2 },
    apply_fields: [],
    ...over,
  })

  const apply = async (jobId: string, recs: unknown[]) =>
    one<{ import_apply: Array<{ outcome: string; message?: string }> }>('select import_apply($1, $2)', [jobId, JSON.stringify(recs)])

  test('first import creates, repeated import creates no duplicates and logs one event', async () => {
    const j1 = await job()
    expect((await apply(j1, [record()])).import_apply[0].outcome).toBe('created')
    // Same job again (resume): already processed.
    expect((await apply(j1, [record()])).import_apply[0].outcome).toBe('already_processed')
    await one('select import_finish($1)', [j1])
    // New job, same file: matched by external id, nothing to change.
    const j2 = await job()
    expect((await apply(j2, [record()])).import_apply[0].outcome).toBe('unchanged')
    const c = await one<{ n: number }>(`select count(*)::int n from media m join media_external_ids x on x.media_id = m.id where x.provider = 'mal_anime' and x.external_id = '9253'`)
    expect(c.n).toBe(1)
    const acts = await one<{ added: number; imported: number }>(
      `select count(*) filter (where action = 'added')::int added, count(*) filter (where action = 'imported')::int imported from activity_log where details->>'job_id' = $1::text or entry_id in (select entry_id from import_records where job_id = $1::uuid)`, [j1])
    expect(acts).toEqual({ added: 0, imported: 1 })
  })

  test('conflicts: personal values change only when approved; merge fills empty fields', async () => {
    const j = await job()
    await apply(j, [record({ entry: { status: 'completed', rating: 6, notes: 'from import', episodes_watched: 24 }, decision: 'merge' })])
    let e = await one<{ rating: number; notes: string }>(`select e.rating, e.notes from library_entries e join media_external_ids x on x.media_id = e.media_id where x.external_id = '9253'`)
    expect(e).toEqual({ rating: 10, notes: 'from import' }) // rating kept, empty notes filled
    const j2 = await job()
    const out = await apply(j2, [record({ entry: { rating: 6 }, apply_fields: ['rating'] })])
    expect(out.import_apply[0].outcome).toBe('updated')
    e = await one(`select e.rating, e.notes from library_entries e join media_external_ids x on x.media_id = e.media_id where x.external_id = '9253'`)
    expect(e).toEqual({ rating: 6, notes: 'from import' })
  })

  test('a failing record is reported without aborting the batch; skips are recorded', async () => {
    const j = await job()
    const out = await apply(j, [
      record({ source_key: 'bad', external_ids: [{ provider: 'mal_anime', external_id: 'bad1' }], media: { category: 'anime', title: 'Bad', total_episodes: 2 }, entry: { episodes_watched: 5 } }),
      record({ source_key: 'skip', decision: 'skip', message: 'user skipped' }),
      record({ source_key: 'good', external_ids: [{ provider: 'mal_anime', external_id: 'good1' }], media: { category: 'anime', title: 'Good One' } }),
    ])
    expect(out.import_apply.map((o) => o.outcome)).toEqual(['failed', 'skip', 'created'])
    expect(out.import_apply[0].message).toMatch(/exceed/)
    const recs = await as(db, OWNER, async (tx) => (await tx.query<{ outcome: string; raw: unknown }>(`select outcome, raw from import_records where job_id = $1 order by id`, [j])).rows)
    expect(recs.map((r) => r.outcome).sort()).toEqual(['created', 'failed', 'skipped'])
    expect(recs.every((r) => r.raw)).toBe(true)
    // The failed media row was rolled back with its subtransaction.
    expect((await one<{ n: number }>(`select count(*)::int n from media where title = 'Bad'`)).n).toBe(0)
  })

  test('import_match finds by external id and offers title candidates without merging', async () => {
    const res = await one<{ import_match: Array<{ match: string; candidates: unknown[] }> }>('select import_match($1)', [JSON.stringify([
      { source_key: 'a', category: 'anime', title: 'Steins;Gate', external_ids: [{ provider: 'mal_anime', external_id: '9253' }] },
      { source_key: 'b', category: 'anime', title: 'STEINS GATE', year: 2011, external_ids: [{ provider: 'mal_anime', external_id: '99999' }] },
    ])])
    expect(res.import_match[0].match).toBe('external_id')
    expect(res.import_match[1].match).toBe('none')
    expect(res.import_match[1].candidates).toHaveLength(1)
  })

  test('Backloggd replay sessions are imported once', async () => {
    const rec = record({
      source_key: 'backloggd:1', external_ids: [{ provider: 'backloggd', external_id: '1' }],
      media: { category: 'game', title: 'Hades' }, entry: { status: 'completed', rating: 9 },
      sessions: [{ session_type: 'replay', status: 'completed', start_date: '2024-01-01', end_date: '2024-02-01' }],
    })
    await apply(await job('backloggd_json'), [rec])
    await apply(await job('backloggd_json'), [rec])
    const e = await one<{ repeat_count: number }>(`select e.repeat_count from library_entries e join media_external_ids x on x.media_id = e.media_id where x.provider = 'backloggd' and x.external_id = '1'`)
    expect(e.repeat_count).toBe(1)
  })
})

describe('enrichment', () => {
  test('fills only empty fields, respects locks and recorded progress', async () => {
    const { mediaId } = await addTitle(db, { category: 'manga', title: 'Enrich Me', synopsis: 'mine', locked_fields: ['poster_url'] }, { chapters_read: 50 })
    const res = await one<{ apply_enrichment: { changed: string[] } }>(`select apply_enrichment($1, $2, 'anilist')`, [mediaId, JSON.stringify({
      media: { synopsis: 'provider', poster_url: 'https://x/p.jpg', total_chapters: 30, total_volumes: 5, release_year: 2020, details: { authors: ['A'] } },
      genres: ['Drama'], titles: [{ title: 'エンリッチ', kind: 'native' }],
    })])
    expect(res.apply_enrichment.changed.sort()).toEqual(['details', 'release_year', 'total_volumes'])
    const m = await one<Record<string, unknown>>('select synopsis, poster_url, total_chapters, total_volumes, enrichment_state, details from media where id = $1', [mediaId])
    expect(m).toMatchObject({ synopsis: 'mine', poster_url: null, total_chapters: null, total_volumes: 5, enrichment_state: 'matched', details: { authors: ['A'] } })
  })
})

describe('statistics', () => {
  test('rating distribution and undated completions come from real rows', async () => {
    const s = await one<{ library_stats: { overview: Record<string, number>; rating_distribution: { rating: number; count: number }[] } }>(
      `select library_stats()`)
    const total = s.library_stats.rating_distribution.reduce((a, r) => a + Number(r.count), 0)
    expect(total).toBe(Number(s.library_stats.overview.rated))
    expect(s.library_stats.rating_distribution).toHaveLength(11)
    expect(Number(s.library_stats.overview.completed_without_date)).toBeGreaterThan(0)
  })

  test('dashboard summary lists all eight categories', async () => {
    const s = await one<{ dashboard_summary: { category: string }[] }>(`select dashboard_summary()`)
    expect(s.dashboard_summary.map((c) => c.category)).toEqual(
      ['anime', 'manga', 'novel', 'visual_novel', 'movie', 'tv_series', 'animated_series', 'game'])
  })
})

describe('backup restore', () => {
  test('wipe requires confirmation; restoring rows reproduces the library', async () => {
    const dump = async (t: string) => as(db, OWNER, async (tx) => (await tx.query(`select * from ${t}`)).rows)
    const tables = ['media', 'media_titles', 'media_external_ids', 'library_entries', 'tracking_sessions', 'vn_routes', 'entry_season_progress']
    const backup: Record<string, unknown[]> = {}
    for (const t of tables) backup[t] = await dump(t)
    const genres = await as(db, OWNER, async (tx) => (await tx.query(`select mg.media_id, g.name as genre from media_genres mg join genres g on g.id = mg.genre_id`)).rows)
    const before = await one<{ n: number; r: number }>(`select count(*)::int n, sum(repeat_count)::int r from library_entries`)

    await expect(one(`select wipe_library('nope')`)).rejects.toThrow(/Confirmation/)
    await one(`select wipe_library('DELETE MY LIBRARY')`)
    expect((await one<{ n: number }>(`select count(*)::int n from library_entries`)).n).toBe(0)

    for (const t of tables) await one(`select restore_rows($1, $2)`, [t, JSON.stringify(backup[t])])
    await one(`select restore_media_genres($1)`, [JSON.stringify(genres)])
    const after = await one<{ n: number; r: number }>(`select count(*)::int n, sum(repeat_count)::int r from library_entries`)
    expect(after).toEqual(before)
    expect((await search2('shingeki'))).toContain('Attack on Titan')
    await expect(one(`select restore_rows('import_jobs', '[]')`)).rejects.toThrow(/cannot be restored/)
  })
})

const search2 = async (q: string) =>
  as(db, OWNER, async (tx) => (await tx.query<{ title: string }>(`select title from library_query(p_search => $1)`, [q])).rows.map((r) => r.title))

test('am_i_owner distinguishes the owner from other accounts', async () => {
  expect((await as(db, OWNER, (tx) => tx.query<{ v: boolean }>('select am_i_owner() as v'))).rows[0].v).toBe(true)
  expect((await as(db, STRANGER, (tx) => tx.query<{ v: boolean }>('select am_i_owner() as v'))).rows[0].v).toBe(false)
  await expect(as(db, 'anon', (tx) => tx.query('select am_i_owner()'))).rejects.toThrow(/permission denied/)
})

describe('create_media_entry', () => {
  test('creates a custom title with a Japanese original title, searchable both ways', async () => {
    const r = await one<{ create_media_entry: { media_id: string; entry_id: string; existing: boolean } }>(
      `select create_media_entry($1, $2, $3, $4, '[]', '[]', '[]', true)`,
      [JSON.stringify({ category: 'novel', title: 'My Custom Novel', original_title: 'わたしの小説', format: 'web_novel', total_chapters: null }),
       JSON.stringify({ status: 'in_progress', chapters_read: 3 }),
       JSON.stringify([{ title: 'Watashi no Shousetsu', kind: 'romaji' }]),
       JSON.stringify(['Fantasy'])])
    expect(r.create_media_entry.existing).toBe(false)
    const m = await one<{ is_custom: boolean; enrichment_state: string; locked_fields: string[]; original_title: string }>(
      'select is_custom, enrichment_state, locked_fields, original_title from media where id = $1', [r.create_media_entry.media_id])
    expect(m).toMatchObject({ is_custom: true, enrichment_state: 'skipped', original_title: 'わたしの小説' })
    expect(m.locked_fields).toContain('original_title')
    const hits = await as(db, OWNER, async (tx) => (await tx.query<{ title: string }>(`select title from library_query(p_search => 'わたし')`)).rows)
    expect(hits.map((h) => h.title)).toContain('My Custom Novel')
    const hits2 = await as(db, OWNER, async (tx) => (await tx.query<{ title: string }>(`select title from library_query(p_search => 'shousetsu')`)).rows)
    expect(hits2.map((h) => h.title)).toContain('My Custom Novel')
  })

  test('reuses an existing title by external id', async () => {
    const args = [JSON.stringify({ category: 'anime', title: 'Dup' }), '{}', '[]', '[]', JSON.stringify([{ provider: 'anilist', external_id: '777' }])]
    const a = await one<{ create_media_entry: { media_id: string } }>(`select create_media_entry($1, $2, $3, $4, $5)`, args)
    const b = await one<{ create_media_entry: { media_id: string; existing: boolean } }>(`select create_media_entry($1, $2, $3, $4, $5)`, args)
    expect(b.create_media_entry).toMatchObject({ media_id: a.create_media_entry.media_id, existing: true })
  })
})

test('apply_enrichment_batch isolates failures', async () => {
  const { mediaId } = await addTitle(db, { category: 'anime', title: 'Batch Enrich' })
  await one(`insert into metadata_enrichment_jobs (media_id, provider) values ($1, 'anilist')`, [mediaId])
  const res = await one<{ apply_enrichment_batch: { ok: boolean }[] }>(`select apply_enrichment_batch($1)`, [JSON.stringify([
    { media_id: mediaId, provider: 'anilist', payload: { media: { total_episodes: 12 }, genres: ['Comedy'] } },
    { media_id: '00000000-0000-4000-8000-000000000000', provider: 'anilist', payload: { media: {} } },
  ])])
  expect(res.apply_enrichment_batch.map((r) => r.ok)).toEqual([true, false])
  const job = await one<{ status: string }>(`select status from metadata_enrichment_jobs where media_id = $1`, [mediaId])
  expect(job.status).toBe('done')
})

describe('bulk_update_entries', () => {
  test('historical completion: no date stamp, no activity, progress filled only where the total is known', async () => {
    const a = await addTitle(db, { category: 'tv_series', title: 'Bulk Known', total_episodes: 62 }, { status: 'planning' })
    const b = await addTitle(db, { category: 'tv_series', title: 'Bulk Unknown' }, { status: 'planning' })
    const before = await one<{ n: number }>(`select count(*)::int n from activity_log`)
    const n = await one<{ n: number }>(`select bulk_update_entries($1, '{"status":"completed"}', true, true) as n`, [[a.entryId, b.entryId]])
    expect(n.n).toBe(2)
    const rows = await as(db, OWNER, async (tx) => (await tx.query<{ title: string; status: string; episodes_watched: number; completed_at: string | null }>(
      `select m.title, e.status, e.episodes_watched, e.completed_at from library_entries e join media m on m.id = e.media_id where e.id = any($1) order by m.title`, [[a.entryId, b.entryId]])).rows)
    expect(rows).toEqual([
      { title: 'Bulk Known', status: 'completed', episodes_watched: 62, completed_at: null },
      { title: 'Bulk Unknown', status: 'completed', episodes_watched: 0, completed_at: null },
    ])
    expect((await one<{ n: number }>(`select count(*)::int n from activity_log`)).n).toBe(before.n)
  })

  test('normal bulk completion stamps completed_at and logs activity', async () => {
    const a = await addTitle(db, { category: 'movie', title: 'Bulk Now' }, { status: 'planning' })
    await one(`select bulk_update_entries($1, '{"status":"completed"}', false, false)`, [[a.entryId]])
    const e = await one<{ has_date: boolean }>(`select completed_at is not null as has_date from library_entries where id = $1`, [a.entryId])
    expect(e.has_date).toBe(true)
    expect((await one<{ n: number }>(`select count(*)::int n from activity_log where entry_id = $1 and action = 'completed'`, [a.entryId])).n).toBe(1)
  })
})

describe('completed means all episodes', () => {
  test('completing fills episodes; a total arriving later fills completed entries quietly; manga untouched', async () => {
    const tv = await addTitle(db, { category: 'tv_series', title: 'Done Show', total_episodes: 10 }, { status: 'planning' })
    await one(`update library_entries set status = 'completed' where id = $1`, [tv.entryId])
    expect((await one<{ e: number }>(`select episodes_watched e from library_entries where id = $1`, [tv.entryId])).e).toBe(10)

    const later = await addTitle(db, { category: 'animated_series', title: 'Unknown Then Known' }, { status: 'completed' })
    const before = await one<{ n: number }>(`select count(*)::int n from activity_log where entry_id = $1`, [later.entryId])
    await one(`update media set total_episodes = 26 where id = $1`, [later.mediaId])
    expect((await one<{ e: number }>(`select episodes_watched e from library_entries where id = $1`, [later.entryId])).e).toBe(26)
    expect((await one<{ n: number }>(`select count(*)::int n from activity_log where entry_id = $1`, [later.entryId])).n).toBe(before.n)

    const manga = await addTitle(db, { category: 'manga', title: 'Partly Read', total_chapters: 50 }, { status: 'completed', chapters_read: 40 })
    expect((await one<{ c: number }>(`select chapters_read c from library_entries where id = $1`, [manga.entryId])).c).toBe(40)
  })
})

describe('time spent', () => {
  test('MAL-style estimates, movie runtime, manual override', async () => {
    const fresh = await createTestDb()
    const add = async (media: Record<string, unknown>, entry: Record<string, unknown>) => addTitle(fresh, media, entry)
    const q = async (sql: string, p: unknown[] = []) => as(fresh, OWNER, async (tx) => (await tx.query(sql, p)).rows)
    await add({ category: 'anime', title: 'A', total_episodes: 12, episode_duration: 24 }, { status: 'completed', episodes_watched: 12, imported_repeat_count: 1 })
    await add({ category: 'anime', title: 'B', total_episodes: 24, episode_duration: 24 }, { status: 'in_progress', episodes_watched: 5 })
    await add({ category: 'anime', title: 'C (no duration)', total_episodes: 12 }, { status: 'completed', episodes_watched: 12 })
    await add({ category: 'movie', title: 'M', runtime: 100 }, { status: 'completed' })
    await add({ category: 'movie', title: 'Planned', runtime: 90 }, { status: 'planning' })
    const g = await add({ category: 'game', title: 'G', details: { time_to_beat_minutes: 600 } }, { status: 'completed' })
    await q(`update library_entries set time_spent_minutes = 1500 where id = $1`, [g.entryId])
    const rows = (await q(`select time_stats() as t`))[0] as { t: { category: string; minutes: number; counted: number; missing: number; manual: number }[] }
    const by = Object.fromEntries(rows.t.map((r) => [r.category, r]))
    // anime: A = (12 + 1×12) × 24 = 576, B = 5 × 24 = 120 → 696; C has no duration → missing
    expect(by.anime).toMatchObject({ minutes: 696, counted: 2, missing: 1 })
    expect(by.movie).toMatchObject({ minutes: 100, counted: 1 })
    expect(by.game).toMatchObject({ minutes: 1500, manual: 1 })
    await fresh.close()
  })
})
