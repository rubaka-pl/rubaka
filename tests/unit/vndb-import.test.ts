// @vitest-environment node
import { fetchVndbList, parseVndb, resolveVndbUser, type VndbListItem } from '@/features/imports/adapters/vndb'

const vn = (title: string, alttitle: string | null = null) => ({
  title, alttitle, titles: [{ title: alttitle ?? title, lang: 'ja', main: true, latin: title }], aliases: [], released: '2003-12-26',
  image: { url: 'https://t.vndb.org/cv/x.jpg', sexual: 0 }, developers: [{ name: 'NITRO PLUS' }], platforms: ['win'],
  tags: [{ name: 'Horror', rating: 2.5, spoiler: 0, category: 'cont' }], description: '[b]Desc[/b]', olang: 'ja', devstatus: 0, relations: [],
})

const items: VndbListItem[] = [
  { id: 'v97', added: 1700000000, started: '2020-01-01', finished: '2020-01-10', vote: 85, voted: 1700000000, notes: 'great', labels: [{ id: 2, label: 'Finished' }, { id: 7, label: 'Voted' }, { id: 13, label: 'Waiting' }], vn: vn('Saya no Uta', '沙耶の唄') },
  { id: 'v45', added: 1218014544, started: null, finished: null, vote: null, voted: null, notes: null, labels: [{ id: 5, label: 'Wishlist' }], vn: vn('Phantom') },
  { id: 'v1', added: null, started: null, finished: null, vote: 60, voted: 1, notes: null, labels: [{ id: 7, label: 'Voted' }], vn: vn('Voted Only') },
  { id: 'v2', added: null, started: null, finished: null, vote: null, voted: null, notes: null, labels: [{ id: 6, label: 'Blacklist' }], vn: vn('Nope') },
] as VndbListItem[]

test('maps VNDB labels, votes, dates and metadata', () => {
  const res = parseVndb(JSON.stringify({ user: 'tester', items }), {})
  const by = (id: string) => res.records.find((r) => r.source_key === `vndb:${id}`)!
  const saya = by('v97')
  expect(saya.entry).toMatchObject({ status: 'completed', rating: 9, start_date: '2020-01-01', completion_date: '2020-01-10' })
  expect(saya.entry.notes).toBe('great\n\nVNDB labels: Waiting')
  expect(saya.media).toMatchObject({ category: 'visual_novel', title: 'Saya no Uta', original_title: '沙耶の唄', poster_url: 'https://t.vndb.org/cv/x.jpg', synopsis: 'Desc' })
  expect(saya.external_ids[0]).toMatchObject({ provider: 'vndb', external_id: 'v97' })
  expect(by('v45').entry).toMatchObject({ status: 'planning', rating: null, wishlisted_at: '2008-08-06T09:22:24.000Z' })
  expect(by('v1').entry.status).toBe('completed')
  expect(by('v1').needsReview).toBeTruthy()
  expect(by('v2').defaultSkip).toBeTruthy()
})

// Opt-in: the real API with a public list (VNDB's author, u2).
test.skipIf(!process.env.RUBAKA_LIVE)('live: reads a real public VNDB list', async () => {
  const user = await resolveVndbUser('yorhel')
  expect(user?.id).toBe('u2')
  const list = await fetchVndbList(user!.id)
  const res = parseVndb(JSON.stringify({ user: user!.username, items: list }), {})
  console.log('live VNDB:', list.length, 'items ->', res.records.length, 'records,', res.invalid.length, 'invalid,',
    Object.entries(res.records.reduce<Record<string, number>>((m, r) => ({ ...m, [r.entry.status!]: (m[r.entry.status!] ?? 0) + 1 }), {})))
  expect(res.records.length + res.invalid.length).toBe(list.length)
  expect(res.records.every((r) => r.media.title && r.external_ids.length === 1)).toBe(true)
}, 120000)

test('scope: Finished + Wishlist by default, other labels skipped (not dropped)', () => {
  const res = parseVndb(JSON.stringify({ user: 'tester', items }), {})
  const skipped = res.records.filter((r) => r.defaultSkip).map((r) => r.source_key).sort()
  expect(skipped).toEqual(['vndb:v1', 'vndb:v2'])
  const all = parseVndb(JSON.stringify({ user: 'tester', items }), { scope: 'no_blacklist' })
  expect(all.records.filter((r) => r.defaultSkip).map((r) => r.source_key)).toEqual(['vndb:v2'])
})
