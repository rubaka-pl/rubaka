/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { fetchLibrary, invalidateLibrary } from '@/features/tracking/api'
import { getProxyStatus, invoke } from '@/integrations/proxied'
import { friendlyError, supabase, unwrap } from '@/lib/supabase'
import type { Franchise, FranchiseSummary, LibraryItem, MediaDetails } from '@/types/db'

export const franchiseKeys = {
  list: ['franchises'] as const,
  one: (id: string) => ['franchise', id] as const,
}

export function useFranchiseList() {
  return useQuery({
    queryKey: franchiseKeys.list,
    queryFn: async () => unwrap(await supabase.rpc('franchise_list'), 'franchises') as FranchiseSummary[],
    staleTime: 30_000,
  })
}

export interface FranchiseDetail { franchise: Franchise; items: LibraryItem[] }

export function useFranchise(id: string | undefined) {
  return useQuery({
    queryKey: franchiseKeys.one(id ?? ''),
    enabled: !!id,
    queryFn: async (): Promise<FranchiseDetail | null> => {
      const f = unwrap(await supabase.from('franchises').select('*').eq('id', id!).maybeSingle(), 'franchise') as Franchise | null
      if (!f) return null
      const rows = unwrap(await supabase.from('media').select('id, library_entries(id)').eq('franchise_id', id!), 'members') as { id: string; library_entries: { id: string }[] }[]
      const entryIds = rows.flatMap((r) => r.library_entries.map((e) => e.id))
      const items = entryIds.length ? (await fetchLibrary({ entryIds, sort: 'release_asc', limit: 500 })).items : []
      return { franchise: f, items }
    },
  })
}

function invalidateFranchises(qc: QueryClient, mediaId?: string) {
  qc.invalidateQueries({ queryKey: franchiseKeys.list })
  qc.invalidateQueries({ queryKey: ['franchise'] })
  invalidateLibrary(qc, mediaId)
}

/** Put a title into a franchise (or take it out with null). Locks the field so detection leaves it alone. */
export async function setMediaFranchise(mediaId: string, franchiseId: string | null) {
  const cur = unwrap(await supabase.from('media').select('locked_fields').eq('id', mediaId).single(), 'locked') as { locked_fields: string[] }
  const locked = Array.from(new Set([...(cur.locked_fields ?? []), 'franchise_id']))
  unwrap(await supabase.from('media').update({ franchise_id: franchiseId, locked_fields: locked }).eq('id', mediaId), 'set franchise')
}

export function useFranchiseMutations() {
  const qc = useQueryClient()
  const onError = (e: unknown) => toast.error(friendlyError(e))

  const setMember = useMutation({
    mutationFn: ({ mediaId, franchiseId }: { mediaId: string; franchiseId: string | null }) => setMediaFranchise(mediaId, franchiseId),
    onError, onSettled: (_d, _e, v) => invalidateFranchises(qc, v.mediaId),
  })
  const create = useMutation({
    mutationFn: async ({ name, mediaIds }: { name: string; mediaIds: string[] }) => {
      const f = unwrap(await supabase.from('franchises').insert({ name: name.trim() }).select().single(), 'create franchise') as Franchise
      for (const id of mediaIds) await setMediaFranchise(id, f.id)
      return f
    },
    onError, onSettled: (_d, _e, v) => invalidateFranchises(qc, v.mediaIds[0]),
  })
  const rename = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      unwrap(await supabase.from('franchises').update({ name: name.trim() }).eq('id', id), 'rename franchise')
    },
    onError, onSettled: () => invalidateFranchises(qc),
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      // Titles stay in the library; they are only ungrouped (and kept out of future detection).
      const rows = unwrap(await supabase.from('media').select('id').eq('franchise_id', id), 'members') as { id: string }[]
      for (const r of rows) await setMediaFranchise(r.id, null)
      unwrap(await supabase.from('franchises').delete().eq('id', id), 'delete franchise')
    },
    onError, onSettled: () => invalidateFranchises(qc),
  })
  return { setMember, create, rename, remove }
}

// ---------------------------------------------------------------- Detection

const collectionName = (n: string) => n.replace(/\s*[-–]?\s*(collection|коллекция|saga)$/i, '').trim() || n

/**
 * Finds franchises:
 *  1. relations between titles (AniList, VNDB, ...) — anime ↔ manga ↔ novels ↔ VNs;
 *  2. TMDB collections for movies;
 *  3. IGDB franchises / collections for games.
 * Provider answers are remembered in media.details, so later runs only ask about new titles.
 */
export async function detectFranchises(onProgress: (msg: string, done?: number, total?: number) => void) {
  const summary = { groups: 0, added: 0, movies: 0, games: 0 }
  onProgress('Linking related titles…')
  const r = unwrap(await supabase.rpc('detect_franchises'), 'detect') as { groups: number; added: number }
  summary.groups += r.groups
  summary.added += r.added

  const status = (await getProxyStatus().catch(() => null)) ?? { tmdb: false, igdb: false }
  if (status.tmdb) summary.movies = await detectMovieCollections(onProgress)
  if (status.igdb) summary.games = await detectGameFranchises(onProgress)
  return summary
}

type Row = { id: string; details: MediaDetails & Record<string, unknown>; media_external_ids: { provider: string; external_id: string }[] }

async function loadWithIds(category: 'movie' | 'game', provider: string): Promise<Row[]> {
  const out: Row[] = []
  for (let from = 0; ; from += 1000) {
    const rows = unwrap(await supabase.from('media').select('id, details, media_external_ids!inner(provider, external_id)')
      .eq('category', category).eq('media_external_ids.provider', provider).order('id').range(from, from + 999), 'load ids') as Row[]
    out.push(...rows)
    if (rows.length < 1000) break
  }
  return out
}

async function saveDetail(row: Row, key: string, value: unknown) {
  row.details = { ...(row.details ?? {}), [key]: value }
  unwrap(await supabase.from('media').update({ details: row.details }).eq('id', row.id), 'save details')
}

async function groupBy(rows: Row[], key: string, prefix: string): Promise<number> {
  const groups = new Map<number, { name: string; ids: string[] }>()
  for (const r of rows) {
    const c = r.details?.[key] as { id: number; name: string } | null | undefined
    if (!c) continue
    const g = groups.get(c.id) ?? { name: collectionName(c.name), ids: [] }
    g.ids.push(r.id)
    groups.set(c.id, g)
  }
  let n = 0
  for (const [id, g] of groups) {
    if (g.ids.length < 2) continue
    unwrap(await supabase.rpc('assign_franchise_group', { p_source: `${prefix}:${id}`, p_name: g.name, p_media_ids: g.ids }), 'group')
    n++
  }
  return n
}

async function detectMovieCollections(onProgress: (msg: string, done?: number, total?: number) => void): Promise<number> {
  const rows = await loadWithIds('movie', 'tmdb_movie')
  const todo = rows.filter((r) => !(r.details && 'tmdb_collection' in r.details))
  for (let i = 0; i < todo.length; i++) {
    onProgress('Movies: TMDB collections…', i, todo.length)
    const id = todo[i].media_external_ids[0].external_id
    try {
      const m = await invoke<{ belongs_to_collection: { id: number; name: string } | null }>('tmdb', { path: `/movie/${Number(id)}` })
      await saveDetail(todo[i], 'tmdb_collection', m.belongs_to_collection ? { id: m.belongs_to_collection.id, name: m.belongs_to_collection.name } : null)
    } catch (e) {
      console.warn('[rubaka] tmdb collection', id, e)
    }
  }
  return groupBy(rows, 'tmdb_collection', 'tmdb_collection')
}

async function detectGameFranchises(onProgress: (msg: string, done?: number, total?: number) => void): Promise<number> {
  const rows = await loadWithIds('game', 'igdb')
  const todo = rows.filter((r) => !(r.details && 'igdb_franchise' in r.details))
  for (let i = 0; i < todo.length; i += 100) {
    onProgress('Games: IGDB franchises…', i, todo.length)
    const part = todo.slice(i, i + 100)
    const ids = part.map((r) => Math.trunc(Number(r.media_external_ids[0].external_id))).filter(Number.isFinite)
    try {
      const res = await invoke<{ id: number; franchise?: { id: number; name: string }; franchises?: { id: number; name: string }[]; collections?: { id: number; name: string }[] }[]>(
        'igdb', { endpoint: 'games', query: `fields id,franchise.name,franchises.name,collections.name; where id = (${ids.join(',')}); limit 100;` })
      const byId = new Map(res.map((g) => [g.id, g]))
      for (const r of part) {
        const g = byId.get(Number(r.media_external_ids[0].external_id))
        const f = g?.franchise ?? g?.franchises?.[0]
        const c = g?.collections?.[0]
        // Franchise ids and collection ids are different spaces: keep them apart in the key.
        await saveDetail(r, 'igdb_franchise', f ? { id: f.id, name: f.name } : c ? { id: -c.id, name: c.name } : null)
      }
    } catch (e) {
      console.warn('[rubaka] igdb franchises', e)
    }
  }
  // Negative ids are collections.
  const fr = rows.filter((r) => ((r.details?.igdb_franchise as { id: number } | null)?.id ?? 0) > 0)
  const col = rows.filter((r) => ((r.details?.igdb_franchise as { id: number } | null)?.id ?? 0) < 0)
    .map((r) => ({ ...r, details: { ...r.details, igdb_franchise: { ...(r.details.igdb_franchise as object), id: -(r.details.igdb_franchise as { id: number }).id } } })) as Row[]
  return (await groupBy(fr, 'igdb_franchise', 'igdb_franchise')) + (await groupBy(col, 'igdb_franchise', 'igdb_collection'))
}
