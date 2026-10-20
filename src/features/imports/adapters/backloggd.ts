/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 */
// Backloggd export produced by the Toolkittd browser extension
// (https://github.com/jolacdev/toolkittd). JSON = array of:
//   { id, name, most_recent_playthrough_id, playthroughs: { [id]: Playthrough }, game_log?: GameLog }
// Types taken from the extension source (entrypoints/backloggd.content/shared/types/api.ts).
// Total hours/minutes from the game log become the entry's time spent.
import { isISODate } from '@/lib/dates'
import type { LibraryStatus } from '@/types/db'
import type { ImportAdapter, InvalidRecord, NormalizedRecord, ParseResult } from '../types'

interface Playthrough {
  id: number
  created_at?: string
  start_date: string | null
  finish_date: string | null
  is_replay: boolean
  is_master?: boolean
  rating?: number
  review?: string
  title?: string
}
interface GameLog {
  game_liked?: boolean
  is_backlog?: boolean
  is_play?: boolean
  is_playing?: boolean
  is_wishlist?: boolean
  rating?: number
  total_hours?: number
  total_minutes?: number
}
interface BackloggdGame {
  id: string | number
  name: string
  most_recent_playthrough_id?: number | null
  playthroughs?: Record<string, Playthrough>
  game_log?: GameLog
}

const dateOnly = (s: string | null | undefined) => {
  const d = s?.slice(0, 10)
  return d && isISODate(d) ? d : null
}

/**
 * Backloggd stores half-star ratings; the export scale is not documented.
 * "half": integers 1..10 (5 = 2.5 stars). "stars": 0.5..5. "auto" decides
 * from the whole file: any value above 5 => half-stars; any fractional value
 * => stars; otherwise half-stars (the internal API format).
 */
function detectScale(games: BackloggdGame[]): 'half' | 'stars' {
  const values = games.flatMap((g) => [g.game_log?.rating, ...Object.values(g.playthroughs ?? {}).map((p) => p.rating)])
    .filter((v): v is number => typeof v === 'number' && v > 0)
  if (values.some((v) => v > 5)) return 'half'
  if (values.some((v) => !Number.isInteger(v))) return 'stars'
  return 'half'
}

/** Logged play time in minutes (0 / missing = unknown). */
function playedMinutes(log: GameLog): number | null {
  const m = Math.round((Number(log.total_hours) || 0) * 60 + (Number(log.total_minutes) || 0))
  return m > 0 ? m : null
}

export function parseBackloggd(text: string, options: Record<string, string>): ParseResult {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { source: 'backloggd_json', records: [], invalid: [{ source_key: 'file', row_number: 0, raw: text.slice(0, 200), reason: 'File is not valid JSON' }], meta: {} }
  }
  const games = (Array.isArray(data) ? data : []) as BackloggdGame[]
  const scale = options.ratingScale === 'stars' || options.ratingScale === 'half' ? options.ratingScale : detectScale(games)
  const toHalf = (v: number | undefined) => {
    if (typeof v !== 'number' || !(v > 0)) return null
    const h = scale === 'stars' ? Math.round(v * 2) : Math.round(v)
    return h >= 1 && h <= 10 ? h : null
  }
  const playedAs = (options.playedStatus ?? 'completed') as LibraryStatus
  const records: NormalizedRecord[] = []
  const invalid: InvalidRecord[] = []

  games.forEach((g, i) => {
    const row = i + 1
    const id = g?.id != null ? String(g.id) : ''
    const key = `backloggd:${id || `row${row}`}`
    if (!id) return invalid.push({ source_key: key, row_number: row, raw: g, reason: 'Missing Backloggd game id' })
    if (!g.name?.trim()) return invalid.push({ source_key: key, row_number: row, raw: g, reason: 'Missing game name' })
    const log = g.game_log
    if (!log) return invalid.push({ source_key: key, row_number: row, raw: g, reason: 'Game has no log on Backloggd (nothing to import)' })

    const warnings: string[] = []
    // Status priority: playing > played > backlog. Wishlist is independent.
    let status: LibraryStatus = 'planning'
    if (log.is_playing) status = 'in_progress'
    else if (log.is_play) status = playedAs
    else if (log.is_backlog) status = 'planning'

    const pts = Object.values(g.playthroughs ?? {}).sort((a, b) =>
      (dateOnly(a.start_date) ?? dateOnly(a.finish_date) ?? a.created_at ?? '').localeCompare(dateOnly(b.start_date) ?? dateOnly(b.finish_date) ?? b.created_at ?? ''))
    const first = pts.find((p) => !p.is_replay) ?? null
    const replays = pts.filter((p) => p.is_replay)
    const start = dateOnly(first?.start_date)
    let finish = dateOnly(first?.finish_date)
    if (start && finish && finish < start) { warnings.push('Finish date before start date — finish date not imported'); finish = null }

    const sessions: NonNullable<NormalizedRecord['sessions']> = []
    let activeUsed = false
    for (const r of replays) {
      const s = dateOnly(r.start_date)
      const e = dateOnly(r.finish_date)
      // A replay counts only when finished. An unfinished one is the active
      // replay if the game is currently being played; otherwise it is kept
      // (with its dates) as abandoned so it is visible but not counted.
      const st = e ? 'completed' : log.is_playing && !activeUsed ? 'active' : 'abandoned'
      if (st === 'active') activeUsed = true
      if (st === 'abandoned') warnings.push('Replay without a finish date imported as not completed')
      sessions.push({
        session_type: 'replay', status: st, start_date: s, end_date: e && s && e < s ? null : e,
        rating: toHalf(r.rating), notes: r.review?.trim() || (st === 'abandoned' ? 'Imported from Backloggd without a finish date' : null),
      })
    }

    records.push({
      source_key: key,
      row_number: row,
      raw: g,
      media: { category: 'game', title: g.name.trim() },
      titles: [],
      genres: [],
      // Backloggd game ids are IGDB ids: metadata is then fetched by id, never guessed by title.
      external_ids: [{ provider: 'backloggd', external_id: id }, ...(/^\d+$/.test(id) ? [{ provider: 'igdb' as const, external_id: id }] : [])],
      entry: {
        status,
        rating: toHalf(log.rating) ?? toHalf(first?.rating),
        start_date: start,
        completion_date: status === 'completed' ? finish : null,
        is_favorite: log.game_liked === true,
        review: first?.review?.trim() || null,
        ...(playedMinutes(log) ? { time_spent_minutes: playedMinutes(log) } : {}),
        ...(log.is_wishlist ? { wishlisted_at: new Date().toISOString() } : {}),
      },
      sessions: sessions.length ? sessions : undefined,
      warnings,
    })
  })
  return { source: 'backloggd_json', records, invalid, meta: { games: games.length, ratingScale: scale } }
}

export const backloggdAdapter: ImportAdapter = {
  source: 'backloggd_json',
  label: 'Backloggd (Toolkittd JSON export)',
  detect: (name, head) => /\.json$/i.test(name) && /"(game_log|playthroughs|most_recent_playthrough_id)"/.test(head),
  options: [
    {
      key: 'playedStatus',
      label: 'Games marked “Played”',
      description: 'The export does not include the played sub-status (completed / shelved / abandoned).',
      choices: [{ value: 'completed', label: 'Completed' }, { value: 'on_hold', label: 'On Hold' }, { value: 'dropped', label: 'Dropped' }],
      default: 'completed',
    },
    {
      key: 'ratingScale',
      label: 'Rating scale',
      description: 'Detected automatically from the file.',
      choices: [{ value: 'auto', label: 'Auto-detect' }, { value: 'half', label: '1–10 (half-stars)' }, { value: 'stars', label: '0.5–5 (stars)' }],
      default: 'auto',
    },
  ],
  parse: parseBackloggd,
}
