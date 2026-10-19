// Open Library search API (https://openlibrary.org/developers/api). No key.
import { providerJson } from './http'
import type { ProviderResult } from './types'

interface OlDoc {
  key: string
  title: string
  author_name?: string[]
  first_publish_year?: number
  cover_i?: number
  publisher?: string[]
  subject?: string[]
  language?: string[]
}

function mapDoc(d: OlDoc): ProviderResult {
  const id = d.key.replace('/works/', '')
  return {
    provider: 'openlibrary',
    externalId: id,
    category: 'novel',
    title: d.title,
    year: d.first_publish_year ?? null,
    format: 'novel',
    posterUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : null,
    genres: [],
    externalIds: [{ provider: 'openlibrary', external_id: id, url: `https://openlibrary.org${d.key}` }],
    details: {
      ...(d.author_name?.length ? { authors: d.author_name.slice(0, 4) } : {}),
      ...(d.publisher?.length ? { publishers: d.publisher.slice(0, 3) } : {}),
      ...(d.subject?.length ? { tags: d.subject.slice(0, 10) } : {}),
    },
    url: `https://openlibrary.org${d.key}`,
  }
}

export async function searchOpenLibrary(q: string): Promise<ProviderResult[]> {
  const fields = 'key,title,author_name,first_publish_year,cover_i,publisher,subject,language'
  const res = await providerJson<{ docs: OlDoc[] }>('openlibrary', `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=15&fields=${fields}`)
  return res.docs.map(mapDoc)
}
