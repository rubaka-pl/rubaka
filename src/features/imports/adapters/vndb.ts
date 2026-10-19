/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 */
// VNDB user list, read directly from the official Kana API (no file needed).
// Public lists need only the username; private labels need a personal API
// token with "listread" permission (used for this request only, never stored).
// Built-in labels: 1 Playing, 2 Finished, 3 Stalled, 4 Dropped, 5 Wishlist,
// 6 Blacklist, 7 Voted. Custom labels (id >= 10) are kept in the notes.
import { isISODate } from '@/lib/dates'
import { providerJson } from '@/integrations/http'
import { mapVn, VN_FIELDS, type VnItem } from '@/integrations/vndb'
import { toMediaPatch } from '@/integrations/types'
import type { LibraryStatus } from '@/types/db'
import type { ImportAdapter, InvalidRecord, NormalizedRecord, ParseResult } from '../types'

const API = 'https://api.vndb.org/kana'

export interface VndbListItem {
  id: string
  added: number | null
  started: string | null
  finished: string | null
  vote: number | null
  voted: number | null
  notes: string | null
  labels: { id: number; label: string }[]
  vn: Omit<VnItem, 'id'>
}

/** Resolve a username or "u123" id. Returns null when the user does not exist. */
export async function resolveVndbUser(name: string): Promise<{ id: string; username: string } | null> {
  const q = name.trim()
  const res = await providerJson<Record<string, { id: string; username: string } | null>>('vndb', `${API}/user?q=${encodeURIComponent(q)}`)
  return res[q] ?? null
}

/** Fetch the whole list (100 per page). */
export async function fetchVndbList(userId: string, token?: string, onPage?: (n: number) => void): Promise<VndbListItem[]> {
  const fields = ['id', 'added', 'started', 'finished', 'vote', 'voted', 'notes', 'labels.id', 'labels.label',
    ...VN_FIELDS.split(',').map((f) => `vn.${f}`)].join(',')
  const out: VndbListItem[] = []
  for (let page = 1; page < 200; page++) {
    const res = await providerJson<{ results: VndbListItem[]; more: boolean }>('vndb', `${API}/ulist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Token ${token.trim()}` } : {}) },
      body: JSON.stringify({ user: userId, fields, results: 100, page, sort: 'id' }),
    })
    out.push(...res.results)
    onPage?.(out.length)
    if (!res.more) break
  }
  return out
}

const LABEL_STATUS: [number, LibraryStatus][] = [[2, 'completed'], [1, 'in_progress'], [3, 'on_hold'], [4, 'dropped']]

export function parseVndb(text: string, options: Record<string, string>): ParseResult {
  const { user, items } = JSON.parse(text) as { user: string; items: VndbListItem[] }
  const records: NormalizedRecord[] = []
  const invalid: InvalidRecord[] = []
  const votedOnly = (options.votedOnly ?? 'completed') as LibraryStatus
  const scope = options.scope ?? 'finished_wishlist'

  items.forEach((it, i) => {
    const key = `vndb:${it.id}`
    if (!it.vn?.title) return invalid.push({ source_key: key, row_number: i + 1, raw: it, reason: 'Missing visual novel data' })
    const ids = new Set(it.labels.map((l) => l.id))
    const warnings: string[] = []
    let needsReview: string | undefined
    let defaultSkip: string | undefined
    // Status priority: Finished > Playing > Stalled > Dropped; otherwise planning.
    let status: LibraryStatus = LABEL_STATUS.find(([id]) => ids.has(id))?.[1] ?? 'planning'
    if (status === 'planning' && it.vote != null && !ids.has(5)) {
      status = votedOnly
      needsReview = 'Has a vote but no Finished/Playing label'
    }
    // Which labels to import. Everything else is shown as skipped (and recorded), never silently dropped.
    if (scope === 'finished_wishlist' && !ids.has(2) && !ids.has(5)) defaultSkip = 'Not Finished or Wishlist on VNDB'
    else if (scope === 'no_blacklist' && ids.has(6)) defaultSkip = 'Blacklisted on VNDB'
    else if (ids.has(6) && ids.size === 1) defaultSkip = 'Blacklisted on VNDB'
    const custom = it.labels.filter((l) => l.id >= 10).map((l) => l.label)

    const r = mapVn({ ...it.vn, id: it.id } as VnItem)
    const start = isISODate(it.started) ? it.started : null
    let finish = isISODate(it.finished) ? it.finished : null
    if (start && finish && finish < start) { warnings.push('Finish date before start date — finish date not imported'); finish = null }
    const added = it.added ? new Date(it.added * 1000).toISOString() : null
    const notes = [it.notes?.trim(), custom.length ? `VNDB labels: ${custom.join(', ')}` : ''].filter(Boolean).join('\n\n') || null

    records.push({
      source_key: key,
      row_number: i + 1,
      raw: { ...it, vn: { title: it.vn.title } },
      media: { ...toMediaPatch(r), category: 'visual_novel', title: r.title },
      titles: r.titles ?? [],
      genres: r.genres ?? [],
      external_ids: r.externalIds,
      entry: {
        status,
        // VNDB votes are 10..100 (1.0–10.0); half-stars are 1..10.
        rating: it.vote != null ? Math.min(10, Math.max(1, Math.round(it.vote / 10))) : null,
        start_date: start,
        completion_date: status === 'completed' ? finish : null,
        notes,
        added_at: added,
        ...(ids.has(5) ? { wishlisted_at: added ?? new Date().toISOString() } : {}),
      },
      warnings,
      needsReview,
      defaultSkip,
    })
  })
  return { source: 'vndb_api', records, invalid, meta: { user, parsed: items.length } }
}

export const vndbAdapter: ImportAdapter = {
  source: 'vndb_api',
  label: 'VNDB (user list via API)',
  detect: () => false, // not a file: started from the VNDB form on the Import page
  options: [
    {
      key: 'scope',
      label: 'What to import',
      description: 'Entries outside this selection are listed as skipped (you can still include single ones).',
      choices: [
        { value: 'finished_wishlist', label: 'Finished + Wishlist' },
        { value: 'no_blacklist', label: 'Everything except Blacklist' },
        { value: 'all', label: 'Everything' },
      ],
      default: 'finished_wishlist',
    },
    {
      key: 'votedOnly',
      label: 'Voted, but no status label',
      description: 'VNDB entries with a vote and no Playing/Finished/Stalled/Dropped label.',
      choices: [{ value: 'completed', label: 'Completed' }, { value: 'planning', label: 'Planning' }],
      default: 'completed',
    },
  ],
  parse: parseVndb,
}
