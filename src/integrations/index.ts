/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 */
import { normalizeTitle } from '@/lib/utils'
import type { MediaCategory } from '@/types/db'
import { searchAniList } from './anilist'
import { searchOpenLibrary } from './openlibrary'
import { getProxyStatus, searchIgdb, searchTmdb } from './proxied'
import { searchTvmaze } from './tvmaze'
import type { ProviderResult } from './types'
import { searchVndb } from './vndb'

export type SearchProvider = 'anilist' | 'vndb' | 'tvmaze' | 'openlibrary' | 'tmdb' | 'igdb'

export const PROVIDER_LABEL: Record<SearchProvider | 'mal', string> = {
  mal: 'MyAnimeList', anilist: 'AniList', vndb: 'VNDB', tvmaze: 'TVMaze', openlibrary: 'Open Library', tmdb: 'TMDB', igdb: 'IGDB',
}

/** Providers per category, in preference order. Proxied ones need server secrets. */
export const CATEGORY_PROVIDERS: Record<MediaCategory, SearchProvider[]> = {
  anime: ['anilist'],
  manga: ['anilist'],
  novel: ['anilist', 'openlibrary'],
  visual_novel: ['vndb'],
  movie: ['tmdb'],
  tv_series: ['tvmaze', 'tmdb'],
  animated_series: ['tvmaze', 'tmdb'],
  game: ['igdb'],
  // No public metadata source: doujinshi come from the nhentai favourites import or are added by hand.
  doujinshi: [],
}

export async function availableProviders(category: MediaCategory): Promise<{ provider: SearchProvider; available: boolean }[]> {
  const status = await getProxyStatus()
  return CATEGORY_PROVIDERS[category].map((p) => ({
    provider: p,
    available: p === 'tmdb' ? !!status?.tmdb : p === 'igdb' ? !!status?.igdb : true,
  }))
}

export async function searchProvider(provider: SearchProvider, category: MediaCategory, q: string): Promise<ProviderResult[]> {
  let results: ProviderResult[]
  switch (provider) {
    case 'anilist': results = await searchAniList(q, category); break
    case 'vndb': results = await searchVndb(q); break
    case 'tvmaze': results = await searchTvmaze(q); break
    case 'openlibrary': results = await searchOpenLibrary(q); break
    case 'tmdb': results = await searchTmdb(q, category); break
    case 'igdb': results = await searchIgdb(q); break
  }
  return results.map((r) => ({ ...r, confidence: matchConfidence(q, r) }))
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>()
  const t = ` ${s} `
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2)
    m.set(g, (m.get(g) ?? 0) + 1)
  }
  return m
}

/** Sørensen–Dice coefficient on character bigrams of normalized strings (0..1). */
export function similarity(a: string, b: string): number {
  const x = normalizeTitle(a), y = normalizeTitle(b)
  if (!x || !y) return 0
  if (x === y) return 1
  const A = bigrams(x), B = bigrams(y)
  let inter = 0, total = 0
  for (const [g, n] of A) { inter += Math.min(n, B.get(g) ?? 0); total += n }
  for (const n of B.values()) total += n
  return (2 * inter) / total
}

/**
 * Confidence that a provider result is the title the user meant: best
 * similarity over all known titles, with a bonus when a year in the query (or
 * a known year) matches. Used to rank results and to decide when automatic
 * enrichment may apply a title-based match (>= 0.92 and unique) versus
 * sending it to manual review.
 */
export function matchConfidence(query: string, r: Pick<ProviderResult, 'title' | 'originalTitle' | 'titles' | 'year'>, year?: number | null): number {
  const yearInQuery = query.match(/\b(19|20)\d{2}\b/)?.[0]
  const q = yearInQuery ? query.replace(yearInQuery, '') : query
  const names = [r.title, r.originalTitle, ...(r.titles?.map((t) => t.title) ?? [])].filter((s): s is string => !!s)
  let best = 0
  for (const n of names) best = Math.max(best, similarity(q, n))
  const y = year ?? (yearInQuery ? Number(yearInQuery) : null)
  if (y && r.year) best = r.year === y ? Math.min(1, best + 0.08) : Math.abs(r.year - y) > 1 ? best * 0.8 : best
  return Math.round(best * 100) / 100
}

export type { ProviderResult } from './types'
