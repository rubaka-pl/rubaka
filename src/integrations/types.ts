import type { ExternalProvider, MediaCategory, MediaDetails, RelationType, ReleaseStatus, TitleKind } from '@/types/db'

/** Provider-neutral metadata record used by Add Media and enrichment. */
export interface ProviderResult {
  provider: 'anilist' | 'vndb' | 'tvmaze' | 'openlibrary' | 'tmdb' | 'igdb' | 'mal'
  /** Id within that provider (namespaced provider key is in externalIds). */
  externalId: string
  category: MediaCategory
  title: string
  originalTitle?: string | null
  year?: number | null
  releaseDate?: string | null
  endDate?: string | null
  releaseStatus?: ReleaseStatus | null
  format?: string | null
  country?: string | null
  posterUrl?: string | null
  backdropUrl?: string | null
  synopsis?: string | null
  totals?: { episodes?: number | null; chapters?: number | null; volumes?: number | null; seasons?: number | null; routes?: number | null }
  episodeDuration?: number | null
  runtime?: number | null
  genres?: string[]
  titles?: { title: string; kind: TitleKind }[]
  externalIds: { provider: ExternalProvider; external_id: string; url?: string | null }[]
  details?: MediaDetails
  seasons?: { season_number: number; title?: string | null; episode_count?: number | null; air_date?: string | null }[]
  relations?: { relation_type: RelationType; provider: ExternalProvider; external_id: string; title: string; category?: MediaCategory | null; poster_url?: string | null }[]
  isAdult?: boolean
  url?: string | null
  /** 0..1 similarity to the search query (set by search). */
  confidence?: number
}

export class ProviderError extends Error {
  constructor(message: string, readonly provider: string, readonly status?: number, readonly retryable = false) {
    super(message)
  }
}

/** media patch for apply_enrichment / media insert. */
export function toMediaPatch(r: ProviderResult) {
  return {
    original_title: r.originalTitle ?? null,
    synopsis: r.synopsis ?? null,
    format: r.format ?? null,
    release_date: r.releaseDate ?? null,
    release_year: r.year ?? (r.releaseDate ? Number(r.releaseDate.slice(0, 4)) : null),
    end_date: r.endDate ?? null,
    release_status: r.releaseStatus ?? null,
    country: r.country ?? null,
    poster_url: r.posterUrl ?? null,
    backdrop_url: r.backdropUrl ?? null,
    total_episodes: r.totals?.episodes || null,
    total_chapters: r.totals?.chapters || null,
    total_volumes: r.totals?.volumes || null,
    total_seasons: r.totals?.seasons || null,
    total_routes: r.totals?.routes || null,
    episode_duration: r.episodeDuration || null,
    runtime: r.runtime || null,
    details: { ...(r.details ?? {}), ...(r.isAdult ? { is_adult: true } : {}) },
  }
}

export function toEnrichmentPayload(r: ProviderResult) {
  return {
    media: toMediaPatch(r),
    titles: r.titles ?? [],
    genres: r.genres ?? [],
    external_ids: r.externalIds,
    seasons: r.seasons ?? [],
    relations: (r.relations ?? []).map((x) => ({ ...x })),
  }
}
