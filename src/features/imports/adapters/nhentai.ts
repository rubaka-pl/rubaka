/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 */
// nhentai favourites, exported in the browser with the script from
// Settings → Import (one JSON array of galleries as the nhentai API returns
// them, plus the thumbnail URL from the favourites page).
import type { ImportAdapter, InvalidRecord, NormalizedRecord, ParseResult } from '../types'

interface Gallery {
  id: number | string
  media_id?: string
  title?: { english?: string | null; japanese?: string | null; pretty?: string | null }
  num_pages?: number
  upload_date?: number
  tags?: { type: string; name: string }[]
  /** Cover / thumbnail as shown on the favourites page. */
  thumb?: string | null
}

/**
 * Sexual content involving characters who are minors is never imported,
 * whatever the source says about the characters' ages.
 */
export const EXCLUDED_TAG = /loli|shota|toddler/i

export function isExcluded(g: Pick<Gallery, 'tags'>): string | null {
  const hit = (g.tags ?? []).find((t) => EXCLUDED_TAG.test(t.name))
  return hit ? hit.name : null
}

const names = (g: Gallery, type: string) => (g.tags ?? []).filter((t) => t.type === type).map((t) => t.name)

export function parseNhentai(text: string): ParseResult {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { source: 'nhentai_json', records: [], invalid: [{ source_key: 'file', row_number: 0, raw: null, reason: 'Not valid JSON' }], meta: {} }
  }
  const list = (Array.isArray(data) ? data : []) as Gallery[]
  const records: NormalizedRecord[] = []
  const invalid: InvalidRecord[] = []
  let excluded = 0
  list.forEach((g, i) => {
    const id = String(g.id ?? '').trim()
    const title = (g.title?.pretty || g.title?.english || g.title?.japanese || '').trim()
    if (!/^\d+$/.test(id) || !title) {
      invalid.push({ source_key: `row:${i}`, row_number: i + 1, raw: g, reason: 'Missing gallery id or title' })
      return
    }
    const banned = isExcluded(g)
    if (banned) {
      excluded++
      invalid.push({ source_key: `nhentai:${id}`, row_number: i + 1, raw: { id }, reason: `Excluded (tag “${banned}”): content involving minors is not imported` })
      return
    }
    const category = names(g, 'category')[0] ?? null
    const format = category === 'artistcg' || category === 'gamecg' ? 'artist_cg' : 'doujinshi'
    const tags = names(g, 'tag')
    const english = g.title?.english?.trim()
    records.push({
      source_key: `nhentai:${id}`,
      row_number: i + 1,
      raw: g,
      media: {
        category: 'doujinshi',
        title,
        original_title: g.title?.japanese?.trim() || null,
        format,
        poster_url: g.thumb || null,
        details: {
          pages: g.num_pages ?? undefined,
          artists: names(g, 'artist'),
          groups: names(g, 'group'),
          parodies: names(g, 'parody').filter((p) => p !== 'original'),
          characters: names(g, 'character'),
          languages: names(g, 'language').filter((l) => l !== 'translated'),
          tags,
          ...(g.upload_date ? { uploaded: new Date(g.upload_date * 1000).toISOString().slice(0, 10) } : {}),
          is_adult: true,
        } as NormalizedRecord['media']['details'],
      },
      titles: english && english !== title ? [{ title: english, kind: 'english' }] : [],
      genres: tags.slice(0, 25),
      external_ids: [{ provider: 'nhentai', external_id: id, url: `https://nhentai.net/g/${id}/` }],
      entry: { status: 'completed' },
      warnings: [],
    })
  })
  return { source: 'nhentai_json', records, invalid, meta: { galleries: list.length, excluded } }
}

export const nhentaiAdapter: ImportAdapter = {
  source: 'nhentai_json',
  label: 'nhentai favourites (JSON from the export script)',
  detect: (name, head) => /\.json$/i.test(name) && /"num_pages"/.test(head) && /"media_id"/.test(head),
  options: [],
  parse: (text) => parseNhentai(text),
}
