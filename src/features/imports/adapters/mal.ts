/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 */
// MyAnimeList XML export ("Export My List", animelist_*.xml.gz / mangalist_*.xml.gz).
// Mapping verified against a real export (format version 1.1.0); see docs/IMPORT_MAPPING.md.
import { tenPointToHalfStars } from '@/lib/rating'
import type { LibraryStatus } from '@/types/db'
import type { ImportAdapter, InvalidRecord, NormalizedRecord, ParseResult } from '../types'

const STATUS: Record<string, LibraryStatus> = {
  watching: 'in_progress', reading: 'in_progress', completed: 'completed', 'on-hold': 'on_hold',
  dropped: 'dropped', 'plan to watch': 'planning', 'plan to read': 'planning',
  // Some older exports use numeric codes.
  '1': 'in_progress', '2': 'completed', '3': 'on_hold', '4': 'dropped', '6': 'planning',
}

const ANIME_FORMAT: Record<string, string> = {
  tv: 'tv', ova: 'ova', ona: 'ona', movie: 'movie', special: 'special', 'tv special': 'special', music: 'music',
  cm: 'other', pv: 'other', unknown: 'other',
}

/** MAL writes unknown dates as 0000-00-00 and partial dates as e.g. 2019-05-00. Only complete dates are kept. */
export function malDate(v: string | undefined): { date: string | null; partial: boolean } {
  if (!v || v.startsWith('0000')) return { date: null, partial: false }
  if (/^\d{4}-\d{2}-\d{2}$/.test(v) && !v.includes('-00')) {
    const d = new Date(`${v}T00:00:00Z`)
    if (!Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v) return { date: v, partial: false }
  }
  return { date: null, partial: true }
}

const int = (v: string | undefined) => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0
}

/** Minimal parser for MAL's flat XML: <anime>/<manga> blocks of simple tags (CDATA aware). */
function parseBlocks(xml: string, tag: 'anime' | 'manga'): Record<string, string>[] {
  const re = tag === 'anime' ? /<anime>([\s\S]*?)<\/anime>/g : /<manga>([\s\S]*?)<\/manga>/g
  const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
  const out: Record<string, string>[] = []
  for (const m of xml.matchAll(re)) {
    const o: Record<string, string> = {}
    for (const f of m[1].matchAll(/<(\w+)>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/\1>/g)) {
      o[f[1]] = f[2] !== undefined ? f[2] : decode(f[3] ?? '')
    }
    out.push(o)
  }
  return out
}

function headerInfo(xml: string): Record<string, string> {
  const info = xml.match(/<myinfo>([\s\S]*?)<\/myinfo>/)?.[1] ?? ''
  return Object.fromEntries([...info.matchAll(/<(\w+)>([^<]*)<\/\1>/g)].map((m) => [m[1], m[2]]))
}

export function parseMal(xml: string, options: Record<string, string>): ParseResult {
  const isManga = /<manga>/.test(xml) && !/<anime>/.test(xml)
  const kind = isManga ? 'manga' : 'anime'
  const items = parseBlocks(xml, kind)
  const records: NormalizedRecord[] = []
  const invalid: InvalidRecord[] = []
  const ptwWishlist = options.ptwWishlist === 'yes'

  items.forEach((it, idx) => {
    const row = idx + 1
    const id = isManga ? it.manga_mangadb_id : it.series_animedb_id
    const title = (isManga ? it.manga_title : it.series_title)?.trim()
    const key = `mal_${kind}:${id ?? `row${row}`}`
    if (!id || !/^\d+$/.test(id)) return invalid.push({ source_key: key, row_number: row, raw: it, reason: 'Missing MyAnimeList id' })
    if (!title) return invalid.push({ source_key: key, row_number: row, raw: it, reason: 'Missing title' })
    const status = STATUS[(it.my_status ?? '').trim().toLowerCase()]
    if (!status) return invalid.push({ source_key: key, row_number: row, raw: it, reason: `Unknown status “${it.my_status}”` })

    const warnings: string[] = []
    const start = malDate(it.my_start_date)
    const finish = malDate(it.my_finish_date)
    if (start.partial || finish.partial) warnings.push('Partial MAL date ignored (only full dates are imported)')
    const startDate = start.date
    let finishDate = finish.date
    if (startDate && finishDate && finishDate < startDate) {
      warnings.push('Finish date before start date — finish date not imported')
      finishDate = null
    }

    // 0 = unknown total in MAL exports. Never stored as 0.
    let totalMain: number | null = int(isManga ? it.manga_chapters : it.series_episodes) || null
    let totalVolumes: number | null = isManga ? int(it.manga_volumes) || null : null
    const progressMain = int(isManga ? it.my_read_chapters : it.my_watched_episodes)
    const progressVolumes = isManga ? int(it.my_read_volumes) : 0
    // Your progress wins over an outdated MAL total: the total is left unknown
    // (to be filled by enrichment) instead of rejecting or truncating progress.
    if (totalMain != null && progressMain > totalMain) {
      warnings.push(`Progress ${progressMain} exceeds MAL total ${totalMain}; total left unknown`)
      totalMain = null
    }
    if (totalVolumes != null && progressVolumes > totalVolumes) {
      warnings.push(`Volumes ${progressVolumes} exceed MAL total ${totalVolumes}; total left unknown`)
      totalVolumes = null
    }

    const repeats = int(isManga ? it.my_times_read : it.my_times_watched)
    const repeating = isManga ? (it.my_rereading ?? '').toUpperCase() === 'YES' : it.my_rewatching === '1'
    const notes = it.my_comments?.replace(/\r\n/g, '\n').trim() || null
    const tags = it.my_tags?.trim()

    records.push({
      source_key: key,
      row_number: row,
      raw: it,
      media: {
        category: isManga ? 'manga' : 'anime',
        title,
        format: isManga ? null : ANIME_FORMAT[(it.series_type ?? '').toLowerCase()] ?? null,
        ...(isManga ? { total_chapters: totalMain, total_volumes: totalVolumes } : { total_episodes: totalMain }),
      },
      titles: [],
      genres: [],
      external_ids: [{ provider: isManga ? 'mal_manga' : 'mal_anime', external_id: id, url: `https://myanimelist.net/${kind}/${id}` }],
      entry: {
        status,
        rating: tenPointToHalfStars(it.my_score),
        ...(isManga ? { chapters_read: progressMain, volumes_read: progressVolumes } : { episodes_watched: progressMain }),
        start_date: startDate,
        completion_date: status === 'completed' ? finishDate : null,
        imported_repeat_count: repeats,
        notes: tags ? `${notes ? `${notes}\n\n` : ''}MAL tags: ${tags}` : notes,
        ...(status === 'planning' && ptwWishlist ? { wishlisted_at: new Date().toISOString() } : {}),
      },
      sessions: repeating ? [{
        session_type: isManga ? 'reread' : 'rewatch', status: 'active', start_date: null, end_date: null,
        notes: `In progress on MyAnimeList (${isManga ? 'chapter' : 'episode'} ${(isManga ? it.my_rereading_chap : it.my_rewatching_ep) ?? '?'})`,
      }] : undefined,
      warnings,
    })
  })

  const info = headerInfo(xml)
  return {
    source: 'mal_xml',
    records,
    invalid,
    meta: {
      kind,
      user: info.user_name,
      declaredTotal: Number(info[isManga ? 'user_total_manga' : 'user_total_anime']) || null,
      parsed: items.length,
    },
  }
}

export const malAdapter: ImportAdapter = {
  source: 'mal_xml',
  label: 'MyAnimeList (XML export)',
  detect: (name, head) => /<myanimelist>/i.test(head) || /^(anime|manga)list_.*\.xml(\.gz)?$/i.test(name),
  options: [
    {
      key: 'ptwWishlist',
      label: 'Plan to Watch / Plan to Read',
      description: 'Imported as status Planning. Optionally also add them to the category Wishlist.',
      choices: [{ value: 'no', label: 'Planning only' }, { value: 'yes', label: 'Planning + Wishlist' }],
      default: 'no',
    },
  ],
  parse: parseMal,
}
