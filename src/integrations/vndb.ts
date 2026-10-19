// VNDB Kana API (https://api.vndb.org/kana). Public, no key, CORS enabled.
import type { ReleaseStatus, TitleKind } from '@/types/db'
import { cached, providerJson } from './http'
import type { ProviderResult } from './types'

const ENDPOINT = 'https://api.vndb.org/kana/vn'
export const VN_FIELDS = 'title,alttitle,titles.title,titles.lang,titles.main,titles.latin,aliases,released,image.url,image.sexual,developers.name,platforms,tags.name,tags.rating,tags.spoiler,tags.category,description,olang,devstatus,relations.id,relations.relation,relations.title,relations.image.url,extlinks.url,extlinks.name'

export interface VnItem {
  id: string
  title: string
  alttitle: string | null
  titles: { title: string; lang: string; main: boolean; latin: string | null }[]
  aliases: string[]
  released: string | null
  image: { url: string; sexual: number } | null
  developers: { name: string }[]
  platforms: string[]
  tags: { name: string; rating: number; spoiler: number; category: string }[]
  description: string | null
  olang: string
  devstatus: number
  relations: { id: string; relation: string; title: string; image: { url: string } | null }[]
}

/** VNDB descriptions use BBCode; keep the text, drop the markup. */
function bbcodeToText(s: string | null): string | null {
  if (!s) return null
  return s.replace(/\[url=[^\]]*\]([\s\S]*?)\[\/url\]/g, '$1').replace(/\[\/?(?:b|i|u|s|spoiler|quote|raw|code)\]/g, '').trim() || null
}

function isoOrNull(d: string | null): string | null {
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null
}

const DEVSTATUS: Record<number, ReleaseStatus> = { 0: 'finished', 1: 'releasing', 2: 'cancelled' }

export function mapVn(v: VnItem): ProviderResult {
  const titles: { title: string; kind: TitleKind }[] = []
  for (const t of v.titles) {
    if (t.title === v.title) continue
    titles.push({ title: t.title, kind: t.lang === 'ja' ? 'japanese' : t.lang === 'ru' ? 'russian' : t.lang === 'en' ? 'english' : 'other' })
    if (t.latin && t.latin !== v.title) titles.push({ title: t.latin, kind: 'romaji' })
  }
  for (const a of v.aliases ?? []) titles.push({ title: a, kind: 'synonym' })
  const year = v.released && /^\d{4}/.test(v.released) ? Number(v.released.slice(0, 4)) : null
  const REL: Record<string, ProviderResult['relations'] extends (infer R)[] | undefined ? R extends { relation_type: infer T } ? T : never : never> = {
    seq: 'sequel', preq: 'prequel', set: 'side_story', alt: 'alternative', char: 'character', side: 'side_story', par: 'parent', ser: 'other', fan: 'spin_off', orig: 'source',
  }
  return {
    provider: 'vndb',
    externalId: v.id,
    category: 'visual_novel',
    title: v.title,
    originalTitle: v.alttitle,
    year,
    releaseDate: isoOrNull(v.released),
    releaseStatus: DEVSTATUS[v.devstatus] ?? null,
    format: 'visual_novel',
    country: v.olang === 'ja' ? 'JP' : v.olang === 'en' ? 'US' : v.olang === 'ko' ? 'KR' : v.olang === 'zh' ? 'CN' : null,
    posterUrl: v.image?.url ?? null,
    synopsis: bbcodeToText(v.description),
    genres: v.tags.filter((t) => t.category === 'cont' && t.spoiler === 0 && t.rating >= 2).slice(0, 6).map((t) => t.name),
    titles,
    externalIds: [{ provider: 'vndb', external_id: v.id, url: `https://vndb.org/${v.id}` }],
    details: {
      developers: v.developers.map((d) => d.name),
      platforms: v.platforms,
      tags: v.tags.filter((t) => t.spoiler === 0 && t.rating >= 1.5).slice(0, 15).map((t) => t.name),
    },
    relations: v.relations.map((r) => ({
      relation_type: REL[r.relation] ?? 'other', provider: 'vndb' as const, external_id: r.id, title: r.title,
      category: 'visual_novel' as const, poster_url: r.image?.url ?? null,
    })),
    // VNDB rates cover images 0 (safe) .. 2 (explicit).
    isAdult: (v.image?.sexual ?? 0) >= 1.5,
    url: `https://vndb.org/${v.id}`,
  }
}

export async function searchVndb(q: string): Promise<ProviderResult[]> {
  const res = await providerJson<{ results: VnItem[] }>('vndb', ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filters: ['search', '=', q], fields: VN_FIELDS, results: 15, sort: 'searchrank' }),
  })
  return res.results.map(mapVn)
}

export async function getVndbById(id: string): Promise<ProviderResult | null> {
  return cached('vndb', `id:${id}`, async () => {
    const res = await providerJson<{ results: VnItem[] }>('vndb', ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filters: ['id', '=', id], fields: VN_FIELDS, results: 1 }),
    })
    return res.results[0] ? mapVn(res.results[0]) : null
  })
}
