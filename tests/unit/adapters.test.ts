// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { parseBackloggd } from '@/features/imports/adapters/backloggd'
import { parseImdb } from '@/features/imports/adapters/imdb'
import { malDate, parseMal } from '@/features/imports/adapters/mal'
import { parseCsv } from '@/features/imports/csv'
import { buildPlan, diffEntry } from '@/features/imports/pipeline'

const fx = (f: string) => readFileSync(join(__dirname, '..', 'fixtures', f), 'utf8')

describe('CSV parser', () => {
  test('handles quotes, embedded commas, escaped quotes, CRLF and BOM', () => {
    const rows = parseCsv('﻿a,b,c\r\n1,"x, y","he said ""hi"""\r\n2,"multi\nline",z\n')
    expect(rows).toEqual([['a', 'b', 'c'], ['1', 'x, y', 'he said "hi"'], ['2', 'multi\nline', 'z']])
  })
})

describe('MyAnimeList adapter', () => {
  const res = parseMal(fx('mal-anime.xml'), {})
  const by = (id: string) => res.records.find((r) => r.source_key === `mal_anime:${id}`)!

  test('maps statuses, scores, dates, progress and repeat counts', () => {
    expect(res.records).toHaveLength(4)
    const sg = by('9253')
    expect(sg.media).toMatchObject({ category: 'anime', title: 'Steins;Gate', format: 'tv', total_episodes: 24 })
    expect(sg.entry).toMatchObject({ status: 'completed', rating: 9, episodes_watched: 24, start_date: '2024-03-12', completion_date: '2024-03-15', imported_repeat_count: 2 })
    expect(sg.entry.notes).toBe('Манга > Аниме')
    expect(sg.external_ids).toEqual([{ provider: 'mal_anime', external_id: '9253', url: 'https://myanimelist.net/anime/9253' }])
  })

  test('score 0 is unrated (null), never zero stars; unknown dates are null', () => {
    const b = by('6408')
    expect(b.entry.rating).toBeNull()
    expect(b.entry.status).toBe('planning')
    expect(b.entry.start_date).toBeNull()
    expect(b.entry.wishlisted_at).toBeUndefined()
  })

  test('unknown total (0) stays unknown and partial dates are dropped with a warning', () => {
    const op = by('21')
    expect(op.media.total_episodes).toBeNull()
    expect(op.entry.episodes_watched).toBe(1102)
    expect(op.entry.start_date).toBeNull()
    expect(op.warnings.join()).toMatch(/Partial/)
  })

  test('progress above the MAL total keeps progress and drops the total; active rewatch becomes a session', () => {
    const cb = by('1')
    expect(cb.media.total_episodes).toBeNull()
    expect(cb.entry.episodes_watched).toBe(30)
    expect(cb.media.format).toBe('other')
    expect(cb.sessions).toEqual([expect.objectContaining({ session_type: 'rewatch', status: 'active' })])
  })

  test('invalid rows are reported, not dropped', () => {
    expect(res.invalid.map((i) => i.reason)).toEqual(['Missing MyAnimeList id', 'Unknown status “Rewatching forever”'])
  })

  test('Plan to Watch -> Wishlist only when chosen', () => {
    const r = parseMal(fx('mal-anime.xml'), { ptwWishlist: 'yes' })
    expect(r.records.find((x) => x.source_key === 'mal_anime:6408')!.entry.wishlisted_at).toBeTruthy()
  })

  test('malDate accepts only complete valid dates', () => {
    expect(malDate('2020-02-30').date).toBeNull()
    expect(malDate('2020-02-29').date).toBe('2020-02-29')
    expect(malDate('0000-00-00')).toEqual({ date: null, partial: false })
  })
})

describe('IMDb adapter', () => {
  const res = parseImdb(fx('imdb-list.csv'), {})
  const by = (id: string) => res.records.find((r) => r.source_key === `imdb:${id}`)!

  test('maps a rated movie; IMDb 8/10 = 4 stars', () => {
    const w = by('tt0910970')
    expect(w.media).toMatchObject({ category: 'movie', format: 'movie', release_year: 2008, release_date: '2008-06-27', runtime: 98 })
    expect(w.media.details).toMatchObject({ directors: ['Andrew Stanton'], imdb_rating: 8.4 })
    expect(w.entry).toMatchObject({ status: 'completed', rating: 8, added_at: '2018-02-05T00:00:00Z' })
    expect(w.genres).toEqual(['Animation', 'Adventure', 'Family', 'Sci-Fi'])
  })

  test('keeps a different original title', () => {
    expect(by('tt3775202').media.original_title).toBe('Ai amu a hîrô')
  })

  test('animated series is flagged for review; plain series is TV', () => {
    expect(by('tt3398228').media.category).toBe('animated_series')
    expect(by('tt3398228').needsReview).toBeTruthy()
    expect(by('tt3398228').entry).toMatchObject({ status: 'planning', rating: null })
    expect(by('tt0903747').media.category).toBe('tv_series')
  })

  test('animated series can be sent to Anime with a valid anime format', () => {
    const r = parseImdb(fx('imdb-list.csv'), { animatedSeries: 'anime' })
    expect(r.records.find((x) => x.source_key === 'imdb:tt3398228')!.media).toMatchObject({ category: 'anime', format: 'tv' })
  })

  test('episodes default to skip; partial release dates keep only the year', () => {
    expect(by('tt0000001').defaultSkip).toBeTruthy()
    const p = by('tt0000002')
    expect(p.media.release_date).toBeNull()
    expect(p.media.release_year).toBe(1998)
    expect(p.media.title).toBe('Partial Date, With Comma')
  })

  test('rows without an IMDb id are invalid', () => {
    expect(res.invalid).toHaveLength(1)
    expect(res.invalid[0].reason).toMatch(/IMDb id/)
  })

  test('unrated -> wishlist option', () => {
    const r = parseImdb(fx('imdb-list.csv'), { unratedStatus: 'wishlist' })
    expect(r.records.find((x) => x.source_key === 'imdb:tt3398228')!.entry.wishlisted_at).toBe('2026-10-17T00:00:00Z')
  })
})

describe('Backloggd adapter', () => {
  const res = parseBackloggd(fx('backloggd.json'), {})
  const by = (id: string) => res.records.find((r) => r.source_key === `backloggd:${id}`)!

  test('maps played game with initial playthrough and replays', () => {
    const h = by('2155')
    expect(h.entry).toMatchObject({ status: 'completed', rating: 9, start_date: '2023-01-02', completion_date: '2023-02-10', is_favorite: true, review: 'Great run.', time_spent_minutes: 51 * 60 })
    expect(h.sessions).toEqual([
      expect.objectContaining({ session_type: 'replay', status: 'completed', start_date: '2024-05-01', end_date: '2024-05-20', rating: 10 }),
      expect.objectContaining({ session_type: 'replay', status: 'abandoned', start_date: '2025-01-01', end_date: null }),
    ])
    expect(res.meta.ratingScale).toBe('half')
  })

  test('backlog + wishlist, playing, and unlogged games', () => {
    expect(by('999').entry).toMatchObject({ status: 'planning', rating: null })
    expect(by('999').entry.wishlisted_at).toBeTruthy()
    expect(by('456').entry.status).toBe('in_progress')
    expect(res.invalid.map((i) => i.source_key)).toEqual(['backloggd:123'])
  })

  test('star-scale files are detected', () => {
    const json = JSON.stringify([{ id: 1, name: 'X', playthroughs: {}, game_log: { is_play: true, rating: 3.5 } }])
    const r = parseBackloggd(json, {})
    expect(r.meta.ratingScale).toBe('stars')
    expect(r.records[0].entry.rating).toBe(7)
  })

  test('invalid JSON is reported', () => {
    expect(parseBackloggd('{nope', {}).invalid[0].reason).toMatch(/not valid JSON/)
  })
})

describe('import planning', () => {
  test('diffEntry separates conflicts from safe fills', () => {
    const rec = parseMal(fx('mal-anime.xml'), {}).records[0]
    const diffs = diffEntry(rec, { status: 'completed', rating: 6, episodes_watched: 24, notes: null, start_date: null })
    expect(diffs.find((d) => d.field === 'rating')).toMatchObject({ type: 'conflict', current: 6, imported: 9 })
    expect(diffs.find((d) => d.field === 'notes')).toMatchObject({ type: 'fill' })
    expect(diffs.find((d) => d.field === 'status')).toBeUndefined()
  })

  test('buildPlan classifies new / existing / duplicate / skip / review and flags repeated rows', () => {
    const parsed = parseImdb(fx('imdb-list.csv'), {})
    parsed.records.push({ ...parsed.records[0] })
    const matches = new Map([
      ['imdb:tt0910970', { source_key: 'imdb:tt0910970', match: 'external_id' as const, media_id: 'm1', entry: { rating: 6, status: 'completed' as const }, media: null, candidates: [] }],
      ['imdb:tt3775202', { source_key: 'imdb:tt3775202', match: 'none' as const, media_id: null, entry: null, media: null, candidates: [{ media_id: 'x', entry_id: 'y', title: 'I Am a Hero', release_year: 2015, format: 'movie', external_ids: [] }] }],
    ])
    const plan = buildPlan(parsed, matches)
    const kinds = Object.fromEntries(plan.map((p) => [p.record.source_key + (p.kind === 'invalid' ? '#dup' : ''), p.kind]))
    expect(kinds).toMatchObject({
      'imdb:tt0910970': 'existing', 'imdb:tt3775202': 'duplicate', 'imdb:tt3398228': 'review',
      'imdb:tt0903747': 'new', 'imdb:tt0000001': 'skip', 'imdb:tt0910970#dup': 'invalid',
    })
    const existing = plan.find((p) => p.kind === 'existing')!
    expect(existing.decision).toBe('merge')
    expect(existing.applyFields).toEqual([])
  })
})

// Optional: run the adapters on the owner's real exports (read-only).
const REAL = process.env.RUBAKA_REAL_EXPORTS
const realFile = (re: RegExp) => {
  if (!REAL || !existsSync(REAL)) return null
  const name = readdirSync(REAL).find((f) => re.test(f))
  return name ? join(REAL, name) : null
}

describe.skipIf(!REAL)('real exports (RUBAKA_REAL_EXPORTS)', () => {
  test('MAL anime + manga parse completely', () => {
    for (const re of [/^animelist_.*\.xml\.gz$/, /^mangalist_.*\.xml\.gz$/]) {
      const f = realFile(re)
      if (!f) continue
      const res = parseMal(gunzipSync(readFileSync(f)).toString('utf8'), {})
      expect(res.invalid).toEqual([])
      expect(res.records.length).toBe(res.meta.parsed)
      expect(res.records.every((r) => r.entry.rating == null || (r.entry.rating >= 1 && r.entry.rating <= 10))).toBe(true)
      console.log(`${res.meta.kind}: ${res.records.length} records, ${res.records.filter((r) => r.warnings.length).length} with warnings`)
    }
  })

  test('IMDb CSV parses completely', () => {
    const f = realFile(/^[0-9a-f-]{36}\.csv$/)
    if (!f) return
    const res = parseImdb(readFileSync(f, 'utf8'), {})
    expect(res.invalid).toEqual([])
    const cats = res.records.reduce<Record<string, number>>((m, r) => ({ ...m, [r.media.category]: (m[r.media.category] ?? 0) + 1 }), {})
    console.log('IMDb', res.records.length, cats, 'skip', res.records.filter((r) => r.defaultSkip).length, 'review', res.records.filter((r) => r.needsReview).length)
  })
})
