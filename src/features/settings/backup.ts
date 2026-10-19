/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 */
// Backup / restore in RUBAKA's own format. Versioned so older backups keep
// working: restore_rows() maps columns by name from the live schema, and
// newer-than-supported versions are rejected.
import { z } from 'zod'
import { assetUrl, supabase, unwrap } from '@/lib/supabase'
import { chunk } from '@/lib/utils'
import type { MediaCategory } from '@/types/db'

export const BACKUP_FORMAT = 'rubaka-backup'
export const BACKUP_VERSION = 1

/** Restore order respects foreign keys. */
export const TABLES = [
  'franchises', 'media', 'media_titles', 'media_external_ids', 'media_seasons', 'media_relations',
  'library_entries', 'entry_season_progress', 'tracking_sessions', 'vn_routes', 'activity_log', 'user_settings',
] as const
type Table = (typeof TABLES)[number]

export interface Backup {
  format: typeof BACKUP_FORMAT
  version: number
  app: 'RUBAKA'
  exported_at: string
  scope: 'full' | MediaCategory
  /** Categories included (absent = all). */
  categories?: MediaCategory[]
  counts: Record<string, number>
  tables: Partial<Record<Table, Record<string, unknown>[]>> & { media_genres?: { media_id: string; genre: string }[] }
  /** Readable copy of the library (not used for restore). */
  library?: ReturnType<typeof buildLibrary>
}

export const backupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.number().int().min(1).max(BACKUP_VERSION, `This backup was made by a newer RUBAKA version (> ${BACKUP_VERSION})`),
  app: z.literal('RUBAKA').optional(),
  exported_at: z.string(),
  scope: z.string(),
  counts: z.record(z.string(), z.number()).optional(),
  tables: z.object({
    ...Object.fromEntries(TABLES.map((t) => [t, z.array(z.record(z.string(), z.unknown())).optional()])),
    media_genres: z.array(z.object({ media_id: z.string(), genre: z.string() })).optional(),
  }),
})

const PAGE = 1000

async function fetchAll(table: string, order: string, filter?: { column: string; values: string[] }): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  if (filter) {
    for (const ids of chunk(filter.values, 200)) {
      for (let from = 0; ; from += PAGE) {
        const rows = unwrap(await supabase.from(table).select('*').in(filter.column, ids).order(order).range(from, from + PAGE - 1), `export ${table}`) as Record<string, unknown>[]
        out.push(...rows)
        if (rows.length < PAGE) break
      }
    }
    return out
  }
  for (let from = 0; ; from += PAGE) {
    const rows = unwrap(await supabase.from(table).select('*').order(order).range(from, from + PAGE - 1), `export ${table}`) as Record<string, unknown>[]
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

/**
 * Build a backup: everything, or only some categories (with everything that
 * hangs off them). `includeHistory` adds the activity log and settings.
 * Besides the restorable `tables`, the file carries `library`: one readable
 * record per title (status, rating, progress, repeats, dates, time, cover
 * URLs, genres, ids, notes, sessions) so the backup is usable on its own.
 */
export async function exportBackup(
  scope: 'full' | MediaCategory | MediaCategory[],
  onProgress?: (msg: string) => void,
  opts: { includeHistory?: boolean } = {},
): Promise<Backup> {
  const cats = scope === 'full' ? null : Array.isArray(scope) ? scope : [scope]
  const partial = cats != null && cats.length < 8
  const tables: Backup['tables'] = {}
  onProgress?.('media')
  const media = !partial
    ? await fetchAll('media', 'id')
    : (await fetchAll('media', 'id')).filter((m) => cats!.includes(m.category as MediaCategory))
  tables.media = media
  // Franchises the exported titles belong to (all of them in a full backup).
  const fids = new Set(media.map((m) => m.franchise_id as string | null).filter(Boolean))
  tables.franchises = (await fetchAll('franchises', 'id')).filter((f) => !partial || fids.has(f.id as string))
  const mediaIds = media.map((m) => m.id as string)
  const byMedia = !partial ? undefined : { column: 'media_id', values: mediaIds }

  for (const t of ['media_titles', 'media_external_ids', 'media_seasons', 'media_relations', 'library_entries'] as const) {
    onProgress?.(t)
    tables[t] = await fetchAll(t, t === 'media_external_ids' ? 'provider' : t === 'media_seasons' ? 'media_id' : 'id', byMedia)
  }
  onProgress?.('genres')
  const genreRows: { media_id: string; genres: { name: string } | null }[] = []
  for (let from = 0; ; from += PAGE) {
    const rows = unwrap(await supabase.from('media_genres').select('media_id, genres(name)').order('media_id').order('genre_id').range(from, from + PAGE - 1), 'export genres') as unknown as typeof genreRows
    genreRows.push(...rows)
    if (rows.length < PAGE) break
  }
  const idSet = new Set(mediaIds)
  tables.media_genres = genreRows.filter((g) => g.genres && idSet.has(g.media_id)).map((g) => ({ media_id: g.media_id, genre: g.genres!.name }))

  const entryIds = (tables.library_entries ?? []).map((e) => e.id as string)
  const byEntry = !partial ? undefined : { column: 'entry_id', values: entryIds }
  for (const t of ['entry_season_progress', 'tracking_sessions', 'vn_routes'] as const) {
    onProgress?.(t)
    tables[t] = await fetchAll(t, t === 'entry_season_progress' ? 'entry_id' : 'id', byEntry)
  }
  if (opts.includeHistory ?? !partial) {
    onProgress?.('activity')
    tables.activity_log = await fetchAll('activity_log', 'id')
    tables.user_settings = await fetchAll('user_settings', 'user_id')
  }
  const counts = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, (v as unknown[]).length]))
  return {
    format: BACKUP_FORMAT, version: BACKUP_VERSION, app: 'RUBAKA', exported_at: new Date().toISOString(),
    scope: !partial ? 'full' : cats!.length === 1 ? cats![0] : 'full',
    categories: cats ?? undefined,
    counts, tables,
    library: buildLibrary(tables),
  }
}

/** Human-readable, self-contained view of the library (one record per title). */
export function buildLibrary(t: Backup['tables']) {
  const entries = new Map((t.library_entries ?? []).map((e) => [e.media_id as string, e]))
  const group = <T extends Record<string, unknown>>(rows: T[] | undefined, key: string) => {
    const m = new Map<string, T[]>()
    for (const r of rows ?? []) m.set(r[key] as string, [...(m.get(r[key] as string) ?? []), r])
    return m
  }
  const titles = group(t.media_titles, 'media_id')
  const ids = group(t.media_external_ids, 'media_id')
  const genres = group(t.media_genres as Record<string, unknown>[] | undefined, 'media_id')
  const sessions = group(t.tracking_sessions, 'entry_id')
  const seasons = group(t.entry_season_progress, 'entry_id')
  return (t.media ?? []).map((m) => {
    const e = (entries.get(m.id as string) ?? {}) as Record<string, unknown>
    return {
      title: m.title, original_title: m.original_title, category: m.category, format: m.format,
      release_year: m.release_year, release_status: m.release_status,
      status: e.status, rating_stars: e.rating != null ? Number(e.rating) / 2 : null,
      progress: { episodes: e.episodes_watched, chapters: e.chapters_read, volumes: e.volumes_read, current_season: e.current_season, current_episode: e.current_episode },
      totals: { episodes: m.total_episodes, chapters: m.total_chapters, volumes: m.total_volumes, seasons: m.total_seasons },
      repeats: { total: e.repeat_count, undated: e.imported_repeat_count, logged: e.session_repeat_count },
      start_date: e.start_date, completion_date: e.completion_date, added_at: e.added_at,
      favorite: e.is_favorite, wishlist: !!e.wishlisted_at, time_spent_minutes: e.time_spent_minutes ?? null,
      poster_url: m.poster_url, custom_cover_url: assetUrl(m.custom_poster_path as string | null), backdrop_url: m.backdrop_url,
      genres: (genres.get(m.id as string) ?? []).map((g) => g.genre),
      alternative_titles: (titles.get(m.id as string) ?? []).map((x) => x.title),
      external_ids: Object.fromEntries((ids.get(m.id as string) ?? []).map((x) => [x.provider, x.url ?? x.external_id])),
      notes: e.notes ?? null, review: e.review ?? null,
      seasons: (seasons.get(e.id as string) ?? []).map((s) => ({ season: s.season_number, episodes: s.episodes_watched })),
      sessions: (sessions.get(e.id as string) ?? []).map((s) => ({
        type: s.session_type, status: s.status, start: s.start_date, end: s.end_date,
        rating_stars: s.rating != null ? Number(s.rating) / 2 : null, notes: s.notes,
      })),
    }
  })
}

export async function currentCounts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  await Promise.all(['media', 'library_entries', 'tracking_sessions', 'activity_log'].map(async (t) => {
    const { count } = await supabase.from(t).select('*', { count: 'exact', head: true })
    out[t] = count ?? 0
  }))
  return out
}

export function parseBackup(text: string): { backup: Backup } | { error: string } {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { error: 'The file is not valid JSON.' }
  }
  const res = backupSchema.safeParse(json)
  if (!res.success) {
    const issue = res.error.issues[0]
    return { error: issue.path[0] === 'format' ? 'This is not a RUBAKA backup file.' : `Invalid backup: ${issue.message} (${issue.path.join('.')})` }
  }
  return { backup: res.data as unknown as Backup }
}

/**
 * Restore. mode "replace" wipes the library first (caller must have confirmed);
 * "merge" only adds rows whose ids do not exist yet (existing data wins) and
 * skips the activity log to avoid duplicating history.
 */
export async function restoreBackup(input: Backup, mode: 'merge' | 'replace', onProgress: (msg: string, done: number, total: number) => void) {
  let b = input
  if (mode === 'replace') {
    onProgress('Deleting current library…', 0, 1)
    unwrap(await supabase.rpc('wipe_library', { p_confirm: 'DELETE MY LIBRARY' }), 'wipe')
  } else {
    onProgress('Checking for titles you already have…', 0, 1)
    b = await withoutKnownTitles(b)
  }
  const result: Record<string, number> = {}
  const order = TABLES.filter((t) => !(mode === 'merge' && t === 'activity_log'))
  const total = order.reduce((n, t) => n + (b.tables[t]?.length ?? 0), 0) + (b.tables.media_genres?.length ?? 0)
  let done = 0
  for (const t of order) {
    const rows = b.tables[t] ?? []
    result[t] = 0
    for (const part of chunk(rows, 500)) {
      onProgress(`Restoring ${t.replace(/_/g, ' ')}…`, done, total)
      result[t] += unwrap(await supabase.rpc('restore_rows', { p_table: t, p_rows: part }), `restore ${t}`) as number
      done += part.length
    }
    if (t === 'media' && b.tables.media_genres?.length) {
      result.media_genres = 0
      for (const part of chunk(b.tables.media_genres, 1000)) {
        onProgress('Restoring genres…', done, total)
        result.media_genres += unwrap(await supabase.rpc('restore_media_genres', { p_rows: part }), 'restore genres') as number
        done += part.length
      }
    }
  }
  await supabase.rpc('restore_finish', { p_summary: { mode, exported_at: b.exported_at, restored: result } })
  return result
}

/**
 * Merge mode: a title whose external id already exists in the library under a
 * different row id is the same work — drop it (and everything hanging off it)
 * from the backup so merging never duplicates titles.
 */
async function withoutKnownTitles(b: Backup): Promise<Backup> {
  const ext = (b.tables.media_external_ids ?? []) as { provider: string; external_id: string; media_id: string }[]
  const known = new Set<string>()
  for (const part of chunk(ext, 200)) {
    const rows = unwrap(await supabase.from('media_external_ids').select('provider, external_id, media_id')
      .in('external_id', part.map((x) => x.external_id)), 'existing ids') as { provider: string; external_id: string; media_id: string }[]
    const backupOwner = new Map(part.map((x) => [`${x.provider}:${x.external_id}`, x.media_id]))
    for (const r of rows) {
      const owner = backupOwner.get(`${r.provider}:${r.external_id}`)
      if (owner && owner !== r.media_id) known.add(owner)
    }
  }
  if (!known.size) return b
  const drop = (rows: Record<string, unknown>[] | undefined, col = 'media_id') => rows?.filter((r) => !known.has(r[col] as string))
  const keptEntries = drop(b.tables.library_entries) ?? []
  const entryIds = new Set(keptEntries.map((e) => e.id as string))
  const byEntry = (rows: Record<string, unknown>[] | undefined) => rows?.filter((r) => entryIds.has(r.entry_id as string))
  return {
    ...b,
    tables: {
      ...b.tables,
      media: drop(b.tables.media, 'id'),
      media_titles: drop(b.tables.media_titles),
      media_external_ids: drop(b.tables.media_external_ids),
      media_seasons: drop(b.tables.media_seasons),
      media_relations: drop(b.tables.media_relations),
      media_genres: b.tables.media_genres?.filter((g) => !known.has(g.media_id)),
      library_entries: keptEntries,
      entry_season_progress: byEntry(b.tables.entry_season_progress),
      tracking_sessions: byEntry(b.tables.tracking_sessions),
      vn_routes: byEntry(b.tables.vn_routes),
    },
  }
}

// ---------------------------------------------------------------- CSV
const csvCell = (v: unknown) => {
  if (v == null) return ''
  const s = Array.isArray(v) ? v.join('; ') : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Flat, spreadsheet-friendly export of the library (one row per title). */
export function backupToCsv(b: Backup): string {
  const genres = new Map<string, string[]>()
  for (const g of b.tables.media_genres ?? []) genres.set(g.media_id, [...(genres.get(g.media_id) ?? []), g.genre])
  const ids = new Map<string, string[]>()
  for (const x of b.tables.media_external_ids ?? []) ids.set(x.media_id as string, [...(ids.get(x.media_id as string) ?? []), `${x.provider}:${x.external_id}`])
  const entries = new Map((b.tables.library_entries ?? []).map((e) => [e.media_id as string, e]))
  const header = ['title', 'original_title', 'category', 'format', 'release_year', 'status', 'rating_stars', 'episodes_watched', 'total_episodes',
    'chapters_read', 'total_chapters', 'volumes_read', 'total_volumes', 'routes_completed', 'start_date', 'completion_date', 'repeat_count',
    'favorite', 'wishlist', 'added_at', 'genres', 'external_ids', 'notes', 'review']
  const lines = [header.join(',')]
  for (const m of b.tables.media ?? []) {
    const e = entries.get(m.id as string) ?? {}
    const row = [m.title, m.original_title, m.category, m.format, m.release_year, e.status, e.rating != null ? Number(e.rating) / 2 : null,
      e.episodes_watched, m.total_episodes, e.chapters_read, m.total_chapters, e.volumes_read, m.total_volumes, e.routes_completed,
      e.start_date, e.completion_date, e.repeat_count, e.is_favorite, e.wishlisted_at ? 'yes' : '', e.added_at,
      genres.get(m.id as string), ids.get(m.id as string), e.notes, e.review]
    lines.push(row.map(csvCell).join(','))
  }
  return `${String.fromCharCode(0xfeff)}${lines.join('\r\n')}\r\n`
}
