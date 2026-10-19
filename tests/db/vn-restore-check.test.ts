// @vitest-environment node
// One-off check of a generated backup file (skipped unless RUBAKA_CHECK_BACKUP is set).
import { readFileSync } from 'node:fs'
import { backupSchema } from '@/features/settings/backup'
import { as, createTestDb, OWNER } from './harness'

const FILE = process.env.RUBAKA_CHECK_BACKUP

test.skipIf(!FILE)('generated backup restores and is searchable', async () => {
  const b = JSON.parse(readFileSync(FILE!, 'utf8'))
  expect(backupSchema.safeParse(b).success).toBe(true)
  const db = await createTestDb()
  for (const t of ['media', 'media_titles', 'media_external_ids', 'library_entries']) {
    const n = await as(db, OWNER, async (tx) => (await tx.query<{ n: number }>('select restore_rows($1, $2) as n', [t, JSON.stringify(b.tables[t])])).rows[0].n)
    expect(n).toBe(b.tables[t].length)
  }
  await as(db, OWNER, (tx) => tx.query('select restore_media_genres($1)', [JSON.stringify(b.tables.media_genres)]))
  const hits = async (q: string) => as(db, OWNER, async (tx) => (await tx.query<{ title: string }>(`select title from library_query(p_search => $1)`, [q])).rows.map((r) => r.title))
  expect(await hits('沙耶の唄')).toContain('Saya no Uta')
  expect(await hits('steins gate')).toContain('STEINS;GATE')
  expect(await hits('ものべの')).toContain('Monobeno -Happy End-')
  const rows = await as(db, OWNER, async (tx) => (await tx.query<{ status: string; genres: string[] }>(`select status, genres from library_query(p_category => 'visual_novel')`)).rows)
  expect(rows).toHaveLength(5)
  expect(rows.every((r) => r.status === 'completed' && r.genres.length > 0)).toBe(true)
})
