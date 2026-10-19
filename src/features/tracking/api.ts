/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CATEGORY_CONFIG } from '@/lib/categories'
import { todayISO } from '@/lib/dates'
import { friendlyError, supabase, unwrap } from '@/lib/supabase'
import { getSettingsSnapshot } from '@/features/settings/settings-store'
import type {
  ActivityRow, CategorySummary, EntryPatch, LibraryEntry, LibraryItem, LibraryStatus, Media,
  MediaCategory, MediaExternalId, MediaRelation, MediaSeason, MediaTitle, SeasonProgress,
  TrackingSession, VnRoute,
} from '@/types/db'

// ---------------------------------------------------------------- Library query
export interface LibraryParams {
  category?: MediaCategory
  statuses?: LibraryStatus[]
  wishlist?: boolean
  favorite?: boolean
  search?: string
  genres?: string[]
  formats?: string[]
  countries?: string[]
  releaseStatuses?: string[]
  yearMin?: number
  yearMax?: number
  ratingMin?: number
  ratingMax?: number
  rated?: boolean
  minRepeats?: number
  progressMin?: number
  activeRepeat?: boolean
  entryIds?: string[]
  sort?: string
  seed?: string
  limit?: number
  offset?: number
}

export function toRpcArgs(p: LibraryParams) {
  const nonEmpty = <T,>(a?: T[]) => (a && a.length ? a : null)
  return {
    p_category: p.category ?? null,
    p_statuses: nonEmpty(p.statuses),
    p_wishlist: p.wishlist ?? null,
    p_favorite: p.favorite ?? null,
    p_search: p.search?.trim() || null,
    p_genres: nonEmpty(p.genres),
    p_formats: nonEmpty(p.formats),
    p_countries: nonEmpty(p.countries),
    p_release_statuses: nonEmpty(p.releaseStatuses),
    p_year_min: p.yearMin ?? null,
    p_year_max: p.yearMax ?? null,
    p_rating_min: p.ratingMin ?? null,
    p_rating_max: p.ratingMax ?? null,
    p_rated: p.rated ?? null,
    p_min_repeats: p.minRepeats ?? null,
    p_progress_min: p.progressMin ?? null,
    p_active_repeat: p.activeRepeat ?? null,
    p_entry_ids: nonEmpty(p.entryIds),
    p_sort: p.sort ?? 'added_desc',
    p_seed: p.seed ?? '',
    p_limit: p.limit ?? 48,
    p_offset: p.offset ?? 0,
  }
}

export async function fetchLibrary(p: LibraryParams): Promise<{ items: LibraryItem[]; total: number }> {
  const data = unwrap(await supabase.rpc('library_query', toRpcArgs(p)), 'library_query') as LibraryItem[]
  return { items: data, total: data[0] ? Number(data[0].total_count) : 0 }
}

export const keys = {
  library: (p: LibraryParams) => ['library', p] as const,
  facets: (c?: MediaCategory) => ['facets', c ?? 'all'] as const,
  dashboard: ['dashboard'] as const,
  activity: (limit: number) => ['activity', limit] as const,
  detail: (mediaId: string) => ['detail', mediaId] as const,
  stats: (c: MediaCategory | undefined, year: number | undefined) => ['stats', c ?? 'all', year ?? 'current'] as const,
}

export function useLibrary(p: LibraryParams, enabled = true) {
  return useQuery({
    queryKey: keys.library(p),
    queryFn: () => fetchLibrary(p),
    placeholderData: (prev) => prev,
    enabled,
  })
}

export interface Facets {
  genres: { name: string; count: number }[]
  formats: string[]
  countries: string[]
  year_min: number | null
  year_max: number | null
  status_counts: Partial<Record<LibraryStatus, number>>
  wishlist_count: number
  total: number
}

export function useFacets(category?: MediaCategory) {
  return useQuery({
    queryKey: keys.facets(category),
    queryFn: async () => unwrap(await supabase.rpc('library_facets', { p_category: category ?? null }), 'library_facets') as Facets,
    staleTime: 60_000,
  })
}

export function useDashboardSummary() {
  return useQuery({
    queryKey: keys.dashboard,
    queryFn: async () => unwrap(await supabase.rpc('dashboard_summary'), 'dashboard_summary') as CategorySummary[],
    staleTime: 30_000,
  })
}

export function useActivity(limit = 8) {
  return useQuery({
    queryKey: keys.activity(limit),
    queryFn: async () =>
      unwrap(
        await supabase
          .from('activity_log')
          .select('id, entry_id, media_id, category, action, details, created_at, media(title, poster_url, custom_poster_path)')
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(limit),
        'activity',
      ) as unknown as ActivityRow[],
    staleTime: 15_000,
  })
}

// ---------------------------------------------------------------- Detail
export interface MediaDetail {
  media: Media
  entry: LibraryEntry | null
  titles: MediaTitle[]
  externalIds: MediaExternalId[]
  genres: string[]
  seasons: MediaSeason[]
  seasonProgress: SeasonProgress[]
  sessions: TrackingSession[]
  relations: MediaRelation[]
  routes: VnRoute[]
}

export async function fetchDetail(mediaId: string): Promise<MediaDetail | null> {
  const media = unwrap(await supabase.from('media').select('*').eq('id', mediaId).maybeSingle(), 'media') as Media | null
  if (!media) return null
  const [entry, titles, ext, genres, seasons, relations] = await Promise.all([
    supabase.from('library_entries').select('*').eq('media_id', mediaId).maybeSingle(),
    supabase.from('media_titles').select('*').eq('media_id', mediaId).order('kind'),
    supabase.from('media_external_ids').select('*').eq('media_id', mediaId),
    supabase.from('media_genres').select('genres(name)').eq('media_id', mediaId),
    supabase.from('media_seasons').select('*').eq('media_id', mediaId).order('season_number'),
    supabase.from('media_relations').select('*').eq('media_id', mediaId),
  ])
  const e = unwrap(entry, 'entry') as LibraryEntry | null
  const [sessions, progress, routes] = e
    ? await Promise.all([
        supabase.from('tracking_sessions').select('*').eq('entry_id', e.id).order('created_at'),
        supabase.from('entry_season_progress').select('*').eq('entry_id', e.id).order('season_number'),
        supabase.from('vn_routes').select('*').eq('entry_id', e.id).order('sort_order').order('created_at'),
      ])
    : [null, null, null]
  return {
    media,
    entry: e,
    titles: (unwrap(titles, 'titles') ?? []) as MediaTitle[],
    externalIds: (unwrap(ext, 'external ids') ?? []) as MediaExternalId[],
    genres: ((unwrap(genres, 'genres') ?? []) as unknown as { genres: { name: string } | null }[])
      .map((g) => g.genres?.name).filter((n): n is string => !!n).sort(),
    seasons: (unwrap(seasons, 'seasons') ?? []) as MediaSeason[],
    seasonProgress: (progress ? unwrap(progress, 'season progress') : []) as SeasonProgress[],
    sessions: (sessions ? unwrap(sessions, 'sessions') : []) as TrackingSession[],
    relations: (unwrap(relations, 'relations') ?? []) as MediaRelation[],
    routes: (routes ? unwrap(routes, 'routes') : []) as VnRoute[],
  }
}

export function useMediaDetail(mediaId: string | undefined) {
  return useQuery({
    queryKey: keys.detail(mediaId ?? ''),
    queryFn: () => fetchDetail(mediaId!),
    enabled: !!mediaId,
  })
}

// ---------------------------------------------------------------- Cache helpers
/** Invalidate every aggregate view after a write. Lists are refetched lazily. */
export function invalidateLibrary(qc: QueryClient, mediaId?: string) {
  qc.invalidateQueries({ queryKey: ['library'] })
  qc.invalidateQueries({ queryKey: ['facets'] })
  qc.invalidateQueries({ queryKey: keys.dashboard })
  qc.invalidateQueries({ queryKey: ['activity'] })
  qc.invalidateQueries({ queryKey: ['stats'] })
  if (mediaId) qc.invalidateQueries({ queryKey: keys.detail(mediaId) })
}

type Snapshot = [readonly unknown[], unknown][]

/** Apply a patch to every cached list row + the detail cache; returns a snapshot for rollback. */
function optimisticPatch(qc: QueryClient, entryIds: string[], patch: Partial<LibraryItem>, mediaId?: string): Snapshot {
  const snap: Snapshot = []
  const ids = new Set(entryIds)
  for (const [key, data] of qc.getQueriesData<{ items: LibraryItem[]; total: number }>({ queryKey: ['library'] })) {
    if (!data?.items) continue
    snap.push([key, data])
    qc.setQueryData(key, { ...data, items: data.items.map((it) => (ids.has(it.entry_id) ? { ...it, ...patch } : it)) })
  }
  if (mediaId) {
    const key = keys.detail(mediaId)
    const d = qc.getQueryData<MediaDetail | null>(key)
    if (d?.entry) {
      snap.push([key, d])
      qc.setQueryData(key, { ...d, entry: { ...d.entry, ...patch } })
    }
  }
  return snap
}

function rollback(qc: QueryClient, snap: Snapshot | undefined) {
  snap?.forEach(([key, data]) => qc.setQueryData(key, data))
}

// ---------------------------------------------------------------- Entry mutations
type EntryLike = Pick<LibraryItem, 'category' | 'status' | 'start_date' | 'completion_date' | 'episodes_watched' | 'chapters_read' | 'volumes_read' | 'routes_completed'> &
  Partial<Pick<LibraryItem, 'total_episodes' | 'total_chapters' | 'total_volumes' | 'total_routes'>>

/**
 * Side effects of a status change (never overwriting data that is already set):
 *  - completed: completion date = today if empty; progress filled to the known
 *    total when the setting is on (unknown totals are left alone);
 *  - in progress: start date = today if empty.
 */
export function buildStatusPatch(entry: EntryLike, status: LibraryStatus): EntryPatch {
  const patch: EntryPatch = { status }
  const today = todayISO()
  if (status === 'completed') {
    if (!entry.completion_date) patch.completion_date = today
    if (getSettingsSnapshot().fillProgressOnComplete) {
      const cfg = CATEGORY_CONFIG[entry.category]
      if (cfg.progress === 'episodes' && entry.total_episodes && entry.episodes_watched < entry.total_episodes) patch.episodes_watched = entry.total_episodes
      if (cfg.progress === 'chapters' && entry.total_chapters && entry.chapters_read < entry.total_chapters) patch.chapters_read = entry.total_chapters
      if (cfg.volumes && entry.total_volumes && entry.volumes_read < entry.total_volumes) patch.volumes_read = entry.total_volumes
      if (cfg.progress === 'routes' && entry.total_routes && entry.routes_completed < entry.total_routes) patch.routes_completed = entry.total_routes
    }
    if (patch.completion_date && entry.start_date && patch.completion_date < entry.start_date) delete patch.completion_date
  }
  if (status === 'in_progress' && !entry.start_date) patch.start_date = today
  return patch
}

export function useUpdateEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ entryId, patch }: { entryId: string; mediaId?: string; patch: EntryPatch; silent?: boolean }) =>
      unwrap(await supabase.from('library_entries').update(patch).eq('id', entryId).select().single(), 'update entry') as LibraryEntry,
    onMutate: async ({ entryId, mediaId, patch }) => {
      await qc.cancelQueries({ queryKey: ['library'] })
      if (mediaId) await qc.cancelQueries({ queryKey: keys.detail(mediaId) })
      return { snap: optimisticPatch(qc, [entryId], patch as Partial<LibraryItem>, mediaId) }
    },
    onError: (err, _v, ctx) => {
      rollback(qc, ctx?.snap)
      toast.error(friendlyError(err))
    },
    onSettled: (_d, _e, v) => invalidateLibrary(qc, v.mediaId),
  })
}

export function useBulkUpdate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ entryIds, patch, fillProgress = false, historical = false }: {
      entryIds: string[]; patch: Pick<EntryPatch, 'status' | 'wishlisted_at' | 'is_favorite'>; fillProgress?: boolean; historical?: boolean
    }) => {
      // One UPDATE statement on the server: either every row changes or none does.
      // historical = "finished earlier": no completion date stamp, no activity events.
      unwrap(await supabase.rpc('bulk_update_entries', {
        p_entry_ids: entryIds, p_patch: patch, p_fill_progress: fillProgress, p_historical: historical,
      }), 'bulk update')
    },
    onMutate: async ({ entryIds, patch }) => {
      await qc.cancelQueries({ queryKey: ['library'] })
      return { snap: optimisticPatch(qc, entryIds, patch as Partial<LibraryItem>) }
    },
    onError: (err, _v, ctx) => {
      rollback(qc, ctx?.snap)
      toast.error(friendlyError(err))
    },
    onSuccess: (_d, v) => toast.success(`Updated ${v.entryIds.length} ${v.entryIds.length === 1 ? 'entry' : 'entries'}`),
    onSettled: () => invalidateLibrary(qc),
  })
}

/** Deletes the media rows (cascading to entries, sessions, notes, ids). */
export function useDeleteMedia() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (mediaIds: string[]) => {
      unwrap(await supabase.from('media').delete().in('id', mediaIds), 'delete media')
    },
    onError: (err) => toast.error(friendlyError(err)),
    onSuccess: (_d, ids) => toast.success(`Deleted ${ids.length} ${ids.length === 1 ? 'entry' : 'entries'}`),
    onSettled: () => invalidateLibrary(qc),
  })
}

// ---------------------------------------------------------------- Sessions
export function useSessionMutations(mediaId: string) {
  const qc = useQueryClient()
  const done = () => invalidateLibrary(qc, mediaId)
  const onError = (err: unknown) => toast.error(friendlyError(err))

  const create = useMutation({
    mutationFn: async (s: Partial<TrackingSession> & { entry_id: string; session_type: TrackingSession['session_type'] }) =>
      unwrap(await supabase.from('tracking_sessions').insert(s).select().single(), 'create session') as TrackingSession,
    onError, onSettled: done,
  })
  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<TrackingSession> }) =>
      unwrap(await supabase.from('tracking_sessions').update(patch).eq('id', id).select().single(), 'update session') as TrackingSession,
    onError, onSettled: done,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      unwrap(await supabase.from('tracking_sessions').delete().eq('id', id), 'delete session')
    },
    onError, onSettled: done,
  })
  return { create, update, remove }
}

// ---------------------------------------------------------------- Media edits
export function useUpdateMedia() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ mediaId, patch, lock = true }: { mediaId: string; patch: Partial<Media>; lock?: boolean }) => {
      // Manually edited fields are added to locked_fields so enrichment never overwrites them.
      let locked: string[] | undefined
      if (lock) {
        const cur = qc.getQueryData<MediaDetail | null>(keys.detail(mediaId))?.media.locked_fields
          ?? ((unwrap(await supabase.from('media').select('locked_fields').eq('id', mediaId).single(), 'locked') as { locked_fields: string[] }).locked_fields)
        locked = Array.from(new Set([...(cur ?? []), ...Object.keys(patch).filter((k) => k !== 'locked_fields')]))
      }
      return unwrap(
        await supabase.from('media').update(locked ? { ...patch, locked_fields: locked } : patch).eq('id', mediaId).select().single(),
        'update media',
      ) as Media
    },
    onError: (err) => toast.error(friendlyError(err)),
    onSettled: (_d, _e, v) => invalidateLibrary(qc, v.mediaId),
  })
}

/** Replace the genre set of a media row (manual edit; locks genres). */
export async function setMediaGenres(mediaId: string, names: string[]) {
  const clean = Array.from(new Set(names.map((n) => n.trim()).filter(Boolean)))
  if (clean.length) {
    unwrap(await supabase.from('genres').upsert(clean.map((name) => ({ name })), { onConflict: 'name', ignoreDuplicates: true }), 'genres')
  }
  const ids = clean.length
    ? (unwrap(await supabase.from('genres').select('id, name').in('name', clean), 'genre ids') as { id: number }[])
    : []
  unwrap(await supabase.from('media_genres').delete().eq('media_id', mediaId), 'clear genres')
  if (ids.length) unwrap(await supabase.from('media_genres').insert(ids.map((g) => ({ media_id: mediaId, genre_id: g.id }))), 'set genres')
}
