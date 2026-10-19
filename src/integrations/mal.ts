// Official MyAnimeList API v2 (https://myanimelist.net/apiconfig/references/api/v2).
// Needs a free Client ID, which stays on the server (metadata-proxy Edge
// Function, secret MAL_CLIENT_ID). Used as a fallback for MAL ids AniList
// does not know. No scraping.
import type { MediaCategory, ReleaseStatus, TitleKind } from '@/types/db'
import { cached } from './http'
import { invoke } from './proxied'
import type { ProviderResult } from './types'

const ANIME_FIELDS = 'id,title,main_picture,alternative_titles,start_date,end_date,synopsis,genres,media_type,status,num_episodes,average_episode_duration,studios,source'
const MANGA_FIELDS = 'id,title,main_picture,alternative_titles,start_date,end_date,synopsis,genres,media_type,status,num_volumes,num_chapters,authors{first_name,last_name}'

interface MalNode {
  id: number
  title: string
  main_picture?: { medium?: string; large?: string }
  alternative_titles?: { synonyms?: string[]; en?: string; ja?: string }
  start_date?: string
  end_date?: string
  synopsis?: string
  genres?: { name: string }[]
  media_type?: string
  status?: string
  num_episodes?: number
  average_episode_duration?: number
  studios?: { name: string }[]
  source?: string
  num_volumes?: number
  num_chapters?: number
  authors?: { node: { first_name?: string; last_name?: string }; role?: string }[]
}

const STATUS: Record<string, ReleaseStatus> = {
  finished_airing: 'finished', currently_airing: 'releasing', not_yet_aired: 'upcoming',
  finished: 'finished', currently_publishing: 'releasing', not_yet_published: 'upcoming', on_hiatus: 'hiatus', discontinued: 'cancelled',
}
const ANIME_FORMAT: Record<string, string> = { tv: 'tv', ova: 'ova', ona: 'ona', movie: 'movie', special: 'special', tv_special: 'special', music: 'music' }
const MANGA_FORMAT: Record<string, string> = { manga: 'manga', manhwa: 'manhwa', manhua: 'manhua', one_shot: 'one_shot', doujinshi: 'doujinshi', oel: 'other' }

const fullDate = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null)
const year = (d?: string) => (d && /^\d{4}/.test(d) ? Number(d.slice(0, 4)) : null)
/** MAL uses 0 for unknown counts. */
const count = (n?: number) => (n && n > 0 ? n : null)

export function mapMal(n: MalNode, kind: 'anime' | 'manga'): ProviderResult {
  const novel = kind === 'manga' && (n.media_type === 'light_novel' || n.media_type === 'novel')
  const category: MediaCategory = kind === 'anime' ? 'anime' : novel ? 'novel' : 'manga'
  const titles: { title: string; kind: TitleKind }[] = []
  if (n.alternative_titles?.en && n.alternative_titles.en !== n.title) titles.push({ title: n.alternative_titles.en, kind: 'english' })
  if (n.alternative_titles?.ja) titles.push({ title: n.alternative_titles.ja, kind: 'japanese' })
  for (const s of n.alternative_titles?.synonyms ?? []) if (s) titles.push({ title: s, kind: 'synonym' })
  const authors = (n.authors ?? []).map((a) => [a.node.first_name, a.node.last_name].filter(Boolean).join(' ')).filter(Boolean)
  const url = `https://myanimelist.net/${kind}/${n.id}`
  return {
    provider: 'mal',
    externalId: String(n.id),
    category,
    title: n.title,
    originalTitle: n.alternative_titles?.ja || null,
    year: year(n.start_date),
    releaseDate: fullDate(n.start_date),
    endDate: fullDate(n.end_date),
    releaseStatus: n.status ? STATUS[n.status] ?? null : null,
    format: kind === 'anime' ? ANIME_FORMAT[n.media_type ?? ''] ?? (n.media_type ? 'other' : null) : novel ? 'light_novel' : MANGA_FORMAT[n.media_type ?? ''] ?? null,
    country: n.media_type === 'manhwa' ? 'KR' : n.media_type === 'manhua' ? 'CN' : null,
    posterUrl: n.main_picture?.large ?? n.main_picture?.medium ?? null,
    synopsis: n.synopsis?.replace(/\[Written by MAL Rewrite\]\s*$/, '').trim() || null,
    totals: { episodes: count(n.num_episodes), chapters: count(n.num_chapters), volumes: count(n.num_volumes) },
    episodeDuration: n.average_episode_duration ? Math.round(n.average_episode_duration / 60) || null : null,
    genres: n.genres?.map((g) => g.name),
    titles,
    externalIds: [{ provider: kind === 'anime' ? 'mal_anime' : 'mal_manga', external_id: String(n.id), url }],
    details: {
      ...(n.studios?.length ? { studios: n.studios.map((s) => s.name) } : {}),
      ...(authors.length ? { authors } : {}),
      ...(n.source ? { source: n.source.replace(/_/g, ' ') } : {}),
    },
    url,
  }
}

export async function getMalById(kind: 'anime' | 'manga', id: number): Promise<ProviderResult | null> {
  return cached('mal', `${kind}:${id}`, async () => {
    try {
      const node = await invoke<MalNode>('mal', { path: `/${kind}/${Math.trunc(id)}`, params: { fields: kind === 'anime' ? ANIME_FIELDS : MANGA_FIELDS } })
      return node?.id ? mapMal(node, kind) : null
    } catch (e) {
      if ((e as { status?: number }).status === 404) return null
      throw e
    }
  })
}
