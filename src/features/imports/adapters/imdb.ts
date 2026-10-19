/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 */
// IMDb list / watchlist / ratings CSV export.
// Columns (verified on a real export): Position, Const, Created, Modified,
// Description, Title, Original Title, URL, Title Type, IMDb Rating,
// Runtime (mins), Year, Genres, Num Votes, Release Date, Directors,
// Your Rating, Date Rated. The ratings export has the same core columns.
// IMDb has no watch status or watch dates — see docs/IMPORT_MAPPING.md.
import { isISODate } from '@/lib/dates'
import { tenPointToHalfStars } from '@/lib/rating'
import type { LibraryStatus, MediaCategory } from '@/types/db'
import { csvObjects } from '../csv'
import type { ImportAdapter, InvalidRecord, NormalizedRecord, ParseResult } from '../types'

const MOVIE_TYPES: Record<string, string> = {
  movie: 'movie', 'tv movie': 'tv_movie', video: 'video', short: 'short', 'tv short': 'short', 'tv special': 'special',
}
const SERIES_TYPES: Record<string, string> = { 'tv series': 'series', 'tv mini series': 'mini_series', 'tv mini-series': 'mini_series' }

const list = (s: string | undefined) => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean)
const posInt = (s: string | undefined) => {
  const n = Number(s)
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null
}

export function parseImdb(text: string, options: Record<string, string>): ParseResult {
  const { header, rows } = csvObjects(text)
  const records: NormalizedRecord[] = []
  const invalid: InvalidRecord[] = []
  const animatedSeriesTo = (options.animatedSeries ?? 'animated_series') as MediaCategory
  const ratedStatus = (options.ratedStatus ?? 'completed') as LibraryStatus
  const unrated = options.unratedStatus ?? 'planning'

  for (const { line, values: v, malformed } of rows) {
    const id = v['Const']
    const key = `imdb:${id || `line${line}`}`
    if (malformed) { invalid.push({ source_key: key, row_number: line, raw: v, reason: 'Wrong number of columns' }); continue }
    if (!/^tt\d+$/.test(id ?? '')) { invalid.push({ source_key: key, row_number: line, raw: v, reason: 'Missing or invalid IMDb id (Const)' }); continue }
    const title = v['Title']
    if (!title) { invalid.push({ source_key: key, row_number: line, raw: v, reason: 'Missing title' }); continue }

    const type = (v['Title Type'] ?? '').toLowerCase()
    const genres = list(v['Genres'])
    const warnings: string[] = []
    let category: MediaCategory
    let format: string | null
    let needsReview: string | undefined
    let defaultSkip: string | undefined
    if (MOVIE_TYPES[type]) {
      category = 'movie'
      format = MOVIE_TYPES[type]
    } else if (SERIES_TYPES[type]) {
      format = SERIES_TYPES[type]
      if (genres.includes('Animation')) {
        // IMDb cannot tell anime from western animation; never decided silently.
        category = animatedSeriesTo
        // Anime uses its own format list (a series is 'tv').
        if (category === 'anime') format = 'tv'
        needsReview = 'Animated series — check whether it belongs in Anime, Animated Series or TV Series'
      } else category = 'tv_series'
    } else if (type === 'tv episode' || type === 'podcast episode') {
      category = 'movie'
      format = 'other'
      defaultSkip = 'Single episode — not a movie or a series'
    } else {
      category = 'movie'
      format = 'other'
      needsReview = `Unknown IMDb title type “${v['Title Type']}”`
    }

    const yearNum = posInt(v['Year'])
    const releaseDate = isISODate(v['Release Date']) ? v['Release Date'] : null
    if (v['Release Date'] && !releaseDate) warnings.push(`Partial release date “${v['Release Date']}” — only the year is kept`)
    const rating = tenPointToHalfStars(v['Your Rating'])
    const runtime = posInt(v['Runtime (mins)'])
    const added = isISODate(v['Created']) ? `${v['Created']}T00:00:00Z` : null
    const imdbRating = Number(v['IMDb Rating'])

    let status: LibraryStatus
    let wishlisted = false
    if (rating != null) status = ratedStatus
    else if (unrated === 'wishlist') { status = 'planning'; wishlisted = true }
    else status = unrated as LibraryStatus

    records.push({
      source_key: key,
      row_number: line,
      raw: v,
      media: {
        category,
        title,
        original_title: v['Original Title'] && v['Original Title'] !== title ? v['Original Title'] : null,
        format,
        release_year: yearNum && yearNum >= 1800 && yearNum <= 2200 ? yearNum : null,
        release_date: releaseDate,
        // IMDb's runtime for series is sometimes not a per-episode length (e.g. 1611): ignore implausible values.
        ...(category === 'movie' ? { runtime } : { episode_duration: runtime && runtime <= 150 ? runtime : null }),
        details: {
          ...(list(v['Directors']).length ? { directors: list(v['Directors']) } : {}),
          ...(Number.isFinite(imdbRating) && imdbRating > 0 ? { imdb_rating: imdbRating } : {}),
        },
      },
      titles: [],
      genres,
      external_ids: [{ provider: 'imdb', external_id: id, url: v['URL'] || `https://www.imdb.com/title/${id}/` }],
      entry: {
        status,
        rating,
        added_at: added,
        ...(wishlisted && added ? { wishlisted_at: added } : wishlisted ? { wishlisted_at: new Date().toISOString() } : {}),
      },
      warnings,
      needsReview,
      defaultSkip,
    })
  }
  return { source: 'imdb_csv', records, invalid, meta: { columns: header, rows: rows.length } }
}

export const imdbAdapter: ImportAdapter = {
  source: 'imdb_csv',
  label: 'IMDb (list / watchlist / ratings CSV)',
  detect: (name, head) => /^(Position,)?Const,/.test(head.charCodeAt(0) === 0xfeff ? head.slice(1) : head) || (/\.csv$/i.test(name) && /\bConst\b/.test(head) && /Title Type/.test(head)),
  options: [
    {
      key: 'ratedStatus',
      label: 'Titles you rated',
      description: 'IMDb has no watch status. A rating usually means you watched it.',
      choices: [{ value: 'completed', label: 'Completed / Watched' }, { value: 'planning', label: 'Planning' }],
      default: 'completed',
    },
    {
      key: 'unratedStatus',
      label: 'Titles without your rating',
      description: 'Choose what an unrated title in this list means.',
      choices: [
        { value: 'planning', label: 'Planning' },
        { value: 'wishlist', label: 'Planning + Wishlist' },
        { value: 'completed', label: 'Completed / Watched' },
      ],
      default: 'planning',
    },
    {
      key: 'animatedSeries',
      label: 'Series with the Animation genre',
      description: 'IMDb does not separate anime from western animation. Each one is marked for review.',
      choices: [
        { value: 'animated_series', label: 'Animated Series' },
        { value: 'anime', label: 'Anime' },
        { value: 'tv_series', label: 'TV Series' },
      ],
      default: 'animated_series',
    },
  ],
  parse: parseImdb,
}
