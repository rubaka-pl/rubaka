/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 */

// Row types mirroring supabase/migrations. Kept by hand (small schema) so the
// project builds without a live database for `supabase gen types`.

export const CATEGORIES = [
  'anime', 'manga', 'novel', 'visual_novel', 'movie', 'tv_series', 'animated_series', 'game',
] as const
export type MediaCategory = (typeof CATEGORIES)[number]

export const STATUSES = ['planning', 'in_progress', 'completed', 'on_hold', 'dropped'] as const
export type LibraryStatus = (typeof STATUSES)[number]

export type SessionType = 'rewatch' | 'reread' | 'replay'
export type SessionStatus = 'active' | 'completed' | 'abandoned'
export type ReleaseStatus = 'upcoming' | 'releasing' | 'finished' | 'cancelled' | 'hiatus'
export type EnrichmentState = 'pending' | 'matched' | 'unresolved' | 'failed' | 'skipped'
export type RelationType =
  | 'adaptation' | 'source' | 'sequel' | 'prequel' | 'side_story' | 'spin_off'
  | 'alternative' | 'parent' | 'summary' | 'character' | 'other'

export type ExternalProvider =
  | 'mal_anime' | 'mal_manga' | 'anilist' | 'kitsu' | 'imdb' | 'tmdb_movie' | 'tmdb_tv' | 'tvmaze'
  | 'vndb' | 'igdb' | 'rawg' | 'backloggd' | 'openlibrary' | 'mangadex' | 'other'

export type TitleKind = 'english' | 'romaji' | 'japanese' | 'native' | 'russian' | 'synonym' | 'other'

/** Category-specific metadata stored in media.details. All optional. */
export interface MediaDetails {
  studios?: string[]
  authors?: string[]
  artists?: string[]
  developers?: string[]
  publishers?: string[]
  directors?: string[]
  cast?: string[]
  platforms?: string[]
  themes?: string[]
  tags?: string[]
  source?: string
  age_rating?: string
  imdb_rating?: number
  networks?: string[]
  [key: string]: unknown
}

export interface Media {
  id: string
  category: MediaCategory
  title: string
  original_title: string | null
  synopsis: string | null
  format: string | null
  release_date: string | null
  release_year: number | null
  end_date: string | null
  release_status: ReleaseStatus | null
  country: string | null
  poster_url: string | null
  backdrop_url: string | null
  custom_poster_path: string | null
  custom_backdrop_path: string | null
  total_episodes: number | null
  total_chapters: number | null
  total_volumes: number | null
  total_seasons: number | null
  total_routes: number | null
  episode_duration: number | null
  runtime: number | null
  details: MediaDetails
  franchise_id: string | null
  locked_fields: string[]
  is_custom: boolean
  enrichment_state: EnrichmentState
  enriched_at: string | null
  created_at: string
  updated_at: string
}

export interface LibraryEntry {
  id: string
  user_id: string
  media_id: string
  status: LibraryStatus
  /** Half-stars 0..10. null = unrated, 0 = explicit zero. */
  rating: number | null
  episodes_watched: number
  chapters_read: number
  volumes_read: number
  current_season: number | null
  current_episode: number | null
  routes_completed: number
  endings_completed: number
  start_date: string | null
  completion_date: string | null
  imported_repeat_count: number
  session_repeat_count: number
  repeat_count: number
  is_favorite: boolean
  wishlisted_at: string | null
  wishlist_priority: number | null
  notes: string | null
  review: string | null
  /** Manual time spent (minutes); overrides the estimate. */
  time_spent_minutes: number | null
  added_at: string
  completed_at: string | null
  last_activity_at: string
  created_at: string
  updated_at: string
}

/** Editable subset of LibraryEntry. */
export type EntryPatch = Partial<Pick<LibraryEntry,
  | 'status' | 'rating' | 'episodes_watched' | 'chapters_read' | 'volumes_read' | 'current_season'
  | 'current_episode' | 'routes_completed' | 'endings_completed' | 'start_date' | 'completion_date'
  | 'imported_repeat_count' | 'is_favorite' | 'wishlisted_at' | 'wishlist_priority' | 'notes' | 'review' | 'time_spent_minutes'>>

/** Row returned by the library_query RPC. */
export interface LibraryItem {
  entry_id: string
  media_id: string
  category: MediaCategory
  title: string
  original_title: string | null
  format: string | null
  release_year: number | null
  release_date: string | null
  release_status: ReleaseStatus | null
  country: string | null
  poster_url: string | null
  custom_poster_path: string | null
  total_episodes: number | null
  total_chapters: number | null
  total_volumes: number | null
  total_seasons: number | null
  total_routes: number | null
  status: LibraryStatus
  rating: number | null
  episodes_watched: number
  chapters_read: number
  volumes_read: number
  current_season: number | null
  current_episode: number | null
  routes_completed: number
  endings_completed: number
  start_date: string | null
  completion_date: string | null
  repeat_count: number
  is_favorite: boolean
  wishlisted_at: string | null
  wishlist_priority: number | null
  added_at: string
  last_activity_at: string
  active_session_id: string | null
  active_session_progress: number | null
  genres: string[]
  relevance: number
  total_count: number
}

export interface TrackingSession {
  id: string
  entry_id: string
  session_type: SessionType
  status: SessionStatus
  start_date: string | null
  end_date: string | null
  progress: number | null
  progress_secondary: number | null
  season_number: number | null
  rating: number | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface MediaTitle {
  id: string
  media_id: string
  title: string
  kind: TitleKind
}

export interface MediaExternalId {
  provider: ExternalProvider
  external_id: string
  media_id: string
  url: string | null
}

export interface MediaSeason {
  media_id: string
  season_number: number
  title: string | null
  episode_count: number | null
  air_date: string | null
}

export interface SeasonProgress {
  entry_id: string
  season_number: number
  episodes_watched: number
}

export interface MediaRelation {
  id: string
  media_id: string
  relation_type: RelationType
  related_media_id: string | null
  related_title: string | null
  related_category: MediaCategory | null
  related_provider: string | null
  related_external_id: string | null
  related_poster_url: string | null
}

export interface VnRoute {
  id: string
  entry_id: string
  name: string
  kind: 'route' | 'ending'
  completed: boolean
  completed_on: string | null
  sort_order: number
  source: 'manual' | 'vndb'
}

export type ActivityAction =
  | 'added' | 'status_changed' | 'completed' | 'rating_changed' | 'progress'
  | 'repeat_started' | 'repeat_completed' | 'repeat_abandoned'
  | 'wishlist_added' | 'wishlist_removed' | 'favorited' | 'imported' | 'restored'

export interface ActivityRow {
  id: number
  entry_id: string | null
  media_id: string | null
  category: MediaCategory | null
  action: ActivityAction
  details: Record<string, unknown>
  created_at: string
  media?: Pick<Media, 'title' | 'poster_url' | 'custom_poster_path'> | null
}

export interface ImportJob {
  id: string
  source: 'imdb_csv' | 'mal_xml' | 'backloggd_json' | 'vndb_api' | 'rubaka_backup' | 'other'
  file_name: string | null
  status: 'running' | 'completed' | 'partial' | 'failed' | 'cancelled'
  options: Record<string, unknown>
  summary: Record<string, unknown>
  created_at: string
  finished_at: string | null
}

export interface ImportRecordRow {
  id: number
  job_id: string
  source_key: string
  row_number: number | null
  outcome: 'created' | 'updated' | 'unchanged' | 'skipped' | 'failed' | 'invalid'
  entry_id: string | null
  media_id: string | null
  message: string | null
  raw: unknown
  created_at: string
}

export interface EnrichmentJob {
  id: string
  media_id: string
  provider: string
  status: 'pending' | 'running' | 'done' | 'unresolved' | 'failed' | 'review'
  attempts: number
  last_error: string | null
  next_attempt_at: string
  result: Record<string, unknown> | null
}

export interface CategorySummary {
  category: MediaCategory
  total: number
  active: number
  completed: number
  wishlist: number
}

export interface Franchise {
  id: string
  name: string
  source: string | null
  created_at: string
  updated_at: string
}

/** Row of franchise_list(). */
export interface FranchiseSummary {
  id: string
  name: string
  members: number
  completed: number
  in_progress: number
  categories: MediaCategory[]
  posters: { poster_url: string | null; custom_poster_path: string | null; title: string }[]
  avg_rating: number | null
  first_year: number | null
  updated_at: string
}

export interface ShareLink {
  token: string
  user_id: string
  show_ratings: boolean
  categories: MediaCategory[] | null
  created_at: string
}
