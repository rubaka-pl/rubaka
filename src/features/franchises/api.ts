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
import { getIgdbById, getProxyStatus, getTmdbMovie, invoke } from '@/integrations/proxied'
import { friendlyError, supabase, unwrap } from '@/lib/supabase'
import { getAniListById } from '@/integrations/anilist'
import { getVndbById } from '@/integrations/vndb'
import { toEnrichmentPayload } from '@/integrations/types'
import type { Franchise, FranchiseMissing, FranchiseSummary, LibraryItem, MediaDetails } from '@/types/db'

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

export interface FranchiseDetail { franchise: Franchise; items: LibraryItem[]; missing: FranchiseMissing[] }

export function useFranchise(id: string | undefined) {
  return useQuery({
    queryKey: franchiseKeys.one(id ?? ''),
    enabled: !!id,
    queryFn: async (): Promise<FranchiseDetail | null> => {
      const f = unwrap(await supabase.from('franchises').select('*').eq('id', id!).maybeSingle(), 'franchise') as Franchise | null
      if (!f) return null
      const rows = unwrap(await supabase.from('media').select('id, library_entries(id)').eq('franchise_id', id!), 'members') as { id: string; library_entries: { id: string }[] }[]
      const entryIds = rows.flatMap((r) => r.library_entries.map((e) => e.id))
      const [items, missing] = await Promise.all([
        entryIds.length ? fetchLibrary({ entryIds, sort: 'release_asc', limit: 500 }).then((r) => r.items) : Promise.resolve([]),
        supabase.rpc('franchise_missing', { p_franchise: id! }).then((r) => (r.error ? [] : r.data) as FranchiseMissing[]),
      ])
      return { franchise: f, items, missing }
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
  /** Add a related work from AniList / VNDB to the library (Planning) and to this franchise. */
  const addMissing = useMutation({
    mutationFn: async ({ franchiseId, item }: { franchiseId: string; item: FranchiseMissing }) => {
      const r = item.provider === 'anilist' ? await getAniListById(Number(item.external_id))
        : item.provider === 'vndb' ? await getVndbById(item.external_id)
          : item.provider === 'tmdb_movie' ? await getTmdbMovie(Number(item.external_id))
            : item.provider === 'igdb' ? await getIgdbById(Number(item.external_id)) : null
      if (!r) throw new Error('Not found at the provider')
      const p = toEnrichmentPayload(r)
      const res = unwrap(await supabase.rpc('create_media_entry', {
        p_media: { ...p.media, category: r.category, title: r.title }, p_entry: { status: 'planning' },
        p_titles: p.titles, p_genres: p.genres, p_external_ids: p.external_ids, p_seasons: p.seasons,
        p_relations: p.relations, p_is_custom: false, p_enriched: true,
      }), 'add title') as { media_id: string }
      await setMediaFranchise(res.media_id, franchiseId)
      return r.title
    },
    onError, onSuccess: (title) => toast.success(`Added “${title}” to Planning`),
    onSettled: () => invalidateFranchises(qc),
  })
  return { setMember, create, rename, remove, addMissing }
}

// ---------------------------------------------------------------- Detection

const collectionName = (n: string) => n.replace(/\s*[-–]?\s*(collection|коллекция|saga)$/i, '').trim() || n

/**
 * Finds franchises:
 *  1. relations between titles (AniList, VNDB, ...) — anime ↔ manga ↔ novels ↔ VNs;
 *     a lone title with an unseen sequel / prequel becomes a franchise too;
 *  2. TMDB collections for movies (with every part of the collection);
 *  3. IGDB franchises / collections for games (with every game in them).
 * Parts you do not have are stored as relations, so the franchise page lists
 * them as "not in your library". Provider answers are remembered in
 * media.details and groups are saved as they are found: an interrupted run
 * continues where it stopped.
 */
export async function detectFranchises(onProgress: (msg: string, done?: number, total?: number) => void) {
  const summary = { groups: 0, added: 0, movies: 0, games: 0, single: 0 }
  onProgress('Linking related titles…')
  const r = unwrap(await supabase.rpc('detect_franchises'), 'detect') as { groups: number; added: number }
  summary.groups += r.groups
  summary.added += r.added
  const single = await supabase.rpc('detect_single_franchises')
  if (!single.error) summary.single = single.data as number

  const status = (await getProxyStatus().catch(() => null)) ?? { tmdb: false, igdb: false }
  if (status.tmdb) summary.movies = await detectMovieCollections(onProgress)
  if (status.igdb) summary.games = await detectGameFranchises(onProgress)
  return summary
}

type Group = { id: number; name: string } | null
type Row = { id: string; details: MediaDetails & Record<string, unknown>; media_external_ids: { provider: string; external_id: string }[] }
type Part = { id: number; title: string; date: string | null; poster: string | null }

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

/** Every title of the library that shares a group, as one franchise (saved right away). */
async function assign(rows: Row[], key: string, prefix: string, g: { id: number; name: string }) {
  const ids = rows.filter((r) => (r.details?.[key] as Group)?.id === g.id).map((r) => r.id)
  if (ids.length) unwrap(await supabase.rpc('assign_franchise_group', { p_source: `${prefix}:${Math.abs(g.id)}`, p_name: collectionName(g.name), p_media_ids: ids }), 'group')
}

/** Store the group's other parts as relations of one member, so missing ones can be listed and added. */
async function storeParts(rows: Row[], key: string, g: { id: number }, provider: 'tmdb_movie' | 'igdb', category: 'movie' | 'game', parts: Part[]) {
  const host = rows.find((r) => (r.details?.[key] as Group)?.id === g.id)
  if (!host) return
  const own = Number(host.media_external_ids[0].external_id)
  const ownDate = parts.find((p) => p.id === own)?.date ?? null
  unwrap(await supabase.from('media_relations').delete().eq('media_id', host.id).eq('related_provider', provider), 'clear parts')
  const rel = parts.filter((p) => p.id !== own).map((p) => ({
    media_id: host.id, relation_type: ownDate && p.date && p.date < ownDate ? 'prequel' : 'sequel',
    related_title: p.title, related_category: category, related_provider: provider, related_external_id: String(p.id), related_poster_url: p.poster,
  }))
  if (rel.length) unwrap(await supabase.from('media_relations').insert(rel), 'store parts')
}

async function detectMovieCollections(onProgress: (msg: string, done?: number, total?: number) => void): Promise<number> {
  const rows = await loadWithIds('movie', 'tmdb_movie')
  const todo = rows.filter((r) => !(r.details && 'tmdb_collection' in r.details))
  for (let i = 0; i < todo.length; i++) {
    onProgress('Movies: TMDB collections…', i, todo.length)
    const id = todo[i].media_external_ids[0].external_id
    try {
      const m = await invoke<{ belongs_to_collection: { id: number; name: string } | null }>('tmdb', { path: `/movie/${Number(id)}` })
      const c = m.belongs_to_collection ? { id: m.belongs_to_collection.id, name: m.belongs_to_collection.name } : null
      await saveDetail(todo[i], 'tmdb_collection', c)
      if (c) await assign(rows, 'tmdb_collection', 'tmdb_collection', c)
    } catch (e) {
      console.warn('[rubaka] tmdb collection', id, e)
    }
  }
  // Groups + every part of each collection (once per collection; remembered in details).
  const groups = new Map<number, { id: number; name: string }>()
  for (const r of rows) { const c = r.details?.tmdb_collection as Group; if (c) groups.set(c.id, c) }
  let i = 0
  for (const c of groups.values()) {
    onProgress('Movies: collection parts…', i++, groups.size)
    await assign(rows, 'tmdb_collection', 'tmdb_collection', c)
    const host = rows.find((r) => (r.details?.tmdb_collection as Group)?.id === c.id)
    if (!host || host.details?.tmdb_parts_at) continue
    try {
      const col = await invoke<{ parts: { id: number; title: string; release_date?: string; poster_path?: string | null }[] }>('tmdb', { path: `/collection/${c.id}` })
      await storeParts(rows, 'tmdb_collection', c, 'tmdb_movie', 'movie', col.parts.map((p) => ({
        id: p.id, title: p.title, date: p.release_date || null, poster: p.poster_path ? `https://image.tmdb.org/t/p/w185${p.poster_path}` : null,
      })))
      await saveDetail(host, 'tmdb_parts_at', new Date().toISOString())
    } catch (e) {
      // Older metadata-proxy without /collection: groups still work, parts come after redeploying it.
      console.warn('[rubaka] tmdb collection parts', c.id, e)
    }
  }
  return groups.size
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
        // Franchise ids and collection ids are different spaces: collections are stored negative.
        await saveDetail(r, 'igdb_franchise', f ? { id: f.id, name: f.name } : c ? { id: -c.id, name: c.name } : null)
      }
    } catch (e) {
      console.warn('[rubaka] igdb franchises', e)
    }
  }
  const groups = new Map<number, { id: number; name: string }>()
  for (const r of rows) { const g = r.details?.igdb_franchise as Group; if (g) groups.set(g.id, g) }
  let i = 0
  for (const g of groups.values()) {
    onProgress('Games: franchise games…', i++, groups.size)
    await assign(rows, 'igdb_franchise', g.id > 0 ? 'igdb_franchise' : 'igdb_collection', g)
    const host = rows.find((r) => (r.details?.igdb_franchise as Group)?.id === g.id)
    if (!host || host.details?.igdb_parts_at) continue
    try {
      const where = g.id > 0 ? `franchises = (${g.id}) | franchise = ${g.id}` : `collections = (${-g.id})`
      const games = await invoke<{ id: number; name: string; first_release_date?: number; cover?: { image_id: string } }[]>(
        'igdb', { endpoint: 'games', query: `fields id,name,first_release_date,cover.image_id; where (${where}) & game_type = (0,8,9,10); limit 100;` })
      await storeParts(rows, 'igdb_franchise', g, 'igdb', 'game', games.map((x) => ({
        id: x.id, title: x.name, date: x.first_release_date ? new Date(x.first_release_date * 1000).toISOString().slice(0, 10) : null,
        poster: x.cover ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${x.cover.image_id}.jpg` : null,
      })))
      await saveDetail(host, 'igdb_parts_at', new Date().toISOString())
    } catch (e) {
      console.warn('[rubaka] igdb franchise games', g.id, e)
    }
  }
  return groups.size
}
