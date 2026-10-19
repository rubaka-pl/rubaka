// TVMaze API (https://www.tvmaze.com/api). Public, no key, CORS enabled.
// Used for TV Series / Animated Series, including lookup by IMDb id.
import type { MediaCategory, ReleaseStatus } from '@/types/db'
import { cached, htmlToText, providerFetch, providerJson } from './http'
import type { ProviderResult } from './types'

interface TvShow {
  id: number
  url: string
  name: string
  type: string
  language: string | null
  genres: string[]
  status: string
  averageRuntime: number | null
  premiered: string | null
  ended: string | null
  network: { name: string; country: { code: string } | null } | null
  webChannel: { name: string; country: { code: string } | null } | null
  externals: { imdb: string | null; thetvdb: number | null }
  image: { medium: string; original: string } | null
  summary: string | null
  _embedded?: {
    seasons?: { number: number; name: string; episodeOrder: number | null; premiereDate: string | null }[]
    cast?: { person: { name: string } }[]
  }
}

const STATUS: Record<string, ReleaseStatus> = { Ended: 'finished', Running: 'releasing', 'To Be Determined': 'hiatus', 'In Development': 'upcoming' }

/**
 * TVMaze labels animated shows with type "Animation" — this is how imported
 * IMDb series are suggested as Animated Series. Japanese-language animation is
 * flagged so the user can decide whether it belongs in Anime instead (never
 * moved automatically).
 */
export function tvmazeCategory(show: Pick<TvShow, 'type'>): MediaCategory {
  return show.type === 'Animation' ? 'animated_series' : 'tv_series'
}

function mapShow(s: TvShow): ProviderResult {
  const seasons = (s._embedded?.seasons ?? []).filter((x) => x.number != null)
  const totalEpisodes = seasons.length && seasons.every((x) => x.episodeOrder) ? seasons.reduce((n, x) => n + (x.episodeOrder ?? 0), 0) : null
  const ch = s.network ?? s.webChannel
  return {
    provider: 'tvmaze',
    externalId: String(s.id),
    category: tvmazeCategory(s),
    title: s.name,
    year: s.premiered ? Number(s.premiered.slice(0, 4)) : null,
    releaseDate: s.premiered,
    endDate: s.ended,
    releaseStatus: STATUS[s.status] ?? null,
    format: 'series',
    country: ch?.country?.code ?? null,
    posterUrl: s.image?.original ?? s.image?.medium ?? null,
    synopsis: htmlToText(s.summary),
    totals: { seasons: seasons.length || null, episodes: totalEpisodes },
    episodeDuration: s.averageRuntime,
    genres: s.genres,
    externalIds: [
      { provider: 'tvmaze', external_id: String(s.id), url: s.url },
      ...(s.externals.imdb ? [{ provider: 'imdb' as const, external_id: s.externals.imdb, url: `https://www.imdb.com/title/${s.externals.imdb}/` }] : []),
    ],
    details: {
      ...(ch ? { networks: [ch.name] } : {}),
      ...(s._embedded?.cast?.length ? { cast: s._embedded.cast.slice(0, 10).map((c) => c.person.name) } : {}),
      ...(s.language ? { language: s.language } : {}),
      tvmaze_type: s.type,
    },
    seasons: seasons.map((x) => ({ season_number: x.number, title: x.name || null, episode_count: x.episodeOrder, air_date: x.premiereDate })),
    url: s.url,
  }
}

export async function searchTvmaze(q: string): Promise<ProviderResult[]> {
  const res = await providerJson<{ score: number; show: TvShow }[]>('tvmaze', `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(q)}`)
  return res.map((r) => mapShow(r.show))
}

export async function getTvmazeById(id: number): Promise<ProviderResult | null> {
  return cached('tvmaze', `id:${id}`, async () => {
    const res = await providerFetch('tvmaze', `https://api.tvmaze.com/shows/${id}?embed[]=seasons&embed[]=cast`)
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`TVMaze responded ${res.status}`)
    return mapShow((await res.json()) as TvShow)
  })
}

/** Resolve an IMDb tt-id to a TVMaze show (404 = TVMaze does not know it). */
export async function getTvmazeByImdb(imdbId: string): Promise<ProviderResult | null> {
  const lookup = await cached('tvmaze', `imdb:${imdbId}`, async () => {
    const res = await providerFetch('tvmaze', `https://api.tvmaze.com/lookup/shows?imdb=${encodeURIComponent(imdbId)}`)
    if (res.status === 404) return { id: null as number | null }
    if (!res.ok) throw new Error(`TVMaze responded ${res.status}`)
    return { id: ((await res.json()) as TvShow).id }
  })
  return lookup.id ? getTvmazeById(lookup.id) : null
}
