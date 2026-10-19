/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 */
// Metadata enrichment.
//
// Priority (per spec): 1) metadata already imported, 2) provider match by a
// stable external id, 3) a high-confidence title match, 4) manual review.
// The database applies results fill-only and never touches locked (hand
// edited) fields or custom covers (see app_private.merge_media_metadata).
//
// There is no always-on server, so the queue (metadata_enrichment_jobs) is
// processed by this browser-side runner while the Import page is open. Jobs
// are persisted, so closing the tab simply pauses the work; failures back off
// exponentially and can be retried.
import { create } from 'zustand'
import { getAniListById, getAniListByMalIds, searchAniList } from '@/integrations/anilist'
import { matchConfidence } from '@/integrations'
import { searchOpenLibrary } from '@/integrations/openlibrary'
import { findTmdbByImdb, getIgdbById, getProxyStatus, getTmdbMovie, getTmdbTv, searchIgdb, searchTmdb } from '@/integrations/proxied'
import { getTvmazeById, getTvmazeByImdb, searchTvmaze } from '@/integrations/tvmaze'
import { toEnrichmentPayload, type ProviderResult } from '@/integrations/types'
import { getVndbById, searchVndb } from '@/integrations/vndb'
import { getMalById } from '@/integrations/mal'
import { CATEGORY_CONFIG } from '@/lib/categories'
import { supabase, unwrap } from '@/lib/supabase'
import { chunk } from '@/lib/utils'
import type { Media, MediaCategory, MediaExternalId } from '@/types/db'

export type EnrichOutcome =
  | { status: 'matched'; result: ProviderResult; changed: string[]; suggestCategory?: MediaCategory }
  | { status: 'review'; candidates: ProviderResult[]; message?: string }
  | { status: 'unresolved'; message?: string }

/** Threshold for applying a title-only match automatically. */
const AUTO_MATCH = 0.92

type MediaLite = Pick<Media, 'id' | 'category' | 'title' | 'original_title' | 'release_year' | 'format'>

const idOf = (ids: Pick<MediaExternalId, 'provider' | 'external_id'>[], p: string) => ids.find((x) => x.provider === p)?.external_id

/**
 * Remove values that would violate the target row's constraints (e.g. a light
 * novel format on an entry that is still in the Manga category).
 */
export function sanitizeForCategory(r: ProviderResult, category: MediaCategory): ProviderResult {
  const formats = CATEGORY_CONFIG[category].formats.map((f) => f.value)
  return { ...r, format: r.format && formats.includes(r.format) ? r.format : null }
}

/** Pick an automatic title match only when it is clearly the best and very similar. */
function pickByTitle(m: MediaLite, results: ProviderResult[]): EnrichOutcome {
  const scored = results
    .map((r) => ({ ...r, confidence: Math.max(matchConfidence(m.title, r, m.release_year), m.original_title ? matchConfidence(m.original_title, r, m.release_year) : 0) }))
    .sort((a, b) => b.confidence - a.confidence)
  const [top, second] = scored
  if (!top || top.confidence < 0.55) return { status: 'unresolved', message: 'No similar title found' }
  const yearOk = !m.release_year || !top.year || Math.abs(top.year - m.release_year) <= 1
  if (top.confidence >= AUTO_MATCH && yearOk && (!second || second.confidence < top.confidence - 0.08)) {
    return { status: 'matched', result: top, changed: [] }
  }
  return { status: 'review', candidates: scored.slice(0, 5), message: 'Several possible matches' }
}

/** Find metadata for one title (no database writes). */
export async function findMetadata(m: MediaLite, ids: Pick<MediaExternalId, 'provider' | 'external_id'>[]): Promise<EnrichOutcome> {
  const proxy = await getProxyStatus()
  switch (m.category) {
    case 'anime':
    case 'manga':
    case 'novel': {
      const anilist = idOf(ids, 'anilist')
      const mal = idOf(ids, m.category === 'anime' ? 'mal_anime' : 'mal_manga')
      let r: ProviderResult | null | undefined = null
      if (anilist) r = await getAniListById(Number(anilist))
      else if (mal) r = (await getAniListByMalIds([Number(mal)], m.category === 'anime' ? 'ANIME' : 'MANGA')).get(Number(mal))
      // Fallback: official MAL API (needs MAL_CLIENT_ID on the server).
      if (!r && mal && proxy?.mal) r = await getMalById(m.category === 'anime' ? 'anime' : 'manga', Number(mal))
      if (r) return { status: 'matched', result: r, changed: [], suggestCategory: r.category !== m.category ? r.category : undefined }
      if (anilist || mal) return { status: 'unresolved', message: proxy?.mal ? 'Neither AniList nor MyAnimeList returned this id' : 'AniList does not know this id (add MAL_CLIENT_ID for a MyAnimeList fallback)' }
      const found = await searchAniList(m.original_title || m.title, m.category)
      const pick = pickByTitle(m, found)
      if (pick.status !== 'unresolved' || m.category !== 'novel') return pick
      return pickByTitle(m, await searchOpenLibrary(m.title))
    }
    case 'visual_novel': {
      const v = idOf(ids, 'vndb')
      if (v) {
        const r = await getVndbById(v)
        return r ? { status: 'matched', result: r, changed: [] } : { status: 'unresolved', message: 'VNDB id not found' }
      }
      return pickByTitle(m, await searchVndb(m.original_title || m.title))
    }
    case 'tv_series':
    case 'animated_series': {
      const tvmaze = idOf(ids, 'tvmaze')
      const imdb = idOf(ids, 'imdb')
      let r: ProviderResult | null = null
      if (tvmaze) r = await getTvmazeById(Number(tvmaze))
      else if (imdb) r = await getTvmazeByImdb(imdb)
      if (!r && proxy?.tmdb) {
        const tmdb = idOf(ids, 'tmdb_tv') ?? (imdb ? (await findTmdbByImdb(imdb)).tv?.toString() : undefined)
        if (tmdb) r = await getTmdbTv(Number(tmdb), m.category)
      }
      if (r) return { status: 'matched', result: { ...r, category: m.category }, changed: [], suggestCategory: r.category !== m.category && r.provider === 'tvmaze' ? r.category : undefined }
      if (tvmaze || imdb) return { status: 'unresolved', message: 'No TV database knows this id' }
      return pickByTitle(m, await searchTvmaze(m.title))
    }
    case 'movie': {
      if (!proxy?.tmdb) return { status: 'unresolved', message: 'TMDB is not configured (needed for movie metadata)' }
      const imdb = idOf(ids, 'imdb')
      const tmdb = idOf(ids, 'tmdb_movie') ?? (imdb ? (await findTmdbByImdb(imdb)).movie?.toString() : undefined)
      if (tmdb) {
        const r = await getTmdbMovie(Number(tmdb))
        return r ? { status: 'matched', result: r, changed: [] } : { status: 'unresolved' }
      }
      if (imdb) return { status: 'unresolved', message: 'TMDB does not know this IMDb id' }
      return pickByTitle(m, await searchTmdb(m.title, 'movie'))
    }
    case 'game': {
      if (!proxy?.igdb) return { status: 'unresolved', message: 'IGDB is not configured (needed for game metadata)' }
      const igdb = idOf(ids, 'igdb')
      if (igdb) {
        const r = await getIgdbById(Number(igdb))
        return r ? { status: 'matched', result: r, changed: [] } : { status: 'unresolved' }
      }
      return pickByTitle(m, await searchIgdb(m.title))
    }
  }
}

async function applyResults(items: { media: MediaLite; provider: string; result: ProviderResult; suggestCategory?: MediaCategory }[]) {
  if (!items.length) return
  const payload = items.map((it) => ({
    media_id: it.media.id,
    provider: it.provider,
    payload: toEnrichmentPayload(sanitizeForCategory(it.result, it.media.category)),
  }))
  unwrap(await supabase.rpc('apply_enrichment_batch', { p_items: payload }), 'apply enrichment')
  // Category suggestions are stored for review — never applied automatically.
  for (const it of items.filter((i) => i.suggestCategory)) {
    await supabase.from('metadata_enrichment_jobs').update({ status: 'review', result: { suggest_category: it.suggestCategory, provider_title: it.result.title } })
      .eq('media_id', it.media.id).eq('provider', it.provider)
  }
}

// Failures retry with exponential backoff (2, 4, 8 min) and give up after 4 attempts.
const retryStatus = (attempts: number) => (attempts >= 4 ? 'failed' as const : 'pending' as const)

async function markJob(mediaId: string, provider: string, status: 'unresolved' | 'review' | 'failed' | 'pending', result: unknown, error?: string, attempts = 0) {
  await supabase.from('metadata_enrichment_jobs').update({
    status, result: result as object, last_error: error ?? null, attempts,
    next_attempt_at: new Date(Date.now() + 60_000 * 2 ** Math.min(attempts, 6)).toISOString(),
  }).eq('media_id', mediaId).eq('provider', provider)
  if (status === 'unresolved' || status === 'failed') await supabase.from('media').update({ enrichment_state: status === 'failed' ? 'failed' : 'unresolved' }).eq('id', mediaId)
}

/** Enrich a single title now (detail page "Fill missing metadata"). */
export async function enrichOne(media: Media, ids: MediaExternalId[]): Promise<EnrichOutcome & { message?: string }> {
  const out = await findMetadata(media, ids)
  if (out.status === 'matched') {
    const res = unwrap(await supabase.rpc('apply_enrichment', {
      p_media_id: media.id, p: toEnrichmentPayload(sanitizeForCategory(out.result, media.category)), p_provider: out.result.provider,
    }), 'apply enrichment') as { changed: string[] }
    return { ...out, changed: res.changed ?? [] }
  }
  if (out.status === 'unresolved') await supabase.from('media').update({ enrichment_state: 'unresolved' }).eq('id', media.id)
  return out
}

// ---------------------------------------------------------------- Batch runner
interface RunnerState {
  running: boolean
  cancelled: boolean
  processed: number
  total: number
  matched: number
  review: number
  unresolved: number
  failed: number
  current: string | null
  log: string[]
}

export const useEnrichment = create<RunnerState>(() => ({
  running: false, cancelled: false, processed: 0, total: 0, matched: 0, review: 0, unresolved: 0, failed: 0, current: null, log: [],
}))

const bump = (k: 'processed' | 'matched' | 'review' | 'unresolved' | 'failed', n = 1) => useEnrichment.setState((s) => ({ [k]: s[k] + n } as Partial<RunnerState>))
const log = (line: string) => useEnrichment.setState((s) => ({ log: [line, ...s.log].slice(0, 200) }))

interface JobRow {
  media_id: string
  provider: string
  attempts: number
  media: MediaLite & { media_external_ids: Pick<MediaExternalId, 'provider' | 'external_id'>[] }
}

export function cancelEnrichment() {
  useEnrichment.setState({ cancelled: true })
}

/** Process the persisted queue until it is empty or cancelled. */
export async function runEnrichment(category?: MediaCategory) {
  if (useEnrichment.getState().running) return
  useEnrichment.setState({ running: true, cancelled: false, processed: 0, matched: 0, review: 0, unresolved: 0, failed: 0, log: [], current: null })
  try {
    await supabase.rpc('enqueue_enrichment', { p_category: category ?? null, p_retry_failed: false })
    const countQ = supabase.from('metadata_enrichment_jobs').select('media_id', { count: 'exact', head: true }).eq('status', 'pending')
    const { count } = await countQ
    useEnrichment.setState({ total: count ?? 0 })
    const proxyStatus = await getProxyStatus()

    while (!useEnrichment.getState().cancelled) {
      let q = supabase.from('metadata_enrichment_jobs')
        .select('media_id, provider, attempts, media!inner(id, category, title, original_title, release_year, format, media_external_ids(provider, external_id))')
        .eq('status', 'pending').lte('next_attempt_at', new Date().toISOString())
        .order('created_at').limit(50)
      if (category) q = q.eq('media.category', category)
      const jobs = unwrap(await q, 'enrichment queue') as unknown as JobRow[]
      if (!jobs.length) break
      // Claim the batch so a second tab would not process it too.
      await supabase.from('metadata_enrichment_jobs').update({ status: 'running' }).in('media_id', jobs.map((j) => j.media_id)).eq('status', 'pending')

      // Fast path: AniList lookup by MAL id, 50 titles per request.
      const malBatch = jobs.filter((j) => (j.media.category === 'anime' || j.media.category === 'manga' || j.media.category === 'novel')
        && !idOf(j.media.media_external_ids, 'anilist') && idOf(j.media.media_external_ids, j.media.category === 'anime' ? 'mal_anime' : 'mal_manga'))
      const handled = new Set<string>()
      for (const type of ['ANIME', 'MANGA'] as const) {
        const group = malBatch.filter((j) => (type === 'ANIME') === (j.media.category === 'anime'))
        if (!group.length) continue
        useEnrichment.setState({ current: `AniList batch (${group.length} ${type.toLowerCase()})` })
        try {
          const ids = group.map((j) => Number(idOf(j.media.media_external_ids, type === 'ANIME' ? 'mal_anime' : 'mal_manga')))
          const found = await getAniListByMalIds(ids, type)
          const apply: Parameters<typeof applyResults>[0] = []
          for (const j of group) {
            const malId = Number(idOf(j.media.media_external_ids, type === 'ANIME' ? 'mal_anime' : 'mal_manga'))
            let r = found.get(malId)
            if (!r && proxyStatus?.mal) {
              try { r = (await getMalById(type === 'ANIME' ? 'anime' : 'manga', malId)) ?? undefined } catch { /* reported as unresolved below */ }
            }
            handled.add(j.media_id)
            if (r) apply.push({ media: j.media, provider: j.provider, result: r, suggestCategory: r.category !== j.media.category ? r.category : undefined })
            else { await markJob(j.media_id, j.provider, 'unresolved', null, proxyStatus?.mal ? 'Not found on AniList or MyAnimeList' : 'AniList does not know this MAL id'); bump('unresolved'); bump('processed') }
          }
          await applyResults(apply)
          bump('matched', apply.length); bump('processed', apply.length)
          const suggested = apply.filter((a) => a.suggestCategory).length
          log(`AniList: ${apply.length} matched${suggested ? `, ${suggested} category suggestions to review` : ''}`)
        } catch (err) {
          for (const j of group) {
            if (handled.has(j.media_id)) continue
            handled.add(j.media_id)
            await markJob(j.media_id, j.provider, retryStatus(j.attempts + 1), null, (err as Error).message, j.attempts + 1)
            bump('failed'); bump('processed')
          }
          log(`AniList batch failed: ${(err as Error).message}`)
        }
      }

      // Everything else one by one (rate limited per provider).
      for (const j of jobs) {
        if (handled.has(j.media_id) || useEnrichment.getState().cancelled) continue
        useEnrichment.setState({ current: j.media.title })
        try {
          const out = await findMetadata(j.media, j.media.media_external_ids as MediaExternalId[])
          if (out.status === 'matched') {
            await applyResults([{ media: j.media, provider: j.provider, result: out.result, suggestCategory: out.suggestCategory }])
            bump('matched')
          } else if (out.status === 'review') {
            await markJob(j.media_id, j.provider, 'review', { candidates: out.candidates.map((c) => ({ ...c })) }, out.message)
            bump('review'); log(`Review: ${j.media.title}`)
          } else {
            await markJob(j.media_id, j.provider, 'unresolved', null, out.message)
            bump('unresolved')
          }
        } catch (err) {
          await markJob(j.media_id, j.provider, retryStatus(j.attempts + 1), null, (err as Error).message, j.attempts + 1)
          bump('failed'); log(`Failed: ${j.media.title} — ${(err as Error).message}`)
        }
        bump('processed')
      }
    }
    // Anything claimed but not processed (cancelled) goes back to the queue.
    await supabase.from('metadata_enrichment_jobs').update({ status: 'pending' }).eq('status', 'running')
  } finally {
    useEnrichment.setState({ running: false, current: null })
  }
}

/** Apply a candidate chosen by the user in the review list. */
export async function applyCandidate(mediaId: string, category: MediaCategory, provider: string, candidate: ProviderResult) {
  unwrap(await supabase.rpc('apply_enrichment_batch', {
    p_items: [{ media_id: mediaId, provider, payload: toEnrichmentPayload(sanitizeForCategory(candidate, category)) }],
  }), 'apply candidate')
}

export async function resetFailedJobs() {
  const ids = unwrap(await supabase.from('metadata_enrichment_jobs').select('media_id').in('status', ['failed', 'unresolved']), 'failed jobs') as { media_id: string }[]
  for (const c of chunk(ids.map((i) => i.media_id), 200)) {
    await supabase.from('metadata_enrichment_jobs').update({ status: 'pending', attempts: 0, next_attempt_at: new Date().toISOString() }).in('media_id', c)
  }
  return ids.length
}
