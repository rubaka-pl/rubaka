import { parseNhentai } from '@/features/imports/adapters/nhentai'

const g = (id: number, tags: [string, string][], extra: Record<string, unknown> = {}) => ({
  id, media_id: String(id * 10), num_pages: 24, upload_date: 1700000000,
  title: { english: `[Circle] Work ${id}`, japanese: `作品${id}`, pretty: `Work ${id}` },
  tags: tags.map(([type, name]) => ({ type, name })), thumb: `https://t.example/${id}.jpg`, ...extra,
})

test('nhentai favourites: maps galleries, excludes anything tagged with minors', () => {
  const r = parseNhentai(JSON.stringify([
    g(1, [['category', 'doujinshi'], ['artist', 'someone'], ['parody', 'original'], ['tag', 'big breasts'], ['language', 'english'], ['language', 'translated']]),
    g(2, [['category', 'doujinshi'], ['tag', 'lolicon']]),
    g(3, [['category', 'artistcg'], ['tag', 'low shotacon']]),
    g(4, [['category', 'artistcg'], ['group', 'circle']]),
    { id: 'x' },
  ]))
  expect(r.records.map((x) => x.source_key)).toEqual(['nhentai:1', 'nhentai:4'])
  const a = r.records[0]
  expect(a.media).toMatchObject({ category: 'doujinshi', title: 'Work 1', original_title: '作品1', format: 'doujinshi', poster_url: 'https://t.example/1.jpg' })
  expect(a.media.details).toMatchObject({ pages: 24, artists: ['someone'], parodies: [], languages: ['english'], tags: ['big breasts'], is_adult: true })
  expect(a.titles).toEqual([{ title: '[Circle] Work 1', kind: 'english' }])
  expect(a.external_ids).toEqual([{ provider: 'nhentai', external_id: '1', url: 'https://nhentai.net/g/1/' }])
  expect(a.entry.status).toBe('completed')
  expect(r.records[1].media.format).toBe('artist_cg')
  expect(r.meta.excluded).toBe(2)
  expect(r.invalid.filter((x) => /minors/.test(x.reason))).toHaveLength(2)
  expect(r.invalid.some((x) => /Missing/.test(x.reason))).toBe(true)
})
