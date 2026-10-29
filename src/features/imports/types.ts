/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 */
import type { EntryPatch, ExternalProvider, LibraryStatus, MediaCategory, MediaDetails, SessionStatus, SessionType, TitleKind } from '@/types/db'

export type ImportSource = 'imdb_csv' | 'mal_xml' | 'backloggd_json' | 'vndb_api' | 'nhentai_json'

/**
 * Normalized record produced by an adapter. This is exactly what the
 * import_apply RPC consumes (plus preview-only fields).
 */
export interface NormalizedRecord {
  source_key: string
  row_number: number
  /** Original source row, stored in import_records so nothing is lost. */
  raw: unknown
  media: {
    category: MediaCategory
    title: string
    original_title?: string | null
    format?: string | null
    release_year?: number | null
    release_date?: string | null
    total_episodes?: number | null
    total_chapters?: number | null
    total_volumes?: number | null
    total_seasons?: number | null
    total_routes?: number | null
    synopsis?: string | null
    poster_url?: string | null
    backdrop_url?: string | null
    release_status?: string | null
    country?: string | null
    end_date?: string | null
    runtime?: number | null
    episode_duration?: number | null
    details?: MediaDetails
  }
  titles: { title: string; kind: TitleKind }[]
  genres: string[]
  external_ids: { provider: ExternalProvider; external_id: string; url?: string | null }[]
  entry: EntryPatch & { added_at?: string | null; status?: LibraryStatus }
  sessions?: { session_type: SessionType; status: SessionStatus; start_date?: string | null; end_date?: string | null; rating?: number | null; notes?: string | null }[]
  /** Adapter notes shown in the preview (e.g. "total dropped: progress exceeded it"). */
  warnings: string[]
  /** Adapter suggests the user reviews this record (e.g. category is a guess). */
  needsReview?: string
  /** Adapter default: skip this record unless the user includes it. */
  defaultSkip?: string
}

export interface InvalidRecord {
  source_key: string
  row_number: number
  raw: unknown
  reason: string
}

export interface ParseResult {
  source: ImportSource
  records: NormalizedRecord[]
  invalid: InvalidRecord[]
  /** Information about the file (e.g. MAL header totals) for the preview. */
  meta: Record<string, unknown>
}

export interface AdapterOption {
  key: string
  label: string
  description?: string
  choices: { value: string; label: string }[]
  default: string
}

export interface ImportAdapter {
  source: ImportSource
  label: string
  /** Accept a file by name/content sniffing. */
  detect: (fileName: string, head: string) => boolean
  options: AdapterOption[]
  parse: (text: string, options: Record<string, string>) => ParseResult
}
