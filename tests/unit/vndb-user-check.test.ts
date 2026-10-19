// @vitest-environment node
// Opt-in: preview how a real user's VNDB list would be imported (RUBAKA_VNDB_USER=u12345).
import { fetchVndbList, parseVndb } from '@/features/imports/adapters/vndb'

const USER = process.env.RUBAKA_VNDB_USER
test.skipIf(!USER)('preview a real VNDB list with default options', async () => {
  const list = await fetchVndbList(USER!)
  const res = parseVndb(JSON.stringify({ user: USER, items: list }), {})
  const imported = res.records.filter((r) => !r.defaultSkip)
  const tally = (rs: typeof imported, f: (r: (typeof imported)[number]) => string) => rs.reduce<Record<string, number>>((m, r) => ({ ...m, [f(r)]: (m[f(r)] ?? 0) + 1 }), {})
  console.log('total', list.length, '| imported', imported.length, tally(imported, (r) => `${r.entry.status}${r.entry.wishlisted_at ? '+wishlist' : ''}`),
    '| rated', imported.filter((r) => r.entry.rating != null).length, '| skipped', res.records.length - imported.length, tally(res.records.filter((r) => r.defaultSkip), (r) => r.defaultSkip!))
}, 120000)
