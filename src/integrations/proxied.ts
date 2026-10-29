/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 */
// TMDB and IGDB need secret credentials, so they are reached through the
// `metadata-proxy` Supabase Edge Function. Nothing secret is in this bundle.
import { supabase } from '@/lib/supabase'
import { sleep } from '@/lib/utils'
import type { MediaCategory, ReleaseStatus } from '@/types/db'
import { cached } from './http'
import { ProviderError, type ProviderResult } from './types'

export interface ProxyStatus { tmdb: boolean; igdb: boolean; mal?: boolean }
let statusPromise: Promise<ProxyStatus | null> | null = null

/** Which proxied providers are configured. null = function not deployed/unreachable. */
export function getProxyStatus(force = false) {
  if (!statusPromise || force) {
    statusPromise = supabase.functions.invoke('metadata-proxy', { body: { provider: 'status' } })
      .then(({ data, error }) => (error ? null : (data as ProxyStatus)))
      .catch(() => null)
  }
  return statusPromise
}

const lastCall: Record<string, number> = {}
export async function invoke<T>(provider: 'tmdb' | 'igdb' | 'mal' | 'nhentai', body: Record<string, unknown>): Promise<T> {
  const spacing = provider === 'tmdb' ? 260 : provider === 'mal' ? 1000 : 300
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = (lastCall[provider] ?? 0) + spacing - Date.now()
    if (wait > 0) await sleep(wait)
    lastCall[provider] = Date.now()
    const { data, error } = await supabase.functions.invoke('metadata-proxy', { body: { provider, ...body } })
    if (!error) return data as T
    const status = (error as { context?: Response }).context?.status
    if (status === 429 || (status && status >= 500 && status !== 501)) {
      await sleep(1000 * 2 ** attempt)
      continue
    }
    if (status === 501) throw new ProviderError(`${provider.toUpperCase()} is not configured on the server`, provider, 501)
    throw new ProviderError(`${provider.toUpperCase()} request failed${status ? ` (${status})` : ''}`, provider, status)
  }
  throw new ProviderError(`${provider.toUpperCase()} is rate limiting requests`, provider, 429, true)
}

// ---------------------------------------------------------------- TMDB
const IMG = 'https://image.tmdb.org/t/p/'

interface TmdbMovie {
  id: number; title: string; original_title: string; overview: string; release_date: string; poster_path: string | null
  backdrop_path: string | null; genres?: { name: string }[]; runtime?: number | null; status?: string; adult?: boolean
  original_language?: string; production_countries?: { iso_3166_1: string }[]; imdb_id?: string | null
  credits?: { cast: { name: string }[]; crew: { name: string; job: string }[] }
}
interface TmdbTv {
  id: number; name: string; original_name: string; overview: string; first_air_date: string; last_air_date?: string
  poster_path: string | null; backdrop_path: string | null; genres?: { name: string }[]; status?: string
  number_of_seasons?: number; number_of_episodes?: number; episode_run_time?: number[]; origin_country?: string[]
  networks?: { name: string }[]; created_by?: { name: string }[]
  seasons?: { season_number: number; name: string; episode_count: number; air_date: string | null }[]
  credits?: { cast: { name: string }[] }; external_ids?: { imdb_id: string | null }
}

const TV_STATUS: Record<string, ReleaseStatus> = { 'Returning Series': 'releasing', Ended: 'finished', Canceled: 'cancelled', 'In Production': 'upcoming', Planned: 'upcoming' }

function mapMovie(m: TmdbMovie): ProviderResult {
  return {
    provider: 'tmdb', externalId: String(m.id), category: 'movie', title: m.title,
    originalTitle: m.original_title !== m.title ? m.original_title : null,
    year: m.release_date ? Number(m.release_date.slice(0, 4)) : null,
    releaseDate: m.release_date || null,
    releaseStatus: m.status === 'Released' ? 'finished' : m.status ? 'upcoming' : null,
    format: 'movie',
    country: m.production_countries?.[0]?.iso_3166_1 ?? null,
    posterUrl: m.poster_path ? `${IMG}w500${m.poster_path}` : null,
    backdropUrl: m.backdrop_path ? `${IMG}w1280${m.backdrop_path}` : null,
    synopsis: m.overview || null,
    runtime: m.runtime || null,
    genres: m.genres?.map((g) => g.name),
    externalIds: [
      { provider: 'tmdb_movie', external_id: String(m.id), url: `https://www.themoviedb.org/movie/${m.id}` },
      ...(m.imdb_id ? [{ provider: 'imdb' as const, external_id: m.imdb_id, url: `https://www.imdb.com/title/${m.imdb_id}/` }] : []),
    ],
    details: {
      ...(m.credits ? { directors: m.credits.crew.filter((c) => c.job === 'Director').map((c) => c.name), cast: m.credits.cast.slice(0, 10).map((c) => c.name) } : {}),
    },
    isAdult: m.adult,
    url: `https://www.themoviedb.org/movie/${m.id}`,
  }
}

function mapTv(t: TmdbTv, category: MediaCategory): ProviderResult {
  return {
    provider: 'tmdb', externalId: String(t.id), category, title: t.name,
    originalTitle: t.original_name !== t.name ? t.original_name : null,
    year: t.first_air_date ? Number(t.first_air_date.slice(0, 4)) : null,
    releaseDate: t.first_air_date || null,
    endDate: t.status === 'Ended' ? t.last_air_date ?? null : null,
    releaseStatus: t.status ? TV_STATUS[t.status] ?? null : null,
    format: 'series',
    country: t.origin_country?.[0] ?? null,
    posterUrl: t.poster_path ? `${IMG}w500${t.poster_path}` : null,
    backdropUrl: t.backdrop_path ? `${IMG}w1280${t.backdrop_path}` : null,
    synopsis: t.overview || null,
    totals: { seasons: t.number_of_seasons ?? null, episodes: t.number_of_episodes ?? null },
    episodeDuration: t.episode_run_time?.[0] ?? null,
    genres: t.genres?.map((g) => g.name),
    externalIds: [
      { provider: 'tmdb_tv', external_id: String(t.id), url: `https://www.themoviedb.org/tv/${t.id}` },
      ...(t.external_ids?.imdb_id ? [{ provider: 'imdb' as const, external_id: t.external_ids.imdb_id, url: `https://www.imdb.com/title/${t.external_ids.imdb_id}/` }] : []),
    ],
    details: {
      ...(t.networks?.length ? { networks: t.networks.map((n) => n.name) } : {}),
      ...(t.created_by?.length ? { creators: t.created_by.map((c) => c.name) } : {}),
      ...(t.credits?.cast.length ? { cast: t.credits.cast.slice(0, 10).map((c) => c.name) } : {}),
    },
    seasons: t.seasons?.map((s) => ({ season_number: s.season_number, title: s.name, episode_count: s.episode_count || null, air_date: s.air_date })),
    url: `https://www.themoviedb.org/tv/${t.id}`,
  }
}

export async function searchTmdb(q: string, category: MediaCategory): Promise<ProviderResult[]> {
  if (category === 'movie') {
    const r = await invoke<{ results: TmdbMovie[] }>('tmdb', { path: '/search/movie', params: { query: q, include_adult: 'false' } })
    return r.results.slice(0, 15).map(mapMovie)
  }
  const r = await invoke<{ results: TmdbTv[] }>('tmdb', { path: '/search/tv', params: { query: q } })
  return r.results.slice(0, 15).map((t) => mapTv(t, category))
}

export async function getTmdbMovie(id: number): Promise<ProviderResult | null> {
  return cached('tmdb', `movie:${id}`, async () => mapMovie(await invoke<TmdbMovie>('tmdb', { path: `/movie/${id}`, params: { append_to_response: 'credits' } })))
}

export async function getTmdbTv(id: number, category: MediaCategory): Promise<ProviderResult | null> {
  const r = await cached('tmdb', `tv:${id}`, async () => invoke<TmdbTv>('tmdb', { path: `/tv/${id}`, params: { append_to_response: 'credits,external_ids' } }))
  return mapTv(r, category)
}

/** Resolve an IMDb id via TMDB /find. */
export async function findTmdbByImdb(imdbId: string): Promise<{ movie?: number; tv?: number }> {
  return cached('tmdb', `find:${imdbId}`, async () => {
    const r = await invoke<{ movie_results: { id: number }[]; tv_results: { id: number }[] }>('tmdb', { path: `/find/${imdbId}`, params: { external_source: 'imdb_id' } })
    return { movie: r.movie_results[0]?.id, tv: r.tv_results[0]?.id }
  })
}

// ---------------------------------------------------------------- IGDB
interface IgdbGame {
  id: number; name: string; slug: string; url: string; summary?: string; first_release_date?: number
  cover?: { image_id: string }; genres?: { name: string }[]; platforms?: { name: string }[]
  involved_companies?: { company: { name: string }; developer: boolean; publisher: boolean }[]
  alternative_names?: { name: string }[]; game_type?: number; category?: number
}

const IGDB_FIELDS = 'fields name,slug,url,summary,first_release_date,cover.image_id,genres.name,platforms.name,involved_companies.company.name,involved_companies.developer,involved_companies.publisher,alternative_names.name,game_type,category;'

function mapGame(g: IgdbGame): ProviderResult {
  const date = g.first_release_date ? new Date(g.first_release_date * 1000).toISOString().slice(0, 10) : null
  const kind = g.game_type ?? g.category
  return {
    provider: 'igdb', externalId: String(g.id), category: 'game', title: g.name,
    year: date ? Number(date.slice(0, 4)) : null,
    releaseDate: date,
    format: kind === 1 ? 'dlc' : kind === 2 ? 'expansion' : kind === 8 ? 'remake' : kind === 9 ? 'remaster' : 'game',
    posterUrl: g.cover ? `https://images.igdb.com/igdb/image/upload/t_cover_big_2x/${g.cover.image_id}.jpg` : null,
    synopsis: g.summary ?? null,
    genres: g.genres?.map((x) => x.name),
    titles: g.alternative_names?.slice(0, 6).map((a) => ({ title: a.name, kind: 'synonym' as const })),
    externalIds: [{ provider: 'igdb', external_id: String(g.id), url: g.url }],
    details: {
      developers: g.involved_companies?.filter((c) => c.developer).map((c) => c.company.name),
      publishers: g.involved_companies?.filter((c) => c.publisher).map((c) => c.company.name),
      platforms: g.platforms?.map((p) => p.name),
      igdb_slug: g.slug,
    },
    url: g.url,
  }
}

export async function searchIgdb(q: string): Promise<ProviderResult[]> {
  const safe = q.replace(/["\\]/g, ' ').slice(0, 100)
  const r = await invoke<IgdbGame[]>('igdb', { endpoint: 'games', query: `search "${safe}"; ${IGDB_FIELDS} limit 15;` })
  return r.map(mapGame)
}

export async function getIgdbById(id: number): Promise<ProviderResult | null> {
  const r = await cached('igdb', `id:${id}`, async () => {
    const g = await invoke<IgdbGame[]>('igdb', { endpoint: 'games', query: `${IGDB_FIELDS} where id = ${Math.trunc(id)};` })
    return g[0] ? mapGame(g[0]) : null
  })
  return r ? withTimeToBeat(r) : null
}

/**
 * IGDB "Time to Beat" (player-submitted, like HowLongToBeat): adds
 * details.time_to_beat_minutes from the "normally" value (falls back to "hastily").
 */
/** Longest plausible "time to beat" (300 h); longer values are treated as unknown. */
export const MAX_TTB_MINUTES = 300 * 60

export async function withTimeToBeat(r: ProviderResult): Promise<ProviderResult> {
  if (r.provider !== 'igdb' || r.details?.time_to_beat_minutes) return r
  try {
    const ttb = await cached('igdb', `ttb:${r.externalId}`, async () =>
      (await invoke<{ normally?: number; hastily?: number }[]>('igdb', { endpoint: 'game_time_to_beats', query: `fields normally,hastily,completely; where game_id = ${Math.trunc(Number(r.externalId))};` }))[0] ?? {})
    const seconds = ttb.normally ?? ttb.hastily
    // Endless / live games get absurd crowd-sourced values (SCP: 99,999 h): over 300 h counts as unknown.
    const minutes = seconds ? Math.round(seconds / 60) : 0
    return minutes > 0 && minutes <= MAX_TTB_MINUTES ? { ...r, details: { ...r.details, time_to_beat_minutes: minutes } } : r
  } catch {
    return r // time to beat is optional; never block enrichment on it
  }
}
