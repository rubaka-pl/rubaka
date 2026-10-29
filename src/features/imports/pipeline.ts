/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 */
// Import pipeline: read -> detect -> parse/validate/normalize (adapter) ->
// match (import_match RPC) -> plan with conflicts -> user review ->
// apply in batches (import_apply RPC, idempotent + resumable) -> report.
import { supabase, unwrap } from '@/lib/supabase'
import { chunk } from '@/lib/utils'
import type { LibraryEntry, MediaCategory } from '@/types/db'
import { backloggdAdapter } from './adapters/backloggd'
import { imdbAdapter } from './adapters/imdb'
import { malAdapter } from './adapters/mal'
import { vndbAdapter } from './adapters/vndb'
import { galleryAdapter } from './adapters/gallery'
import type { ImportAdapter, InvalidRecord, NormalizedRecord, ParseResult } from './types'

export const ADAPTERS: ImportAdapter[] = [malAdapter, imdbAdapter, backloggdAdapter, vndbAdapter, galleryAdapter]

export async function readImportFile(file: File): Promise<string> {
  const isGzip = /\.gz$/i.test(file.name) || file.type === 'application/gzip' || file.type === 'application/x-gzip'
  if (!isGzip) return file.text()
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot unpack .gz files. Extract the file first and select the .xml.')
  const stream = file.stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

export function detectAdapter(fileName: string, text: string): ImportAdapter | null {
  const head = text.slice(0, 4000)
  return ADAPTERS.find((a) => a.detect(fileName, head)) ?? null
}

/** A tiny content hash so a resumed import can be tied to the same file. */
export async function hashText(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf).slice(0, 12)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ---------------------------------------------------------------- Matching
export interface MatchInfo {
  source_key: string
  match: 'external_id' | 'none'
  media_id: string | null
  entry: Partial<LibraryEntry> | null
  media: { title: string; release_year: number | null; format: string | null; category: MediaCategory } | null
  candidates: { media_id: string; entry_id: string | null; title: string; release_year: number | null; format: string | null; external_ids: string[] }[]
}

export async function matchRecords(records: NormalizedRecord[], onProgress?: (done: number) => void): Promise<Map<string, MatchInfo>> {
  const out = new Map<string, MatchInfo>()
  let done = 0
  for (const part of chunk(records, 250)) {
    const payload = part.map((r) => ({
      source_key: r.source_key, category: r.media.category, title: r.media.title, year: r.media.release_year ?? null,
      external_ids: r.external_ids.map(({ provider, external_id }) => ({ provider, external_id })),
    }))
    const res = unwrap(await supabase.rpc('import_match', { p_records: payload }), 'import_match') as MatchInfo[]
    for (const m of res) out.set(m.source_key, m)
    done += part.length
    onProgress?.(done)
  }
  return out
}

// ---------------------------------------------------------------- Planning
export type PlanKind = 'new' | 'existing' | 'duplicate' | 'review' | 'skip' | 'invalid'
export type Decision = 'create' | 'merge' | 'skip' | 'invalid'
export type ConflictPolicy = 'merge' | 'keep' | 'imported' | 'skip'

export interface FieldDiff {
  field: string
  current: unknown
  imported: unknown
  /** conflict = both have values that differ; fill = only the import has a value. */
  type: 'conflict' | 'fill'
}

export interface PlanItem {
  record: NormalizedRecord
  kind: PlanKind
  match?: MatchInfo
  diffs: FieldDiff[]
  decision: Decision
  applyFields: string[]
  targetMediaId?: string
  reason?: string
}

const COMPARED = ['status', 'rating', 'episodes_watched', 'chapters_read', 'volumes_read', 'start_date', 'completion_date',
  'imported_repeat_count', 'notes', 'review', 'is_favorite', 'wishlisted_at'] as const

const isEmpty = (field: string, v: unknown) =>
  v == null || v === '' || (typeof v === 'number' && v === 0 && field !== 'rating') || (field === 'is_favorite' && v === false)

/** Compare imported personal values with the current entry. */
export function diffEntry(record: NormalizedRecord, current: Partial<LibraryEntry>): FieldDiff[] {
  const diffs: FieldDiff[] = []
  for (const f of COMPARED) {
    if (!(f in record.entry)) continue
    const imp = (record.entry as Record<string, unknown>)[f]
    const cur = (current as Record<string, unknown>)[f]
    if (f === 'wishlisted_at') {
      if (imp && !cur) diffs.push({ field: f, current: false, imported: true, type: 'fill' })
      continue
    }
    if (isEmpty(f, imp)) continue
    if (isEmpty(f, cur)) diffs.push({ field: f, current: cur ?? null, imported: imp, type: 'fill' })
    else if (String(cur) !== String(imp)) diffs.push({ field: f, current: cur, imported: imp, type: 'conflict' })
  }
  return diffs
}

export function applyPolicy(item: PlanItem, policy: ConflictPolicy): PlanItem {
  if (item.kind !== 'existing') return item
  const conflicts = item.diffs.filter((d) => d.type === 'conflict').map((d) => d.field)
  switch (policy) {
    case 'keep': return { ...item, decision: 'create', applyFields: [] }
    case 'merge': return { ...item, decision: 'merge', applyFields: [] }
    case 'imported': return { ...item, decision: 'merge', applyFields: conflicts }
    case 'skip': return { ...item, decision: 'skip', applyFields: [] }
  }
}

export function buildPlan(parsed: ParseResult, matches: Map<string, MatchInfo>, policy: ConflictPolicy = 'merge'): PlanItem[] {
  const seen = new Set<string>()
  const items: PlanItem[] = []
  for (const r of parsed.records) {
    if (seen.has(r.source_key)) {
      items.push({ record: r, kind: 'invalid', diffs: [], decision: 'invalid', applyFields: [], reason: 'Duplicate row in the file (same id appears earlier)' })
      continue
    }
    seen.add(r.source_key)
    const m = matches.get(r.source_key)
    if (r.defaultSkip) {
      items.push({ record: r, kind: 'skip', match: m, diffs: [], decision: 'skip', applyFields: [], reason: r.defaultSkip })
    } else if (m?.match === 'external_id') {
      const diffs = m.entry ? diffEntry(r, m.entry) : []
      items.push(applyPolicy({ record: r, kind: 'existing', match: m, diffs, decision: 'merge', applyFields: [] }, policy))
    } else if (m?.candidates.length) {
      // Same title (and year) but no shared id: never merged automatically.
      items.push({ record: r, kind: 'duplicate', match: m, diffs: [], decision: 'create', applyFields: [], reason: 'A title with the same name already exists' })
    } else if (r.needsReview) {
      items.push({ record: r, kind: 'review', match: m, diffs: [], decision: 'create', applyFields: [], reason: r.needsReview })
    } else {
      items.push({ record: r, kind: 'new', match: m, diffs: [], decision: 'create', applyFields: [] })
    }
  }
  return items
}

export function invalidToPlan(invalid: InvalidRecord[]): PlanItem[] {
  return invalid.map((iv) => ({
    record: {
      source_key: iv.source_key, row_number: iv.row_number, raw: iv.raw, media: { category: 'movie', title: '(invalid)' },
      titles: [], genres: [], external_ids: [], entry: {}, warnings: [],
    },
    kind: 'invalid', diffs: [], decision: 'invalid', applyFields: [], reason: iv.reason,
  }))
}

export function summarize(plan: PlanItem[]) {
  const byKind: Record<PlanKind, number> = { new: 0, existing: 0, duplicate: 0, review: 0, skip: 0, invalid: 0 }
  const byCategory: Partial<Record<MediaCategory, number>> = {}
  let conflicts = 0
  for (const p of plan) {
    byKind[p.kind]++
    if (p.kind !== 'invalid') byCategory[p.record.media.category] = (byCategory[p.record.media.category] ?? 0) + 1
    if (p.diffs.some((d) => d.type === 'conflict')) conflicts++
  }
  return { total: plan.length, byKind, byCategory, conflicts }
}

// ---------------------------------------------------------------- Execution
export interface ApplyOutcome { source_key: string; outcome: string; message?: string; entry_id?: string; media_id?: string }

/** Convert a plan item into the payload import_apply expects. */
export function toApplyRecord(p: PlanItem) {
  const r = p.record
  return {
    source_key: r.source_key,
    row_number: r.row_number,
    raw: r.raw,
    decision: p.decision,
    message: p.reason ?? (r.warnings.length ? r.warnings.join('; ') : undefined),
    target_media_id: p.targetMediaId,
    media: r.media,
    titles: r.titles,
    genres: r.genres,
    external_ids: r.external_ids,
    entry: r.entry,
    apply_fields: p.applyFields,
    sessions: r.sessions ?? [],
  }
}

export async function createJob(source: ParseResult['source'], fileName: string, options: Record<string, unknown>): Promise<string> {
  const job = unwrap(await supabase.from('import_jobs').insert({ source, file_name: fileName, options, status: 'running' }).select('id').single(), 'create job') as { id: string }
  return job.id
}

/**
 * Apply the plan in batches of 100 records. Each batch is one transaction on
 * the server with per-record isolation; a network failure stops the run and
 * the same job can be resumed later (already processed records are skipped).
 */
export async function runImport(jobId: string, plan: PlanItem[], onProgress: (done: number, outcomes: ApplyOutcome[]) => void, isCancelled: () => boolean) {
  const outcomes: ApplyOutcome[] = []
  let done = 0
  for (const part of chunk(plan, 100)) {
    if (isCancelled()) break
    let res: ApplyOutcome[] | null = null
    for (let attempt = 0; attempt < 3 && !res; attempt++) {
      const { data, error } = await supabase.rpc('import_apply', { p_job_id: jobId, p_records: part.map(toApplyRecord) })
      if (!error) res = data as ApplyOutcome[]
      else if (attempt === 2) throw error
      else await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
    }
    outcomes.push(...res!)
    done += part.length
    onProgress(done, outcomes)
  }
  return outcomes
}

export async function finishJob(jobId: string, status?: 'cancelled' | 'failed') {
  return unwrap(await supabase.rpc('import_finish', { p_job_id: jobId, p_status: status ?? null }), 'finish job') as Record<string, number>
}
