/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 */
// AniList GraphQL API (https://docs.anilist.co). Public, no key, CORS enabled.
import type { MediaCategory, RelationType, ReleaseStatus, TitleKind } from '@/types/db'
import { cached, htmlToText, isoDate, providerJson } from './http'
import type { ProviderResult } from './types'

const ENDPOINT = 'https://graphql.anilist.co'

const FIELDS = `
  id idMal type format status countryOfOrigin isAdult siteUrl
  title { romaji english native }
  synonyms
  description(asHtml: false)
  startDate { year month day }
  endDate { year month day }
  episodes duration chapters volumes source
  coverImage { extraLarge large }
  bannerImage
  genres
  tags { name rank isMediaSpoiler }
  studios(isMain: true) { nodes { name } }
  staff(perPage: 8, sort: RELEVANCE) { edges { role node { name { full } } } }
  relations { edges { relationType node { id idMal type format title { romaji english } coverImage { medium } } } }
`

interface AniMedia {
  id: number
  idMal: number | null
  type: 'ANIME' | 'MANGA'
  format: string | null
  status: string | null
  countryOfOrigin: string | null
  isAdult: boolean
  siteUrl: string
  title: { romaji: string | null; english: string | null; native: string | null }
  synonyms: string[]
  description: string | null
  startDate: { year: number | null; month: number | null; day: number | null }
  endDate: { year: number | null; month: number | null; day: number | null }
  episodes: number | null
  duration: number | null
  chapters: number | null
  volumes: number | null
  source: string | null
  coverImage: { extraLarge: string | null; large: string | null }
  bannerImage: string | null
  genres: string[]
  tags: { name: string; rank: number; isMediaSpoiler: boolean }[]
  studios: { nodes: { name: string }[] }
  staff: { edges: { role: string; node: { name: { full: string } } }[] }
  relations: { edges: { relationType: string; node: { id: number; idMal: number | null; type: string; format: string | null; title: { romaji: string | null; english: string | null }; coverImage: { medium: string | null } } }[] }
}

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await providerJson<{ data: T; errors?: { message: string }[] }>('anilist', ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  if (res.errors?.length) throw new Error(`AniList: ${res.errors[0].message}`)
  return res.data
}

const STATUS: Record<string, ReleaseStatus> = {
  FINISHED: 'finished', RELEASING: 'releasing', NOT_YET_RELEASED: 'upcoming', CANCELLED: 'cancelled', HIATUS: 'hiatus',
}
const ANIME_FORMAT: Record<string, string> = {
  TV: 'tv', TV_SHORT: 'tv_short', MOVIE: 'movie', SPECIAL: 'special', OVA: 'ova', ONA: 'ona', MUSIC: 'music',
}
const RELATION: Record<string, RelationType> = {
  ADAPTATION: 'adaptation', SOURCE: 'source', SEQUEL: 'sequel', PREQUEL: 'prequel', SIDE_STORY: 'side_story',
  SPIN_OFF: 'spin_off', ALTERNATIVE: 'alternative', PARENT: 'parent', SUMMARY: 'summary', CHARACTER: 'character',
}

/** Category an AniList entry belongs to in RUBAKA (light novels go to Novels). */
export function anilistCategory(m: Pick<AniMedia, 'type' | 'format'>): MediaCategory {
  if (m.type === 'ANIME') return 'anime'
  return m.format === 'NOVEL' ? 'novel' : 'manga'
}

function mangaFormat(m: AniMedia): string | null {
  if (m.format === 'NOVEL') return 'light_novel'
  if (m.format === 'ONE_SHOT') return 'one_shot'
  if (m.countryOfOrigin === 'KR') return 'manhwa'
  if (m.countryOfOrigin === 'CN' || m.countryOfOrigin === 'TW') return 'manhua'
  return m.format === 'MANGA' ? 'manga' : null
}

export function mapAniList(m: AniMedia): ProviderResult {
  const category = anilistCategory(m)
  const title = m.title.english || m.title.romaji || m.title.native || `AniList #${m.id}`
  const titles: { title: string; kind: TitleKind }[] = []
  if (m.title.romaji && m.title.romaji !== title) titles.push({ title: m.title.romaji, kind: 'romaji' })
  if (m.title.english && m.title.english !== title) titles.push({ title: m.title.english, kind: 'english' })
  if (m.title.native) titles.push({ title: m.title.native, kind: m.countryOfOrigin === 'JP' ? 'japanese' : 'native' })
  for (const s of m.synonyms ?? []) if (s && s !== title) titles.push({ title: s, kind: 'synonym' })
  const authors = m.staff.edges.filter((e) => /story|original creator|author/i.test(e.role)).map((e) => e.node.name.full)
  const artists = m.staff.edges.filter((e) => /art/i.test(e.role)).map((e) => e.node.name.full)
  const ids: ProviderResult['externalIds'] = [{ provider: 'anilist', external_id: String(m.id), url: m.siteUrl }]
  if (m.idMal) {
    ids.push({ provider: m.type === 'ANIME' ? 'mal_anime' : 'mal_manga', external_id: String(m.idMal), url: `https://myanimelist.net/${m.type === 'ANIME' ? 'anime' : 'manga'}/${m.idMal}` })
  }
  return {
    provider: 'anilist',
    externalId: String(m.id),
    category,
    title,
    originalTitle: m.title.native,
    year: m.startDate.year,
    releaseDate: isoDate(m.startDate.year, m.startDate.month, m.startDate.day),
    endDate: isoDate(m.endDate.year, m.endDate.month, m.endDate.day),
    releaseStatus: m.status ? STATUS[m.status] ?? null : null,
    format: m.type === 'ANIME' ? (m.format ? ANIME_FORMAT[m.format] ?? 'other' : null) : mangaFormat(m),
    country: m.countryOfOrigin,
    posterUrl: m.coverImage.extraLarge || m.coverImage.large,
    backdropUrl: m.bannerImage,
    synopsis: htmlToText(m.description),
    totals: { episodes: m.episodes, chapters: m.chapters, volumes: m.volumes },
    episodeDuration: m.duration,
    genres: m.genres,
    titles,
    externalIds: ids,
    details: {
      ...(m.studios.nodes.length ? { studios: m.studios.nodes.map((s) => s.name) } : {}),
      ...(authors.length ? { authors } : {}),
      ...(artists.length ? { artists } : {}),
      ...(m.source ? { source: m.source.replace(/_/g, ' ').toLowerCase() } : {}),
      themes: m.tags.filter((t) => !t.isMediaSpoiler && t.rank >= 60).slice(0, 10).map((t) => t.name),
    },
    relations: m.relations.edges
      .filter((e) => e.node.type === 'ANIME' || e.node.type === 'MANGA')
      .map((e) => ({
        relation_type: RELATION[e.relationType] ?? 'other',
        provider: 'anilist' as const,
        external_id: String(e.node.id),
        title: e.node.title.english || e.node.title.romaji || `#${e.node.id}`,
        category: anilistCategory({ type: e.node.type as AniMedia['type'], format: e.node.format }),
        poster_url: e.node.coverImage.medium,
      })),
    isAdult: m.isAdult,
    url: m.siteUrl,
  }
}

export async function searchAniList(q: string, category: MediaCategory, adult = false): Promise<ProviderResult[]> {
  const type = category === 'anime' ? 'ANIME' : 'MANGA'
  const formatFilter = category === 'novel' ? ', format_in: [NOVEL]' : category === 'manga' ? ', format_not: NOVEL' : ''
  const data = await gql<{ Page: { media: AniMedia[] } }>(
    `query ($q: String, $adult: Boolean) { Page(perPage: 15) { media(search: $q, type: ${type}${formatFilter}, isAdult: $adult, sort: SEARCH_MATCH) { ${FIELDS} } } }`,
    { q, adult },
  )
  return data.Page.media.map(mapAniList)
}

export async function getAniListById(id: number): Promise<ProviderResult | null> {
  return cached('anilist', `id:${id}`, async () => {
    const data = await gql<{ Media: AniMedia | null }>(`query ($id: Int) { Media(id: $id) { ${FIELDS} } }`, { id })
    return data.Media ? mapAniList(data.Media) : null
  })
}

/**
 * Batch lookup by MyAnimeList ids (50 per request) — used to enrich MAL
 * imports. Returns a map of MAL id -> result. Ids AniList does not know are
 * simply absent from the map.
 */
export async function getAniListByMalIds(malIds: number[], type: 'ANIME' | 'MANGA'): Promise<Map<number, ProviderResult>> {
  const out = new Map<number, ProviderResult>()
  for (let i = 0; i < malIds.length; i += 50) {
    const batch = malIds.slice(i, i + 50)
    const key = `mal:${type}:${batch.join(',')}`
    const results = await cached('anilist', key, async () => {
      const data = await gql<{ Page: { media: AniMedia[] } }>(
        `query ($ids: [Int]) { Page(perPage: 50) { media(idMal_in: $ids, type: ${type}) { ${FIELDS} } } }`,
        { ids: batch },
      )
      return data.Page.media.map((m) => ({ malId: m.idMal, result: mapAniList(m) }))
    })
    for (const r of results) if (r.malId) out.set(r.malId, r.result)
  }
  return out
}
